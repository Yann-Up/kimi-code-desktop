//! desktop-config: 桌面端自身配置的持久化(<app_data_dir>/desktop-config.json)。
//! 含 kimi_home / cli_bin / channels / active_channel / setup_done(SSH 密码不落此文件,只存 keyring)。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::target::{ConnectionConfig, ConnectionTarget};

/// 一条连接通道:除本机("local")外的每条 WSL/SSH 连接各占一条。
/// id 生成规则见 ConnectionTarget::channel_id;label 为展示名(本机 / WSL (Ubuntu) / user@host)。
#[derive(Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub label: String,
    pub config: ConnectionConfig,
}

#[derive(Default, Serialize, Deserialize)]
pub struct DesktopConfig {
    pub kimi_home: Option<String>,
    pub cli_bin: Option<String>,
    /// 旧版单目标字段:仅用于迁移(见 migrate)。迁移后恒为 None/本机
    pub connection: Option<ConnectionConfig>,
    /// 额外通道(不含本机);空 = 单本机模式
    pub channels: Option<Vec<Channel>>,
    /// 当前激活通道 id(None = "local")
    pub active_channel: Option<String>,
    /// 首次启动向导是否已完成(默认 false:进入向导)
    pub setup_done: Option<bool>,
    /// 实验性功能开关:env 名 → 是否开启(启动 kimi web 时注入为环境变量;
    /// 缺 key 按各项默认 —— KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL 默认开,其余默认关)
    pub experimental: Option<std::collections::HashMap<String, bool>>,
    /// kimi web 首选端口(None = 默认 58666;被占时仍 +1 顺延)
    pub web_port: Option<u16>,
    /// 桌宠悬浮窗开关(实验性,缺省关;见 pet.rs)
    pub pet_enabled: Option<bool>,
    /// 当前激活宠物 slug(缺省 "kimi" 即内置;外部宠物为目录名,见 pet.rs 扫描逻辑)
    pub pet_slug: Option<String>,
    /// 界面皮肤开关(实验性,缺省关):主页/统计/设置页右侧显示内置立绘
    pub skin_enabled: Option<bool>,
    /// 当前皮肤 slug(None = 注册表第一个;内置皮肤注册表在前端,见 src/components/skins.ts)
    pub skin_slug: Option<String>,
    /// 卡片不透明度百分比(None = 默认 82;取值 30-100,越低立绘透出越明显)
    pub skin_opacity: Option<u8>,
    /// 对话页内透出立绘(实验性,缺省关):经注入脚本显示在官方 web UI iframe 内右下
    /// (注入见 assets/chat_skin_inject.js,桥接见 src/components/chatSkinBridge.ts)
    pub skin_in_chat: Option<bool>,
    /// 用户在更新弹窗点"跳过此版本"的 CLI 版本号;启动查更新时该版本不再提示
    /// (有新于它的版本仍会提示;升级成功后自然失效——比较用 is_newer)
    pub cli_update_skip: Option<String>,
}

impl DesktopConfig {
    /// 额外通道列表(不含本机)
    pub fn extra_channels(&self) -> Vec<Channel> {
        self.channels.clone().unwrap_or_default()
    }

    /// 当前激活通道 id("local" 为本机)
    pub fn active(&self) -> String {
        self.active_channel
            .clone()
            .unwrap_or_else(|| "local".to_string())
    }

    /// kimi web 启动参数(未配置时取默认:端口 58666)
    pub fn web_options(&self) -> crate::server::WebOptions {
        crate::server::WebOptions {
            port: self.web_port.unwrap_or(crate::server::START_PORT),
        }
    }
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

/// 旧版单目标配置 → 通道模型迁移(应用启动时调用):
/// channels 为空且 connection 存在且 target != local → 迁移成一条额外 channel 并设为 active,
/// 然后把 connection 置 None 保存。本机目标无需迁移(与"local 通道"语义一致)。
/// 返回迁移后的配置(未迁移时与原配置一致)。
pub fn migrate(app: &AppHandle) -> DesktopConfig {
    let mut cfg = load(app);
    let changed = migrate_in_place(&mut cfg);
    if changed {
        let _ = save(app, &cfg);
    }
    cfg
}

fn migrate_in_place(cfg: &mut DesktopConfig) -> bool {
    let channels_empty = cfg.channels.as_ref().map_or(true, |c| c.is_empty());
    if !channels_empty {
        return false;
    }
    let Some(conn) = &cfg.connection else {
        return false;
    };
    if conn.target == "local" {
        return false;
    }
    let target = ConnectionTarget::from(conn.clone());
    let id = target.channel_id();
    cfg.channels = Some(vec![Channel {
        id: id.clone(),
        label: target.describe(),
        config: conn.clone(),
    }]);
    cfg.active_channel = Some(id);
    cfg.connection = None;
    true
}
