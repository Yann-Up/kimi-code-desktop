//! cli-manager: Kimi Code CLI 的自检测、自动安装与升级。
//! - 未安装:首次启动时执行官方安装脚本自动下载
//! - 已安装:对比 npm registry 最新版,有新版本时交给 UI 询问用户,确认后 `kimi upgrade`

use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Duration;
use tokio::process::Command;

use crate::target::ConnectionTarget;

const NPM_REGISTRY: &str = "https://registry.npmjs.org/@moonshot-ai/kimi-code/latest";
const NPM_REGISTRY_MIRROR: &str = "https://registry.npmmirror.com/@moonshot-ai/kimi-code/latest";

/// 用户在设置里自定义的 kimi 数据目录(持久化在 desktop-config.json,启动时加载)
static KIMI_HOME_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

/// 用户在设置里指定的 CLI 二进制路径(优先级最高,持久化在 desktop-config.json)
static CLI_BIN_OVERRIDE: RwLock<Option<String>> = RwLock::new(None);

/// 用户在设置里指定的远端 CLI 二进制路径(仅 WSL/SSH 目标生效,持久化在 connection.remoteBin)
static REMOTE_BIN_OVERRIDE: RwLock<Option<String>> = RwLock::new(None);

/// 当前连接目标(本机 / WSL / SSH,持久化在 desktop-config.json,启动时加载)
static CONNECTION_TARGET: RwLock<ConnectionTarget> = RwLock::new(ConnectionTarget::Local);

/// 设置/读取自定义目录覆盖(设置页 set_kimi_home 用)
pub fn set_kimi_home_override(path: Option<PathBuf>) {
    *KIMI_HOME_OVERRIDE.write().unwrap() = path;
}

pub fn kimi_home_override() -> Option<PathBuf> {
    KIMI_HOME_OVERRIDE.read().unwrap().clone()
}

pub fn set_cli_bin_override(bin: Option<String>) {
    *CLI_BIN_OVERRIDE.write().unwrap() = bin;
}

pub fn cli_bin_override() -> Option<String> {
    CLI_BIN_OVERRIDE.read().unwrap().clone()
}

/// 设置/读取远端 CLI 二进制覆盖(设置页 set_remote_bin 与启动加载用)
pub fn set_remote_bin_override(bin: Option<String>) {
    *REMOTE_BIN_OVERRIDE.write().unwrap() = bin;
}

pub fn remote_bin_override() -> Option<String> {
    REMOTE_BIN_OVERRIDE.read().unwrap().clone()
}

/// 设置/读取连接目标(设置页 set_connection_target 与启动加载用)
pub fn set_connection_target(target: ConnectionTarget) {
    *CONNECTION_TARGET.write().unwrap() = target;
}

pub fn connection_target() -> ConnectionTarget {
    CONNECTION_TARGET.read().unwrap().clone()
}

/// 用户 home 目录(优先 USERPROFILE,避免引入 dirs 依赖)
pub fn home_dir() -> PathBuf {
    if let Ok(p) = std::env::var("USERPROFILE") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Ok(p) = std::env::var("HOME") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    PathBuf::from(".")
}

/// 默认 kimi 数据目录:~/.kimi-code(不考虑任何覆盖/环境变量)
pub fn default_kimi_home() -> PathBuf {
    home_dir().join(".kimi-code")
}

/// kimi 数据目录:用户自定义覆盖 > KIMI_CODE_HOME 环境变量 > ~/.kimi-code
pub fn kimi_home() -> PathBuf {
    if let Some(h) = kimi_home_override() {
        return h;
    }
    if let Ok(h) = std::env::var("KIMI_CODE_HOME") {
        if !h.is_empty() {
            return PathBuf::from(h);
        }
    }
    default_kimi_home()
}

/// 当前数据目录来源(设置页展示用)
pub fn kimi_home_source() -> &'static str {
    if kimi_home_override().is_some() {
        "custom"
    } else if std::env::var("KIMI_CODE_HOME").map(|h| !h.is_empty()).unwrap_or(false) {
        "env"
    } else {
        "default"
    }
}

/// 解析 kimi 可执行文件:用户自定义 > KIMI_CODE_BIN 环境变量 > 当前数据目录/bin > 默认目录/bin > PATH
/// (自定义数据目录通常不含二进制,回退到默认安装位置)
pub fn kimi_bin() -> String {
    if let Some(b) = cli_bin_override() {
        return b;
    }
    if let Ok(b) = std::env::var("KIMI_CODE_BIN") {
        if !b.is_empty() {
            return b;
        }
    }
    for home in [kimi_home(), default_kimi_home()] {
        for name in ["kimi.exe", "kimi"] {
            let p = home.join("bin").join(name);
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    "kimi".to_string()
}

/// 当前 CLI 二进制来源(设置页展示/升级守卫用):
/// custom=设置指定,env=KIMI_CODE_BIN,home=数据目录或默认目录安装,path=PATH 上的(如 npm 全局)
pub fn kimi_bin_source() -> &'static str {
    if cli_bin_override().is_some() {
        return "custom";
    }
    if std::env::var("KIMI_CODE_BIN").map(|b| !b.is_empty()).unwrap_or(false) {
        return "env";
    }
    for home in [kimi_home(), default_kimi_home()] {
        for name in ["kimi.exe", "kimi"] {
            if home.join("bin").join(name).exists() {
                return "home";
            }
        }
    }
    "path"
}

/// 构造子进程命令;Windows 下 GUI 应用拉起控制台程序时隐藏黑窗(CREATE_NO_WINDOW)。
/// .cmd/.bat(npm 全局安装的 shim)无法直接 CreateProcess,经 cmd.exe /c 包装
pub fn hidden_command(program: &str) -> Command {
    let lower = program.to_lowercase();
    if lower.ends_with(".cmd") || lower.ends_with(".bat") {
        let mut cmd = Command::new("cmd.exe");
        cmd.arg("/c");
        // cmd 把 /c 之后的内容按原始命令行解析,不能走 Rust 的引号转义
        // (转义后的 \" 会成为字面反斜杠导致解析失败),必须用 raw_arg 原样追加
        #[cfg(windows)]
        {
            cmd.raw_arg(format!("\"\"{program}\"\""));
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        #[cfg(not(windows))]
        cmd.arg(program);
        return cmd;
    }
    let mut cmd = Command::new(program);
    // tokio::process::Command 自带 creation_flags(Windows)
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

/// 已安装则返回版本号,未安装返回 None
pub async fn detect_installed() -> Option<String> {
    // 非本机目标经各自通道检测(WSL/SSH 不支持自动安装与 npm 升级,由调用方跳过)
    let target = connection_target();
    if !target.is_local() {
        return target.detect_cli().await.ok().filter(|v| !v.is_empty());
    }
    // kill_on_drop:超时(timeout 返回)后子进程随之被杀,不留后台残留
    let out = tokio::time::timeout(
        Duration::from_secs(15),
        hidden_command(&kimi_bin())
            .arg("--version")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// 从 npm registry 取最新版本(主源失败回退 npmmirror)
pub async fn fetch_latest_version(client: &reqwest::Client) -> Option<String> {
    for url in [NPM_REGISTRY, NPM_REGISTRY_MIRROR] {
        let res = tokio::time::timeout(Duration::from_secs(8), client.get(url).send()).await;
        if let Ok(Ok(res)) = res {
            if !res.status().is_success() {
                continue;
            }
            if let Ok(j) = res.json::<serde_json::Value>().await {
                if let Some(v) = j.get("version").and_then(|v| v.as_str()) {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

/// semver 比较:latest 是否新于 current
pub fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |s: &str| -> Vec<i64> {
        s.split('.')
            .map(|x| {
                // 预发布/构建后缀(如 "2-beta.1"、"1+build")只取数字前缀再 parse
                x.split(['-', '+'])
                    .next()
                    .unwrap_or("")
                    .parse::<i64>()
                    .unwrap_or(0)
            })
            .collect()
    };
    let pa = parse(latest);
    let pb = parse(current);
    for i in 0..pa.len().max(pb.len()) {
        let a = pa.get(i).copied().unwrap_or(0);
        let b = pb.get(i).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

/// 官方安装脚本(Windows:irm install.ps1 | iex)
pub async fn install_cli() -> Result<(), String> {
    let mut cmd = hidden_command("powershell");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
    ]);
    // kill_on_drop:超时(timeout 返回)后子进程随之被杀,不留后台残留
    cmd.kill_on_drop(true);
    let status = tokio::time::timeout(Duration::from_secs(600), cmd.status())
        .await
        .map_err(|_| "CLI 安装超时(600s)".to_string())?
        .map_err(|e| format!("启动 powershell 失败: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("安装脚本退出码 {:?}", status.code()))
    }
}

/// kimi upgrade(升级后需要重启 kimi web 服务才生效)
pub async fn upgrade_cli() -> Result<String, String> {
    // kill_on_drop:超时(timeout 返回)后子进程随之被杀,不留后台残留
    let out = tokio::time::timeout(
        Duration::from_secs(600),
        hidden_command(&kimi_bin())
            .arg("upgrade")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "kimi upgrade 超时(600s)".to_string())?
    .map_err(|e| format!("kimi upgrade 执行失败: {e}"))?;
    if !out.status.success() {
        return Err(format!("kimi upgrade 退出码 {:?}", out.status.code()));
    }
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    // (stdout + stderr).slice(0, 500),注意按字符截断避免切断 UTF-8
    Ok(s.chars().take(500).collect())
}

/// npm 全局安装的快捷升级:npm update -g @moonshot-ai/kimi-code
/// (Windows 下 npm 是 npm.cmd,经 cmd.exe 执行)
pub async fn npm_upgrade() -> Result<String, String> {
    let mut cmd = hidden_command("cmd.exe");
    cmd.args(["/c", "npm", "update", "-g", "@moonshot-ai/kimi-code"]);
    // kill_on_drop:超时(timeout 返回)后子进程随之被杀,不留后台残留
    cmd.kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(600), cmd.output())
        .await
        .map_err(|_| "npm update 超时(600s)".to_string())?
        .map_err(|e| format!("npm update 执行失败: {e}"))?;
    if !out.status.success() {
        let stderr: String = String::from_utf8_lossy(&out.stderr).chars().take(300).collect();
        return Err(format!("npm update 退出码 {:?}: {stderr}", out.status.code()));
    }
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok(s.chars().take(500).collect())
}
