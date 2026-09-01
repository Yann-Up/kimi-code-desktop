//! 应用自动更新:tauri-plugin-updater + GitHub Releases(latest.json + minisign 签名校验)。
//! 检查/下载/安装全部在 Rust 侧完成,渲染层经 kimiApi 契约调用(不直接 invoke 插件 JS API);
//! 启动时延迟静默自检,发现新版本发系统通知并 emit `app:update-available` 供前端角标提示。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// 并发守卫:前端切页导致重复点击/重复调用时,拒绝并行的第二个下载安装任务
static INSTALLING: AtomicBool = AtomicBool::new(false);

/// 更新信息(serde camelCase,与前端 AppUpdateInfo 契约一致)
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

impl From<&Update> for AppUpdateInfo {
    fn from(u: &Update) -> Self {
        Self {
            version: u.version.clone(),
            notes: u.body.clone(),
        }
    }
}

/// 检查更新:endpoints 按序回退(CNB 优先,GitHub 兜底)。
/// 注意不能用 UpdaterBuilder::timeout——它同样作用于 download 阶段,会掐断大文件下载;
/// 改为只在 check 外层包 tokio 超时(latest.json 很小,15s 足够),兜住
/// "CNB 故障 + GitHub 挂起"时无代理连接的超长等待。
async fn fetch_update(app: &AppHandle) -> Result<Option<Update>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let check = updater.check();
    tokio::time::timeout(std::time::Duration::from_secs(15), check)
        .await
        .map_err(|_| "检查更新失败: 请求超时".to_string())?
        .map_err(|e| format!("检查更新失败: {e}"))
}

/// 手动检查更新(设置页「检查更新」按钮);无更新返回 None,错误抛给前端展示
#[tauri::command]
pub async fn app_update_check(app: AppHandle) -> Result<Option<AppUpdateInfo>, String> {
    Ok(fetch_update(&app).await?.map(|u| AppUpdateInfo::from(&u)))
}

/// 下载并安装更新:下载进度经 `app:update-progress` 事件推给前端;
/// 完成后重启应用(Windows 上 NSIS 安装器接管进程,restart 实际不会返回)。
/// 有意重新 check 而非复用设置页的结果:命令保持无状态,且可兜住
/// "检查发现新版后 Release 被撤回"的场景(此时静默返回 Ok,由前端提示重查)
#[tauri::command]
pub async fn app_update_install(app: AppHandle) -> Result<(), String> {
    // 已有下载/安装任务在进行:直接报错让前端提示,避免双下载写同一临时文件
    if INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("更新下载已在进行中,请稍候".to_string());
    }
    let result = download_and_install(app).await;
    // 成功路径进程会被安装器接管/重启,此复位实际只在出错或更新被撤回时生效
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

async fn download_and_install(app: AppHandle) -> Result<(), String> {
    let Some(update) = fetch_update(&app).await? else {
        return Ok(());
    };
    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let bytes = update
        .download(
            move |chunk_len, total| {
                downloaded += chunk_len as u64;
                let _ = progress_app.emit(
                    "app:update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载更新失败: {e}"))?;
    // 关键:install 在 Windows 上是 ShellExecute 拉起 NSIS 安装器后 std::process::exit(0)
    // 立即终止本进程——不会触发 ExitRequested,优雅关停完全不执行。
    // 不先停服务的话 kimi web 变孤儿继续占住首选端口,新版启动时端口被迫顺延。
    crate::stop_all_backends(&app).await;
    // 内嵌终端 PTY 会话同样要清:kimi TUI 是壳的子进程,install 直接 exit 不走 ExitRequested
    app.state::<std::sync::Arc<crate::AppState>>()
        .terminals
        .lock()
        .await
        .kill_all();
    update
        .install(bytes)
        .map_err(|e| format!("安装更新失败: {e}"))?;
    // 重启进新版本(Windows 上 NSIS 安装器已接管进程,此行实际不会执行到)
    tauri::process::restart(&app.env());
}

/// 启动静默自检:dev 环境跳过(无有效签名产物);延迟 15s 避开 bootstrap/服务启动抢占。
/// 检查失败(无网络/未发布 release)只记日志,不打扰用户。
pub fn spawn_startup_check(app: AppHandle) {
    if tauri::is_dev() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        match fetch_update(&app).await {
            Ok(Some(update)) => {
                let info = AppUpdateInfo::from(&update);
                let _ = app.emit("app:update-available", info.clone());
                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title("Kimi Code Desktop")
                    .body(format!("发现新版本 v{},可点击标题栏更新按钮下载安装", info.version))
                    .show();
            }
            Ok(None) => {}
            Err(e) => eprintln!("[updater] 启动自检失败: {e}"),
        }
    });
}
