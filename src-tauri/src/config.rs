//! desktop-config: 桌面端自身配置的持久化(<app_data_dir>/desktop-config.json)。
//! 含 kimi_home / cli_bin / connection / setup_done(SSH 密码不落此文件,只存 keyring)。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::target::ConnectionConfig;

#[derive(Default, Serialize, Deserialize)]
pub struct DesktopConfig {
    pub kimi_home: Option<String>,
    pub cli_bin: Option<String>,
    /// 连接目标(本机 / WSL / SSH),None = 本机
    pub connection: Option<ConnectionConfig>,
    /// 首次启动向导是否已完成(默认 false:进入向导)
    pub setup_done: Option<bool>,
}

/// 本地配置目录(desktop-config.json 所在目录)缓存:
/// 首次 load/save 后可用,ssh.rs 的 known_hosts 落盘用(那里没有 AppHandle)
static CONFIG_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("desktop-config.json"));
    if let Some(dir) = path.as_ref().and_then(|p| p.parent()) {
        let _ = CONFIG_DIR.set(dir.to_path_buf());
    }
    path
}

/// 配置目录(desktop-config.json 同目录);首次 load/save 前为 None
pub fn config_dir() -> Option<PathBuf> {
    CONFIG_DIR.get().cloned()
}

/// 原子写文件:先写同目录 .tmp 再 rename 覆盖(崩溃最多留下 .tmp,不会截断原文件)
pub(crate) fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    // Windows 下 rename 不允许覆盖已存在的目标,先删再换(旧文件保留到最后一刻)
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 启动时读取配置(文件不存在/解析失败均按默认处理)
pub fn load(app: &AppHandle) -> DesktopConfig {
    let Some(path) = config_path(app) else {
        return DesktopConfig::default();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return DesktopConfig::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// 写盘(父目录先建好;原子写,崩溃不留截断文件)
pub fn save(app: &AppHandle, cfg: &DesktopConfig) -> Result<(), String> {
    let path = config_path(app).ok_or("无法确定配置目录")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    write_atomic(&path, &(raw + "\n"))
}
