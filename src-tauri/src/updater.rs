//! 应用自动更新:tauri-plugin-updater + GitHub Releases(latest.json + minisign 签名校验)。
//! 检查/下载/安装全部在 Rust 侧完成,渲染层经 kimiApi 契约调用(不直接 invoke 插件 JS API);
//! 启动时延迟静默自检,发现新版本发系统通知并 emit `app:update-available` 供前端角标提示。

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

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

async fn fetch_update(app: &AppHandle) -> Result<Option<Update>, String> {
    app.updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
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
    let Some(update) = fetch_update(&app).await? else {
        return Ok(());
    };
    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    update
        .download_and_install(
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
        .map_err(|e| format!("下载/安装更新失败: {e}"))?;
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
                    .body(format!("发现新版本 v{},可前往 设置 → 常规 更新", info.version))
                    .show();
            }
            Ok(None) => {}
            Err(e) => eprintln!("[updater] 启动自检失败: {e}"),
        }
    });
}
