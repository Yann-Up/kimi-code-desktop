//! 用户自选皮肤(实验性):扫描 <config_dir>/skins/ 下的图片(png/webp/jpg/jpeg),
//! 经 skin:// 自定义协议(lib.rs 注册)按 slug 供图;slug = 文件名(去扩展名),
//! 白名单校验复用 pet::valid_slug 防路径穿越。
//! 内置皮肤不进本模块:它们打包在前端资产里(见 src/components/skins.ts)。

use std::path::PathBuf;

/// 卡片不透明度默认值与可调范围(百分比;皮肤开启时皮肤卡片背景的不透明度)
pub const DEFAULT_OPACITY: u8 = 82;
pub const MIN_OPACITY: u8 = 30;

/// 支持的图片扩展名(mime 推断也按此表)
const EXTS: [&str; 4] = ["png", "webp", "jpg", "jpeg"];

/// 用户皮肤目录(<config_dir>/skins;config 目录未初始化返回 None)
pub fn skins_dir() -> Option<PathBuf> {
    crate::config::config_dir().map(|d| d.join("skins"))
}

/// 扫描用户皮肤目录,返回 slug 列表(排序去重;同 stem 多格式按 EXTS 顺序取第一个)。
/// 目录不存在/读失败均返回空列表
pub fn scan_custom_skins() -> Vec<String> {
    let Some(dir) = skins_dir() else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut slugs: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let (stem, ext) = name.rsplit_once('.')?;
            let ext = ext.to_lowercase();
            if !EXTS.contains(&ext.as_str()) || !crate::pet::valid_slug(stem) {
                return None;
            }
            Some(stem.to_string())
        })
        .collect();
    slugs.sort();
    slugs.dedup();
    slugs
}

/// 按 slug 读取用户皮肤图片字节与 mime(按 EXTS 顺序探测文件);找不到返回 None
pub fn load_custom_skin(slug: &str) -> Option<(Vec<u8>, &'static str)> {
    if !crate::pet::valid_slug(slug) {
        return None;
    }
    let dir = skins_dir()?;
    for ext in EXTS {
        let path = dir.join(format!("{slug}.{ext}"));
        if let Ok(bytes) = std::fs::read(&path) {
            let mime = match ext {
                "png" => "image/png",
                "webp" => "image/webp",
                _ => "image/jpeg",
            };
            return Some((bytes, mime));
        }
    }
    None
}
