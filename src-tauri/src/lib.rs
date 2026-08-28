//! Kimi Code 桌面端 Tauri 后端:替代 Electron 主进程 + preload 的全部职责。
//! 模块划分对照原 TS:
//! - cli.rs          ↔ src/main/cli-manager.ts
//! - server.rs       ↔ src/main/server-manager.ts
//! - rest.rs         ↔ src/main/rest-client.ts
//! - ws.rs           ↔ src/main/ws-client.ts
//! - git.rs          ↔ src/main/git.ts
//! - local_store.rs  ↔ src/main/local-store.ts
//! - 本文件命令/事件 ↔ src/main/ipc.ts + index.ts

mod cli;
mod config;
mod local_store;
mod pet;
mod rest;
mod server;
mod skin;
mod ssh;
mod target;
mod updater;
mod ws;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use rest::RestClient;
use server::{ServerInfo, ServerManager, SharedServer};
use updater::{app_update_check, app_update_install};
use ws::WsClient;

/// 窗口标题 / 托盘 tooltip 显示名:dev 构建(tauri.dev.conf.json,独立 identifier)
/// 加 [dev] 后缀,与正式版并存时任务栏/托盘可区分
const APP_DISPLAY_NAME: &str = if cfg!(debug_assertions) {
    "Kimi Code Desktop [dev]"
} else {
    "Kimi Code Desktop"
};

/// 单个通道的后端运行时状态:server / REST / server_info / WS 均按通道隔离,
/// 各通道可独立启停、同时在线。key 为通道 id("local" 为本机)。
pub struct BackendState {
    pub server: SharedServer,
    pub rest: tokio::sync::Mutex<Option<RestClient>>,
    pub server_info: tokio::sync::Mutex<Option<ServerInfo>>,
    pub ws: tokio::sync::Mutex<Option<Arc<WsClient>>>,
    /// 该通道后端(kimi web)是否在运行:供窗口关闭拦截判断,无锁读取
    pub backend_running: AtomicBool,
    /// 该通道服务代次:每次 init_backend(服务就绪)递增;WsClient 记录创建时的代次,
    /// 与当前代次不一致即为绑定旧 port/token 的僵尸连接,重建订阅器时据此区分
    pub generation: AtomicU64,
    /// 该通道 bootstrap 进行中的停止请求:stop_backend 置位,run_bootstrap 启动成功后检查,
    /// 避免"安装/启动途中点停止"被随后完成的 bootstrap 静默撤销
    pub manual_stop: AtomicBool,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            server: Arc::new(tokio::sync::Mutex::new(ServerManager::default())),
            rest: tokio::sync::Mutex::new(None),
            server_info: tokio::sync::Mutex::new(None),
            ws: tokio::sync::Mutex::new(None),
            backend_running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            manual_stop: AtomicBool::new(false),
        }
    }
}

/// 全局状态:各通道 BackendState 以 HashMap 隔离管理(http / exit_cleaned 为全局)
pub struct AppState {
    /// 各通道后端状态:key = 通道 id,get-or-insert 访问
    pub backends: tokio::sync::Mutex<HashMap<String, BackendState>>,
    pub http: reqwest::Client,
    /// 退出清理标记:防止 ExitRequested 二次进入
    pub exit_cleaned: AtomicBool,
}

impl AppState {
    fn new() -> Self {
        Self {
            backends: tokio::sync::Mutex::new(HashMap::new()),
            // 显式超时:默认无超时的 Client 在连接 stall(SSH 转发断流/对端休眠)时
            // 会永久挂起,卡死 start/stop/退出整条生命周期链路
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            exit_cleaned: AtomicBool::new(false),
        }
    }

    /// get-or-insert 并克隆某通道的 SharedServer(不持 map 锁返回,供长 await 使用)
    async fn channel_server(&self, channel: &str) -> SharedServer {
        self.backends
            .lock()
            .await
            .entry(channel.to_string())
            .or_default()
            .server
            .clone()
    }

    /// get-or-insert 并对该通道 BackendState 做同步短操作(原子读写;内部锁的 await 由调用方直接持 map 锁完成)
    async fn with_backend<F, R>(&self, channel: &str, f: F) -> R
    where
        F: FnOnce(&BackendState) -> R,
    {
        let mut map = self.backends.lock().await;
        f(map.entry(channel.to_string()).or_default())
    }

    /// 任一通道后端运行中(关窗拦截用;锁被占时保守按运行中处理)
    fn any_backend_running(&self) -> bool {
        match self.backends.try_lock() {
            Ok(map) => map
                .values()
                .any(|b| b.backend_running.load(Ordering::SeqCst)),
            Err(_) => true,
        }
    }
}

/// 全局远端 CLI 覆盖跟随激活通道:remoteBin 存在且非空时应用,否则清除
fn apply_active_remote_bin(cfg: &config::DesktopConfig) {
    let bin = cfg
        .extra_channels()
        .iter()
        .find(|c| c.id == cfg.active())
        .and_then(|c| c.config.remote_bin.clone())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    cli::set_remote_bin_override(bin);
}

/// <app_data_dir>/logs(等价 Electron 的 userData/logs)
fn log_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("logs")
}

/// 服务就绪后初始化该通道的 REST 单例 / server_info / WS 通知订阅器(对应 ipc.ts initBackend)
async fn init_backend(app: &AppHandle, state: &AppState, channel: &str, info: &ServerInfo) {
    let map = state.backends.lock().await;
    let bs = &map[channel];
    *bs.server_info.lock().await = Some(info.clone());
    let rest = RestClient::new(info.clone(), state.http.clone());
    *bs.rest.lock().await = Some(rest.clone());
    bs.backend_running.store(true, Ordering::SeqCst);
    // 代次最后递增:读到新代次的订阅器必能看到新 server_info
    bs.generation.fetch_add(1, Ordering::SeqCst);
    // 清理可能残留的旧 WS(理论不该有,防御),按新代次重建通知订阅器
    if let Some(old) = bs.ws.lock().await.take() {
        old.close().await;
    }
    let generation = bs.generation.load(Ordering::SeqCst);
    let client = WsClient::new(info.clone(), app.clone(), log_dir(app), generation, rest);
    client.start();
    *bs.ws.lock().await = Some(client);
}

/// kimi web 意外退出时的清理(server.rs 退出监控回调):
/// 先清该通道 REST/ServerInfo(否则清理窗口内重建订阅器会拿旧 port/token 建僵尸连接)
/// → 关 WS → 复位 backend_running → 广播 server:exited(带 channel)。
/// 不做的话崩溃后 start_backend 会因 server_info.is_some() 永久 no-op,卡死在假"运行中"状态
pub(crate) async fn handle_unexpected_exit(app: &AppHandle, channel: &str, detail: &str) {
    eprintln!("[handle_unexpected_exit] {channel}: {detail}");
    let state = app.state::<Arc<AppState>>();
    {
        let map = state.backends.lock().await;
        if let Some(bs) = map.get(channel) {
            *bs.rest.lock().await = None;
            *bs.server_info.lock().await = None;
            if let Some(ws) = bs.ws.lock().await.take() {
                ws.close().await;
            }
            bs.backend_running.store(false, Ordering::SeqCst);
        }
    }
    let _ = app.emit("server:exited", json!({ "channel": channel, "detail": detail }));
}

/// 关停所有通道的 kimi web(进程退出 / 应用更新安装前共用):
/// 逐通道清 REST/ServerInfo、关 WS、优雅停服务(POST shutdown → 等退出 → 强杀兜底)、
/// 复位 backend_running 并广播 server:stopped。
/// 更新场景必须做:updater 插件安装时是 std::process::exit 立即终止进程,
/// 不会触发 ExitRequested,不先停服务则 kimi web 变孤儿占住首选端口,重启后端口顺延
pub(crate) async fn stop_all_backends(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let channels: Vec<String> = state.backends.lock().await.keys().cloned().collect();
    for channel in channels {
        let server = {
            let map = state.backends.lock().await;
            let Some(bs) = map.get(&channel) else {
                continue;
            };
            bs.manual_stop.store(true, Ordering::SeqCst);
            *bs.rest.lock().await = None;
            *bs.server_info.lock().await = None;
            if let Some(ws) = bs.ws.lock().await.take() {
                ws.close().await;
            }
            bs.server.clone()
        };
        ServerManager::stop(&server, &state.http).await;
        state
            .with_backend(&channel, |bs| bs.backend_running.store(false, Ordering::SeqCst))
            .await;
        let _ = app.emit("server:stopped", json!({ "channel": channel }));
    }
}

// ---------- app ----------

/// 应用与指定通道(缺省=激活通道)服务信息;保持旧调用兼容(channel 省略 = 激活通道)
#[tauri::command]
async fn app_info(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    channel: Option<String>,
) -> Result<Value, String> {
    let channel = channel.unwrap_or_else(cli::active_channel);
    let info = {
        let map = state.backends.lock().await;
        match map.get(&channel) {
            Some(bs) => bs.server_info.lock().await.clone(),
            None => None,
        }
    };
    Ok(json!({
        "appVersion": app.package_info().version.to_string(),
        "cliVersion": info.as_ref().map(|i| i.cli_version.clone()),
        "port": info.as_ref().map(|i| i.port),
        "meta": info.as_ref().and_then(|i| i.meta.clone()),
    }))
}

/// 官方 web UI 地址(对话 tab iframe src 用):http://127.0.0.1:<port>/#token=<token>;
/// 指定通道(缺省=激活通道)服务未运行返回 Err,前端据此显示未启动占位页
#[tauri::command]
async fn web_ui_url(
    state: State<'_, Arc<AppState>>,
    channel: Option<String>,
) -> Result<String, String> {
    let channel = channel.unwrap_or_else(cli::active_channel);
    let info = {
        let map = state.backends.lock().await;
        match map.get(&channel) {
            Some(bs) => bs.server_info.lock().await.clone(),
            None => None,
        }
    }
    .ok_or_else(|| "server not ready".to_string())?;
    Ok(format!("{}#token={}", info.base_url, info.token))
}

#[tauri::command]
async fn app_open_logs(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// 系统浏览器打开 http/https 链接(iframe 被 frame-ancestors 拦截时的降级入口);
/// 与 on_new_window 同一红线:仅 http/https,其他 scheme 拒绝
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("仅允许 http/https 链接".to_string());
    }
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

/// 前端在退出确认弹窗中点"退出"后调用:直接退出(仍走 ExitRequested 优雅关停)
#[tauri::command]
fn confirm_close(app: AppHandle) {
    app.exit(0);
}

/// 退出确认弹窗选"进入托盘":隐藏主窗口(仅托盘驻留);恢复走托盘 restore_main。
/// 必须 async:同步命令占住主线程会卡住事件循环(见 AGENTS.md)
#[tauri::command]
async fn hide_main_to_tray(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
async fn cli_upgrade(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<String, String> {
    // WSL/SSH:CLI 在远端环境,走远端升级路径
    let conn_target = cli::connection_target();
    if !conn_target.is_local() {
        return cli_upgrade_remote(&app, &state, &conn_target).await;
    }
    // 按 CLI 安装来源自动选择升级通道:
    // home(官方 irm/install.ps1 脚本装到数据目录/bin)走 `kimi upgrade` 自更新;
    // path/custom/env(npm 全局或自定义路径)走 `npm update -g`
    let source = cli::kimi_bin_source();
    let before = cli::detect_installed().await;
    match source {
        "home" => {
            let _out = cli::upgrade_cli().await?;
        }
        _ => {
            let _out = cli::npm_upgrade().await?;
        }
    }
    let version = cli::detect_installed().await;
    // 升级前后版本一致:自更新渠道暂未发布该版本(irm 渠道可能落后于 npm registry),
    // 或交互式升级被取消 / 当前 CLI 并非 npm 全局安装——如实报错,误报成功会导致
    // 下次启动重复提示同一更新
    if version.is_some() && version == before {
        return Err(if source == "home" {
            "CLI 自更新渠道暂未发布新版本(或升级被取消),请稍后再试".to_string()
        } else {
            "升级后版本未变化;若 CLI 非 npm 全局安装(如 scoop/手动放置),请用对应方式手动升级".to_string()
        });
    }
    // 服务在跑则重启使新版本生效;重启失败不否定升级本身(restartOk=false 由前端提示)
    let was_running = {
        let map = state.backends.lock().await;
        match map.get(&cli::active_channel()) {
            Some(bs) => bs.server_info.lock().await.is_some(),
            None => false,
        }
    };
    let restart_ok = if was_running {
        restart_backend(&app, &state).await.is_ok()
    } else {
        false
    };
    let _ = app.emit(
        "cli:upgraded",
        json!({ "version": version, "restartOk": restart_ok }),
    );
    // 升级后探测失败不视为升级失败:version=null,前端提示"无法确认新版本"
    Ok(version.unwrap_or_default())
}

/// WSL/SSH 远端升级:路径含 .kimi-code/bin 视为官方脚本安装(重跑安装脚本),
/// 否则按 npm 全局安装处理(npm update -g,经 bash -lc 拿 PATH)。
/// 完成后重启后端并广播 cli:upgraded(事件格式与本机升级一致)
async fn cli_upgrade_remote(
    app: &AppHandle,
    state: &AppState,
    conn_target: &target::ConnectionTarget,
) -> Result<String, String> {
    let bin = conn_target.kimi_bin_resolved().await?;
    let cmd = if bin.contains(".kimi-code/bin") {
        "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash".to_string()
    } else {
        "bash -lc 'npm update -g @moonshot-ai/kimi-code'".to_string()
    };
    let out = conn_target
        .run_shell(&cmd, std::time::Duration::from_secs(600))
        .await?;
    if out.code != 0 {
        let stderr: String = out.stderr.trim().chars().take(300).collect();
        return Err(format!("远端升级失败({}): {stderr}", conn_target.describe()));
    }
    restart_backend(app, state).await?;
    let version = cli::detect_installed().await;
    let _ = app.emit(
        "cli:upgraded",
        json!({ "version": version, "restartOk": true }),
    );
    version.ok_or_else(|| "升级后检测 CLI 版本失败".to_string())
}

// ---------- 后端服务启停 ----------

/// 手动启动指定通道(缺省=激活通道)后端:已在运行则直接返回;否则按 bootstrap 流程
/// (CLI 检测→缺失则安装→查更新→启动 kimi web)异步执行,进度经事件广播
#[tauri::command]
async fn start_backend(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    channel: Option<String>,
) -> Result<(), String> {
    let channel = channel.unwrap_or_else(cli::active_channel);
    // 已在运行则直接返回(server_info 就绪即视为在跑)
    let running = {
        let map = state.backends.lock().await;
        match map.get(&channel) {
            Some(bs) => bs.server_info.lock().await.is_some(),
            None => false,
        }
    };
    if running {
        return Ok(());
    }
    let app2 = app.clone();
    let st = state.inner().clone();
    let ch = channel.clone();
    tauri::async_runtime::spawn(async move {
        run_bootstrap(app2, st, ch).await;
    });
    Ok(())
}

/// 停止指定通道(缺省=激活通道)后端:先清 REST/ServerInfo(停服窗口内 web_ui_url/rest 报
/// server not ready,不会拿旧 port/token 建僵尸连接)→ 关 WS(通知订阅器随之退出)→
/// 停 kimi web → 复位 backend_running
#[tauri::command]
async fn stop_backend(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    channel: Option<String>,
) -> Result<(), String> {
    let channel = channel.unwrap_or_else(cli::active_channel);
    // 记录停止请求:bootstrap 进行中时 stop 对空 proc 空转,由 bootstrap 启动成功后自查
    {
        let map = state.backends.lock().await;
        if let Some(bs) = map.get(&channel) {
            bs.manual_stop.store(true, Ordering::SeqCst);
            *bs.rest.lock().await = None;
            *bs.server_info.lock().await = None;
            if let Some(ws) = bs.ws.lock().await.take() {
                ws.close().await;
            }
        }
    }
    let server = state.channel_server(&channel).await;
    ServerManager::stop(&server, &state.http).await;
    state
        .with_backend(&channel, |bs| bs.backend_running.store(false, Ordering::SeqCst))
        .await;
    let _ = app.emit("server:stopped", json!({ "channel": channel }));
    Ok(())
}

/// 更新弹窗"跳过此版本":持久化到 desktop-config.json,启动查更新时该版本不再提示
#[tauri::command]
async fn cli_update_skip(app: AppHandle, version: String) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.cli_update_skip = Some(version);
    config::save(&app, &cfg)
}

/// 手动检查 CLI 更新:对比 npm registry 最新版,返回当前/最新版本与是否有更新。
/// 网络不可达时返回错误,便于设置页给出明确反馈(启动时的自动检查是静默的)
#[tauri::command]
async fn cli_check_update(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    let current = cli::detect_installed().await;
    let latest = cli::fetch_latest_version(&state.http)
        .await
        .ok_or_else(|| "无法获取最新版本信息,请检查网络后重试".to_string())?;
    let has_update = match &current {
        Some(c) => cli::is_newer(&latest, c),
        None => false,
    };
    Ok(json!({
        "current": current,
        "latest": latest,
        "hasUpdate": has_update,
    }))
}

// ---------- kimi 数据目录(工作区) ----------

/// 当前数据目录信息:生效路径 / 来源(custom|env|default|remote)/ 默认路径。
/// 非本机目标返回远端数据目录(远端 $HOME/.kimi-code,经目标通道探测;
/// 探测失败回退 "~/.kimi-code" 字样,不影响设置页打开)
#[tauri::command]
async fn get_kimi_home() -> Value {
    let target = cli::connection_target();
    if target.is_local() {
        return json!({
            "home": cli::kimi_home().to_string_lossy(),
            "source": cli::kimi_home_source(),
            "defaultHome": cli::default_kimi_home().to_string_lossy(),
        });
    }
    let home = target
        .kimi_home_str()
        .await
        .unwrap_or_else(|_| "~/.kimi-code".to_string());
    json!({
        "home": home,
        "source": "remote",
        "defaultHome": home,
    })
}

/// 重启激活通道后端:先清该通道 REST/ServerInfo(理由同 stop_backend,杜绝僵尸 WS 窗口)→
/// 关 WS(通知订阅器随之退出,init_backend 按新 ServerInfo 重建)→ 停服务 →
/// 按新配置重新启动并广播 server:ready / server:error(带 channel)
async fn restart_backend(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let channel = cli::active_channel();
    let target = cli::connection_target_for(&channel);
    let server = state.channel_server(&channel).await;
    {
        let map = state.backends.lock().await;
        if let Some(bs) = map.get(&channel) {
            *bs.rest.lock().await = None;
            *bs.server_info.lock().await = None;
            bs.backend_running.store(false, Ordering::SeqCst);
            if let Some(ws) = bs.ws.lock().await.take() {
                ws.close().await;
            }
        }
    }
    ServerManager::stop(&server, &state.http).await;

    match ServerManager::start(&server, &state.http, app, &channel, &target).await {
        Ok(info) => {
            init_backend(app, state, &channel, &info).await;
            let _ = app.emit(
                "server:ready",
                json!({
                    "channel": channel,
                    "cliVersion": info.cli_version,
                    "port": info.port,
                    "token": info.token,
                    "meta": info.meta,
                    "frameBlocked": info.frame_blocked,
                }),
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("server:error", json!({ "channel": channel, "error": e.clone() }));
            Err(e)
        }
    }
}

/// 设置/清除自定义数据目录:持久化 → 重启 kimi web 服务 → 重新初始化 REST/WS。
/// path 为 None 时恢复默认(清除覆盖)。
#[tauri::command]
async fn set_kimi_home(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
) -> Result<Value, String> {
    let override_path = match path {
        Some(p) => {
            let p = p.trim().to_string();
            if p.is_empty() {
                return Err("路径不能为空".to_string());
            }
            let dir = PathBuf::from(&p);
            // 目录不存在则创建(全新工作区是合法场景)
            std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
            if !dir.is_dir() {
                return Err("路径不是目录".to_string());
            }
            Some(dir)
        }
        None => None,
    };

    // 持久化(合并已有配置,保留 cli_bin)+ 应用到全局
    let mut cfg = config::load(&app);
    cfg.kimi_home = override_path
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned());
    config::save(&app, &cfg)?;
    cli::set_kimi_home_override(override_path);

    restart_backend(&app, &state).await?;
    Ok(get_kimi_home().await)
}

// ---------- 连接目标(本机 / WSL / SSH) ----------

/// 通道列表 + 当前激活通道:前端顶部切换器与设置→通道页用。
/// running 为该通道后端实时运行状态(backend_running)
#[tauri::command]
async fn get_channels(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    let cfg = config::load(&app);
    let map = state.backends.lock().await;
    let running = |id: &str| {
        map.get(id)
            .map(|b| b.backend_running.load(Ordering::SeqCst))
            .unwrap_or(false)
    };
    let mut channels = vec![json!({
        "id": "local",
        "label": "本机",
        "target": "local",
        "running": running("local"),
    })];
    for c in cfg.extra_channels() {
        channels.push(json!({
            "id": c.id,
            "label": c.label,
            "target": c.config.target,
            "running": running(&c.id),
        }));
    }
    Ok(json!({ "channels": channels, "active": cfg.active() }))
}

/// 切换激活通道:只写配置,不启停任何服务。通道不存在报错
#[tauri::command]
async fn set_active_channel(app: AppHandle, id: String) -> Result<(), String> {
    let mut cfg = config::load(&app);
    let exists = id == "local" || cfg.extra_channels().iter().any(|c| c.id == id);
    if !exists {
        return Err(format!("通道不存在: {id}"));
    }
    cfg.active_channel = if id == "local" { None } else { Some(id) };
    config::save(&app, &cfg)?;
    cli::refresh_channels(&cfg.extra_channels(), cfg.active());
    // 远端 CLI 覆盖随激活通道走
    apply_active_remote_bin(&cfg);
    // 新通道的用量缓存后台预热(统计页首开直接命中)
    warm_usage_cache();
    Ok(())
}

/// 后台预热激活通道的用量扫描缓存:统计页(用量概览/API 调用)首开直接命中,
/// 避免冷缓存全量扫描卡顿;失败静默(统计页自己会再扫)
fn warm_usage_cache() {
    tauri::async_runtime::spawn(async move {
        let t = cli::connection_target_for(&cli::active_channel());
        let _ = t.usage_record_lines().await;
    });
}

/// 实验性功能开关(返回各注册项的有效值:用户设置 > 桌面默认 > CLI 默认)
#[tauri::command]
fn experimental_get() -> HashMap<String, bool> {
    target::experimental_effective().into_iter().collect()
}

/// 保存实验性功能开关:持久化到 desktop-config.json 并更新运行时;
/// 激活通道后端运行中则自动重启(环境变量需重启进程生效)
#[tauri::command]
async fn experimental_set(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    flags: HashMap<String, bool>,
) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.experimental = Some(flags.clone());
    config::save(&app, &cfg)?;
    cli::set_experimental_flags(flags);
    let channel = cli::active_channel();
    let running = {
        let map = state.backends.lock().await;
        map.get(&channel)
            .map(|bs| bs.backend_running.load(Ordering::SeqCst))
            .unwrap_or(false)
    };
    if running {
        restart_backend(&app, &state).await?;
    }
    Ok(())
}

/// 读取 kimi web 启动参数(首选端口,未配置回默认)
#[tauri::command]
fn web_server_get(app: AppHandle) -> Value {
    let opts = config::load(&app).web_options();
    json!({ "port": opts.port })
}

/// 保存 kimi web 启动参数:持久化到 desktop-config.json 并更新运行时;
/// 激活通道后端运行中则自动重启(端口是进程启动参数,需重启生效)
#[tauri::command]
async fn web_server_set(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    port: u16,
) -> Result<Value, String> {
    if port == 0 {
        return Err("端口必须大于 0".to_string());
    }
    let mut cfg = config::load(&app);
    cfg.web_port = Some(port);
    config::save(&app, &cfg)?;
    server::set_web_options(cfg.web_options());
    let channel = cli::active_channel();
    let running = {
        let map = state.backends.lock().await;
        map.get(&channel)
            .map(|bs| bs.backend_running.load(Ordering::SeqCst))
            .unwrap_or(false)
    };
    if running {
        restart_backend(&app, &state).await?;
    }
    Ok(web_server_get(app))
}

/// 桌宠配置载荷(enabled/slug/clickThrough/wander),pet_config_get 返回值与 pet:config-changed 载荷共用
fn pet_config_json(cfg: &config::DesktopConfig) -> Value {
    json!({
        "enabled": cfg.pet_enabled.unwrap_or(false),
        "slug": cfg.pet_slug.clone().unwrap_or_else(|| pet::BUILTIN_SLUG.to_string()),
        "clickThrough": cfg.pet_click_through.unwrap_or(false),
        "wander": cfg.pet_wander.unwrap_or(true),
    })
}

/// 桌宠配置(实验性):enabled 缺省关;slug 为当前激活宠物(缺省 "kimi" 即内置);
/// clickThrough 点击穿透缺省关;wander 闲置散步缺省开(桌宠 M5 P5)
#[tauri::command]
fn pet_config_get(app: AppHandle) -> Value {
    pet_config_json(&config::load(&app))
}

/// 开关桌宠:持久化到 desktop-config.json 并即时创建/销毁悬浮窗。
/// 必须是 async:同步命令跑在主线程,而 build() 依赖主线程事件循环初始化
/// WebView2,同步命令里建窗会死锁(2026-08 实测:enter 后无返回)。
#[tauri::command]
async fn pet_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.pet_enabled = Some(enabled);
    config::save(&app, &cfg)?;
    if enabled {
        pet::show(&app)?;
    } else {
        pet::hide(&app);
    }
    // 广播配置变化:右键菜单/其他页面改配置后,各窗口都能同步(载荷为完整 PetConfig)
    let _ = app.emit("pet:config-changed", pet_config_json(&cfg));
    Ok(())
}

/// 开关点击穿透:持久化并即时应用到已存在的悬浮窗(建窗时 pet::show 会按配置补齐)。
/// 异步:窗口操作遵守上述 async 约定
#[tauri::command]
async fn pet_set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.pet_click_through = Some(enabled);
    config::save(&app, &cfg)?;
    pet::apply_click_through(&app, enabled);
    let _ = app.emit("pet:config-changed", pet_config_json(&cfg));
    Ok(())
}

/// 闲置散步开关(桌宠 M5 P5):只持久化并广播 pet:config-changed,不建窗,sync 即可
#[tauri::command]
fn pet_set_wander(app: AppHandle, wander: bool) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.pet_wander = Some(wander);
    config::save(&app, &cfg)?;
    let _ = app.emit("pet:config-changed", pet_config_json(&cfg));
    Ok(())
}

/// 闲置散步挪窗(桌宠 M5 P5):x 方向移动 dx 逻辑像素(y 不动),
/// clamp 在宠物所在显示器范围内。必须 async(窗口操作依赖主线程事件循环)
#[tauri::command]
async fn pet_nudge(app: AppHandle, dx: f64) -> Result<(), String> {
    let Some(w) = app.get_webview_window(pet::PET_WINDOW_LABEL) else {
        return Ok(());
    };
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let size = w.outer_size().map_err(|e| e.to_string())?;
    let scale = w.scale_factor().unwrap_or(1.0);
    let target = pos.x as f64 + dx * scale;
    let x = match w.current_monitor().ok().flatten() {
        Some(m) => {
            let min = m.position().x as f64;
            let max = m.position().x as f64 + m.size().width as f64 - size.width as f64;
            target.clamp(min, max.max(min))
        }
        None => target,
    };
    w.set_position(tauri::PhysicalPosition::new(x as i32, pos.y))
        .map_err(|e| e.to_string())
}

/// 桌宠窗口唤回主窗(桌宠 M5 P1):包 restore_main 的 unminimize+show+focus 逻辑,
/// 供宠物窗/悬浮菜单前端调用。必须 async(窗口操作跑在主线程事件循环上,同步会死锁)。
#[tauri::command]
async fn pet_restore_main(app: AppHandle) {
    restore_main(&app);
}

/// 悬浮菜单开关(桌宠 M5 P3):菜单可见则收起,否则在宠物上方展开。
/// 必须 async(建窗依赖主线程事件循环,同步会死锁)。
#[tauri::command]
async fn pet_menu_toggle(app: AppHandle) -> Result<(), String> {
    pet::menu_toggle(&app)
}

/// 收起悬浮菜单(hide 不 close,保留前端状态;失焦/选中会话后由前端调用)
#[tauri::command]
async fn pet_menu_hide(app: AppHandle) {
    pet::menu_hide(&app);
}

/// 悬浮菜单快捷入口(桌宠 M5 P3):唤回主窗并广播 app:navigate,
/// 主窗据此切 view;带 session_id 时对话 iframe 跳转到该会话。
/// 先 restore 再 emit:主窗被隐藏时 webview 仍存活,listen 一直有效,时序不丢
#[tauri::command]
async fn pet_menu_navigate(app: AppHandle, view: Option<String>, session_id: Option<String>) {
    restore_main(&app);
    let _ = app.emit(
        "app:navigate",
        json!({ "view": view, "sessionId": session_id }),
    );
}

/// 钉选会话切换(桌宠 M5 P3):load→toggle→原子写,返回新数组(新的在前)。
/// 不建窗,sync 即可
#[tauri::command]
fn pet_menu_pin_toggle(app: AppHandle, session_id: String) -> Result<Vec<String>, String> {
    let mut cfg = config::load(&app);
    let mut pins = cfg.menu_pinned_sessions.unwrap_or_default();
    if let Some(pos) = pins.iter().position(|p| p == &session_id) {
        pins.remove(pos);
    } else {
        pins.insert(0, session_id);
    }
    cfg.menu_pinned_sessions = Some(pins.clone());
    config::save(&app, &cfg)?;
    Ok(pins)
}

/// 钉选会话列表(桌宠 M5 P3;缺省空数组)
#[tauri::command]
fn pet_menu_pins_get(app: AppHandle) -> Vec<String> {
    config::load(&app).menu_pinned_sessions.unwrap_or_default()
}

/// 宠物列表(M3):内置注册表在前,其后为扫描到的外部宠物(kimi-code 目录优先于 petdex)。
/// 不建窗,仅读盘扫描,sync 即可
#[tauri::command]
fn pet_list() -> Vec<pet::PetInfo> {
    let mut list: Vec<pet::PetInfo> = pet::builtin_pets().iter().map(|p| p.info()).collect();
    list.extend(pet::scan_pets().into_iter().map(|p| p.info()));
    list
}

/// 导入宠物包(设置页"导入 zip"):bytes 为 zip 文件内容,解压校验到 kimi_home/pets/<slug>。
/// 只读盘/写盘,不建窗,sync 即可
#[tauri::command]
fn pet_import_zip(name: String, bytes: Vec<u8>) -> Result<pet::PetInfo, String> {
    pet::import_zip(&name, &bytes)
}

/// 当前激活宠物完整元信息(M3):按 desktop-config.json 的 pet_slug 在扫描结果里找,
/// 找不到/未设置回退内置宠物。不建窗,sync 即可
#[tauri::command]
fn pet_active_get(app: AppHandle) -> pet::PetMeta {
    pet::resolve_pet(&pet::active_slug(&app))
}

/// 切换激活宠物(M3):校验 slug 存在(内置注册表或扫描到)→ 持久化 pet_slug →
/// 广播 pet:config-changed(载荷为完整 PetConfig)。不建窗,sync 即可
#[tauri::command]
fn pet_set_active(app: AppHandle, slug: String) -> Result<(), String> {
    if !pet::valid_slug(&slug) {
        return Err(format!("非法宠物标识: {slug}"));
    }
    let is_builtin = pet::builtin_pets().iter().any(|p| p.slug == slug);
    if !is_builtin && !pet::scan_pets().iter().any(|p| p.slug == slug) {
        return Err(format!("宠物不存在: {slug}"));
    }
    let mut cfg = config::load(&app);
    cfg.pet_slug = Some(slug);
    config::save(&app, &cfg)?;
    let _ = app.emit("pet:config-changed", pet_config_json(&cfg));
    Ok(())
}

/// 皮肤配置载荷(enabled/slug/opacity/in_chat),skin_config_get 返回值与 skin:config-changed 载荷共用
fn skin_config_json(cfg: &config::DesktopConfig) -> Value {
    json!({
        "enabled": cfg.skin_enabled.unwrap_or(false),
        "slug": cfg.skin_slug,
        "opacity": cfg.skin_opacity.unwrap_or(skin::DEFAULT_OPACITY),
        "inChat": cfg.skin_in_chat.unwrap_or(false),
    })
}

/// 皮肤配置(实验性):enabled 缺省关;slug 为当前皮肤(缺省 None,前端回退注册表第一个);
/// opacity 为卡片不透明度百分比(缺省 82)
#[tauri::command]
fn skin_config_get(app: AppHandle) -> Value {
    skin_config_json(&config::load(&app))
}

/// 开关界面皮肤:只持久化并广播 skin:config-changed,不涉及建窗,sync 即可
#[tauri::command]
fn skin_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.skin_enabled = Some(enabled);
    config::save(&app, &cfg)?;
    let _ = app.emit("skin:config-changed", skin_config_json(&cfg));
    Ok(())
}

/// 切换皮肤:内置皮肤注册表在前端(src/assets/skins/ 目录扫描),Rust 不校验 slug,
/// 前端遇到未知 slug 回退注册表第一个(与 pet_active_get 的回退策略一致)
#[tauri::command]
fn skin_set_active(app: AppHandle, slug: String) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.skin_slug = Some(slug.clone());
    config::save(&app, &cfg)?;
    let _ = app.emit("skin:config-changed", skin_config_json(&cfg));
    Ok(())
}

/// 调整卡片不透明度(30-100):拖动滑块时连续调用,每次持久化并广播,立绘透出即时预览
#[tauri::command]
fn skin_set_opacity(app: AppHandle, opacity: u8) -> Result<(), String> {
    if !(skin::MIN_OPACITY..=100).contains(&opacity) {
        return Err(format!("不透明度需在 {}-100 之间", skin::MIN_OPACITY));
    }
    let mut cfg = config::load(&app);
    cfg.skin_opacity = Some(opacity);
    config::save(&app, &cfg)?;
    let _ = app.emit("skin:config-changed", skin_config_json(&cfg));
    Ok(())
}

/// 开关对话页内立绘透出(实验性):只持久化并广播 skin:config-changed,
/// iframe 内显隐由注入脚本与壳侧桥接(chatSkinBridge)完成,sync 即可
#[tauri::command]
fn skin_set_in_chat(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.skin_in_chat = Some(enabled);
    config::save(&app, &cfg)?;
    let _ = app.emit("skin:config-changed", skin_config_json(&cfg));
    Ok(())
}

/// 用户自选皮肤列表:扫描 <config_dir>/skins/,返回 slug 列表(只读盘,sync 即可)
#[tauri::command]
fn skin_custom_list() -> Vec<String> {
    skin::scan_custom_skins()
}

/// 打开用户皮肤目录(不存在先建好),便于用户往里放图片
#[tauri::command]
async fn skin_dir_open(app: AppHandle) -> Result<(), String> {
    let dir = skin::skins_dir().ok_or("无法确定配置目录")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// 添加通道:复用 set_connection_target 的保存/密码落 keyring 逻辑,但只追加,
/// 不切换激活通道、不重启任何服务。id 按目标自动生成,重复报错;本机不可添加。
/// label 省略时按目标展示名(本机 / WSL (Ubuntu) / user@host)生成
#[tauri::command]
async fn add_channel(
    app: AppHandle,
    cfg: Value,
    label: Option<String>,
    password: Option<String>,
) -> Result<Value, String> {
    let conn: target::ConnectionConfig =
        serde_json::from_value(cfg).map_err(|e| format!("连接目标配置格式错误: {e}"))?;
    let target = target::ConnectionTarget::from(conn.clone());
    if let target::ConnectionTarget::Ssh { host, .. } = &target {
        if host.trim().is_empty() {
            return Err("SSH 目标必须填写 user@host".to_string());
        }
    }
    if target.is_local() {
        return Err("本机通道已存在,无需添加".to_string());
    }
    let id = cli::channel_id_for(&conn);
    let mut desktop = config::load(&app);
    if desktop.extra_channels().iter().any(|c| c.id == id) {
        return Err(format!("通道已存在: {id}"));
    }
    // 密码认证:保存到系统凭据管理器。ssh 侧只从 keyring 读密码,
    // keyring 写失败则后端启动必失败,这里直接报错(与 set_connection_target 一致)
    if let target::ConnectionTarget::Ssh { auth, .. } = &target {
        if auth.as_deref() != Some("key") {
            if let Some(pw) = password.as_deref().filter(|p| !p.is_empty()) {
                target
                    .ssh_config()
                    .and_then(|c| ssh::save_password(&c.user, &c.host, c.port, pw))
                    .map_err(|e| format!("系统凭据管理器不可用,密码无法保存: {e}"))?;
            }
        }
    }
    let label = label
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| target.describe());
    let channel = config::Channel {
        id: id.clone(),
        label,
        config: conn,
    };
    let mut channels = desktop.channels.take().unwrap_or_default();
    channels.push(channel.clone());
    desktop.channels = Some(channels);
    config::save(&app, &desktop)?;
    cli::refresh_channels(&desktop.extra_channels(), desktop.active());
    serde_json::to_value(&channel).map_err(|e| e.to_string())
}

/// 删除通道:若其服务在跑先停;从配置删除;若删的是激活通道则 active 回落 "local"。local 不可删。
/// 删除后同步清掉该通道的 SSH 共享连接与远端路径缓存
#[tauri::command]
async fn remove_channel(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    if id == "local" {
        return Err("本机通道不可删除".to_string());
    }
    let mut cfg = config::load(&app);
    if !cfg.extra_channels().iter().any(|c| c.id == id) {
        return Err(format!("通道不存在: {id}"));
    }
    // 服务在跑先停(顺带关 WS,避免移除后通知订阅器对死端口空转)
    let server = state.channel_server(&id).await;
    {
        let map = state.backends.lock().await;
        if let Some(bs) = map.get(&id) {
            *bs.rest.lock().await = None;
            *bs.server_info.lock().await = None;
            if let Some(ws) = bs.ws.lock().await.take() {
                ws.close().await;
            }
        }
    }
    ServerManager::stop(&server, &state.http).await;
    state.backends.lock().await.remove(&id);

    // SSH 通道:连同系统凭据管理器中的密码一起清除(账号名归一化与保存时同走 ssh_config)
    if let Some(ch) = cfg.extra_channels().into_iter().find(|c| c.id == id) {
        if let Ok(c) = target::ConnectionTarget::from(ch.config).ssh_config() {
            ssh::delete_password(&c.user, &c.host, c.port);
        }
    }

    cfg.channels = Some(cfg.extra_channels().into_iter().filter(|c| c.id != id).collect());
    if cfg.active() == id {
        cfg.active_channel = None;
    }
    config::save(&app, &cfg)?;
    cli::refresh_channels(&cfg.extra_channels(), cfg.active());
    apply_active_remote_bin(&cfg);
    // SSH 共享连接与远端路径缓存按目标隔离,删除后清理不残留
    ssh::invalidate().await;
    target::invalidate_remote_caches();
    Ok(())
}

/// 首次启动向导状态(App.tsx 挂载时据此决定是否进入向导)
#[tauri::command]
fn get_setup_state(app: AppHandle) -> Value {
    json!({
        "setupDone": config::load(&app).setup_done.unwrap_or(false),
    })
}

/// 复位向导标记(设置页"重新运行初始向导"入口):下次启动或前端主动打开时重新进入向导
#[tauri::command]
fn reset_setup(app: AppHandle) -> Result<(), String> {
    let mut cfg = config::load(&app);
    cfg.setup_done = Some(false);
    config::save(&app, &cfg)
}

/// 测试连接目标(向导/设置页"测试连接"用,不持久化):
/// SSH 走完整认证 + kimi --version(password 显式传入,不进共享缓存);
/// WSL 走 wsl detect;Local 走本地 detect
#[tauri::command]
async fn test_connection_target(cfg: Value, password: Option<String>) -> Result<Value, String> {
    let conn: target::ConnectionConfig =
        serde_json::from_value(cfg).map_err(|e| format!("连接目标配置格式错误: {e}"))?;
    let target = target::ConnectionTarget::from(conn);
    if let target::ConnectionTarget::Ssh { host, .. } = &target {
        if host.trim().is_empty() {
            return Err("SSH 目标必须填写 user@host".to_string());
        }
    }
    let version = target
        .detect_cli_with_password(password.as_deref().filter(|p| !p.is_empty()))
        .await?;
    Ok(json!({
        "version": version,
        "describe": target.describe(),
    }))
}

/// 当前连接目标配置与展示名(设置页用);hasPassword 供回显"已保存密码",
/// config.remoteBin 取自全局覆盖(ConnectionTarget 本身不携带,这里补回供设置页回显/保存时保留)
#[tauri::command]
fn get_connection_target() -> Value {
    let target = cli::connection_target();
    let has_password = match &target {
        target::ConnectionTarget::Ssh { .. } => target
            .ssh_config()
            .map(|c| ssh::has_password(&c.user, &c.host, c.port))
            .unwrap_or(false),
        _ => false,
    };
    let mut config = target::ConnectionConfig::from(&target);
    config.remote_bin = cli::remote_bin_override();
    json!({
        "config": config,
        "describe": target.describe(),
        "hasPassword": has_password,
    })
}

/// 切换连接目标:持久化 → 重启 kimi web 服务(照 set_kimi_home 模式)。
/// SSH 目标必须填写 host;非本机目标下数据目录/CLI 路径设置不生效(远端用自己的 ~/.kimi-code)。
/// ssh_auth = "password" 且传入 password 时,密码存 keyring(keyring 不可用则直接报错),
/// 密码永不写入 desktop-config.json;保存后置 setup_done = true(向导完成)
#[tauri::command]
async fn set_connection_target(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    cfg: Value,
    password: Option<String>,
) -> Result<Value, String> {
    let conn: target::ConnectionConfig =
        serde_json::from_value(cfg).map_err(|e| format!("连接目标配置格式错误: {e}"))?;
    let target = target::ConnectionTarget::from(conn.clone());
    if let target::ConnectionTarget::Ssh { host, .. } = &target {
        if host.trim().is_empty() {
            return Err("SSH 目标必须填写 user@host".to_string());
        }
    }

    // 密码认证:保存到系统凭据管理器。ssh 侧只从 keyring 读密码,
    // keyring 写失败则后端启动必失败,这里直接报错(不做无实际存储的假"内存生效"降级)
    let mut password_saved = false;
    if let target::ConnectionTarget::Ssh { auth, .. } = &target {
        if auth.as_deref() != Some("key") {
            if let Some(pw) = password.as_deref().filter(|p| !p.is_empty()) {
                target
                    .ssh_config()
                    .and_then(|c| ssh::save_password(&c.user, &c.host, c.port, pw))
                    .map_err(|e| format!("系统凭据管理器不可用,密码无法保存: {e}"))?;
                password_saved = true;
            }
        }
    }

    let mut desktop = config::load(&app);
    desktop.connection = Some(conn);
    desktop.setup_done = Some(true);
    config::save(&app, &desktop)?;
    // 立即生效:本机通道切换为该目标(持久化仍走旧 connection 字段,下次启动按迁移规则转通道)
    cli::set_channel_target("local", target);
    cli::set_remote_bin_override(
        desktop
            .connection
            .as_ref()
            .and_then(|c| c.remote_bin.clone())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    );
    // 目标可能变化:丢弃旧 SSH 共享连接与远端路径缓存,restart 时按新配置重连/重探测
    ssh::invalidate().await;
    target::invalidate_remote_caches();

    restart_backend(&app, &state).await?;
    let mut out = get_connection_target();
    if let Some(obj) = out.as_object_mut() {
        obj.insert("passwordSaved".to_string(), json!(password_saved));
    }
    Ok(out)
}

// ---------- CLI 二进制来源 ----------

/// 当前 CLI 二进制信息:生效路径 / 来源 / 版本。
/// Local:来源 custom|env|home|path;WSL/SSH:来源 custom(remote_bin 覆盖)|auto(自动探测),
/// 探测失败时 bin/version 给 null(不报错,设置页仍要能打开)
#[tauri::command]
async fn get_cli_bin() -> Value {
    let conn_target = cli::connection_target();
    if conn_target.is_local() {
        // detect 先行:内部完成 home/PATH 双候选比较,bin/source 反映比较结果
        let version = cli::detect_installed().await;
        return json!({
            "bin": cli::kimi_bin(),
            "source": cli::kimi_bin_source(),
            "version": version,
        });
    }
    let (bin, version) = match conn_target.kimi_bin_resolved().await {
        Ok(bin) => {
            let version = conn_target.detect_cli().await.ok().filter(|v| !v.is_empty());
            (Value::String(bin), version.map_or(Value::Null, Value::String))
        }
        Err(_) => (Value::Null, Value::Null),
    };
    json!({
        "bin": bin,
        "source": if cli::remote_bin_override().is_some() { "custom" } else { "auto" },
        "version": version,
    })
}

/// 指定/清除远端 CLI 二进制路径(仅 WSL/SSH 连接目标;None 恢复自动探测)。
/// Some 时必须是 / 开头的绝对路径且在目标上可执行(test -x);
/// 持久化到 connection.remoteBin → 应用覆盖 → 清探测缓存 → 重启服务 → 返回最新 CLI 状态
#[tauri::command]
async fn set_remote_bin(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
) -> Result<Value, String> {
    let conn_target = cli::connection_target();
    if conn_target.is_local() {
        return Err("远端 CLI 路径仅在 WSL/SSH 连接目标下可设置".to_string());
    }
    let bin = match path {
        Some(p) => {
            let p = p.trim().to_string();
            if !p.starts_with('/') {
                return Err("远端路径必须是 / 开头的绝对路径".to_string());
            }
            let out = conn_target
                .run_shell(
                    &format!("test -x {}", target::sq(&p)),
                    std::time::Duration::from_secs(15),
                )
                .await?;
            if out.code != 0 {
                return Err(format!("自定义远端路径不可执行: {p}"));
            }
            Some(p)
        }
        None => None,
    };

    // 持久化到激活通道的 config(额外通道写 channels;local 通道写旧 connection 字段)
    let mut cfg = config::load(&app);
    if cfg.active() == "local" {
        let mut conn = cfg
            .connection
            .unwrap_or_else(|| target::ConnectionConfig::from(&conn_target));
        conn.remote_bin = bin.clone();
        cfg.connection = Some(conn);
    } else {
        let mut channels = cfg.extra_channels();
        if let Some(c) = channels.iter_mut().find(|c| c.id == cfg.active()) {
            c.config.remote_bin = bin.clone();
        }
        cfg.channels = Some(channels);
    }
    config::save(&app, &cfg)?;
    cli::set_remote_bin_override(bin);
    // 路径变化:丢弃探测缓存,restart 时按新路径/重新探测
    target::invalidate_remote_caches();

    restart_backend(&app, &state).await?;
    Ok(get_cli_bin().await)
}

/// 指定/清除自定义 CLI 二进制(npm 全局安装选 D:\...\nodejs\kimi.cmd 这类 shim 亦可,
/// .cmd/.bat 自动经 cmd.exe 包装)。path 为 None 时恢复自动解析。
#[tauri::command]
async fn set_cli_bin(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
) -> Result<Value, String> {
    let bin = match path {
        Some(p) => {
            let p = p.trim().to_string();
            if p.is_empty() {
                return Err("路径不能为空".to_string());
            }
            if !PathBuf::from(&p).is_file() {
                return Err(format!("文件不存在: {p}"));
            }
            Some(p)
        }
        None => None,
    };

    let mut cfg = config::load(&app);
    cfg.cli_bin = bin.clone();
    config::save(&app, &cfg)?;
    cli::set_cli_bin_override(bin);

    restart_backend(&app, &state).await?;
    Ok(get_cli_bin().await)
}

// ---------- rest ----------

#[tauri::command]
async fn rest_request(
    state: State<'_, Arc<AppState>>,
    method: Option<String>,
    path: String,
    body: Option<Value>,
    query: Option<HashMap<String, String>>,
    channel: Option<String>,
) -> Result<Value, String> {
    let channel = channel.unwrap_or_else(cli::active_channel);
    // 锁内 clone 出 RestClient 后即释放 guard,HTTP await 不再持有全局锁(避免所有 REST 调用串行化)
    let rest = {
        let map = state.backends.lock().await;
        match map.get(&channel) {
            Some(bs) => bs.rest.lock().await.clone(),
            None => None,
        }
    }
    .ok_or("server not ready")?;
    rest.request(method.as_deref(), &path, body, query)
        .await
        .map_err(|e| e.to_string())
}

// ---------- local ----------

/// local_* 系列:按通道解析出对应 ConnectionConfig 再路由(缺省=激活通道);
/// local_drives 只对本机有意义,忽略 channel 参数

#[tauri::command]
async fn local_skills(channel: Option<String>) -> Vec<local_store::SkillEntry> {
    local_store::list_skills(&channel.unwrap_or_else(cli::active_channel)).await
}

#[tauri::command]
async fn local_agents(channel: Option<String>) -> Vec<local_store::AgentProfile> {
    local_store::list_agent_profiles(&channel.unwrap_or_else(cli::active_channel)).await
}

#[tauri::command]
async fn local_usage_daily(
    days: Option<u32>,
    channel: Option<String>,
) -> local_store::UsageDailyResult {
    local_store::aggregate_usage_daily(
        &channel.unwrap_or_else(cli::active_channel),
        days.unwrap_or(30),
    )
    .await
}

/// 今日逐小时用量(实时曲线,Tauri 专属)
#[tauri::command]
async fn local_usage_today(channel: Option<String>) -> local_store::UsageTodayResult {
    local_store::aggregate_usage_today(&channel.unwrap_or_else(cli::active_channel)).await
}

/// API 调用明细分页(step.end 口径,含 TTFT/TPS,API 调用统计页用)
#[tauri::command]
async fn local_api_calls(
    page: Option<u32>,
    page_size: Option<u32>,
    channel: Option<String>,
) -> local_store::ApiCallsResult {
    local_store::aggregate_api_calls(
        &channel.unwrap_or_else(cli::active_channel),
        page.unwrap_or(1),
        page_size.unwrap_or(20),
    )
    .await
}

#[tauri::command]
async fn local_mcp_read(channel: Option<String>) -> Value {
    local_store::read_mcp_config(&channel.unwrap_or_else(cli::active_channel)).await
}

#[tauri::command]
async fn local_mcp_write(
    data: Value,
    channel: Option<String>,
) -> Result<String, String> {
    local_store::write_mcp_config(&channel.unwrap_or_else(cli::active_channel), data).await
}

#[tauri::command]
async fn local_cli_config_read(channel: Option<String>) -> Option<String> {
    local_store::read_config_toml(&channel.unwrap_or_else(cli::active_channel)).await
}

#[tauri::command]
async fn local_cli_config_write(
    content: String,
    channel: Option<String>,
) -> Result<String, String> {
    local_store::write_config_toml(&channel.unwrap_or_else(cli::active_channel), content).await
}

#[tauri::command]
async fn local_cli_config_merge(patch: Value, channel: Option<String>) -> Result<String, String> {
    local_store::merge_config_toml(&channel.unwrap_or_else(cli::active_channel), patch).await
}

#[tauri::command]
async fn local_cli_config_parsed(channel: Option<String>) -> Result<Option<Value>, String> {
    local_store::read_config_toml_parsed(&channel.unwrap_or_else(cli::active_channel)).await
}

/// Remote Control 访问链接(实验性):读 kimi web --remote-control 写的 rc.json;未运行返回 null
#[tauri::command]
async fn remote_control_status(channel: Option<String>) -> Result<Value, String> {
    Ok(local_store::read_remote_control_status(&channel.unwrap_or_else(cli::active_channel)).await)
}

#[tauri::command]
fn local_drives() -> Vec<String> {
    local_store::list_drives()
}

// ---------- 托盘 ----------

/// 托盘图标:编译期内嵌 build/tray.png,不依赖 resource_dir/工作目录,dev 与打包均可用
fn tray_icon(app: &AppHandle) -> Option<tauri::image::Image<'static>> {
    let _ = app;
    tauri::image::Image::from_bytes(include_bytes!("../../build/tray.png")).ok()
}

/// 从托盘恢复主窗口:先 unminimize 再 show,兼容"任务栏最小化"与"hide 到托盘"两种隐藏态
fn restore_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let Some(icon) = tray_icon(app) else {
        eprintln!("tray: 图标解码失败,跳过托盘创建(最小化到托盘将无法唤回窗口)");
        return Ok(());
    };
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &sep, &quit]).build()?;
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip(APP_DISPLAY_NAME)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                // 可见则聚焦,不可见(最小化到托盘)则恢复显示
                restore_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

// ---------- bootstrap ----------

/// 启动流程:CLI 自检测(缺则自动装)→ 查更新(不阻塞)→ 启动 kimi web。
/// 由 start_backend 命令触发(对话页占位图"启动服务"、错误页"重试"等入口)。
/// channel 为该流程所属通道;启动/停止/事件均按通道隔离
async fn run_bootstrap(app: AppHandle, state: Arc<AppState>, channel: String) {
    let run = async {
        let target = cli::connection_target_for(&channel);
        state
            .with_backend(&channel, |bs| bs.manual_stop.store(false, Ordering::SeqCst))
            .await;
        // 1. 检测安装(仅本机通道支持自动安装;WSL/SSH 需用户自行在对应环境安装)
        // 非本机目标直接透传探测错误:detect_installed 的 Option 语义会把 SSH 认证
        // 失败等真实错误吞成 None,误报为"未安装 CLI"引导用户重装
        let mut version = if target.is_local() {
            cli::detect_installed().await
        } else {
            Some(target.detect_cli().await?)
        };
        if version.is_none() && target.is_local() {
            let _ = app.emit("cli:installing", ());
            cli::install_cli().await?;
            version = cli::detect_installed().await;
            if version.is_none() {
                return Err("CLI 安装后仍不可用,请手动执行: irm https://code.kimi.com/kimi-code/install.ps1 | iex".to_string());
            }
        }
        let Some(version) = version else {
            return Err(format!(
                "未能在 {} 检测到 kimi CLI,请先在该环境安装后重试",
                target.describe()
            ));
        };
        // 2. 查更新(不阻塞启动;仅本机通道,npm 查询对远端环境无意义)
        if target.is_local() {
            let app2 = app.clone();
            let http = state.http.clone();
            let current = version.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(latest) = cli::fetch_latest_version(&http).await {
                    // 用户在弹窗点过"跳过此版本":该版本不再提示(有更新的版本仍会提示)
                    let skipped = config::load(&app2).cli_update_skip;
                    if skipped.as_deref() == Some(latest.as_str()) {
                        return;
                    }
                    if cli::is_newer(&latest, &current) {
                        // source 供前端区分升级通道:home=kimi upgrade,其余=npm update -g;
                        // bin 为当前生效的二进制路径(弹窗透明化展示更新对象)
                        let _ = app2.emit(
                            "cli:update-available",
                            json!({ "current": current, "latest": latest, "source": cli::kimi_bin_source(), "bin": cli::kimi_bin() }),
                        );
                    }
                }
            });
        }
        // 3. 启动该通道的 kimi web
        let server = state.channel_server(&channel).await;
        let info = ServerManager::start(&server, &state.http, &app, &channel, &target).await?;
        // bootstrap 途中用户点了停止(stop_backend 对空 proc 空转):停掉刚拉起的服务,
        // 尊重停止意图,而不是静默完成启动
        let manual_stopped = state
            .with_backend(&channel, |bs| bs.manual_stop.swap(false, Ordering::SeqCst))
            .await;
        if manual_stopped {
            ServerManager::stop(&server, &state.http).await;
            return Ok::<(), String>(());
        }
        init_backend(&app, &state, &channel, &info).await;
        let _ = app.emit(
            "server:ready",
            json!({
                "channel": channel,
                "cliVersion": info.cli_version,
                "port": info.port,
                "token": info.token,
                "meta": info.meta,
                "frameBlocked": info.frame_blocked,
            }),
        );
        Ok::<(), String>(())
    };
    if let Err(e) = run.await {
        eprintln!("bootstrap failed ({channel}): {e}");
        let _ = app.emit("server:error", json!({ "channel": channel, "error": e }));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(AppState::new());

    let app = tauri::Builder::default()
        // 单实例:第二实例 show + focus 主窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                if w.is_minimized().unwrap_or(false) {
                    let _ = w.unminimize();
                }
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 外部宠物精灵图协议(M3):前端 URL 形态 http://pet.localhost/<slug>
        // (Tauri v2 在 Windows 上自定义 scheme 的访问形态)。按 slug 定位宠物目录下的
        // 精灵图(优先 webp 其次 png)返回字节;slug 白名单校验防路径穿越;找不到 404
        .register_uri_scheme_protocol("pet", |_ctx, request| {
            let slug = request.uri().path().trim_start_matches('/');
            let err = |status: u16| {
                tauri::http::Response::builder()
                    .status(status)
                    .body(Vec::new())
                    .expect("pet 协议错误响应构建失败")
            };
            if !pet::valid_slug(slug) {
                return err(400);
            }
            match pet::load_spritesheet(slug) {
                // ACAO:* 放行跨源读像素:PetWindow 的帧探测要对这张图 getImageData,
                // 窗口源(dev: localhost:5188 / 打包: tauri.localhost)与 pet.localhost 不同源,
                // 没有此头 canvas 会被污染、getImageData 抛 SecurityError
                Some((bytes, mime)) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .expect("pet 协议响应构建失败"),
                None => err(404),
            }
        })
        // 用户自选皮肤协议:前端 URL 形态 http://skin.localhost/<slug>(同 pet 协议)。
        // 按 slug 读 <config_dir>/skins/<slug>.<ext>;slug 白名单校验防路径穿越;找不到 404
        .register_uri_scheme_protocol("skin", |_ctx, request| {
            let slug = request.uri().path().trim_start_matches('/');
            let err = |status: u16| {
                tauri::http::Response::builder()
                    .status(status)
                    .body(Vec::new())
                    .expect("skin 协议错误响应构建失败")
            };
            if !pet::valid_slug(slug) {
                return err(400);
            }
            match skin::load_custom_skin(slug) {
                Some((bytes, mime)) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    // 壳侧 fetch(skin.url) 转 dataURL 属跨源请求,需 ACAO(同 pet 协议);
                    // <img> 直引不受 CORS 限制,故主页/设置页立绘不受影响
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .expect("skin 协议响应构建失败"),
                None => err(404),
            }
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            app_info,
            app_update_check,
            app_update_install,
            web_ui_url,
            app_open_logs,
            open_external,
            confirm_close,
            hide_main_to_tray,
            cli_upgrade,
            cli_update_skip,
            cli_check_update,
            start_backend,
            stop_backend,
            get_channels,
            set_active_channel,
            add_channel,
            remove_channel,
            get_kimi_home,
            set_kimi_home,
            get_setup_state,
            reset_setup,
            test_connection_target,
            get_connection_target,
            set_connection_target,
            get_cli_bin,
            set_cli_bin,
            set_remote_bin,
            rest_request,
            local_skills,
            local_agents,
            local_usage_daily,
            local_usage_today,
            local_api_calls,
            experimental_get,
            experimental_set,
            web_server_get,
            web_server_set,
            pet_config_get,
            pet_set_enabled,
            pet_set_click_through,
            pet_set_wander,
            pet_nudge,
            pet_list,
            pet_import_zip,
            pet_active_get,
            pet_set_active,
            pet_restore_main,
            pet_menu_toggle,
            pet_menu_hide,
            pet_menu_navigate,
            pet_menu_pin_toggle,
            pet_menu_pins_get,
            skin_config_get,
            skin_set_enabled,
            skin_set_active,
            skin_custom_list,
            skin_dir_open,
            skin_set_opacity,
            skin_set_in_chat,
            local_mcp_read,
            local_mcp_write,
            local_cli_config_read,
            local_cli_config_write,
            local_cli_config_merge,
            local_cli_config_parsed,
            remote_control_status,
            local_drives,
        ])
        .setup(move |app| {
            // 旧版单目标配置 → 通道模型迁移(channels 为空且 connection 非本机时转成通道并设为 active)
            let cfg = config::migrate(app.handle());
            // 加载用户自定义配置(数据目录/CLI 二进制,必须先于 bootstrap 启动服务)
            if let Some(home) = cfg.kimi_home.as_deref() {
                if !home.trim().is_empty() {
                    cli::set_kimi_home_override(Some(PathBuf::from(home)));
                }
            }
            if let Some(bin) = cfg.cli_bin.as_deref() {
                if !bin.trim().is_empty() {
                    cli::set_cli_bin_override(Some(bin.to_string()));
                }
            }
            // 通道映射(含本机):active 决定连接目标路由;远端 CLI 覆盖随激活通道走
            cli::refresh_channels(&cfg.extra_channels(), cfg.active());
            apply_active_remote_bin(&cfg);
            // 实验性功能开关加载(启动 kimi web 时经 experimental_envs 注入为环境变量)
            cli::set_experimental_flags(cfg.experimental.clone().unwrap_or_default());
            // kimi web 启动参数(端口/--host/--allowed-host)加载
            server::set_web_options(cfg.web_options());
            // 用量缓存后台预热:统计页首开直接命中缓存,避免冷扫描卡顿
            warm_usage_cache();
            // 程序化建窗(参数与原 config app.windows 一致):config 声明的窗口挂不上
            // on_new_window(builder 级钩子),iframe 内 window.open/target=_blank 必须接管
            // 转系统浏览器,否则官方 UI 外链会被 WebView2 静默吞掉
            tauri::WebviewWindowBuilder::new(app.handle(), "main", tauri::WebviewUrl::default())
                .title(APP_DISPLAY_NAME)
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                .decorations(false)
                // config 的 dragDropEnabled:false 对应此方法(默认开启拖拽处理)
                .disable_drag_drop_handler()
                .background_color(tauri::window::Color(255, 255, 255, 255))
                .on_new_window(|url, _| {
                    // 拦截 iframe 内的 window.open / target=_blank:
                    // http/https 一律转系统浏览器打开,并拒绝新窗口(官方 UI 外链全走这)
                    let lower = url.as_str().to_lowercase();
                    if lower.starts_with("http://") || lower.starts_with("https://") {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                // 对话页内皮肤立绘(实验性):注入脚本在官方 web UI iframe(回环源子框架)内
                // 挂载立绘容器,与壳侧 chatSkinBridge.ts 经 postMessage 收发配置;
                // 脚本自带子框架/回环 origin 守卫,主框架与其他页面不受影响
                .initialization_script_for_all_frames(include_str!("../assets/chat_skin_inject.js"))
                .build()?;
            create_tray(app.handle())?;
            // 桌宠状态机巡检(一次性动作到期回基底 / 事件流断裂复位)
            pet::init(app.handle());
            // 桌宠(实验性):配置开启时启动即显示悬浮窗
            if cfg.pet_enabled.unwrap_or(false) {
                let _ = pet::show(app.handle());
            }
            // 关闭拦截:点 X 一律不直接关窗,通知前端弹确认框(是否关闭进程):
            // "退出程序"走 confirm_close(app.exit),"进入托盘"走 hide_main_to_tray;
            // 覆盖标题栏关闭按钮、Alt+F4、任务栏关闭等所有关窗路径
            if let Some(win) = app.get_webview_window("main") {
                let st = app.state::<Arc<AppState>>().inner().clone();
                let win2 = win.clone();
                win.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        // payload: 是否有后端在跑(前端据此决定确认框的警告文案)
                        let _ = win2.emit("app:close-requested", st.any_backend_running());
                    }
                });
            }
            // 启动即进主页面,但不自动拉起 kimi web:由对话页占位图上的"启动服务"触发
            // 应用自动更新:延迟静默自检,发现新版发系统通知 + emit app:update-available
            updater::spawn_startup_check(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 退出前优雅关停所有通道的 kimi web(对应 Electron 的 before-quit)
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let state = handle.state::<Arc<AppState>>();
            if !state.exit_cleaned.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    stop_all_backends(&h).await;
                    h.exit(0);
                });
            }
        }
    });
}
