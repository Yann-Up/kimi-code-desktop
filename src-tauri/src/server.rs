//! server-manager: 管理 `kimi web` 服务进程的生命周期(本机 / WSL / SSH 三种连接目标)。
//! - 检测 kimi CLI 是否存在及版本
//! - 启动前回收同 home 的残留实例(崩溃/强杀留下的孤儿,POST shutdown + pid 强杀兜底),
//!   让端口恒定为 58666:iframe 源(origin)稳定,web UI 按源存 localStorage 的
//!   "新浏览器"验证才不会每次启动重弹
//! - 选择空闲端口,按连接目标启动 `kimi web --no-open --port <p>`
//!   (Local/WSL 为本地子进程;SSH 为 russh exec_keepalive + 进程内端口转发)
//! - 读取 token:先解析启动 banner(CLI 0.29.2+ 只在 banner 打印 Token 行),
//!   超时回退 server.token 文件读取(本机读文件,WSL/SSH 经各自通道 cat,兼容旧 CLI)
//! - 轮询 /api/v1/healthz 直到就绪(三种目标下都连 127.0.0.1:<本地端口>)
//! - 优雅关停(POST /api/v1/shutdown → 等待退出 → 强杀/断连兜底)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use tauri::AppHandle;

use crate::ssh::SshProcess;
use crate::target::ConnectionTarget;

/// 默认起始端口:配合启动前的残留实例回收(reclaim_stale_instances),iframe 源恒定为此端口;
/// 仅当被 kimi 以外的程序占用时才 +1 顺延(free_port 兜底)。设置页可改(web_server_set)
pub const START_PORT: u16 = 58666;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(45);
/// 等待启动 banner 打印 token 的超时(CLI 0.29.2+ 只打印、不写 server.token);
/// 超时后回退旧 CLI 的 server.token 文件轮询
const BANNER_TOKEN_TIMEOUT: Duration = Duration::from_secs(12);

/// kimi web 启动参数(设置页「服务启动参数」可配;改动经 web_server_set 落盘并重启服务生效)
#[derive(Clone)]
pub struct WebOptions {
    /// 首选端口(默认 58666;被占时 free_port 顺延)
    pub port: u16,
    /// 绑定 0.0.0.0 允许局域网访问(--host 0.0.0.0);默认 false = 仅 127.0.0.1
    pub open_host: bool,
    /// 追加 --allowed-host:非 loopback 的 Host 头默认被 DNS-rebinding 检查拦截,
    /// 局域网内用 IP/域名访问时必须把对应主机名加进来
    pub allowed_hosts: Vec<String>,
}

impl Default for WebOptions {
    fn default() -> Self {
        Self {
            port: START_PORT,
            open_host: false,
            allowed_hosts: Vec::new(),
        }
    }
}

impl WebOptions {
    /// Local/WSL 子进程的命令行参数形态
    pub fn cli_args(&self) -> Vec<String> {
        let mut args = Vec::new();
        if self.open_host {
            args.push("--host".into());
            args.push("0.0.0.0".into());
        }
        for h in &self.allowed_hosts {
            args.push("--allowed-host".into());
            args.push(h.clone());
        }
        args
    }

    /// SSH/WSL 拼接进 shell 命令串的形态(host 值过单引号转义)
    pub fn shell_suffix(&self) -> String {
        let mut s = String::new();
        if self.open_host {
            s.push_str(" --host 0.0.0.0");
        }
        for h in &self.allowed_hosts {
            s.push_str(&format!(" --allowed-host {}", crate::target::sq(h)));
        }
        s
    }
}

/// 当前生效的启动参数(启动时从 desktop-config.json 加载,web_server_set 更新)
static WEB_OPTIONS: std::sync::RwLock<WebOptions> = std::sync::RwLock::new(WebOptions {
    port: START_PORT,
    open_host: false,
    allowed_hosts: Vec::new(),
});

pub fn set_web_options(opts: WebOptions) {
    *WEB_OPTIONS.write().unwrap() = opts;
}

pub fn web_options() -> WebOptions {
    WEB_OPTIONS.read().unwrap().clone()
}

pub type SharedServer = Arc<tokio::sync::Mutex<ServerManager>>;

/// banner token 共享槽位:启动输出 drain(本地 stdout/stderr、SSH pty 两路)
/// 捕获到 token 行后写入,启动流程 await_token 等待;store 幂等(只保留第一个),
/// 通知用 notify_one(无等待者时存一个 permit,不会丢通知)
#[derive(Clone)]
pub struct TokenSlot {
    inner: Arc<tokio::sync::Mutex<Option<String>>>,
    notify: Arc<tokio::sync::Notify>,
}

impl Default for TokenSlot {
    fn default() -> Self {
        Self {
            inner: Arc::new(tokio::sync::Mutex::new(None)),
            notify: Arc::new(tokio::sync::Notify::new()),
        }
    }
}

impl TokenSlot {
    pub fn new() -> Self {
        Self::default()
    }

    /// 写入 token(幂等:只接受第一个),唤醒等待者
    pub async fn store(&self, token: String) {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            *guard = Some(token);
            self.notify.notify_one();
        }
    }

    /// 等待 token,超时返回 None(调用方据此回退 server.token 文件轮询)
    pub async fn await_token(&self, timeout: Duration) -> Option<String> {
        tokio::time::timeout(timeout, async {
            loop {
                if let Some(t) = self.inner.lock().await.clone() {
                    return t;
                }
                self.notify.notified().await;
            }
        })
        .await
        .ok()
    }
}

/// 从启动 banner 行提取 token,两种形态(CLI 0.29.2+ 只在 banner 打印):
/// - `Token: <value>` 独立行
/// - URL hash `...#token=<value>`(Local URL 行)
/// token 字符集为 [A-Za-z0-9_-=],命中即返回,未命中 None
pub(crate) fn parse_banner_token(line: &str) -> Option<String> {
    // URL hash 形态
    if let Some(pos) = line.find("#token=") {
        let rest = &line[pos + "#token=".len()..];
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '='))
            .unwrap_or(rest.len());
        let tok = &rest[..end];
        if !tok.is_empty() {
            return Some(tok.to_string());
        }
    }
    // 独立 Token 行形态(大小写不敏感)
    let lower = line.to_lowercase();
    if let Some(pos) = lower.find("token:") {
        let rest = line[pos + "token:".len()..].trim_start();
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '='))
            .unwrap_or(rest.len());
        let tok = &rest[..end];
        if !tok.is_empty() {
            return Some(tok.to_string());
        }
    }
    None
}

#[derive(Clone)]
pub struct ServerInfo {
    pub port: u16,
    pub base_url: String,
    pub token: String,
    pub cli_version: String,
    pub meta: Option<serde_json::Value>,
}

/// 启动前回收同 home 的残留 kimi web 实例(仅 Local/WSL):
/// 上次运行未优雅关停(应用崩溃/强杀;WSL 下 wsl.exe 会话结束、Linux 侧进程被 /init 收养)
/// 会留下孤儿占住低端口,新实例被迫端口漂移 → iframe 源(origin)变化 →
/// web UI 存于 localStorage 的"新浏览器"验证状态每次启动都失效。
/// 同 home 实例共享同一 token 与会话数据,残留实例纯冗余:先 POST shutdown 优雅关停,
/// 端口 8s 内不还则按注册表登记的 pid 兜底强杀。
/// token 读不到(server.token 缺失)时整体跳过——回收是尽力而为,不阻塞启动
async fn reclaim_stale_instances(http: &reqwest::Client, target: &ConnectionTarget) {
    if matches!(target, ConnectionTarget::Ssh { .. }) {
        return;
    }
    let token = match target.read_token_once().await {
        Ok(Some(t)) => t,
        _ => return,
    };
    for (port, pid) in target.list_server_instances().await {
        let base = format!("http://127.0.0.1:{port}");
        let healthy = http
            .get(format!("{base}/api/v1/healthz"))
            .bearer_auth(&token)
            .timeout(Duration::from_millis(1500))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if !healthy {
            continue; // 进程已死、仅注册表残留,跳过
        }
        eprintln!("[kimi-web] 回收残留实例 port={port} pid={pid}");
        let _ = http
            .post(format!("{base}/api/v1/shutdown"))
            .bearer_auth(&token)
            .timeout(Duration::from_secs(3))
            .send()
            .await;
        // 轮询等端口释放(进程退出后监听 socket 关闭),最多 8s,超时兜底强杀
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
                break;
            }
            if Instant::now() > deadline {
                eprintln!("[kimi-web] 残留实例 port={port} 未在 8s 内退出,按注册表 pid={pid} 强杀");
                target.kill_pid(pid).await;
                break;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }
}

/// 从 from 起连续试 50 个端口,返回第一个可绑定的(保真实现,不用端口 0)
fn free_port(from: u16) -> Result<u16, String> {
    for p in from..from + 50 {
        if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return Ok(p);
        }
    }
    Err("no free port found".to_string())
}

/// 强杀子进程;Windows 下 .cmd shim(npm 全局安装)的直接子进程是 cmd.exe,
/// 普通 kill 只杀壳进程,真正的 node 服务进程变孤儿(继续占用端口与数据目录,
/// 还可能最后写 server.token 污染下次启动),故用 taskkill /T 杀整棵进程树。
/// 先 try_wait 确认仍在运行:进程已退出时 pid 可能已被系统复用,误杀他人
async fn kill_child_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        if matches!(child.try_wait(), Ok(None)) {
            if let Some(pid) = child.id() {
                let _ = crate::cli::hidden_command("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .kill_on_drop(true)
                    .output()
                    .await;
                return;
            }
        }
    }
    let _ = child.kill().await;
}

/// 启动失败/超时清理:Process 强杀;Ssh 关通道使远端收 HUP
async fn kill_handle(handle: ServiceHandle) {
    match handle {
        ServiceHandle::Process(child) => {
            kill_child_tree(&mut *child.lock().await).await;
        }
        ServiceHandle::Ssh(proc) => proc.shutdown().await,
    }
}

/// 服务句柄:本地子进程(Local/WSL)或远端常驻进程(SSH,russh pty 通道)
pub enum ServiceHandle {
    Process(Arc<tokio::sync::Mutex<Child>>),
    Ssh(SshProcess),
}

pub struct ServerManager {
    proc: Option<ServiceHandle>,
    info: Option<ServerInfo>,
    /// stop 置位;每次 start 新建(代次隔离):旧代监控任务持有旧 flag,stop 后恒为 true,
    /// 不会被新代 start 复位 —— 否则 restart 后旧监控看到旧进程已退出且 flag=false,
    /// 误走一遍意外退出清理并多广播一次虚假 server:exited
    stopping: Arc<AtomicBool>,
}

impl Default for ServerManager {
    fn default() -> Self {
        Self {
            proc: None,
            info: None,
            stopping: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl ServerManager {
    pub async fn current(shared: &SharedServer) -> Option<ServerInfo> {
        shared.lock().await.info.clone()
    }

    /// 启动 kimi web:target 指定通道的连接目标(channel 为通道 id,用于意外退出回调与错误上报)。
    /// 启动流程本身(banner token / healthz)与单通道时代完全一致,仅按通道隔离实例。
    pub async fn start(
        shared: &SharedServer,
        http: &reqwest::Client,
        app: &AppHandle,
        channel: &str,
        target: &ConnectionTarget,
    ) -> Result<ServerInfo, String> {
        let mut mgr = shared.lock().await;
        if let Some(info) = &mgr.info {
            return Ok(info.clone());
        }
        // 每次 start 新建 stopping 标志:旧代监控任务持有旧 flag(stop 后恒 true,
        // 见上),新代监控持有新 flag,互不干扰
        mgr.stopping = Arc::new(AtomicBool::new(false));
        // 连接目标决定启动/读 token/检测 CLI 的方式;REST/WS 永远连 127.0.0.1:port
        let cli_version = target.detect_cli().await?;
        // 启动参数(设置页可配):首选端口 / --host 0.0.0.0 / --allowed-host
        let opts = web_options();
        // 回收残留实例(崩溃/强杀留下的孤儿),把首选端口还回来,
        // 保证 iframe 源跨启动稳定(web UI 的"新浏览器"验证状态按源存 localStorage)
        reclaim_stale_instances(http, target).await;
        let port = free_port(opts.port)?;

        // 退出探针:Process 用 try_wait,Ssh 探测通道活性(远端关闭/断连时翻 false)
        #[derive(Clone)]
        enum ExitProbe {
            Process(Arc<tokio::sync::Mutex<Child>>),
            Ssh(Arc<AtomicBool>),
        }

        // stderr 尾部缓冲:启动失败时随错误返回,帮助定位(仅本机/WSL 子进程写入)
        let stderr_tail = Arc::new(std::sync::Mutex::new(String::new()));

        let (handle, probe, token_slot) = match &target {
            ConnectionTarget::Ssh { .. } => {
                // 单连接方案:共享连接上 exec_keepalive 跑 kimi web,再做进程内 -L 等价转发;
                // 关停时关闭通道,远端进程随 pty 断开收 SIGHUP,生命周期干净。
                // 远端端口与本地相同(本地 free_port 选出,远端大概率空闲;
                // 若被占 kimi 会 +1,转发仍命中同 home 的已有实例,token 一致可用)
                let client = target.ssh_client().await?;
                // 用解析到的绝对路径启动,不依赖远端 login shell 的 PATH
                // (bash -lc 读不到交互 shell ~/.bashrc/.zshrc 里的 PATH 条目)
                let bin = target.kimi_bin_resolved().await?;
                let mut proc = client
                    .exec_keepalive(&format!(
                        "{}{} web --no-open --port {port}{}",
                        crate::target::experimental_env_prefix(),
                        crate::target::sq(&bin),
                        opts.shell_suffix()
                    ))
                    .await?;
                // pty drain 内部捕获启动 banner 的 token,此处取出槽位供等待
                let token_slot = proc.token_slot();
                let fwd = client.forward(port, port).await?;
                proc.attach_forward(fwd);
                let probe = ExitProbe::Ssh(proc.alive_flag());
                (ServiceHandle::Ssh(proc), probe, token_slot)
            }
            _ => {
                let token_slot = TokenSlot::new();
                let mut cmd = target.web_command(port, &opts).await?;
                cmd.stdin(std::process::Stdio::null())
                    // stdout 改 piped 由 drain 逐行读:直接 null 会丢 banner 的 token
                    // (CLI 0.29.2+ 只在 banner 打印),且必须持续排空避免 64KB 管道写满阻塞
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                let mut child = cmd
                    .spawn()
                    .map_err(|e| format!("spawn kimi web 失败({}): {e}", target.describe()))?;

                // stdout drain:读即丢弃(不落日志),仅解析 banner token
                if let Some(stdout) = child.stdout.take() {
                    let slot = token_slot.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(stdout).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if let Some(tok) = parse_banner_token(&line) {
                                slot.store(tok).await;
                            }
                        }
                    });
                }

                // stderr 日志脱敏:不打印含 token 的内容,单行截断 500 字符;
                // 同时解析 banner token(Token 行与 Local URL 行都可能走 stderr)
                if let Some(stderr) = child.stderr.take() {
                    let tail = stderr_tail.clone();
                    let slot = token_slot.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(stderr).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if let Some(tok) = parse_banner_token(&line) {
                                slot.store(tok).await;
                            }
                            // 启动横幅是 "Token: <value>",旧过滤只挡 "token=" 会漏;
                            // 任何含 token 字样的行都不落日志
                            if !line.to_lowercase().contains("token") {
                                let truncated: String = line.trim().chars().take(500).collect();
                                eprintln!("[kimi-web] {truncated}");
                                // 留尾部 2000 字符,供启动失败时随错误返回定位
                                if let Ok(mut t) = tail.lock() {
                                    t.push_str(&truncated);
                                    t.push('\n');
                                    if t.len() > 2000 {
                                        let excess = t.len() - 2000;
                                        let keep = t.split_off(excess);
                                        *t = keep;
                                    }
                                }
                            }
                        }
                    });
                }

                let child_arc = Arc::new(tokio::sync::Mutex::new(child));
                (
                    ServiceHandle::Process(child_arc.clone()),
                    ExitProbe::Process(child_arc),
                    token_slot,
                )
            }
        };

        // 退出监控:非主动停止的意外退出记录日志、清空 info,
        // 并回调 lib.rs 清该通道 AppState + 广播 server:exited(否则崩溃后卡死在假"运行中"状态)
        {
            let stopping = mgr.stopping.clone();
            let weak = Arc::downgrade(shared);
            let monitor_probe = probe.clone();
            let app = app.clone();
            let channel = channel.to_string();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    // 主动停止(stop/启动失败的 kill 兜底)时直接退出:
                    // SSH 目标下 alive 只在 drain 任务自然结束时翻转,而 shutdown/Drop
                    // 会 abort drain,标志永不翻转,不检查 stopping 监控任务会永久空转
                    if stopping.load(Ordering::SeqCst) {
                        break;
                    }
                    let exited = match &monitor_probe {
                        ExitProbe::Process(child) => match child.lock().await.try_wait() {
                            Ok(Some(status)) => Some(format!("code = {:?}", status.code())),
                            Ok(None) => None,
                            Err(_) => Some("wait 失败".to_string()),
                        },
                        ExitProbe::Ssh(alive) => {
                            if alive.load(Ordering::SeqCst) {
                                None
                            } else {
                                Some("远端进程已退出或连接断开".to_string())
                            }
                        }
                    };
                    if let Some(detail) = exited {
                        if !stopping.load(Ordering::SeqCst) {
                            eprintln!("[kimi-web] exited unexpectedly, {detail}");
                            if let Some(m) = weak.upgrade() {
                                m.lock().await.info = None;
                            }
                            crate::handle_unexpected_exit(&app, &channel, &detail).await;
                        }
                        break;
                    }
                }
            });
        }

        mgr.proc = Some(handle);

        // spawn 之后的所有错误返回路径都要先杀子进程,否则 kimi web 泄漏成孤儿进程;
        // 杀前置 stopping=true,让退出监控把这次退出视为主动停止、不重复清理/通知
        // 先等启动 banner 打印 token(CLI 0.29.2+ 只打印、不写 server.token);
        // 超时回退旧 CLI 的 server.token 文件轮询(target.rs read_token,兼容旧版本)
        // 两条途径都失败时,照旧杀子进程清理,避免 kimi web 泄漏成孤儿进程
        let token = match token_slot.await_token(BANNER_TOKEN_TIMEOUT).await {
            Some(token) => token,
            None => match target.read_token().await {
                Ok(token) => token,
                Err(e) => {
                    mgr.stopping.store(true, Ordering::SeqCst);
                    if let Some(handle) = mgr.proc.take() {
                        kill_handle(handle).await;
                    }
                    return Err(e);
                }
            },
        };
        let base_url = format!("http://127.0.0.1:{port}");

        // 轮询健康检查,45s 超时,每 400ms 一次
        let deadline = Instant::now() + HEALTH_TIMEOUT;
        loop {
            // 子进程已退出则立即失败(不傻等超时),附 stderr 尾部帮助定位
            let early_exit: Option<String> = match &probe {
                ExitProbe::Process(child) => match child.lock().await.try_wait() {
                    Ok(Some(status)) => {
                        let tail = stderr_tail
                            .lock()
                            .map(|t| t.trim().to_string())
                            .unwrap_or_default();
                        let mut msg =
                            format!("kimi web 启动后即退出(code = {:?})", status.code());
                        if !tail.is_empty() {
                            msg.push_str(&format!(",stderr 尾部: {tail}"));
                        }
                        Some(msg)
                    }
                    _ => None,
                },
                ExitProbe::Ssh(alive) => {
                    if alive.load(Ordering::SeqCst) {
                        None
                    } else {
                        Some("kimi web 远端进程启动后即退出或连接断开".to_string())
                    }
                }
            };
            if let Some(msg) = early_exit {
                mgr.stopping.store(true, Ordering::SeqCst);
                if let Some(handle) = mgr.proc.take() {
                    kill_handle(handle).await;
                }
                return Err(msg);
            }
            if let Ok(res) = http
                .get(format!("{base_url}/api/v1/healthz"))
                .bearer_auth(&token)
                .send()
                .await
            {
                if res.status().is_success() {
                    break;
                }
            }
            if Instant::now() > deadline {
                mgr.stopping.store(true, Ordering::SeqCst);
                if let Some(handle) = mgr.proc.take() {
                    kill_handle(handle).await;
                }
                return Err("kimi web failed to become healthy within timeout".to_string());
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }

        // 保险:官方未来若对 loopback 也下发 frame 拒绝头,iframe 内嵌会失效。
        // 一次性 HEAD / 检查响应头,命中则 warn 预警(不阻断启动)
        if let Ok(res) = http
            .head(format!("{base_url}/"))
            .bearer_auth(&token)
            .send()
            .await
        {
            let csp = res
                .headers()
                .get("content-security-policy")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            if csp.contains("frame-ancestors") || res.headers().contains_key("x-frame-options") {
                eprintln!(
                    "[kimi-web] 警告:官方 kimi web 已返回 frame-ancestors/x-frame-options 头,未来版本可能禁止 iframe 嵌入,请留意升级"
                );
            }
        }

        // meta 非关键,失败忽略
        let mut meta = None;
        if let Ok(res) = http
            .get(format!("{base_url}/api/v1/meta"))
            .bearer_auth(&token)
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(body) = res.json::<serde_json::Value>().await {
                    meta = body.get("data").cloned();
                }
            }
        }

        let info = ServerInfo {
            port,
            base_url,
            token,
            cli_version,
            meta,
        };
        mgr.info = Some(info.clone());
        Ok(info)
    }

    /// 优雅关停:POST /api/v1/shutdown → 等 5s → 强杀/断连兜底
    pub async fn stop(shared: &SharedServer, http: &reqwest::Client) {
        let mut mgr = shared.lock().await;
        mgr.stopping.store(true, Ordering::SeqCst);
        let info = mgr.info.clone();
        let Some(handle) = mgr.proc.take() else {
            return;
        };
        if let Some(info) = info {
            let _ = http
                .post(format!("{}/api/v1/shutdown", info.base_url))
                .bearer_auth(&info.token)
                .send()
                .await;
        }
        match handle {
            ServiceHandle::Process(child_arc) => {
                let mut child = child_arc.lock().await;
                let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
                // 兜底强杀(已退出时 try_wait 命中、跳过 taskkill;kill 返回错误忽略)
                kill_child_tree(&mut child).await;
            }
            ServiceHandle::Ssh(proc) => {
                // 关闭 pty 通道,远端进程收 SIGHUP;转发监听一并停止
                proc.shutdown().await;
            }
        }
        mgr.info = None;
    }
}
