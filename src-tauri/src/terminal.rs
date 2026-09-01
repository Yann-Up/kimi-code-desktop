//! terminal-manager: 本机 PTY 中运行 `kimi` CLI 交互 TUI(内嵌终端 Workspace Grid 后端)。
//! 每窗格一个会话:open 建 PTY + spawn,reader/wait 各一条 std::thread(同步 API,不占 tokio worker);
//! 输出经 tauri::ipc::Channel 二进制直发前端;退出经 terminal:exit 事件通知。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

/// 打开终端会话参数(前端 camelCase)
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpenOpts {
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// 单个 PTY 会话:writer/master 供写与 resize;child 经 Arc<Mutex> 与 wait 线程共享,
/// 会话侧用于 close kill 与惰性清理判活,wait 线程侧阻塞等退出后 emit terminal:exit
struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

/// 内嵌终端会话管理器:sessionId("t1"/"t2"...)→ PtySession
pub struct TerminalManager {
    sessions: HashMap<String, PtySession>,
    next_id: u64,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
        }
    }

    /// 建 PTY 并 spawn kimi TUI:reader 线程把输出经 Channel 推给前端,
    /// wait 线程等进程退出后 emit terminal:exit(会话移除走 has_sessions/close 惰性清理,
    /// 避免在线程里操作 manager)
    pub fn open(
        &mut self,
        app: &AppHandle,
        opts: TerminalOpenOpts,
        on_data: Channel<Vec<u8>>,
    ) -> Result<String, String> {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("PTY 创建失败: {e}"))?;

        let bin = crate::cli::kimi_bin();
        // .cmd/.bat shim 必须 cmd.exe /c 才能跑(参照 cli.rs hidden_command 的处理)
        let mut cmd = if bin.to_lowercase().ends_with(".cmd") || bin.to_lowercase().ends_with(".bat")
        {
            let mut c = CommandBuilder::new("cmd.exe");
            c.args(["/c", &bin]);
            c
        } else {
            CommandBuilder::new(&bin)
        };
        // 数据目录随 kimi_home() 解析规则走(自定义覆盖 > env > 默认),严禁硬编码 ~/.kimi-code
        cmd.env(
            "KIMI_CODE_HOME",
            crate::cli::kimi_home().to_string_lossy().to_string(),
        );
        // 实验性功能开关与 kimi web 同源注入(target.rs web_command 同款,
        // 只含与 CLI 默认不一致的项),保证 TUI 与 web 行为一致
        for (k, v) in crate::target::experimental_envs() {
            cmd.env(k, v);
        }
        // 终端能力声明:注入 TERM/COLORTERM、移除 NO_COLOR——父环境可能是受限 shell
        // (CI/agent 环境常见 TERM=dumb、NO_COLOR=1),继承会让 TUI 判定无颜色输出纯文本
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env_remove("NO_COLOR");
        // cwd:前端指定(须为已存在目录——项目被删/移动时回退主目录,避免 spawn 失败)
        // > 用户主目录(Windows USERPROFILE / Unix HOME)> 进程当前目录
        #[cfg(windows)]
        let home_dir = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from);
        #[cfg(not(windows))]
        let home_dir = std::env::var_os("HOME").map(std::path::PathBuf::from);
        let cwd = opts
            .cwd
            .filter(|c| !c.trim().is_empty())
            .map(std::path::PathBuf::from)
            .filter(|p| p.is_dir())
            .or(home_dir)
            .unwrap_or_else(|| {
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
            });
        cmd.cwd(&cwd);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("终端进程启动失败: {e}"))?;
        drop(pair.slave);

        // 读取端/写入端获取失败时必须先 kill 已 spawn 的子进程,否则成无人管理的孤儿
        let mut child = child;
        let mut reader = match pair.master.try_clone_reader() {
            Ok(r) => r,
            Err(e) => {
                let _ = child.kill();
                return Err(format!("PTY 读取端克隆失败: {e}"));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(w) => w,
            Err(e) => {
                let _ = child.kill();
                return Err(format!("PTY 写入端获取失败: {e}"));
            }
        };

        let sid = format!("t{}", self.next_id);
        self.next_id += 1;

        // child 提前包进 Arc:reader 线程(前端断开时主动 kill)与 wait 线程共享
        let child: Arc<Mutex<Box<dyn Child + Send + Sync>>> = Arc::new(Mutex::new(child));

        // reader 线程:8KB buf 循环读 PTY 输出,二进制直发前端;EOF/出错即退出;
        // Channel send 失败 = 前端已断开(webview 重载/窗格关闭),主动 kill 子进程防会话残留
        let kill_child = Arc::clone(&child);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if on_data.send(buf[..n].to_vec()).is_err() {
                            let _ = kill_child.lock().unwrap().kill();
                            break;
                        }
                    }
                }
            }
        });

        // wait 线程:轮询 try_wait 等进程退出,emit terminal:exit(code 可能拿不到,给 null);
        // 不能 lock 后阻塞 wait——锁会被持有到进程退出,而 close/kill_all 要拿同一把锁才能 kill,
        // 互相等待即死锁;轮询下锁只微秒级持有。会话移除走 has_sessions/close 惰性清理
        let wait_child = Arc::clone(&child);
        let wait_app = app.clone();
        let exit_sid = sid.clone();
        std::thread::spawn(move || {
            let code = loop {
                {
                    let mut g = wait_child.lock().unwrap();
                    match g.try_wait() {
                        Ok(Some(status)) => break Some(status.exit_code()),
                        Ok(None) => {}
                        Err(_) => break None,
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            };
            let _ = wait_app.emit(
                "terminal:exit",
                serde_json::json!({ "sessionId": exit_sid, "code": code }),
            );
        });

        self.sessions.insert(
            sid.clone(),
            PtySession {
                writer,
                master: pair.master,
                child,
            },
        );
        Ok(sid)
    }

    /// 写入终端(前端键入)
    pub fn write(&mut self, id: &str, data: &[u8]) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(id)
            .ok_or_else(|| format!("终端会话不存在: {id}"))?;
        session
            .writer
            .write_all(data)
            .and_then(|_| session.writer.flush())
            .map_err(|e| format!("终端写入失败: {e}"))
    }

    /// 调整 PTY 尺寸(前端 xterm.js fit 后同步)
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("终端会话不存在: {id}"))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("终端尺寸调整失败: {e}"))
    }

    /// 关闭会话:移除并 kill(已退出时 kill 报错,幂等忽略)
    pub fn close(&mut self, id: &str) {
        if let Some(session) = self.sessions.remove(id) {
            let _ = session.child.lock().unwrap().kill();
        }
    }

    /// 清空并逐个 kill(退出清理 / 安装更新前用)
    pub fn kill_all(&mut self) {
        for (_, session) in self.sessions.drain() {
            let _ = session.child.lock().unwrap().kill();
        }
    }

    /// 是否有存活会话(关窗拦截用;惰性清理:顺手移除已退出的会话)
    pub fn has_sessions(&mut self) -> bool {
        let exited: Vec<String> = self
            .sessions
            .iter()
            .filter_map(|(id, session)| match session.child.lock().unwrap().try_wait() {
                Ok(Some(_)) => Some(id.clone()),
                _ => None,
            })
            .collect();
        for id in exited {
            self.sessions.remove(&id);
        }
        !self.sessions.is_empty()
    }
}
