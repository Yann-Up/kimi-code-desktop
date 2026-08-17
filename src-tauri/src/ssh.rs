//! ssh: 基于 russh 的进程内 SSH 客户端(替代外部 ssh.exe,Windows 下无需 OpenSSH)。
//! - 密码 / 私钥两种认证;密码只存系统凭据管理器(keyring),不落配置文件
//! - host key TOFU(trust on first use):指纹记录到配置目录 known_hosts,变更即拒绝连接
//! - 全局共享一条连接(按 user@host:port+认证方式 失效重连),并发 exec 共用
//! - exec_keepalive:申请 pty 后执行,通道关闭时远端进程收 SIGHUP(替代 ssh 子进程语义)
//! - forward:本地 TcpListener → direct-tcpip 通道双向拷贝(替代 ssh -L 隧道)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg};
use tokio::sync::RwLock;

/// keyring 服务名(account 为 ssh:<user>@<host>:<port>)
const KEYRING_SERVICE: &str = "kimi-code-desktop";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 握手+认证整体超时(服务端不响应时避免无限挂死)
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(25);

/// SSH 认证方式(密码来自 keyring 或显式传入,私钥为文件路径)
#[derive(Clone, Debug)]
pub enum SshAuth {
    Password,
    KeyFile(String),
}

/// 一条 SSH 连接的全部要素(host 已拆分出 user,port 已补默认 22)
#[derive(Clone, Debug)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
}

/// exec 结果(对齐子进程 output 语义)
pub struct ExecOut {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

/// keyring 账号名:ssh:<user>@<host>:<port>
fn keyring_account(user: &str, host: &str, port: u16) -> String {
    format!("ssh:{user}@{host}:{port}")
}

/// 保存 SSH 密码到系统凭据管理器
pub fn save_password(user: &str, host: &str, port: u16, password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &keyring_account(user, host, port))
        .map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| e.to_string())
}

/// 读取已保存的 SSH 密码(无则 None)
pub fn load_password(user: &str, host: &str, port: u16) -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &keyring_account(user, host, port)).ok()?;
    entry.get_password().ok().filter(|p| !p.is_empty())
}

/// 是否已保存密码(get_connection_target 回显"已保存密码"用)
pub fn has_password(user: &str, host: &str, port: u16) -> bool {
    load_password(user, host, port).is_some()
}

/// 删除已保存的 SSH 密码(删除通道/替换目标时调用,避免凭据在系统凭据管理器残留);
/// 不存在或删除失败均静默(不阻塞主流程)
pub fn delete_password(user: &str, host: &str, port: u16) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &keyring_account(user, host, port)) {
        let _ = entry.delete_credential();
    }
}

/// host key 策略:TOFU(trust on first use)——首次连接记录指纹,之后指纹变更即拒绝
struct SshHandler {
    host: String,
    port: u16,
}

/// known_hosts 路径(desktop-config.json 同目录);配置目录未知时为 None
fn known_hosts_path() -> Option<std::path::PathBuf> {
    crate::config::config_dir().map(|d| d.join("known_hosts"))
}

/// TOFU 校验:Ok(true)=首次信任(已记录);Ok(false)=指纹一致;Err=指纹变更,拒绝连接
fn check_known_host(host_port: &str, fingerprint: &str) -> Result<bool, String> {
    let Some(path) = known_hosts_path() else {
        eprintln!("[ssh] 配置目录未知,跳过 known_hosts 校验: {host_port} {fingerprint}");
        return Ok(false);
    };
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    for line in existing.lines() {
        let mut it = line.split_whitespace();
        if it.next() == Some(host_port) {
            return if it.next() == Some(fingerprint) {
                Ok(false)
            } else {
                Err(format!(
                    "主机密钥已变更({host_port}),可能存在中间人攻击;\
                     如确认无误请删除 {} 中对应条目",
                    path.display()
                ))
            };
        }
    }
    // 首次连接:追加记录并接受(记录失败不阻断,下次连接仍会走首次信任)
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&format!("{host_port} {fingerprint}\n"));
    if let Err(e) = crate::config::write_atomic(&path, &content) {
        eprintln!("[ssh] 写入 known_hosts 失败({}): {e}", path.display());
    }
    eprintln!("[ssh] 首次信任主机 {host_port},host key 指纹: {fingerprint}");
    Ok(true)
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        let host_port = format!("{}:{}", self.host, self.port);
        match check_known_host(&host_port, &fp) {
            Ok(_) => Ok(true),
            Err(reason) => Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, reason).into()),
        }
    }
}

pub struct SshClient {
    handle: Arc<client::Handle<SshHandler>>,
}

impl SshClient {
    /// 建立连接并完成认证;密码来源:显式传入 > keyring 已保存
    /// (握手+认证整体包超时,服务端不响应时不会无限挂死)
    pub async fn connect(cfg: &SshConfig, password: Option<&str>) -> Result<Self, String> {
        tokio::time::timeout(HANDSHAKE_TIMEOUT, Self::connect_inner(cfg, password))
            .await
            .map_err(|_| format!("SSH 握手/认证超时({}:{})", cfg.host, cfg.port))?
    }

    async fn connect_inner(cfg: &SshConfig, password: Option<&str>) -> Result<Self, String> {
        let config = Arc::new(client::Config {
            nodelay: true,
            // 隧道空闲时保活;不做无活动断连(kimi web 长连接场景)
            keepalive_interval: Some(Duration::from_secs(30)),
            inactivity_timeout: None,
            // 放大通道窗口,批量拉取(用量 grep)不易被流控卡住
            window_size: 16 * 1024 * 1024,
            channel_buffer_size: 256,
            ..Default::default()
        });
        let addr = (cfg.host.as_str(), cfg.port);
        let handler = SshHandler {
            host: cfg.host.clone(),
            port: cfg.port,
        };
        let mut handle = tokio::time::timeout(
            CONNECT_TIMEOUT,
            client::connect(config, addr, handler),
        )
        .await
        .map_err(|_| format!("SSH 连接超时({}:{})", cfg.host, cfg.port))?
        .map_err(|e| format!("SSH 连接失败({}:{}): {e}", cfg.host, cfg.port))?;

        match &cfg.auth {
            SshAuth::Password => {
                let pw = password
                    .map(str::to_string)
                    .or_else(|| load_password(&cfg.user, &cfg.host, cfg.port))
                    .ok_or_else(|| {
                        "SSH 密码未提供,且凭据管理器中无已保存密码".to_string()
                    })?;
                let res = handle
                    .authenticate_password(&cfg.user, pw)
                    .await
                    .map_err(|e| format!("SSH 认证出错: {e}"))?;
                if !matches!(res, client::AuthResult::Success) {
                    return Err("SSH 认证失败:用户名或密码错误".to_string());
                }
            }
            SshAuth::KeyFile(path) => {
                let key = load_secret_key(path, None)
                    .map_err(|e| format!("读取私钥失败({path}): {e}"))?;
                // RSA 密钥按服务器支持选择哈希算法;非 RSA 忽略
                // (外层 Option = 服务器是否支持 server-sig-algs 扩展,内层 = 具体哈希)
                let hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .ok()
                    .flatten()
                    .flatten();
                let res = handle
                    .authenticate_publickey(
                        &cfg.user,
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await
                    .map_err(|e| format!("SSH 认证出错: {e}"))?;
                if !matches!(res, client::AuthResult::Success) {
                    return Err("SSH 认证失败:私钥未被服务器接受".to_string());
                }
            }
        }
        Ok(Self {
            handle: Arc::new(handle),
        })
    }

    /// 连接是否已断开(共享缓存据此重连)
    pub fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    /// 远端执行命令并收集输出;stdin 非空时写入后发送 EOF(如 cat > file)
    pub async fn exec(
        &self,
        cmd: &str,
        stdin: Option<&[u8]>,
        timeout: Duration,
    ) -> Result<ExecOut, String> {
        let run = async {
            let mut channel = self
                .handle
                .channel_open_session()
                .await
                .map_err(|e| format!("SSH 打开通道失败: {e}"))?;
            channel
                .exec(true, cmd.to_string())
                .await
                .map_err(|e| format!("SSH exec 失败: {e}"))?;
            if let Some(data) = stdin {
                channel
                    .data_bytes(data.to_vec())
                    .await
                    .map_err(|e| format!("SSH 写入 stdin 失败: {e}"))?;
                channel
                    .eof()
                    .await
                    .map_err(|e| format!("SSH 发送 EOF 失败: {e}"))?;
            }
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            // 未收到 ExitStatus 时保持 None:连接中断/通道异常关闭不能当成功(code 0)返回
            let mut code: Option<i32> = None;
            while let Some(msg) = channel.wait().await {
                match msg {
                    russh::ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                    russh::ChannelMsg::ExtendedData { data, .. } => {
                        stderr.extend_from_slice(&data)
                    }
                    russh::ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status as i32),
                    _ => {}
                }
            }
            let code = code.ok_or_else(|| {
                "SSH 通道关闭但未收到退出状态(连接可能已中断)".to_string()
            })?;
            Ok::<ExecOut, String>(ExecOut {
                stdout: String::from_utf8_lossy(&stdout).into_owned(),
                stderr: String::from_utf8_lossy(&stderr).into_owned(),
                code,
            })
        };
        tokio::time::timeout(timeout, run)
            .await
            .map_err(|_| format!("SSH 命令超时({}s): {}", timeout.as_secs(), cmd.chars().take(80).collect::<String>()))?
    }

    /// 申请 pty 后执行常驻命令(如 kimi web):返回句柄,关闭通道使远端进程收 SIGHUP
    pub async fn exec_keepalive(&self, cmd: &str) -> Result<SshProcess, String> {
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("SSH 打开通道失败: {e}"))?;
        channel
            .request_pty(false, "xterm", 120, 30, 0, 0, &[])
            .await
            .map_err(|e| format!("SSH 申请 pty 失败: {e}"))?;
        channel
            .exec(true, cmd.to_string())
            .await
            .map_err(|e| format!("SSH exec 失败: {e}"))?;

        let (mut read, write) = channel.split();
        let alive = Arc::new(AtomicBool::new(true));
        // banner token 槽位:pty 输出里捕获(CLI 0.29.2+ 只打印、不写 server.token)
        let token_slot = crate::server::TokenSlot::new();
        // 持续排空通道输出(避免窗口耗尽),日志按 server.rs 同款规则脱敏截断
        let drain = {
            let alive = alive.clone();
            let slot = token_slot.clone();
            tokio::spawn(async move {
                let mut line = String::new();
                while let Some(msg) = read.wait().await {
                    if let russh::ChannelMsg::Data { data } = msg {
                        line.push_str(&String::from_utf8_lossy(&data));
                        while let Some(pos) = line.find('\n') {
                            let l: String = line.drain(..=pos).collect();
                            // 启动 banner 的 token 捕获,两路 drain 复用同一解析规则
                            if let Some(tok) = crate::server::parse_banner_token(&l) {
                                slot.store(tok).await;
                            }
                            // 启动横幅是 "Token: <value>",旧过滤只挡 "token=" 会漏;
                            // 任何含 token 字样的行都不落日志
                            if !l.to_lowercase().contains("token") {
                                let truncated: String =
                                    l.trim().chars().take(500).collect();
                                if !truncated.is_empty() {
                                    eprintln!("[kimi-web] {truncated}");
                                }
                            }
                        }
                    }
                }
                alive.store(false, Ordering::SeqCst);
            })
        };
        Ok(SshProcess {
            alive,
            drain,
            write: Some(write),
            forward: None,
            token: token_slot,
        })
    }

    /// 本地端口转发:127.0.0.1:local_port → 远端 127.0.0.1:remote_port
    /// (每个入站连接开一条 direct-tcpip 通道双向拷贝;guard drop 时停止监听)
    pub async fn forward(&self, local_port: u16, remote_port: u16) -> Result<ForwardGuard, String> {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", local_port))
            .await
            .map_err(|e| format!("绑定本地转发端口 {local_port} 失败: {e}"))?;
        let handle = self.handle.clone();
        let task = tokio::spawn(async move {
            loop {
                let (socket, _) = match listener.accept().await {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[ssh] 转发监听 accept 失败: {e}");
                        break;
                    }
                };
                let handle = handle.clone();
                tokio::spawn(async move {
                    let r = async {
                        let channel = handle
                            .channel_open_direct_tcpip(
                                "127.0.0.1",
                                remote_port as u32,
                                "127.0.0.1",
                                local_port as u32,
                            )
                            .await?;
                        let mut ch_stream = channel.into_stream();
                        let mut socket = socket;
                        tokio::io::copy_bidirectional(&mut socket, &mut ch_stream).await?;
                        Ok::<(), russh::Error>(())
                    };
                    if let Err(e) = r.await {
                        eprintln!("[ssh] 转发通道结束: {e}");
                    }
                });
            }
        });
        Ok(ForwardGuard(task))
    }
}

/// 端口转发守卫:drop 即停止监听(已建立的连接随通道结束自然收尾)
pub struct ForwardGuard(tokio::task::JoinHandle<()>);

impl Drop for ForwardGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// 远端常驻进程句柄(对齐 ssh 子进程语义:通道关闭 → 远端收 SIGHUP 退出)
pub struct SshProcess {
    alive: Arc<AtomicBool>,
    drain: tokio::task::JoinHandle<()>,
    write: Option<russh::ChannelWriteHalf<client::Msg>>,
    forward: Option<ForwardGuard>,
    /// pty drain 捕获到的 banner token 槽位(供 server.rs 等待)
    token: crate::server::TokenSlot,
}

impl SshProcess {
    /// 活性标记(通道被远端关闭/连接断开时翻 false,server.rs 退出监控据此判定)
    pub fn alive_flag(&self) -> Arc<AtomicBool> {
        self.alive.clone()
    }

    /// banner token 槽位:启动流程 await_token 等待远端打印的 Token 行
    pub fn token_slot(&self) -> crate::server::TokenSlot {
        self.token.clone()
    }

    pub fn attach_forward(&mut self, guard: ForwardGuard) {
        self.forward = Some(guard);
    }

    /// 关停:停止转发 → 关闭 exec 通道(远端收 HUP)→ 停止输出排空
    pub async fn shutdown(mut self) {
        self.forward.take();
        if let Some(write) = self.write.take() {
            let _ = write.close().await;
        }
        self.drain.abort();
    }
}

impl Drop for SshProcess {
    fn drop(&mut self) {
        // 未经 shutdown 直接 drop 时,尽力发送通道关闭(无运行时上下文则放弃)
        if let Some(write) = self.write.take() {
            if let Ok(rt) = tokio::runtime::Handle::try_current() {
                rt.spawn(async move {
                    let _ = write.close().await;
                });
            }
        }
        self.drain.abort();
    }
}

/// 全局共享连接缓存(同一 user@host:port+认证方式 复用一条,断开自动重连)
static SHARED_CLIENT: RwLock<Option<(String, Arc<SshClient>)>> = RwLock::const_new(None);

fn cache_key(cfg: &SshConfig) -> String {
    let auth = match &cfg.auth {
        SshAuth::Password => "password".to_string(),
        // 带上私钥路径:同主机换 key 文件不复用旧连接
        SshAuth::KeyFile(p) => format!("key:{p}"),
    };
    format!("{}@{}:{}:{auth}", cfg.user, cfg.host, cfg.port)
}

/// 取共享连接(密码从 keyring 取;测试连接等一次性场景请直接用 SshClient::connect)
pub async fn shared(cfg: &SshConfig) -> Result<Arc<SshClient>, String> {
    let key = cache_key(cfg);
    {
        let guard = SHARED_CLIENT.read().await;
        if let Some((k, c)) = guard.as_ref() {
            if k == &key && !c.is_closed() {
                return Ok(c.clone());
            }
        }
    }
    // 不持锁连接:connect 可能耗时较长(含认证),持写锁会阻塞所有并发任务
    let client = Arc::new(SshClient::connect(cfg, None).await?);
    let mut guard = SHARED_CLIENT.write().await;
    // 双检:connect 期间可能已被其他任务写入,丢弃新建连接用已有的
    if let Some((k, c)) = guard.as_ref() {
        if k == &key && !c.is_closed() {
            return Ok(c.clone());
        }
    }
    *guard = Some((key, client.clone()));
    Ok(client)
}

/// 丢弃共享连接(切换连接目标时调用)
pub async fn invalidate() {
    *SHARED_CLIENT.write().await = None;
}
