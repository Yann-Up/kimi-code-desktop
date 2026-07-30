//! server-manager: 管理 `kimi web` 服务进程的生命周期(本机 / WSL / SSH 三种连接目标)。
//! - 检测 kimi CLI 是否存在及版本
//! - 选择空闲端口,按连接目标启动 `kimi web --no-open --port <p>`
//!   (Local/WSL 为本地子进程;SSH 为 russh exec_keepalive + 进程内端口转发)
//! - 读取 server.token(本机读文件,WSL/SSH 经各自通道 cat)
//! - 轮询 /api/v1/healthz 直到就绪(三种目标下都连 127.0.0.1:<本地端口>)
//! - 优雅关停(POST /api/v1/shutdown → 等待退出 → 强杀/断连兜底)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use tauri::AppHandle;

use crate::cli;
use crate::ssh::SshProcess;
use crate::target::ConnectionTarget;

pub const START_PORT: u16 = 58627;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(45);

pub type SharedServer = Arc<tokio::sync::Mutex<ServerManager>>;

#[derive(Clone)]
pub struct ServerInfo {
    pub port: u16,
    pub base_url: String,
    pub token: String,
    pub cli_version: String,
    pub meta: Option<serde_json::Value>,
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

    pub async fn start(
        shared: &SharedServer,
        http: &reqwest::Client,
        app: &AppHandle,
    ) -> Result<ServerInfo, String> {
        let mut mgr = shared.lock().await;
        if let Some(info) = &mgr.info {
            return Ok(info.clone());
        }
        // 每次 start 新建 stopping 标志:旧代监控任务持有旧 flag(stop 后恒 true,
        // 见上),新代监控持有新 flag,互不干扰
        mgr.stopping = Arc::new(AtomicBool::new(false));
        // 连接目标决定启动/读 token/检测 CLI 的方式;REST/WS 永远连 127.0.0.1:port
        let target = cli::connection_target();
        let cli_version = target.detect_cli().await?;
        let port = free_port(START_PORT)?;

        // 退出探针:Process 用 try_wait,Ssh 探测通道活性(远端关闭/断连时翻 false)
        #[derive(Clone)]
        enum ExitProbe {
            Process(Arc<tokio::sync::Mutex<Child>>),
            Ssh(Arc<AtomicBool>),
        }

        // stderr 尾部缓冲:启动失败时随错误返回,帮助定位(仅本机/WSL 子进程写入)
        let stderr_tail = Arc::new(std::sync::Mutex::new(String::new()));

        let (handle, probe) = match &target {
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
                        "{} web --no-open --port {port}",
                        crate::target::sq(&bin)
                    ))
                    .await?;
                let fwd = client.forward(port, port).await?;
                proc.attach_forward(fwd);
                let probe = ExitProbe::Ssh(proc.alive_flag());
                (ServiceHandle::Ssh(proc), probe)
            }
            _ => {
                let mut cmd = target.web_command(port).await?;
                cmd.stdin(std::process::Stdio::null())
                    // stdout 无人读取,必须丢弃:piped 写满(64KB)后 kimi web 会阻塞死锁
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::piped());
                let mut child = cmd
                    .spawn()
                    .map_err(|e| format!("spawn kimi web 失败({}): {e}", target.describe()))?;

                // stderr 日志脱敏:不打印含 token 的内容,单行截断 500 字符
                if let Some(stderr) = child.stderr.take() {
                    let tail = stderr_tail.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(stderr).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
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
                (ServiceHandle::Process(child_arc.clone()), ExitProbe::Process(child_arc))
            }
        };

        // 退出监控:非主动停止的意外退出记录日志、清空 info,
        // 并回调 lib.rs 清 AppState + 广播 server:exited(否则崩溃后卡死在假"运行中"状态)
        {
            let stopping = mgr.stopping.clone();
            let weak = Arc::downgrade(shared);
            let monitor_probe = probe.clone();
            let app = app.clone();
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
                            crate::handle_unexpected_exit(&app, &detail).await;
                        }
                        break;
                    }
                }
            });
        }

        mgr.proc = Some(handle);

        // spawn 之后的所有错误返回路径都要先杀子进程,否则 kimi web 泄漏成孤儿进程;
        // 杀前置 stopping=true,让退出监控把这次退出视为主动停止、不重复清理/通知
        let token = match target.read_token().await {
            Ok(token) => token,
            Err(e) => {
                mgr.stopping.store(true, Ordering::SeqCst);
                if let Some(handle) = mgr.proc.take() {
                    kill_handle(handle).await;
                }
                return Err(e);
            }
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
