//! connection-target: kimi web 服务的连接目标抽象(本机 / WSL / SSH),兼作环境工厂。
//! 三种目标下桌面端永远连 127.0.0.1:<本地端口> —— WSL 靠 localhostForwarding,
//! SSH 靠进程内 direct-tcpip 转发(russh,见 ssh.rs)。
//! 除服务启停外,文件读写 / 目录列举 / shell 执行(git、用量扫描)也统一经此路由,
//! local_store.rs / git.rs 不再感知目标差异。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::cli::{hidden_command, kimi_bin, kimi_home, remote_bin_override};
use crate::ssh::{self, SshClient};

/// 连接目标(运行时全局存放在 cli::CONNECTION_TARGET,持久化经 ConnectionConfig)
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectionTarget {
    /// 本机:直接 spawn 本地 kimi CLI
    Local,
    /// WSL:经 wsl.exe 进入发行版执行(distro 为 None = 默认发行版)
    Wsl { distro: Option<String> },
    /// SSH:russh 进程内连接;host 允许 "user@host"(内嵌 user),user 字段优先于内嵌
    Ssh {
        host: String,
        port: Option<u16>,
        identity: Option<String>,
        user: Option<String>,
        /// "password" | "key"(None 按 password 处理)
        auth: Option<String>,
    },
}

/// desktop-config.json 中的持久化形式(与渲染层 ConnectionTargetConfig 对应)
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    /// "local" | "wsl" | "ssh"
    pub target: String,
    pub wsl_distro: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_identity: Option<String>,
    pub ssh_user: Option<String>,
    /// "password" | "key"(密码本体只存 keyring,不落此文件)
    pub ssh_auth: Option<String>,
    /// 用户自定义的远端 CLI 绝对路径(仅 WSL/SSH 生效,None = 自动探测)
    pub remote_bin: Option<String>,
}

/// 去掉首尾空白,空串视为 None
fn trimmed(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl From<ConnectionConfig> for ConnectionTarget {
    fn from(c: ConnectionConfig) -> Self {
        match c.target.as_str() {
            "wsl" => ConnectionTarget::Wsl {
                distro: trimmed(c.wsl_distro),
            },
            "ssh" => ConnectionTarget::Ssh {
                host: trimmed(c.ssh_host).unwrap_or_default(),
                port: c.ssh_port,
                identity: trimmed(c.ssh_identity),
                user: trimmed(c.ssh_user),
                auth: trimmed(c.ssh_auth),
            },
            _ => ConnectionTarget::Local,
        }
    }
}

impl From<&ConnectionTarget> for ConnectionConfig {
    fn from(t: &ConnectionTarget) -> Self {
        match t {
            ConnectionTarget::Local => ConnectionConfig {
                target: "local".into(),
                ..Default::default()
            },
            ConnectionTarget::Wsl { distro } => ConnectionConfig {
                target: "wsl".into(),
                wsl_distro: distro.clone(),
                ..Default::default()
            },
            ConnectionTarget::Ssh {
                host,
                port,
                identity,
                user,
                auth,
            } => ConnectionConfig {
                target: "ssh".into(),
                ssh_host: Some(host.clone()),
                ssh_port: *port,
                ssh_identity: identity.clone(),
                ssh_user: user.clone(),
                ssh_auth: auth.clone(),
                ..Default::default()
            },
        }
    }
}

/// shell 单引号转义:'a'b' → 'a'\''b'(所有远端命令拼接必须过此函数)
pub(crate) fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// 远端(WSL/SSH)kimi 可执行文件路径缓存(key = 目标 Debug 串,set_connection_target 时清空)
static REMOTE_KIMI_BIN: std::sync::LazyLock<std::sync::RwLock<HashMap<String, String>>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(HashMap::new()));

/// 切换连接目标时清空远端路径缓存(lib.rs set_connection_target 调用)
pub fn invalidate_remote_caches() {
    REMOTE_KIMI_BIN.write().unwrap().clear();
}

/// run_shell 的统一返回(对齐子进程 output 语义)
pub struct ShellOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// 用量扫描结果:每个有 wire.jsonl 的会话一条,lines 为含 "usage.record" 的原始行
pub struct SessionWire {
    pub wd: String,
    pub sid: String,
    pub lines: Vec<String>,
}

/// cron 文件扫描结果:每个 *.json 一条(内容原样带回,JSON 解析留在 local_store)
pub struct CronFile {
    pub sid: String,
    pub file: String,
    pub content: String,
}

/// 远端批量扫描的标记行分隔符(\x01 + 文件路径,JSON 文本中不会出现 \x01)
const MARK: char = '\u{1}';

/// 把 marker 分隔的扫描输出拆成 (路径, 内容) 列表
fn split_marked(out: &str) -> Vec<(String, String)> {
    let mut files: Vec<(String, String)> = Vec::new();
    for line in out.split('\n') {
        if let Some(path) = line.strip_prefix(MARK) {
            files.push((path.trim_end_matches('\r').to_string(), String::new()));
        } else if let Some((_, body)) = files.last_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    files
}

/// 从 <home>/sessions/<wd>/<sid>/... 提取 (wd, sid)
fn session_parts(home: &str, path: &str) -> Option<(String, String)> {
    let prefix = format!("{home}/sessions/");
    let rest = path.strip_prefix(&prefix)?;
    let mut it = rest.split('/');
    let wd = it.next()?.to_string();
    let sid = it.next()?.to_string();
    if wd.is_empty() || sid.is_empty() {
        return None;
    }
    Some((wd, sid))
}

/// 远端用量扫描脚本:逐 wire.jsonl 打 marker 后 grep 出 usage.record 行
/// (marker 行存在即代表该会话有 wire 文件,aggregate_usage 的 sessions 计数依赖这一点)
fn usage_scan_script(home: &str) -> String {
    format!(
        "for f in {h}/sessions/*/*/agents/main/wire.jsonl; do [ -f \"$f\" ] || continue; printf '\\001%s\\n' \"$f\"; grep -F '\"usage.record\"' -- \"$f\" 2>/dev/null; done",
        h = sq(home)
    )
}

/// 远端 cron 扫描脚本:逐 cron/*.json 打 marker 后 cat 内容
fn cron_scan_script(home: &str) -> String {
    format!(
        "for f in {h}/sessions/*/*/cron/*.json; do [ -f \"$f\" ] || continue; printf '\\001%s\\n' \"$f\"; cat -- \"$f\"; printf '\\n'; done",
        h = sq(home)
    )
}

/// 远端 $HOME 缓存(kimi_home_str 用,键为目标描述;切换目标后键不同自然隔离)
static HOME_CACHE: std::sync::LazyLock<std::sync::RwLock<HashMap<String, String>>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(HashMap::new()));

impl ConnectionTarget {
    pub fn is_local(&self) -> bool {
        matches!(self, ConnectionTarget::Local)
    }

    /// 设置页展示名("本机" / "WSL (Ubuntu)" / "user@host")
    pub fn describe(&self) -> String {
        match self {
            ConnectionTarget::Local => "本机".to_string(),
            ConnectionTarget::Wsl { distro } => match distro {
                Some(d) => format!("WSL ({d})"),
                None => "WSL(默认发行版)".to_string(),
            },
            ConnectionTarget::Ssh { host, .. } => host.clone(),
        }
    }

    /// WSL 命令:wsl.exe [-d <distro>] -- bash -lc <cmd>
    /// (经 login shell 拿 PATH,npm 全局安装的 kimi 通常不在默认 PATH 上)
    fn wsl_shell_command(distro: &Option<String>, shell_cmd: &str) -> Command {
        let mut cmd = hidden_command("wsl.exe");
        if let Some(d) = distro {
            cmd.args(["-d", d]);
        }
        cmd.arg("--").args(["bash", "-lc", shell_cmd]);
        cmd
    }

    /// 拆分 "user@host"(无 @ 或 user 为空时返回 (None, 原样))
    fn split_user_host(host: &str) -> (Option<String>, String) {
        match host.rsplit_once('@') {
            Some((u, h)) if !u.is_empty() && !h.is_empty() => {
                (Some(u.to_string()), h.to_string())
            }
            _ => (None, host.to_string()),
        }
    }

    /// 由当前目标构造 SSH 连接要素(非 SSH 目标报错)
    pub fn ssh_config(&self) -> Result<ssh::SshConfig, String> {
        let ConnectionTarget::Ssh {
            host,
            port,
            identity,
            user,
            auth,
        } = self
        else {
            return Err("非 SSH 目标".to_string());
        };
        if host.trim().is_empty() {
            return Err("SSH 目标必须填写 user@host".to_string());
        }
        let (embedded, pure_host) = Self::split_user_host(host);
        let user = user.clone().or(embedded).ok_or_else(|| {
            "SSH 缺少用户名(host 用 user@host 或单独填写用户名)".to_string()
        })?;
        let auth = match auth.as_deref() {
            Some("key") => ssh::SshAuth::KeyFile(
                identity
                    .clone()
                    .ok_or_else(|| "私钥认证需要指定私钥路径".to_string())?,
            ),
            _ => ssh::SshAuth::Password,
        };
        Ok(ssh::SshConfig {
            host: pure_host,
            port: port.unwrap_or(22),
            user,
            auth,
        })
    }

    /// 共享 SSH 连接(密码从 keyring 取;按 user@host:port+认证方式 缓存复用)
    pub async fn ssh_client(&self) -> Result<Arc<SshClient>, String> {
        ssh::shared(&self.ssh_config()?).await
    }

    // ---------- 环境工厂:路径 / 文件 / shell ----------

    /// 路径拼接:统一 "/" 分隔(Windows 的 std::fs 接受正斜杠,远端是 Linux 路径)
    pub fn join(&self, base: &str, part: &str) -> String {
        let b = base.trim_end_matches(['/', '\\']);
        let p = part.trim_start_matches(['/', '\\']);
        if b.is_empty() {
            return p.to_string();
        }
        if p.is_empty() {
            return b.to_string();
        }
        format!("{b}/{p}")
    }

    /// kimi 数据目录字符串:Local 走 kimi_home();WSL/SSH 取远端 $HOME + "/.kimi-code"(缓存)
    pub async fn kimi_home_str(&self) -> Result<String, String> {
        if let ConnectionTarget::Local = self {
            return Ok(kimi_home().to_string_lossy().replace('\\', "/"));
        }
        let key = format!("{self:?}");
        if let Some(h) = HOME_CACHE.read().unwrap().get(&key) {
            return Ok(h.clone());
        }
        let out = self.run_shell("echo $HOME", Duration::from_secs(10)).await?;
        let home = out.stdout.trim().to_string();
        if out.code != 0 || home.is_empty() {
            return Err(format!("获取远端 $HOME 失败({})", self.describe()));
        }
        let full = format!("{home}/.kimi-code");
        HOME_CACHE.write().unwrap().insert(key, full.clone());
        Ok(full)
    }

    /// 读文本文件(远端: cat --,失败含文件不存在返回 Err)
    pub async fn read_text(&self, path: &str) -> Result<String, String> {
        match self {
            ConnectionTarget::Local => tokio::fs::read_to_string(path)
                .await
                .map_err(|e| e.to_string()),
            _ => {
                let out = self
                    .run_shell(&format!("cat -- {}", sq(path)), Duration::from_secs(15))
                    .await?;
                if out.code != 0 {
                    return Err(out.stderr.trim().chars().take(200).collect());
                }
                Ok(out.stdout)
            }
        }
    }

    /// 写文本文件(远端: cat > '<path>.tmp' && mv 覆盖,崩溃不留截断文件)
    pub async fn write_text(&self, path: &str, content: &str) -> Result<(), String> {
        match self {
            ConnectionTarget::Local => {
                crate::config::write_atomic(std::path::Path::new(path), content)
            }
            ConnectionTarget::Wsl { distro } => {
                let tmp = format!("{path}.tmp");
                let out = Self::wsl_run(
                    distro,
                    &format!("cat > {} && mv -f {} {}", sq(&tmp), sq(&tmp), sq(path)),
                    Some(content.as_bytes()),
                    Duration::from_secs(15),
                )
                .await?;
                if out.code != 0 {
                    return Err(out.stderr.trim().chars().take(200).collect());
                }
                Ok(())
            }
            ConnectionTarget::Ssh { .. } => {
                let tmp = format!("{path}.tmp");
                let out = self
                    .ssh_client()
                    .await?
                    .exec(
                        &format!("cat > {} && mv -f {} {}", sq(&tmp), sq(&tmp), sq(path)),
                        Some(content.as_bytes()),
                        Duration::from_secs(15),
                    )
                    .await?;
                if out.code != 0 {
                    return Err(out.stderr.trim().chars().take(200).collect());
                }
                Ok(())
            }
        }
    }

    /// 复制文件(远端: cp --;调用方容错,失败不报错 —— 原文件可能本就不存在)
    pub async fn copy(&self, from: &str, to: &str) {
        match self {
            ConnectionTarget::Local => {
                let _ = tokio::fs::copy(from, to).await;
            }
            _ => {
                let _ = self
                    .run_shell(
                        &format!("cp -- {} {}", sq(from), sq(to)),
                        Duration::from_secs(15),
                    )
                    .await;
            }
        }
    }

    /// 列目录(仅文件名;失败/不存在 → 空)
    pub async fn list_dir(&self, path: &str) -> Vec<String> {
        match self {
            ConnectionTarget::Local => {
                let Ok(rd) = std::fs::read_dir(path) else {
                    return vec![];
                };
                rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            }
            _ => {
                let Ok(out) = self
                    .run_shell(&format!("ls -1 -- {}", sq(path)), Duration::from_secs(15))
                    .await
                else {
                    return vec![];
                };
                if out.code != 0 {
                    return vec![];
                }
                out.stdout
                    .split('\n')
                    .map(|l| l.trim_end_matches('\r'))
                    .filter(|l| !l.is_empty())
                    .map(str::to_string)
                    .collect()
            }
        }
    }

    /// 是否存在的普通文件(远端: test -f)
    pub async fn is_file(&self, path: &str) -> bool {
        match self {
            ConnectionTarget::Local => std::fs::metadata(path)
                .map(|m| m.is_file())
                .unwrap_or(false),
            _ => self
                .run_shell(&format!("test -f {}", sq(path)), Duration::from_secs(10))
                .await
                .map(|o| o.code == 0)
                .unwrap_or(false),
        }
    }

    /// 执行 shell 命令:WSL 走 wsl.exe bash -lc;SSH 走共享连接 exec;Local 走系统 shell
    pub async fn run_shell(&self, cmd: &str, timeout: Duration) -> Result<ShellOut, String> {
        match self {
            ConnectionTarget::Local => {
                // git 等本机命令的兜底路径(主流程一般直 spawn,不经这里)
                #[cfg(windows)]
                let mut c = {
                    let mut c = hidden_command("cmd.exe");
                    c.args(["/c", cmd]);
                    c
                };
                #[cfg(not(windows))]
                let mut c = {
                    let mut c = Command::new("sh");
                    c.args(["-c", cmd]);
                    c
                };
                let out = tokio::time::timeout(timeout, c.output())
                    .await
                    .map_err(|_| "命令超时".to_string())?
                    .map_err(|e| e.to_string())?;
                Ok(ShellOut {
                    code: out.status.code().unwrap_or(-1),
                    stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                })
            }
            ConnectionTarget::Wsl { distro } => Self::wsl_run(distro, cmd, None, timeout).await,
            ConnectionTarget::Ssh { .. } => {
                let out = self.ssh_client().await?.exec(cmd, None, timeout).await?;
                Ok(ShellOut {
                    code: out.code,
                    stdout: out.stdout,
                    stderr: out.stderr,
                })
            }
        }
    }

    /// WSL 执行并收集输出。
    /// stdin 语义分两种:
    /// - Some(data):数据 stdin(cat > file 场景),脚本保持 argv 形式 bash -lc;
    /// - None:脚本本身经 stdin 传给 bash -l 执行——wsl.exe 的 Windows→Linux
    ///   命令行转换会吃掉 argv 里的变量赋值(p=...; 被当成环境变量前缀吞掉),
    ///   探测/统计这类带赋值的复杂脚本在 argv 模式下必然失效,stdin 通道完全免疫
    async fn wsl_run(
        distro: &Option<String>,
        cmd: &str,
        stdin: Option<&[u8]>,
        timeout: Duration,
    ) -> Result<ShellOut, String> {
        let run = async {
            let mut command = hidden_command("wsl.exe");
            if let Some(d) = distro {
                command.args(["-d", d]);
            }
            if stdin.is_some() {
                command.arg("--").args(["bash", "-lc", cmd]);
            } else {
                command.arg("--").args(["bash", "-l"]);
            }
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                // kill_on_drop:外层 timeout 返回后子进程随之被杀,不留 wsl.exe 残留
                .kill_on_drop(true);
            let mut child = command
                .spawn()
                .map_err(|e| format!("wsl.exe 执行失败: {e}"))?;
            // 数据 stdin 写数据;否则把脚本本身写进 stdin(写完关闭,bash 收到 EOF 后执行完退出)
            let payload: Vec<u8> = match stdin {
                Some(data) => data.to_vec(),
                None => cmd.as_bytes().to_vec(),
            };
            {
                let mut sin = child.stdin.take().ok_or("无法打开 wsl stdin")?;
                sin.write_all(&payload)
                    .await
                    .map_err(|e| format!("写入 wsl stdin 失败: {e}"))?;
            }
            let out = child
                .wait_with_output()
                .await
                .map_err(|e| format!("wsl.exe 等待失败: {e}"))?;
            Ok::<ShellOut, String>(ShellOut {
                code: out.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            })
        };
        tokio::time::timeout(timeout, run)
            .await
            .map_err(|_| "wsl 命令超时".to_string())?
    }

    /// 用量扫描:Local 逐文件读;WSL/SSH 一条命令带回全部 wire.jsonl 的 usage 行
    pub async fn usage_record_lines(&self) -> Vec<SessionWire> {
        match self {
            ConnectionTarget::Local => {
                let sessions_root = kimi_home().join("sessions");
                let mut out = Vec::new();
                let Ok(wds) = std::fs::read_dir(&sessions_root) else {
                    return out;
                };
                for wd in wds.flatten() {
                    let Ok(sids) = std::fs::read_dir(wd.path()) else {
                        continue;
                    };
                    for sid in sids.flatten() {
                        let wire = sid.path().join("agents").join("main").join("wire.jsonl");
                        if !self.is_file(&wire.to_string_lossy()).await {
                            continue;
                        }
                        let Ok(content) = tokio::fs::read_to_string(&wire).await else {
                            continue;
                        };
                        // 先字符串包含过滤(与原 local_store 逐文件逻辑一致),JSON 解析留给上层
                        let lines = content
                            .split('\n')
                            .filter(|l| l.contains("\"usage.record\""))
                            .map(str::to_string)
                            .collect();
                        out.push(SessionWire {
                            wd: wd.file_name().to_string_lossy().into_owned(),
                            sid: sid.file_name().to_string_lossy().into_owned(),
                            lines,
                        });
                    }
                }
                out
            }
            _ => {
                let Ok(home) = self.kimi_home_str().await else {
                    return vec![];
                };
                let Ok(out) = self
                    .run_shell(&usage_scan_script(&home), Duration::from_secs(60))
                    .await
                else {
                    return vec![];
                };
                split_marked(&out.stdout)
                    .into_iter()
                    .filter_map(|(path, body)| {
                        let (wd, sid) = session_parts(&home, &path)?;
                        Some(SessionWire {
                            wd,
                            sid,
                            lines: body
                                .split('\n')
                                .filter(|l| !l.is_empty())
                                .map(str::to_string)
                                .collect(),
                        })
                    })
                    .collect()
            }
        }
    }

    /// cron 文件扫描:Local 逐文件读;WSL/SSH 一条命令带回全部 cron/*.json 内容
    pub async fn cron_files(&self) -> Vec<CronFile> {
        match self {
            ConnectionTarget::Local => {
                let sessions_root = kimi_home().join("sessions");
                let mut out = Vec::new();
                let Ok(wds) = std::fs::read_dir(&sessions_root) else {
                    return out;
                };
                for wd in wds.flatten() {
                    let Ok(sids) = std::fs::read_dir(wd.path()) else {
                        continue;
                    };
                    for sid in sids.flatten() {
                        let cron_dir = sid.path().join("cron");
                        let Ok(files) = std::fs::read_dir(&cron_dir) else {
                            continue;
                        };
                        for f in files.flatten() {
                            let name = f.file_name().to_string_lossy().into_owned();
                            if !name.ends_with(".json") {
                                continue;
                            }
                            let Ok(content) = tokio::fs::read_to_string(f.path()).await else {
                                continue;
                            };
                            out.push(CronFile {
                                sid: sid.file_name().to_string_lossy().into_owned(),
                                file: name,
                                content,
                            });
                        }
                    }
                }
                out
            }
            _ => {
                let Ok(home) = self.kimi_home_str().await else {
                    return vec![];
                };
                let Ok(out) = self
                    .run_shell(&cron_scan_script(&home), Duration::from_secs(60))
                    .await
                else {
                    return vec![];
                };
                split_marked(&out.stdout)
                    .into_iter()
                    .filter_map(|(path, body)| {
                        let (_, sid) = session_parts(&home, &path)?;
                        let file = path.rsplit('/').next()?.to_string();
                        Some(CronFile {
                            sid,
                            file,
                            content: body,
                        })
                    })
                    .collect()
            }
        }
    }

    // ---------- 服务启停 ----------

    /// 构造启动 kimi web 的子进程命令;local_port 为本地端口。
    /// 仅 Local/WSL 走本地 spawn;SSH 由 server.rs 经 russh exec_keepalive + forward 启动
    pub async fn web_command(&self, local_port: u16) -> Result<Command, String> {
        match self {
            ConnectionTarget::Local => {
                let mut cmd = hidden_command(&kimi_bin());
                cmd.args(["web", "--no-open", "--port", &local_port.to_string()])
                    .env("KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL", "1")
                    // 显式传入数据目录:保证 CLI 与桌面端读取同一份(自定义工作区/默认一致)
                    .env("KIMI_CODE_HOME", kimi_home());
                Ok(cmd)
            }
            ConnectionTarget::Wsl { distro } => {
                // WSL localhostForwarding 使 Windows 侧可直接访问 127.0.0.1:<port>;
                // WSL 内用自己的 ~/.kimi-code(KIMI_CODE_HOME 覆盖不适用)。
                // 用解析到的绝对路径启动,不赌 login shell PATH;仍保留 bash -lc
                // (bin 可能是 npm shim 脚本,需要 shell 解释)
                let bin = self.kimi_bin_resolved().await?;
                Ok(Self::wsl_shell_command(
                    distro,
                    &format!("{} web --no-open --port {local_port}", sq(&bin)),
                ))
            }
            ConnectionTarget::Ssh { .. } => {
                Err("SSH 目标经 russh 进程内启动,不走本地 spawn".to_string())
            }
        }
    }

    /// 读取 server.token:本机读文件;WSL/SSH 反复执行 cat 命令(每次 ~10s 超时防挂死)。
    /// token 文件在服务首次启动时可能尚未生成,轮询等待(25 × 400ms)
    pub async fn read_token(&self) -> Result<String, String> {
        let mut last_err = String::new();
        for _ in 0..25 {
            match self.try_read_token().await {
                Ok(Some(token)) => return Ok(token),
                Ok(None) => {}
                Err(e) => {
                    // 认证/连接失败重试无意义(连续失败认证还会触发 fail2ban),立即终止
                    if e.contains("SSH 认证") || e.contains("SSH 连接") {
                        last_err = e;
                        break;
                    }
                    last_err = e;
                }
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        match self {
            ConnectionTarget::Local => Err(format!(
                "读取 server.token 失败: {}",
                kimi_home().join("server.token").display()
            )),
            ConnectionTarget::Wsl { .. } => {
                Err("读取 WSL 内 server.token 失败,请确认 kimi web 已在 WSL 中正常启动".to_string())
            }
            ConnectionTarget::Ssh { host, .. } => {
                // 认证类错误直接透出(文案已在 ssh.rs 友好化)
                if last_err.contains("SSH 认证") || last_err.contains("SSH 连接") {
                    Err(last_err)
                } else {
                    Err(format!("读取远端 server.token 失败({host}): {last_err}"))
                }
            }
        }
    }

    /// 单次尝试读 token:Ok(None) 表示文件尚不存在(继续轮询);Err 记录原因后继续轮询
    async fn try_read_token(&self) -> Result<Option<String>, String> {
        let parse = |out: std::process::Output| -> Result<Option<String>, String> {
            if !out.status.success() {
                // 文件未生成(cat 退出 1)与认证失败都走这里,记录 stderr 供最终报错
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                return Err(stderr.chars().take(200).collect());
            }
            let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(if token.is_empty() { None } else { Some(token) })
        };
        match self {
            ConnectionTarget::Local => {
                let path = kimi_home().join("server.token");
                match tokio::fs::read_to_string(&path).await {
                    Ok(raw) => {
                        let token = raw.trim().to_string();
                        Ok(if token.is_empty() { None } else { Some(token) })
                    }
                    Err(_) => Ok(None),
                }
            }
            ConnectionTarget::Wsl { distro } => {
                // kill_on_drop:超时后子进程随之被杀,不留 wsl.exe 残留
                let out = tokio::time::timeout(
                    Duration::from_secs(10),
                    Self::wsl_shell_command(distro, "cat ~/.kimi-code/server.token")
                        .kill_on_drop(true)
                        .output(),
                )
                .await
                .map_err(|_| "wsl cat server.token 超时".to_string())?
                .map_err(|e| format!("wsl.exe 执行失败: {e}"))?;
                parse(out)
            }
            ConnectionTarget::Ssh { .. } => {
                let client = self.ssh_client().await?;
                let out = client
                    .exec("cat ~/.kimi-code/server.token", None, Duration::from_secs(10))
                    .await?;
                if out.code != 0 {
                    // 文件未生成(cat 退出 1),记录 stderr 供最终报错
                    return Err(out.stderr.trim().chars().take(200).collect());
                }
                let token = out.stdout.trim().to_string();
                Ok(if token.is_empty() { None } else { Some(token) })
            }
        }
    }

    /// 远端 kimi 探测脚本:login shell PATH → 常见安装位置(SSH/WSL 共用,只是执行通道不同)
    fn remote_probe_script() -> &'static str {
        concat!(
            "p=$(bash -lc 'command -v kimi' 2>/dev/null); ",
            "if [ -n \"$p\" ]; then echo \"$p\"; exit 0; fi; ",
            "for c in \"$HOME/.kimi-code/bin/kimi\" \"$HOME/.local/bin/kimi\" ",
            "/usr/local/bin/kimi /usr/bin/kimi /snap/bin/kimi; do ",
            "if [ -x \"$c\" ]; then echo \"$c\"; exit 0; fi; done; exit 1"
        )
    }

    /// 探测脚本输出 → 路径(失败统一报"远端未找到 kimi CLI")
    fn probe_result(out: &ShellOut) -> Result<String, String> {
        let bin = out.stdout.trim().to_string();
        if out.code == 0 && !bin.is_empty() {
            return Ok(bin);
        }
        Err("远端未找到 kimi CLI(已尝试 login shell PATH 及 ~/.kimi-code/bin、~/.local/bin、/usr/local/bin 等位置)。\
             请先在远端安装:curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash"
            .to_string())
    }

    /// SSH 远端 kimi 可执行文件探测(带缓存,走共享连接)。
    /// 背景:非交互 SSH exec 下 bash -lc 只读 login profile,交互 shell 的
    /// ~/.bashrc / .zshrc PATH 条目可能缺失,因此不赌 PATH,解析出绝对路径后统一使用。
    pub async fn remote_kimi_bin(&self) -> Result<String, String> {
        let key = format!("{self:?}");
        if let Some(b) = REMOTE_KIMI_BIN.read().unwrap().get(&key) {
            return Ok(b.clone());
        }
        let client = self.ssh_client().await?;
        let bin = Self::probe_remote_kimi_bin(&client).await?;
        REMOTE_KIMI_BIN.write().unwrap().insert(key, bin.clone());
        Ok(bin)
    }

    /// 在指定连接上探测远端 kimi 路径:login shell PATH → 常见安装位置
    /// (test_connection_target 的一次性连接也走这里,不进缓存)
    pub async fn probe_remote_kimi_bin(client: &SshClient) -> Result<String, String> {
        let out = client
            .exec(Self::remote_probe_script(), None, Duration::from_secs(15))
            .await?;
        Self::probe_result(&ShellOut {
            code: out.code,
            stdout: out.stdout,
            stderr: out.stderr,
        })
    }

    /// 解析当前目标实际使用的 kimi 可执行文件:
    /// - Local:本地解析逻辑(cli_bin 覆盖 > env > 数据目录 > PATH)
    /// - WSL/SSH:remote_bin 覆盖(SSH 先经共享连接 test -x 验证)优先,否则自动探测(带缓存)
    pub async fn kimi_bin_resolved(&self) -> Result<String, String> {
        match self {
            ConnectionTarget::Local => Ok(kimi_bin()),
            ConnectionTarget::Wsl { .. } => {
                if let Some(b) = remote_bin_override() {
                    return Ok(b);
                }
                let key = format!("{self:?}");
                if let Some(b) = REMOTE_KIMI_BIN.read().unwrap().get(&key) {
                    return Ok(b.clone());
                }
                // 与 SSH 同款探测脚本,经 wsl.exe bash -lc 执行
                let out = self
                    .run_shell(Self::remote_probe_script(), Duration::from_secs(15))
                    .await?;
                let bin = Self::probe_result(&out)?;
                REMOTE_KIMI_BIN.write().unwrap().insert(key, bin.clone());
                Ok(bin)
            }
            ConnectionTarget::Ssh { .. } => {
                if let Some(b) = remote_bin_override() {
                    // 自定义路径先验证可执行,避免启动 web 时才暴露
                    let out = self
                        .run_shell(&format!("test -x {}", sq(&b)), Duration::from_secs(15))
                        .await?;
                    if out.code != 0 {
                        return Err(format!("自定义远端路径不可执行: {b}"));
                    }
                    return Ok(b);
                }
                self.remote_kimi_bin().await
            }
        }
    }

    /// `kimi --version`(未安装/连接失败时返回错误,与 TS 版 detectCli 一致直接抛出)
    pub async fn detect_cli(&self) -> Result<String, String> {
        self.detect_cli_with_password(None).await
    }

    /// 带显式密码的 CLI 检测:test_connection_target 用;
    /// SSH 显式密码时走一次性连接(不进共享缓存,避免测试中的配置污染运行中连接)
    pub async fn detect_cli_with_password(&self, password: Option<&str>) -> Result<String, String> {
        if let ConnectionTarget::Ssh { .. } = self {
            let client = match password {
                Some(pw) => Arc::new(SshClient::connect(&self.ssh_config()?, Some(pw)).await?),
                None => self.ssh_client().await?,
            };
            // 一次性连接直接探测;共享连接走 kimi_bin_resolved(自定义覆盖 + 缓存探测)
            let bin = match password {
                Some(_) => Self::probe_remote_kimi_bin(&client).await?,
                None => self.kimi_bin_resolved().await?,
            };
            let out = client
                .exec(&format!("{} --version", sq(&bin)), None, Duration::from_secs(15))
                .await?;
            if out.code != 0 {
                let stderr: String = out.stderr.trim().chars().take(200).collect();
                return Err(format!(
                    "远端 kimi CLI 存在但执行失败({bin}),请检查安装完整性。{stderr}"
                ));
            }
            return Ok(out.stdout.trim().to_string());
        }
        let mut cmd = match self {
            ConnectionTarget::Local => {
                let mut c = hidden_command(&kimi_bin());
                c.arg("--version");
                c
            }
            ConnectionTarget::Wsl { distro } => {
                // 用解析到的绝对路径(自定义覆盖 / 探测缓存),不赌裸命令名的 PATH
                let bin = self.kimi_bin_resolved().await?;
                Self::wsl_shell_command(distro, &format!("{} --version", sq(&bin)))
            }
            ConnectionTarget::Ssh { .. } => unreachable!(),
        };
        // kill_on_drop:超时后子进程随之被杀,不留残留
        let out = tokio::time::timeout(Duration::from_secs(15), cmd.kill_on_drop(true).output())
            .await
            .map_err(|_| format!("kimi --version 超时({})", self.describe()))?
            .map_err(|e| format!("kimi --version 执行失败({}): {e}", self.describe()))?;
        if !out.status.success() {
            let stderr: String = String::from_utf8_lossy(&out.stderr).chars().take(200).collect();
            return Err(match self {
                ConnectionTarget::Local => "kimi --version 退出非零".to_string(),
                ConnectionTarget::Wsl { .. } => {
                    format!("未能在 WSL 中运行 kimi CLI,请先在 WSL 内安装(已安装请检查 PATH)。{stderr}")
                }
                ConnectionTarget::Ssh { .. } => unreachable!(),
            });
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
}
