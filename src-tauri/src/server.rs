//! server-manager: 管理 `kimi web` 服务进程的生命周期(本机 / WSL / SSH 三种连接目标)。
//! - 检测 kimi CLI 是否存在及版本
//! - 启动前回收首选端口(release 58666 / dev 58766)上的残留实例(崩溃/强杀/更新安装留下的孤儿:
//!   token 可用时 POST shutdown + pid 强杀兜底;token 不可用但端口被占且注册表心跳新鲜时
//!   按 pid 强杀;其他端口上用户另开的 kimi web 不动),让端口恒定:iframe 源(origin)稳定,
//!   web UI 按源存 localStorage 的"新浏览器"验证才不会每次启动重弹
//! - 选择空闲端口,按连接目标启动 `kimi web --no-open --port <p>`
//!   (Local/WSL 为本地子进程;SSH 为 russh exec_keepalive + 进程内端口转发)
//! - 读取 token:banner 优先解析启动输出里的 Token 行,超时回退读 server.token 文件
//!   (本机读文件,WSL/SSH 经各自通道 cat)。CLI 0.42 起 server.token 必然持久化落盘(0600)
//!   且跨重启复用,banner 优先 + 文件兜底是长期双通道,不只是兼容旧 CLI
//! - 轮询 /api/v1/healthz 直到就绪(三种目标下都连 127.0.0.1:<本地端口>)
//! - RC 单例预检(--remote-control 开启的本机/WSL):CLI 的 RC 锁(<kimi_home>/server/rc.json,
//!   按 pid 活性判定)与实例注册表是两套账本,注册表回收覆盖不到的 RC 持有者(孤儿/条目被
//!   清理)会让新实例必被 CLI 拒启、重试永远失败;预检对残留锁强杀、健康实例直接收养
//! - 优雅关停(POST /api/v1/shutdown → 等待退出 → 强杀/断连兜底)

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use tauri::AppHandle;

use crate::ssh::SshProcess;
use crate::target::ConnectionTarget;

/// 默认起始端口:配合启动前的残留实例回收(reclaim_stale_instances),iframe 源恒定为此端口;
/// 仅当被 kimi 以外的程序占用时才 +1 顺延(free_port 兜底)。设置页可改(web_server_set)。
/// dev 构建用 58766:与正式版(58666)错开(两边顺延窗口各 50 个端口,互不重叠),
/// 配合 dev 独立 identifier(tauri.dev.conf.json),dev 与正式版可并存,回收各管各的端口
pub const START_PORT: u16 = if cfg!(debug_assertions) {
    58766
} else {
    58666
};
const HEALTH_TIMEOUT: Duration = Duration::from_secs(45);
/// 等待启动 banner 打印 token 的超时(CLI 0.29.2+ 只打印、不写 server.token);
/// 超时后回退旧 CLI 的 server.token 文件轮询
const BANNER_TOKEN_TIMEOUT: Duration = Duration::from_secs(12);

/// kimi web 启动参数(设置页「服务启动参数」可配;改动经 web_server_set 落盘并重启服务生效)
#[derive(Clone)]
pub struct WebOptions {
    /// 首选端口(默认 START_PORT,release 58666 / dev 58766;被占时 free_port 顺延)
    pub port: u16,
}

impl Default for WebOptions {
    fn default() -> Self {
        Self { port: START_PORT }
    }
}

/// 当前生效的启动参数(启动时从 desktop-config.json 加载,web_server_set 更新)
static WEB_OPTIONS: std::sync::RwLock<WebOptions> =
    std::sync::RwLock::new(WebOptions { port: START_PORT });

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

/// RC 冲突结构化错误标记:前端解析它渲染"结束旧实例并重试"定向操作。
/// 格式 `RC_CONFLICT|pid=<pid>|origin=<origin>`,只含这两个字段(可出现在整串中部,
/// 前端按 indexOf 定位,因为 App/ShellHome 会给它加"后端服务意外退出:"等前缀)
pub(crate) const RC_CONFLICT_MARK: &str = "RC_CONFLICT|";

fn rc_conflict_error(pid: u32, origin: &str) -> String {
    format!("{RC_CONFLICT_MARK}pid={pid}|origin={origin}")
}

/// 从 stderr 尾部解析 CLI 的 RC 单例拒绝:
/// "Remote Control is already running on this machine (pid 63024, http://127.0.0.1:58666, since ...)"
pub(crate) fn parse_rc_conflict(text: &str) -> Option<(u32, String)> {
    let anchor = text.find("Remote Control is already running")?;
    let rest = &text[anchor..];
    let pid_pos = rest.find("pid ")? + "pid ".len();
    let digits: String = rest[pid_pos..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let pid: u32 = digits.parse().ok()?;
    let origin = match rest[pid_pos..].find("http") {
        Some(p) => {
            let s = &rest[pid_pos + p..];
            let end = s.find([',', ' ', ')', '\n']).unwrap_or(s.len());
            s[..end].to_string()
        }
        None => String::new(),
    };
    Some((pid, origin))
}

/// 强杀前的身份核验(rc.json 的 pid 由 CLI 自己写入,但 pid 可能被系统复用):
/// 进程名(basename)必须是 kimi/kimi.exe;node/node.exe(npm 安装形态)还需命令行含
/// "kimi" 佐证,防误杀无关 node 进程;其余一律不杀。macOS 的 ps -o comm= 给全路径,故取 basename
pub(crate) fn rc_killable(process_name: &str, cmdline: Option<&str>) -> bool {
    let base = process_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(process_name)
        .to_lowercase();
    if base == "kimi" || base == "kimi.exe" {
        return true;
    }
    if base == "node" || base == "node.exe" {
        return cmdline
            .map(|c| c.to_lowercase().contains("kimi"))
            .unwrap_or(false);
    }
    false
}

/// 按 pid 强杀 RC 持有者并等退净(最多 3s;CLI 按 pid 活性判锁,不等则随即重启仍会撞锁)。
/// 调用前必须先过 rc_killable 核验;返回是否已退净
pub(crate) async fn kill_rc_holder_and_wait(target: &ConnectionTarget, pid: u32, name: &str) -> bool {
    eprintln!("[kimi-web] 回收 RC 持有者 pid={pid} ({name})");
    target.kill_pid(pid).await;
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if target.process_name_if_alive(pid).await.is_none() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    target.process_name_if_alive(pid).await.is_none()
}

/// 从 stderr 尾部缓冲解析 RC 冲突签名;stderr drain 是独立任务,进程刚死时最后几行
/// 可能还没进缓冲,首次未命中做短暂重试(3×100ms),避免偶发丢签名退回笼统错误
async fn rc_conflict_from_tail(tail: &Arc<std::sync::Mutex<String>>) -> Option<(u32, String)> {
    for attempt in 0..4 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let text = tail.lock().map(|t| t.trim().to_string()).unwrap_or_default();
        if let Some(hit) = parse_rc_conflict(&text) {
            return Some(hit);
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
    /// 服务端下发了 CSP frame-ancestors / X-Frame-Options(官方禁止嵌入),
    /// 壳内 iframe 将被浏览器拦截;前端据此显示引导而非空白 iframe
    pub frame_blocked: bool,
}

/// 启动前回收占用首选端口的残留 kimi web 实例(仅 Local/WSL):
/// 上次运行未优雅关停(应用崩溃/强杀/更新安装强杀;WSL 下 wsl.exe 会话结束、Linux 侧进程被
/// /init 收养)会留下孤儿占住首选端口,新实例被迫端口漂移 → iframe 源(origin)变化 →
/// web UI 存于 localStorage 的"新浏览器"验证状态每次启动都失效。
/// 只处理首选端口上的实例:其他端口上的 kimi web 可能是用户有意开着的另一个 CLI 实例,不动。
/// 两条途径:
/// 1. token 可读(server.token,新版 CLI 持久化复用)且实例健康:POST shutdown 优雅关停,
///    端口 8s 内不还则按注册表登记的 pid 兜底强杀;
/// 2. token 读不到或健康检查未过(旧 CLI 不写 server.token / token 已轮换):端口仍被占用
///    且注册表心跳新鲜(CLI 每 15s 刷新 heartbeat_at)说明孤儿还活着,直接按 pid 强杀;
///    心跳过期则是死进程的注册表残留(pid 可能已被系统复用),跳过。
/// 整体尽力而为,不阻塞启动
async fn reclaim_stale_instances(http: &reqwest::Client, target: &ConnectionTarget, preferred: u16) {
    if matches!(target, ConnectionTarget::Ssh { .. }) {
        return;
    }
    let token = target.read_token_once().await.ok().flatten();
    for (port, pid, heartbeat_at) in target.list_server_instances().await {
        if port != preferred {
            continue; // 其他端口的实例不归本服务管(可能是另一个 kimi CLI 在跑)
        }
        let base = format!("http://127.0.0.1:{port}");
        let healthy = match &token {
            Some(token) => http
                .get(format!("{base}/api/v1/healthz"))
                .bearer_auth(token)
                .timeout(Duration::from_millis(1500))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false),
            None => false,
        };
        if healthy {
            let token = token.as_deref().unwrap_or_default();
            eprintln!("[kimi-web] 回收残留实例 port={port} pid={pid}");
            let _ = http
                .post(format!("{base}/api/v1/shutdown"))
                .bearer_auth(token)
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
            continue;
        }
        // token 缺失/无效或实例不健康:孤儿仍存活(端口被占 + 注册表心跳新鲜)则按 pid 强杀
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let heartbeat_fresh = heartbeat_at > 0 && now_ms.saturating_sub(heartbeat_at) < 60_000;
        let port_occupied = std::net::TcpListener::bind(("127.0.0.1", port)).is_err();
        if heartbeat_fresh && port_occupied {
            eprintln!("[kimi-web] 回收残留实例(无可用 token,按注册表 pid 强杀)port={port} pid={pid}");
            target.kill_pid(pid).await;
            // 等端口释放,最多 3s(taskkill 异步生效,不等会被后面的 free_port 顺延)
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
        }
        // 否则:进程已死、仅注册表残留(心跳过期),跳过
    }
}

/// RC 单例预检结果
enum RcPreCheck {
    /// 无锁/锁已死/僵尸已清理:走正常 spawn
    Clear,
    /// 已有健康 RC 实例在跑:直接收养,不再 spawn
    Adopt { port: u16, token: String },
    /// 锁活着但无法接管(凭据不符/状态异常/非回环 origin):结构化冲突错误,前端定向处理
    Conflict(String),
}

/// RC 单例预检(--remote-control 开启时调用,三种目标通用):
/// CLI 的 RC 锁(<kimi_home>/server/rc.json,按 pid 活性判定)与实例注册表是两套账本,
/// reclaim_stale_instances 覆盖不到未登记的 RC 持有者(孤儿/注册表条目被清理/用户另开),
/// 不预检则新实例必被 CLI 拒启(exit 1),重试永远失败。
/// 处置矩阵:pid 已死 → Clear(CLI 启动时会覆盖残留 rc.json);
/// 健康(healthz 凭 server.token 认证通过)→ Adopt(仅本机/WSL;SSH 无前向转发探不了 HTTP,
/// 活锁一律 Conflict,前端按钮可远程强杀);
/// 进程在但端口不可达 → 区分半死与"还在启动"(started_at < 20s 时给足启动窗口多次重探),
/// 半死才强杀;端口可达但凭据不符/状态异常 → Conflict(可能正被他人使用,不擅自杀)。
async fn rc_precheck(http: &reqwest::Client, target: &ConnectionTarget) -> RcPreCheck {
    let Ok(home) = target.kimi_home_str().await else {
        return RcPreCheck::Clear;
    };
    let Ok(raw) = target
        .read_text(&target.join(&home, "server/rc.json"))
        .await
    else {
        return RcPreCheck::Clear;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return RcPreCheck::Clear;
    };
    let Some(pid) = v.get("pid").and_then(|x| x.as_u64()).map(|x| x as u32) else {
        return RcPreCheck::Clear;
    };
    let origin = v
        .get("local_origin")
        .or_else(|| v.get("localOrigin"))
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string();
    // 防御:rc.json 不应指向壳自身(仅本机目标有意义,SSH 远端是独立 pid 空间)
    if target.is_local() && pid == std::process::id() {
        return RcPreCheck::Conflict(rc_conflict_error(pid, &origin));
    }
    // pid 已死:rc.json 是残留,直接启动
    let Some(name) = target.process_name_if_alive(pid).await else {
        return RcPreCheck::Clear;
    };
    // SSH 远端:没有前向转发探不了 HTTP 活,活锁一律交冲突处理
    if matches!(target, ConnectionTarget::Ssh { .. }) {
        return RcPreCheck::Conflict(rc_conflict_error(pid, &origin));
    }
    // 只认回环 origin:非回环(--host 0.0.0.0 等)下"不可达"判定不可靠,不误杀
    if !origin.contains("127.0.0.1") && !origin.contains("localhost") && !origin.contains("[::1]")
    {
        return RcPreCheck::Conflict(rc_conflict_error(pid, &origin));
    }
    let Some(port) = origin.rsplit(':').next().and_then(|s| s.parse::<u16>().ok()) else {
        // origin 缺失/异常:不干预,spawn 后若被 CLI 拒启,由 stderr 冲突标记路径兜底
        return RcPreCheck::Clear;
    };
    // 读不到凭据的活实例:无法验证也无法接管,不擅自杀
    let Ok(Some(token)) = target.read_token_once().await else {
        return RcPreCheck::Conflict(rc_conflict_error(pid, &origin));
    };
    // 探活并区分"半死"与"还在启动":刚写 rc.json 的实例(started_at < 20s)给足启动窗口,
    // 避免把用户刚在终端拉起的健康实例当僵尸误杀
    let started_at = v
        .get("started_at")
        .or_else(|| v.get("startedAt"))
        .and_then(|x| x.as_i64())
        .unwrap_or(0);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let young = started_at > 0 && now_ms.saturating_sub(started_at) < 20_000;
    let (tries, gap) = if young {
        (15, Duration::from_millis(1000))
    } else {
        (3, Duration::from_millis(500))
    };
    for attempt in 0..tries {
        if attempt > 0 {
            tokio::time::sleep(gap).await;
        }
        match http
            .get(format!("{origin}/api/v1/healthz"))
            .bearer_auth(&token)
            .timeout(Duration::from_millis(1500))
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => return RcPreCheck::Adopt { port, token },
            // 服务可达但凭据不符/状态异常:可能正被他人使用,交用户决断
            Ok(_) => return RcPreCheck::Conflict(rc_conflict_error(pid, &origin)),
            Err(_) => {}
        }
    }
    // 连续不可达的半死僵尸(进程在、服务没了):身份核验后强杀(node 形态需命令行佐证)
    let cmdline = if rc_killable(&name, None) {
        None
    } else {
        target.process_cmdline(pid).await
    };
    if !rc_killable(&name, cmdline.as_deref()) {
        return RcPreCheck::Conflict(rc_conflict_error(pid, &origin));
    }
    if kill_rc_holder_and_wait(target, pid, &name).await {
        RcPreCheck::Clear
    } else {
        // 杀不掉:交前端(按钮再走一遍核验+强杀)
        RcPreCheck::Conflict(rc_conflict_error(pid, &origin))
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

/// 启动失败/超时清理:Process 强杀;Ssh 关通道使远端收 HUP;Adopted 不动(非本进程子进程)
async fn kill_handle(handle: ServiceHandle) {
    match handle {
        ServiceHandle::Process(child) => {
            kill_child_tree(&mut *child.lock().await).await;
        }
        ServiceHandle::Ssh(proc) => proc.shutdown().await,
        ServiceHandle::Adopted => {}
    }
}

/// 服务句柄:本地子进程(Local/WSL)、远端常驻进程(SSH,russh pty 通道)
/// 或收养的已有 RC 实例(Adopted:只 POST shutdown 优雅关停,绝不强杀)
pub enum ServiceHandle {
    Process(Arc<tokio::sync::Mutex<Child>>),
    Ssh(SshProcess),
    Adopted,
}

/// 退出探针(服务就绪后监控任务的存活判定):Process 用 try_wait,Ssh 探测通道活性
/// (远端关闭/断连时翻 false),Http 用于收养的 RC 实例(非本进程子进程,
/// 以 healthz 连续失败判定)
#[derive(Clone)]
enum ExitProbe {
    Process(Arc<tokio::sync::Mutex<Child>>),
    Ssh(Arc<AtomicBool>),
    Http {
        url: String,
        token: String,
        misses: Arc<AtomicU32>,
    },
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
    /// RC 开启时先做单例预检(rc_precheck):健康旧实例直接收养,半死僵尸强杀后重新 spawn
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

        // RC 单例预检(--remote-control 开启时;三种目标通用,SSH 只分死/活、无收养):
        // 注册表回收覆盖不到的 RC 持有者会让新实例必被 CLI 拒启、重试永远失败;
        // 健康持有者直接收养(不再 spawn),收尾与 spawn 分支共用 finalize_start
        if crate::target::remote_control_enabled() {
            match rc_precheck(http, target).await {
                RcPreCheck::Clear => {}
                RcPreCheck::Conflict(msg) => return Err(msg),
                RcPreCheck::Adopt { port, token } => {
                    eprintln!("[kimi-web] 收养已在运行的 RC 实例 port={port}");
                    mgr.proc = Some(ServiceHandle::Adopted);
                    let probe = ExitProbe::Http {
                        url: format!("http://127.0.0.1:{port}"),
                        token: token.clone(),
                        misses: Arc::new(AtomicU32::new(0)),
                    };
                    return Self::finalize_start(
                        shared,
                        &mut mgr,
                        http,
                        app,
                        channel,
                        probe,
                        token,
                        port,
                        cli_version,
                    )
                    .await;
                }
            }
        }

        // 启动参数(设置页可配):首选端口
        let opts = web_options();
        // 回收首选端口上的残留实例(崩溃/强杀留下的孤儿),把首选端口还回来,
        // 保证 iframe 源跨启动稳定(web UI 的"新浏览器"验证状态按源存 localStorage);
        // 其他端口上的 kimi web 实例不动(可能是用户另开的 CLI)
        reclaim_stale_instances(http, target, opts.port).await;
        let port = free_port(opts.port)?;

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
                // Remote Control 启用时附加 --remote-control(同 target.rs web_command)
                let rc = if crate::target::remote_control_enabled() {
                    " --remote-control"
                } else {
                    ""
                };
                let mut proc = client
                    .exec_keepalive(&format!(
                        "{}{} web --no-open --port {port}{rc}",
                        crate::target::experimental_env_prefix(),
                        crate::target::sq(&bin),
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
                let mut cmd = target.web_command(port).await?;
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

        // spawn 之后的所有错误返回路径都要先杀子进程,否则 kimi web 泄漏成孤儿进程
        // (退出监控在服务就绪后才启动,见 finalize_start;清理路径的 stopping 置位纯防御)
        mgr.proc = Some(handle);
        // 先等启动 banner 打印 token(CLI 0.29.2+ 只打印、不写 server.token);
        // 超时回退旧 CLI 的 server.token 文件轮询(target.rs read_token,兼容旧版本)
        // 两条途径都失败时,照旧杀子进程清理,避免 kimi web 泄漏成孤儿进程
        // 特例:--remote-control 启动时 banner 改打印 RC 链接块、不含 token 行,
        // 直接走 server.token 文件轮询(0.39 仍写该文件),避免白等 BANNER_TOKEN_TIMEOUT
        let banner_token = if crate::target::remote_control_enabled() {
            None
        } else {
            token_slot.await_token(BANNER_TOKEN_TIMEOUT).await
        };
        let token = match banner_token {
            Some(token) => token,
            None => match target.read_token().await {
                Ok(token) => token,
                Err(e) => {
                    mgr.stopping.store(true, Ordering::SeqCst);
                    if let Some(handle) = mgr.proc.take() {
                        kill_handle(handle).await;
                    }
                    // RC 单例拒绝(stderr 有签名):换结构化冲突错误,
                    // 前端据此出"结束旧实例并重试",不再是笼统的重试
                    if let Some((pid, origin)) = rc_conflict_from_tail(&stderr_tail).await {
                        return Err(rc_conflict_error(pid, &origin));
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
                        // RC 单例拒绝:换结构化冲突错误(同上)
                        if let Some((pid, origin)) = rc_conflict_from_tail(&stderr_tail).await {
                            Some(rc_conflict_error(pid, &origin))
                        } else {
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
                // spawn 路径不会产生 Http 探针(仅收养分支),此处仅为穷尽匹配
                ExitProbe::Http { .. } => None,
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

        Self::finalize_start(shared, &mut mgr, http, app, channel, probe, token, port, cli_version)
            .await
    }

    /// start 的收尾(spawn 与收养两条路径共用):启动退出监控 → frame 拒绝头预警 →
    /// meta 拉取 → 落 ServerInfo。退出监控只在服务就绪后启动:启动期失败由 spawn 路径的
    /// 早退探针覆盖并直接返回(带 stderr 尾部),监控若与启动并发竞报,会先广播一条
    /// 只有 exit code 的劣质消息,把可读原因盖掉
    #[allow(clippy::too_many_arguments)]
    async fn finalize_start(
        shared: &SharedServer,
        mgr: &mut ServerManager,
        http: &reqwest::Client,
        app: &AppHandle,
        channel: &str,
        probe: ExitProbe,
        token: String,
        port: u16,
        cli_version: String,
    ) -> Result<ServerInfo, String> {
        // 退出监控:非主动停止的意外退出记录日志、清空 info,
        // 并回调 lib.rs 清该通道 AppState + 广播 server:exited(否则崩溃后卡死在假"运行中"状态)
        {
            let stopping = mgr.stopping.clone();
            let weak = Arc::downgrade(shared);
            let app = app.clone();
            let channel = channel.to_string();
            let http = http.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    // 主动停止(stop/重启)时直接退出:
                    // SSH 目标下 alive 只在 drain 任务自然结束时翻转,而 shutdown/Drop
                    // 会 abort drain,标志永不翻转,不检查 stopping 监控任务会永久空转
                    if stopping.load(Ordering::SeqCst) {
                        break;
                    }
                    let exited: Option<String> = match &probe {
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
                        ExitProbe::Http { url, token, misses } => match http
                            .get(format!("{url}/api/v1/healthz"))
                            .bearer_auth(token)
                            .timeout(Duration::from_secs(1))
                            .send()
                            .await
                        {
                            Ok(res) if res.status().is_success() => {
                                misses.store(0, Ordering::SeqCst);
                                None
                            }
                            // 连续 10 次(约 5s)不可达才判退出,过滤瞬时抖动
                            _ if misses.fetch_add(1, Ordering::SeqCst) + 1 >= 10 => {
                                Some("收养的 RC 实例健康检查连续失败".to_string())
                            }
                            _ => None,
                        },
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

        let base_url = format!("http://127.0.0.1:{port}");

        // 保险:官方若下发 frame 拒绝头(如 --host 0.0.0.0 模式实测会带 frame-ancestors 'self',
        // 故壳不提供局域网开放选项),iframe 内嵌即被浏览器拦截。
        // 一次性 HEAD / 检查响应头,命中则标记 frame_blocked 交给前端引导(不阻断启动)
        let mut frame_blocked = false;
        if let Ok(res) = http
            .head(format!("{base_url}/"))
            .bearer_auth(&token)
            // 收养的实例可能半死:per-request 超时,不靠 client 全局 30s 兜底
            .timeout(Duration::from_secs(5))
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
                frame_blocked = true;
                eprintln!(
                    "[kimi-web] 警告:服务端返回了 frame-ancestors/x-frame-options 头,壳内 iframe 无法嵌入,已转为浏览器访问引导"
                );
            }
        }

        // meta 非关键,失败忽略
        let mut meta = None;
        if let Ok(res) = http
            .get(format!("{base_url}/api/v1/meta"))
            .bearer_auth(&token)
            .timeout(Duration::from_secs(5))
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
            frame_blocked,
        };
        mgr.info = Some(info.clone());
        Ok(info)
    }

    /// 优雅关停:POST /api/v1/shutdown → 等 5s → 强杀/断连兜底(收养实例只等退净、不强杀)
    pub async fn stop(shared: &SharedServer, http: &reqwest::Client) {
        let mut mgr = shared.lock().await;
        mgr.stopping.store(true, Ordering::SeqCst);
        let info = mgr.info.clone();
        let Some(handle) = mgr.proc.take() else {
            return;
        };
        if let Some(info) = &info {
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
            ServiceHandle::Adopted => {
                // 收养的 RC 实例不是本进程子进程:POST shutdown(上面已发)后等它退净
                // (最多 5s,防 restart 场景 start 又把将死实例收养回来),但不强杀
                if let Some(info) = &info {
                    let deadline = Instant::now() + Duration::from_secs(5);
                    while Instant::now() < deadline {
                        let up = http
                            .get(format!("{}/api/v1/healthz", info.base_url))
                            .bearer_auth(&info.token)
                            .timeout(Duration::from_millis(500))
                            .send()
                            .await
                            .map(|r| r.status().is_success())
                            .unwrap_or(false);
                        if !up {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(300)).await;
                    }
                }
            }
        }
        mgr.info = None;
    }
}
