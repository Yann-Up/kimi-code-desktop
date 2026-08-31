//! cli-manager: Kimi Code CLI 的自检测、自动安装与升级。
//! - 未安装:首次启动时执行官方安装脚本自动下载
//! - 已安装:对比 npm registry 最新版,有新版本时交给 UI 询问用户;
//!   确认后按来源升级(home=`kimi upgrade`,path/custom/env=`npm update -g`)
//! - 本机双候选:数据目录/bin 与 PATH 同时存在 kimi 时按 --version 选较新的生效

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Duration;
use tokio::process::Command;

use crate::config::Channel;
use crate::target::{ConnectionConfig, ConnectionTarget};

const NPM_REGISTRY: &str = "https://registry.npmjs.org/@moonshot-ai/kimi-code/latest";
const NPM_REGISTRY_MIRROR: &str = "https://registry.npmmirror.com/@moonshot-ai/kimi-code/latest";

/// 用户在设置里自定义的 kimi 数据目录(持久化在 desktop-config.json,启动时加载)
static KIMI_HOME_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

/// 用户在设置里指定的 CLI 二进制路径(优先级最高,持久化在 desktop-config.json)
static CLI_BIN_OVERRIDE: RwLock<Option<String>> = RwLock::new(None);

/// 用户指定的远端 CLI 二进制路径(仅 WSL/SSH 目标生效);
/// 多通道下表示"当前激活通道"的远端覆盖,随激活通道切换刷新
static REMOTE_BIN_OVERRIDE: RwLock<Option<String>> = RwLock::new(None);

/// 本机 CLI 双候选(home/bin 与 PATH)比较结果:
/// Some(true)=PATH 候选较新,优先生效;Some(false)=维持 home 优先;None=未比较/无需比较。
/// 每次运行最多比较一次(首个 detect_installed 触发),设置变更时失效重估
static LOCAL_BIN_PICK: RwLock<Option<bool>> = RwLock::new(None);

/// 通道 id → 连接目标(含 "local"),启动加载与配置变更后刷新
static CHANNEL_TARGETS: std::sync::LazyLock<RwLock<HashMap<String, ConnectionTarget>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));

/// 当前激活通道 id(None = "local")
static ACTIVE_CHANNEL: std::sync::LazyLock<RwLock<Option<String>>> =
    std::sync::LazyLock::new(|| RwLock::new(None));

/// 刷新通道映射与激活通道(Rust 侧配置变更后调用;远端 CLI 覆盖由调用方另行设置)
pub fn refresh_channels(channels: &[Channel], active: String) {
    let mut map = HashMap::new();
    map.insert("local".to_string(), ConnectionTarget::Local);
    for c in channels {
        map.insert(c.id.clone(), ConnectionTarget::from(c.config.clone()));
    }
    *CHANNEL_TARGETS.write().unwrap() = map;
    *ACTIVE_CHANNEL.write().unwrap() = if active == "local" {
        None
    } else {
        Some(active)
    };
}

/// 当前激活通道 id
pub fn active_channel() -> String {
    ACTIVE_CHANNEL
        .read()
        .unwrap()
        .clone()
        .unwrap_or_else(|| "local".to_string())
}

/// 当前激活通道的连接目标(默认本机)
pub fn connection_target() -> ConnectionTarget {
    connection_target_for(&active_channel())
}

/// 指定通道的连接目标(未登记通道按本机)
pub fn connection_target_for(channel: &str) -> ConnectionTarget {
    CHANNEL_TARGETS
        .read()
        .unwrap()
        .get(channel)
        .cloned()
        .unwrap_or(ConnectionTarget::Local)
}

/// 立即替换某通道的连接目标(旧 set_connection_target 语义:本机通道切换目标,不落 channels)
pub fn set_channel_target(id: &str, target: ConnectionTarget) {
    CHANNEL_TARGETS
        .write()
        .unwrap()
        .insert(id.to_string(), target);
}

/// 由 ConnectionConfig 生成通道 id(与 ConnectionTarget::channel_id 一致)
pub fn channel_id_for(conn: &ConnectionConfig) -> String {
    ConnectionTarget::from(conn.clone()).channel_id()
}

/// 设置/读取自定义目录覆盖(设置页 set_kimi_home 用)
pub fn set_kimi_home_override(path: Option<PathBuf>) {
    *KIMI_HOME_OVERRIDE.write().unwrap() = path;
    invalidate_local_bin_pick();
}

pub fn kimi_home_override() -> Option<PathBuf> {
    KIMI_HOME_OVERRIDE.read().unwrap().clone()
}

pub fn set_cli_bin_override(bin: Option<String>) {
    *CLI_BIN_OVERRIDE.write().unwrap() = bin;
    invalidate_local_bin_pick();
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

/// 实验性功能开关(desktop-config.json 的 experimental 字段;启动 kimi web 时注入为环境变量)
static EXPERIMENTAL_FLAGS: std::sync::LazyLock<RwLock<HashMap<String, bool>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));

/// 设置实验性开关(启动加载与设置页 experimental_set 用)
pub fn set_experimental_flags(flags: HashMap<String, bool>) {
    *EXPERIMENTAL_FLAGS.write().unwrap() = flags;
}

pub fn experimental_flags() -> HashMap<String, bool> {
    EXPERIMENTAL_FLAGS.read().unwrap().clone()
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

/// home 候选:数据目录/bin 或默认目录/bin 下的 kimi(现行 home 段优先级)
fn home_bin_candidate() -> Option<String> {
    for home in [kimi_home(), default_kimi_home()] {
        for name in ["kimi.exe", "kimi"] {
            let p = home.join("bin").join(name);
            if p.exists() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// 解析 kimi 可执行文件:用户自定义 > KIMI_CODE_BIN 环境变量 > 双候选比较结果
/// (PATH 较新时 PATH 优先,否则数据目录/bin > 默认目录/bin)> PATH
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
    // 双候选比较选定 PATH 时优先之(PATH 上的候选消失则自然回退 home)
    if *LOCAL_BIN_PICK.read().unwrap() == Some(true) {
        if let Some(p) = resolve_on_path("kimi") {
            return p;
        }
    }
    if let Some(p) = home_bin_candidate() {
        return p;
    }
    // PATH 兜底:Windows 上 CreateProcess 只自动补 .exe,裸 "kimi" 永远找不到 npm 全局
    // 安装的 kimi.cmd shim,先用 where.exe 解析出实际路径(.cmd 由 hidden_command 走
    // cmd /c 包装);解析失败才回退裸名(Unix 的 execvp 自己会搜 PATH)
    resolve_on_path("kimi").unwrap_or_else(|| "kimi".to_string())
}

/// 在 PATH 上解析可执行文件的实际路径:Windows 用 where.exe(按 PATHEXT 命中多行,
/// 优先 .exe,其次 .cmd/.bat shim),Unix 用 which;找不到返回 None。
/// 同步短探测(毫秒级),用 std::process 以便 kimi_bin 保持同步签名
fn resolve_on_path(name: &str) -> Option<String> {
    let probe = if cfg!(windows) { "where.exe" } else { "which" };
    let mut cmd = std::process::Command::new(probe);
    cmd.arg(name);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = stdout.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let pick = |pred: fn(&str) -> bool| {
        lines.iter().find(|l| pred(l)).map(|s| (*s).to_string())
    };
    pick(|l| l.to_lowercase().ends_with(".exe"))
        .or_else(|| pick(|l| l.to_lowercase().ends_with(".cmd") || l.to_lowercase().ends_with(".bat")))
        .or_else(|| lines.first().map(|s| (*s).to_string()))
}

/// 当前 CLI 二进制来源(设置页展示/升级守卫用):
/// custom=设置指定,env=KIMI_CODE_BIN,home=数据目录或默认目录安装,path=PATH 上的(如 npm 全局);
/// 双候选比较选定 PATH 时(较新)返回 path,与 kimi_bin 的实际解析一致
pub fn kimi_bin_source() -> &'static str {
    if cli_bin_override().is_some() {
        return "custom";
    }
    if std::env::var("KIMI_CODE_BIN").map(|b| !b.is_empty()).unwrap_or(false) {
        return "env";
    }
    if *LOCAL_BIN_PICK.read().unwrap() == Some(true) && resolve_on_path("kimi").is_some() {
        return "path";
    }
    if home_bin_candidate().is_some() {
        return "home";
    }
    "path"
}

/// 路径等价判断:Windows 下大小写/分隔符不敏感
fn paths_equal(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.replace('/', "\\").eq_ignore_ascii_case(&b.replace('/', "\\"))
    } else {
        a == b
    }
}

/// 短探测指定二进制的版本(双候选比较用;超时/失败返回 None)
async fn probe_version(bin: &str) -> Option<String> {
    let out = tokio::time::timeout(
        Duration::from_secs(5),
        hidden_command(bin)
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

/// 本机双候选比较:home/bin 与 PATH 各有 kimi 且非同一文件时,选 --version 较新的生效
/// (避免数据目录残留旧版静默遮蔽 npm 全局新版);版本并列/任一侧探测失败维持 home 优先。
/// custom/env 覆盖优先于本比较;每次运行最多比较一次,结果缓存于 LOCAL_BIN_PICK
pub async fn ensure_local_bin_pick() {
    if cli_bin_override().is_some()
        || std::env::var("KIMI_CODE_BIN").map(|b| !b.is_empty()).unwrap_or(false)
    {
        return;
    }
    if LOCAL_BIN_PICK.read().unwrap().is_some() {
        return;
    }
    let pick = match (home_bin_candidate(), resolve_on_path("kimi")) {
        (Some(home), Some(path)) if !paths_equal(&home, &path) => {
            let (hv, pv) = tokio::join!(probe_version(&home), probe_version(&path));
            match (hv, pv) {
                (Some(hv), Some(pv)) => is_newer(&pv, &hv),
                _ => false,
            }
        }
        // 单一候选或同一文件:无需比较,维持现行 home 优先
        _ => false,
    };
    *LOCAL_BIN_PICK.write().unwrap() = Some(pick);
}

/// 使双候选比较结果失效(自定义 CLI/数据目录变更后重估)
pub fn invalidate_local_bin_pick() {
    *LOCAL_BIN_PICK.write().unwrap() = None;
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
    // mut 仅 Windows 需要(creation_flags);非 Windows 无后续可变调用,allow 掉 unused_mut
    #[allow(unused_mut)]
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
    // 本机:先完成 home/PATH 双候选比较(每次运行一次),再探测生效二进制的版本
    ensure_local_bin_pick().await;
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

/// 规范化版本串:去首尾空白、取最后一个空白分隔段(容忍 "kimi 0.37.2" 这类输出)、去 v/V 前缀
fn normalize_version(s: &str) -> &str {
    let s = s.trim();
    let s = s.split_whitespace().last().unwrap_or(s);
    s.strip_prefix(['v', 'V']).unwrap_or(s)
}

/// semver 比较:latest 是否新于 current。
/// latest 为预发布(含 "-" 后缀,如 0.38.0-beta.1)时不提示升级:
/// stable 渠道的升级命令拿不到它,提示了只会反复打扰
pub fn is_newer(latest: &str, current: &str) -> bool {
    let latest = normalize_version(latest);
    if latest.contains('-') {
        return false;
    }
    let parse = |s: &str| -> Vec<i64> {
        normalize_version(s)
            .split('.')
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

/// 官方安装脚本(Windows:irm install.ps1 | iex;macOS/Linux:curl install.sh | bash)
pub async fn install_cli() -> Result<(), String> {
    let mut cmd = if cfg!(windows) {
        let mut c = hidden_command("powershell");
        c.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
        ]);
        c
    } else {
        // bash -lc:mac GUI 应用默认 PATH 不含 /opt/homebrew/bin 等,登录 shell 兜底
        let mut c = hidden_command("bash");
        c.args([
            "-lc",
            "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
        ]);
        c
    };
    // kill_on_drop:超时(timeout 返回)后子进程随之被杀,不留后台残留
    cmd.kill_on_drop(true);
    let status = tokio::time::timeout(Duration::from_secs(600), cmd.status())
        .await
        .map_err(|_| "CLI 安装超时(600s)".to_string())?
        .map_err(|e| format!("启动安装脚本失败: {e}"))?;
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
/// (Windows 下 npm 是 npm.cmd,经 cmd.exe 执行;macOS/Linux 经 bash -lc 拿登录 PATH)
pub async fn npm_upgrade() -> Result<String, String> {
    let mut cmd = if cfg!(windows) {
        let mut c = hidden_command("cmd.exe");
        c.args(["/c", "npm", "update", "-g", "@moonshot-ai/kimi-code"]);
        c
    } else {
        let mut c = hidden_command("bash");
        c.args(["-lc", "npm update -g @moonshot-ai/kimi-code"]);
        c
    };
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
