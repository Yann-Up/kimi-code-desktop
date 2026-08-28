//! connection-target: kimi web 服务的连接目标抽象(本机 / WSL / SSH),兼作环境工厂。
//! 三种目标下桌面端永远连 127.0.0.1:<本地端口> —— WSL 靠 localhostForwarding,
//! SSH 靠进程内 direct-tcpip 转发(russh,见 ssh.rs)。
//! 除服务启停外,文件读写 / 目录列举 / shell 执行(git、用量扫描)也统一经此路由,
//! local_store.rs / git.rs 不再感知目标差异。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::cli::{hidden_command, kimi_bin, kimi_home, remote_bin_override};
use crate::ssh::{self, SshClient};

/// 连接目标(运行时按通道存放在 cli::CHANNEL_TARGETS,持久化经 ConnectionConfig)
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

/// 解析实例注册表内容(多个单行 JSON 首尾拼接)为 (port, pid, heartbeat_at) 列表;损坏条目跳过
fn parse_server_instances(text: &str) -> Vec<(u16, u32, u64)> {
    serde_json::Deserializer::from_str(text)
        .into_iter::<Value>()
        .filter_map(|item| {
            let v = item.ok()?;
            let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
            let pid = u32::try_from(v.get("pid")?.as_u64()?).ok()?;
            let heartbeat_at = v
                .get("heartbeat_at")
                .and_then(|h| h.as_u64())
                .unwrap_or(0);
            Some((port, pid, heartbeat_at))
        })
        .collect()
}

/// 远端(WSL/SSH)kimi 可执行文件路径缓存(key = 目标 Debug 串,set_connection_target 时清空)
static REMOTE_KIMI_BIN: std::sync::LazyLock<std::sync::RwLock<HashMap<String, String>>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(HashMap::new()));

/// 切换连接目标时清空远端路径缓存(lib.rs set_connection_target 调用)
pub fn invalidate_remote_caches() {
    REMOTE_KIMI_BIN.write().unwrap().clear();
}

/// 实验性开关登记表:(env, CLI 默认是否开启, 未显式设置时桌面端是否按开启处理)
/// 注入规则:有效值 ≠ CLI 默认时才注入对应 env —— 显式关闭 CLI 默认开启的项(如 search_worker)
/// 会注入 "0";未设置且桌面端不干预时不注入,由 CLI 自身默认生效
/// (flag 清单与本机 CLI 0.39.0 的 FlagResolver 注册表一致;新增实验特性时在此追加。
/// remote_control 特殊:env 只解锁能力,真正生效靠启动 kimi web 时附加 --remote-control
/// (见 web_command / server.rs SSH 启动串),且会把 Web UI 经官方中继暴露到公网,前端开关文案需明示风险)
const EXPERIMENTAL_FLAG_TABLE: &[(&str, bool, bool)] = &[
    ("KIMI_CODE_EXPERIMENTAL_FLAG", false, false),
    // 二级模型:桌面端历来默认开启(保持既有行为)
    ("KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL", false, true),
    ("KIMI_CODE_EXPERIMENTAL_TOOL_SELECT", false, false),
    ("KIMI_CODE_EXPERIMENTAL_AUTO_SESSION_TITLE", false, false),
    // 搜索索引 worker 线程:CLI 默认开启
    ("KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER", true, false),
    // 以下为 CLI 0.39.0 注册表新增
    ("KIMI_CODE_EXPERIMENTAL_SUBAGENT_FORK", false, false),
    ("KIMI_CODE_EXPERIMENTAL_TOWER", false, false),
    ("KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL", false, false),
    // WaitFor 工具 / minidb 读模型:CLI 默认开启
    ("KIMI_CODE_EXPERIMENTAL_WAIT_FOR", true, false),
    ("KIMI_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL", true, false),
];

/// Remote Control 是否启用(跟随实验性开关有效值);
/// 启用时启动 kimi web 需附加 --remote-control(env 只解锁该 flag,不直接生效)
pub fn remote_control_enabled() -> bool {
    experimental_effective()
        .into_iter()
        .any(|(env, on)| env == "KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL" && on)
}

/// 各实验性开关的有效值(用户显式设置 > 桌面端默认 > CLI 默认)
pub fn experimental_effective() -> Vec<(String, bool)> {
    let flags = crate::cli::experimental_flags();
    EXPERIMENTAL_FLAG_TABLE
        .iter()
        .map(|(env, cli_default, desktop_on)| {
            let on = flags
                .get(*env)
                .copied()
                .unwrap_or(*desktop_on || *cli_default);
            (env.to_string(), on)
        })
        .collect()
}

/// 实验性功能开关 → 启动 kimi web 时注入的环境变量。
/// 只注入有效值与 CLI 默认不一致的项(开 → "1",关 → "0"),其余由 CLI 默认生效
pub fn experimental_envs() -> Vec<(String, String)> {
    experimental_effective()
        .into_iter()
        .zip(EXPERIMENTAL_FLAG_TABLE.iter())
        .filter(|((_, on), (_, cli_default, _))| on != cli_default)
        .map(|((env, on), _)| (env, if on { "1".to_string() } else { "0".to_string() }))
        .collect()
}

/// experimental_envs 的 shell 前缀形式(WSL/SSH 命令串用):"A=1 B=1 ";无开关时为空串
pub fn experimental_env_prefix() -> String {
    let mut s = String::new();
    for (k, v) in experimental_envs() {
        s.push_str(&format!("{k}={v} "));
    }
    s
}

/// run_shell 的统一返回(对齐子进程 output 语义)
pub struct ShellOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// 单条 usage.record 解析结果(usage_record_lines 的解析值,三个聚合口径共用一份)
#[derive(Clone)]
pub struct UsageRecord {
    pub model: String, // 空串在解析时已归一为 "unknown"
    pub time: i64,     // 毫秒时间戳
    pub input_other: i64,
    pub output: i64,
    pub input_cache_read: i64,
    pub input_cache_creation: i64,
}

/// 单条 API 调用(step.end 事件)解析结果:含 token 用量与 TTFT/流式耗时
#[derive(Clone)]
pub struct ApiCallRecord {
    pub time: i64, // 毫秒时间戳
    pub model: String, // 由同文件 llm.request 按 turnId.step join,缺省 "unknown"
    pub session_id: String,
    pub agent_id: String,
    pub workspace: String, // sessions 下的 wd 目录名
    pub input_other: i64,
    pub input_cache_read: i64,
    pub input_cache_creation: i64,
    pub output: i64,
    pub ttft_ms: Option<i64>,   // llmFirstTokenLatencyMs
    pub stream_ms: Option<i64>, // llmStreamDurationMs(首 token 之后的流式耗时)
    pub finish_reason: Option<String>,
}

/// 用量扫描结果:每个有 wire.jsonl 的会话一条,records 为解析后的 usage 记录,
/// api_calls 为 step.end 口径的逐次 API 调用(API 调用统计页用)
pub struct SessionUsage {
    pub sid: String,
    pub wd: String, // sessions 下的 wd 目录名(按项目聚合用)
    pub records: Vec<UsageRecord>,
    pub api_calls: Vec<ApiCallRecord>,
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

/// 从 <home>/sessions/<wd>/<sid>/agents/<agentId>/wire.jsonl 提取 (wd, sid, agentId)
fn wire_path_parts(home: &str, path: &str) -> Option<(String, String, String)> {
    let prefix = format!("{home}/sessions/");
    let rest = path.strip_prefix(&prefix)?;
    let mut it = rest.split('/');
    let wd = it.next()?.to_string();
    let sid = it.next()?.to_string();
    if it.next()? != "agents" {
        return None;
    }
    let agent = it.next()?.to_string();
    if wd.is_empty() || sid.is_empty() || agent.is_empty() {
        return None;
    }
    Some((wd, sid, agent))
}

/// 远端用量扫描脚本:逐 wire.jsonl 打 marker 后 grep 出 usage/step.end/llm.request 行
/// (主代理与 subagent 的 wire 文件都扫,即 agents/*/wire.jsonl;
/// marker 行存在即代表该会话有 wire 文件,usage_record_lines 的 sessions 计数依赖这一点;
/// step.end/llm.request 行供 API 调用统计解析 TTFT/TPS)
fn usage_scan_script(home: &str) -> String {
    format!(
        "for f in {h}/sessions/*/*/agents/*/wire.jsonl; do [ -f \"$f\" ] || continue; printf '\\001%s\\n' \"$f\"; grep -E '\"(usage\\.record|step\\.end|llm\\.request)\"' -- \"$f\" 2>/dev/null; done",
        h = sq(home)
    )
}

/// 解析单行 wire.jsonl:非 usage.record / 缺 usage / 缺 time / JSON 非法 → None。
/// 与原 local_store 逐行过滤逻辑逐字一致(先字符串包含,再 JSON.parse,再字段校验)。
fn parse_usage_line(line: &str) -> Option<UsageRecord> {
    if !line.contains("\"usage.record\"") {
        return None;
    }
    let rec: Value = serde_json::from_str(line).ok()?;
    if rec.get("type").and_then(|t| t.as_str()) != Some("usage.record")
        || rec.get("usage").is_none()
    {
        return None;
    }
    let time = rec.get("time").and_then(|t| t.as_i64())?;
    let num = |key: &str| -> i64 {
        rec.get("usage")
            .and_then(|u| u.get(key))
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
            .unwrap_or(0)
    };
    let model = rec
        .get("model")
        .and_then(|m| m.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("unknown")
        .to_string();
    Some(UsageRecord {
        model,
        time,
        input_other: num("inputOther"),
        output: num("output"),
        input_cache_read: num("inputCacheRead"),
        input_cache_creation: num("inputCacheCreation"),
    })
}

/// 从 JSON 取整数(i64 或 f64 截断),缺失/非法 → 0
fn json_num(v: Option<&Value>) -> i64 {
    v.and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
        .unwrap_or(0)
}

/// 解析 llm.request 行 → (turnStep, modelAlias 或 model),供 step.end 按轮次 join 模型名
fn parse_llm_request_line(line: &str) -> Option<(String, String)> {
    if !line.contains("\"llm.request\"") {
        return None;
    }
    let rec: Value = serde_json::from_str(line).ok()?;
    if rec.get("type").and_then(|t| t.as_str()) != Some("llm.request") {
        return None;
    }
    let turn_step = rec.get("turnStep").and_then(|t| t.as_str())?.to_string();
    let model = rec
        .get("modelAlias")
        .and_then(|m| m.as_str())
        .or_else(|| rec.get("model").and_then(|m| m.as_str()))
        .filter(|s| !s.is_empty())?
        .to_string();
    Some((turn_step, model))
}

/// 提取 step.end 事件:支持顶层 {"type":"step.end"} 与 context.append_loop_event 包裹
/// 两种形态;返回 (事件体, 时间戳毫秒)(包裹形态时间在外层)
fn step_end_event(line: &str) -> Option<(Value, i64)> {
    if !line.contains("\"step.end\"") {
        return None;
    }
    let rec: Value = serde_json::from_str(line).ok()?;
    match rec.get("type").and_then(|t| t.as_str()) {
        Some("step.end") => {
            let time = rec.get("time").and_then(|t| t.as_i64())?;
            Some((rec, time))
        }
        Some("context.append_loop_event") => {
            let ev = rec.get("event")?.clone();
            if ev.get("type").and_then(|t| t.as_str()) != Some("step.end") {
                return None;
            }
            let time = rec
                .get("time")
                .and_then(|t| t.as_i64())
                .or_else(|| ev.get("time").and_then(|t| t.as_i64()))?;
            Some((ev, time))
        }
        _ => None,
    }
}

/// step.end 事件体 → ApiCallRecord(model 由 model_map 按 "<turnId>.<step>" join,
/// 缺省 "unknown";session/agent/workspace 由调用方按路径回填)
fn api_call_from_step_end(
    ev: &Value,
    time: i64,
    model_map: &HashMap<String, String>,
) -> ApiCallRecord {
    let usage = ev.get("usage");
    let num = |key: &str| -> i64 { json_num(usage.and_then(|u| u.get(key))) };
    let turn_id = ev
        .get("turnId")
        .and_then(|t| {
            t.as_str()
                .map(String::from)
                .or_else(|| t.as_i64().map(|n| n.to_string()))
        })
        .unwrap_or_default();
    let step = json_num(ev.get("step"));
    let model = model_map
        .get(&format!("{turn_id}.{step}"))
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());
    ApiCallRecord {
        time,
        model,
        session_id: String::new(),
        agent_id: String::new(),
        workspace: String::new(),
        input_other: num("inputOther"),
        input_cache_read: num("inputCacheRead"),
        input_cache_creation: num("inputCacheCreation"),
        output: num("output"),
        ttft_ms: ev.get("llmFirstTokenLatencyMs").and_then(|v| v.as_i64()),
        stream_ms: ev.get("llmStreamDurationMs").and_then(|v| v.as_i64()),
        finish_reason: ev
            .get("finishReason")
            .and_then(|f| f.as_str())
            .map(String::from),
    }
}

/// 单个 wire.jsonl 的完整解析结果(usage 记录 + API 调用,一次遍历产出)
struct WireParse {
    records: Vec<UsageRecord>,
    api_calls: Vec<ApiCallRecord>,
}

/// 逐行解析 wire.jsonl 内容:usage.record / llm.request / step.end 三类行
/// (llm.request 先建 turnStep→model map,step.end 统一在遍历结束后 join 模型,
/// 不依赖行序;读取中断由调用方判定)
fn parse_wire_lines<'a>(lines: impl Iterator<Item = &'a str>) -> WireParse {
    let mut records = Vec::new();
    let mut model_map: HashMap<String, String> = HashMap::new();
    let mut step_ends: Vec<(Value, i64)> = Vec::new();
    for line in lines {
        if let Some(rec) = parse_usage_line(line) {
            records.push(rec);
        }
        if let Some((turn_step, model)) = parse_llm_request_line(line) {
            model_map.insert(turn_step, model);
        }
        if let Some(se) = step_end_event(line) {
            step_ends.push(se);
        }
    }
    WireParse {
        records,
        api_calls: step_ends
            .iter()
            .map(|(ev, time)| api_call_from_step_end(ev, *time, &model_map))
            .collect(),
    }
}

/// 单个 wire.jsonl 的缓存条目:mtime 或 len 任一变化即视为失效(改动文件就地覆盖)
struct CachedUsage {
    mtime: Option<SystemTime>,
    len: u64,
    records: Vec<UsageRecord>,
    api_calls: Vec<ApiCallRecord>,
}

/// 进程内 usage 解析缓存(Local 目标专用)。key = (kimi_home 字符串, wire.jsonl 绝对路径),
/// mtime+len 做有效性校验;每次扫描结束清理未触达的 key(文件被删/目录变化/切换 home 不残留)。
/// WSL/SSH 远端路径不缓存(远端 grep 已省掉全量回传,且 mtime/len 需额外一条 stat 命令)。
static USAGE_CACHE: std::sync::LazyLock<std::sync::Mutex<HashMap<(String, String), CachedUsage>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// 用量扫描全局互斥锁:冷缓存时并发扫描串行化(见 usage_record_lines)
static USAGE_SCAN_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

/// BufReader 逐行读 wire.jsonl,只收 usage.record/step.end/llm.request 三类行后解析
/// (不整文件载入内存)。文件不存在/读取失败返回 None(与原 read_to_string 失败整体跳过一致)。
async fn read_wire_parse(path: &std::path::Path) -> Option<WireParse> {
    let file = tokio::fs::File::open(path).await.ok()?;
    let mut lines = tokio::io::BufReader::new(file).lines();
    let mut raw: Vec<String> = Vec::new();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if line.contains("\"usage.record\"")
                    || line.contains("\"step.end\"")
                    || line.contains("\"llm.request\"")
                {
                    raw.push(line);
                }
            }
            Ok(None) => break,
            Err(_) => return None, // 读取中断:整文件视为失败
        }
    }
    Some(parse_wire_lines(raw.iter().map(|s| s.as_str())))
}

/// 带缓存读单个 wire.jsonl:stat 校验 → 命中直接克隆解析结果,未命中才逐行读+解析。
/// 返回 None 表示文件不存在/非文件/读取失败(此时不加入 touched,旧缓存随扫描结束清理)。
async fn cached_wire_parse(
    path: &std::path::Path,
    key: &(String, String),
    touched: &mut HashSet<(String, String)>,
) -> Option<(Vec<UsageRecord>, Vec<ApiCallRecord>)> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    if !meta.is_file() {
        return None;
    }
    touched.insert(key.clone());
    let mtime = meta.modified().ok();
    let len = meta.len();
    {
        let cache = USAGE_CACHE.lock().unwrap();
        if let Some(c) = cache.get(key) {
            if c.mtime == mtime && c.len == len {
                return Some((c.records.clone(), c.api_calls.clone()));
            }
        }
    }
    let parsed = read_wire_parse(path).await?;
    let out = (parsed.records.clone(), parsed.api_calls.clone());
    USAGE_CACHE.lock().unwrap().insert(
        key.clone(),
        CachedUsage {
            mtime,
            len,
            records: parsed.records,
            api_calls: parsed.api_calls,
        },
    );
    Some(out)
}

/// 清理本次扫描未触达的缓存 key(文件删除/目录变化/切换 kimi_home 后不残留)
fn prune_usage_cache(touched: &HashSet<(String, String)>) {
    USAGE_CACHE
        .lock()
        .unwrap()
        .retain(|k, _| touched.contains(k));
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

    /// 通道 id:"local" / "wsl:<distro|default>" / "ssh:<user@>host"
    pub fn channel_id(&self) -> String {
        match self {
            ConnectionTarget::Local => "local".to_string(),
            ConnectionTarget::Wsl { distro } => format!(
                "wsl:{}",
                distro.clone().unwrap_or_else(|| "default".to_string())
            ),
            ConnectionTarget::Ssh { host, user, .. } => {
                let host = host.trim().to_string();
                let (embedded, pure) = Self::split_user_host(&host);
                match user.clone().or(embedded) {
                    Some(u) => format!("ssh:{u}@{pure}"),
                    None => format!("ssh:{pure}"),
                }
            }
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

    /// 用户 home 目录字符串(~/.agents 等通用目录用):
    /// Local 为系统用户目录(与 KIMI_CODE_HOME 覆盖无关);WSL/SSH 由 kimi_home_str 去掉
    /// "/.kimi-code" 后缀推出(远端该目录恒为 $HOME/.kimi-code,见 kimi_home_str)
    pub async fn user_home_str(&self) -> Result<String, String> {
        if let ConnectionTarget::Local = self {
            return Ok(crate::cli::home_dir().to_string_lossy().replace('\\', "/"));
        }
        let h = self.kimi_home_str().await?;
        Ok(h.strip_suffix("/.kimi-code").unwrap_or(&h).to_string())
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

    /// 用量扫描:Local 逐文件读(带进程内缓存);WSL/SSH 一条命令带回全部 wire.jsonl 的
    /// usage/step.end/llm.request 行;api_calls 为 step.end 口径的逐次 API 调用。
    /// 全局互斥串行化:冷缓存时并发调用方(daily/today/api_calls 同时进来)排队等首轮扫描,
    /// 后者直接命中缓存,避免同一批 wire 文件被重复全量读
    pub async fn usage_record_lines(&self) -> Vec<SessionUsage> {
        let _guard = USAGE_SCAN_LOCK.lock().await;
        self.usage_record_lines_inner().await
    }

    async fn usage_record_lines_inner(&self) -> Vec<SessionUsage> {
        match self {
            ConnectionTarget::Local => {
                let sessions_root = kimi_home().join("sessions");
                let home_str = kimi_home().to_string_lossy().into_owned();
                let mut out = Vec::new();
                let mut touched: HashSet<(String, String)> = HashSet::new();
                let Ok(wds) = std::fs::read_dir(&sessions_root) else {
                    return out;
                };
                for wd in wds.flatten() {
                    let Ok(sids) = std::fs::read_dir(wd.path()) else {
                        continue;
                    };
                    for sid in sids.flatten() {
                        // 主代理与 subagent 各有独立 wire 文件(agents/<agentId>/wire.jsonl),
                        // 全部扫描后按会话合并,用量统计才不会漏掉 subagent 的消耗
                        let agents_dir = sid.path().join("agents");
                        let Ok(agents) = std::fs::read_dir(&agents_dir) else {
                            continue;
                        };
                        let mut found = false;
                        let mut records: Vec<UsageRecord> = Vec::new();
                        let mut api_calls: Vec<ApiCallRecord> = Vec::new();
                        for agent in agents.flatten() {
                            let wire = agent.path().join("wire.jsonl");
                            let key = (home_str.clone(), wire.to_string_lossy().into_owned());
                            // 按文件缓存解析结果(mtime/len 未变直接复用),各聚合口径共享
                            if let Some((mut recs, mut calls)) =
                                cached_wire_parse(&wire, &key, &mut touched).await
                            {
                                let agent_id = agent.file_name().to_string_lossy().into_owned();
                                for c in &mut calls {
                                    c.workspace = wd.file_name().to_string_lossy().into_owned();
                                    c.session_id = sid.file_name().to_string_lossy().into_owned();
                                    c.agent_id = agent_id.clone();
                                }
                                records.append(&mut recs);
                                api_calls.append(&mut calls);
                                found = true;
                            }
                        }
                        if !found {
                            continue;
                        }
                        out.push(SessionUsage {
                            sid: sid.file_name().to_string_lossy().into_owned(),
                            wd: wd.file_name().to_string_lossy().into_owned(),
                            records,
                            api_calls,
                        });
                    }
                }
                prune_usage_cache(&touched);
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
                // 同一会话的主代理与 subagent 各有 wire 文件,按 (wd, sid) 合并,
                // 保证 sessions 计数与 Local 分支一致
                let mut order: Vec<(String, String)> = Vec::new();
                let mut map: HashMap<(String, String), (Vec<UsageRecord>, Vec<ApiCallRecord>)> =
                    HashMap::new();
                for (path, body) in split_marked(&out.stdout) {
                    let Some((wd, sid, agent_id)) = wire_path_parts(&home, &path) else {
                        continue;
                    };
                    let key = (wd.clone(), sid.clone());
                    if !map.contains_key(&key) {
                        order.push(key.clone());
                    }
                    let parsed = parse_wire_lines(body.split('\n').filter(|l| !l.is_empty()));
                    let mut calls = parsed.api_calls;
                    for c in &mut calls {
                        c.workspace = wd.clone();
                        c.session_id = sid.clone();
                        c.agent_id = agent_id.clone();
                    }
                    let entry = map.entry(key).or_default();
                    entry.0.extend(parsed.records);
                    entry.1.extend(calls);
                }
                order
                    .into_iter()
                    .map(|key| {
                        let (records, api_calls) = map.remove(&key).unwrap_or_default();
                        SessionUsage {
                            sid: key.1.clone(),
                            wd: key.0.clone(),
                            records,
                            api_calls,
                        }
                    })
                    .collect()
            }
        }
    }

    // ---------- 服务启停 ----------

    /// 构造启动 kimi web 的子进程命令;local_port 为本地端口。
    /// 仅 Local/WSL 走本地 spawn;SSH 由 server.rs 经 russh exec_keepalive + forward 启动
    pub async fn web_command(&self, local_port: u16) -> Result<Command, String> {
        // Remote Control 启用时附加 --remote-control(0.39.0+;banner 改打印 RC 链接块,
        // 不含 token 行,server.rs 的 token 获取随之改走 server.token 文件轮询)
        let rc = if remote_control_enabled() {
            " --remote-control"
        } else {
            ""
        };
        match self {
            ConnectionTarget::Local => {
                let mut cmd = hidden_command(&kimi_bin());
                cmd.args(["web", "--no-open", "--port", &local_port.to_string()])
                    // 显式传入数据目录:保证 CLI 与桌面端读取同一份(自定义工作区/默认一致)
                    .env("KIMI_CODE_HOME", kimi_home());
                if !rc.is_empty() {
                    cmd.arg("--remote-control");
                }
                // 实验性功能开关(设置页可配;二级模型默认开)
                for (k, v) in experimental_envs() {
                    cmd.env(k, v);
                }
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
                    &format!(
                        "{}{} web --no-open --port {local_port}{rc}",
                        experimental_env_prefix(),
                        sq(&bin),
                    ),
                ))
            }
            ConnectionTarget::Ssh { .. } => {
                Err("SSH 目标经 russh 进程内启动,不走本地 spawn".to_string())
            }
        }
    }

    /// 列举 kimi web 实例注册表(server/instances/*.json)中登记的 (port, pid, heartbeat_at)。
    /// 供 server.rs 启动前回收残留实例(稳定 iframe 端口、避免孤儿累积)。
    /// Local 直读目录;WSL 经 wsl.exe cat;SSH 恒空(远端进程随 pty 断连收 SIGHUP,无孤儿)。
    /// 损坏/`.tmp` 文件静默忽略;任何通道错误都返回空——回收是尽力而为,不阻塞启动
    pub(crate) async fn list_server_instances(&self) -> Vec<(u16, u32, u64)> {
        let text = match self {
            ConnectionTarget::Local => {
                let dir = kimi_home().join("server").join("instances");
                let mut entries = match tokio::fs::read_dir(&dir).await {
                    Ok(e) => e,
                    Err(_) => return Vec::new(),
                };
                let mut buf = String::new();
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    // 只收正式 .json:崩溃残留的 *.json.tmp.* 半写文件跳过
                    if !name.ends_with(".json") {
                        continue;
                    }
                    if let Ok(content) = tokio::fs::read_to_string(entry.path()).await {
                        buf.push_str(&content);
                        buf.push('\n');
                    }
                }
                buf
            }
            ConnectionTarget::Wsl { distro } => {
                let home = match self.kimi_home_str().await {
                    Ok(h) => h,
                    Err(_) => return Vec::new(),
                };
                let cmd = format!("cat {}/server/instances/*.json 2>/dev/null || true", sq(&home));
                let out = match tokio::time::timeout(
                    Duration::from_secs(10),
                    Self::wsl_shell_command(distro, &cmd)
                        .kill_on_drop(true)
                        .output(),
                )
                .await
                {
                    Ok(Ok(o)) => o,
                    _ => return Vec::new(),
                };
                String::from_utf8_lossy(&out.stdout).into_owned()
            }
            ConnectionTarget::Ssh { .. } => return Vec::new(),
        };
        parse_server_instances(&text)
    }

    /// 按注册表登记的 pid 强杀目标环境内的进程:回收残留 kimi web 的兜底
    /// (POST shutdown 超过等待仍未退出时使用;pid 来自实例注册表,非运行时猜测)
    pub(crate) async fn kill_pid(&self, pid: u32) {
        match self {
            ConnectionTarget::Local => {
                // 与 kill_child_tree 同理:Windows 下 /T 杀整棵树(npm shim 下壳进程≠服务进程)
                #[cfg(windows)]
                {
                    let _ = hidden_command("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .kill_on_drop(true)
                        .output()
                        .await;
                }
                #[cfg(not(windows))]
                {
                    let _ = hidden_command("kill")
                        .args(["-9", &pid.to_string()])
                        .kill_on_drop(true)
                        .output()
                        .await;
                }
            }
            ConnectionTarget::Wsl { distro } => {
                let _ = tokio::time::timeout(
                    Duration::from_secs(10),
                    Self::wsl_shell_command(distro, &format!("kill -9 {pid} 2>/dev/null || true"))
                        .kill_on_drop(true)
                        .output(),
                )
                .await;
            }
            ConnectionTarget::Ssh { .. } => {}
        }
    }

    /// 读取 server.token 的兜底途径:CLI 0.29.2+ 只打印 banner 不写文件,
    /// 正常流程应由 server.rs 先等 banner token;此处是旧 CLI 的回退
    /// (本机读文件;WSL/SSH 反复执行 cat 命令,每次 ~10s 超时防挂死)。
    /// token 文件在服务首次启动时可能尚未生成,轮询等待(25 × 400ms)
    pub async fn read_token(&self) -> Result<String, String> {
        let mut last_err = String::new();
        for _ in 0..25 {
            match self.read_token_once().await {
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
                "获取 kimi web token 失败:启动横幅未输出 Token 行,且未能在 {} 读取 server.token 文件",
                kimi_home().join("server.token").display()
            )),
            ConnectionTarget::Wsl { .. } => {
                Err("获取 WSL 内 kimi web token 失败:启动横幅未输出 Token 行,且读取 WSL 内 server.token 失败,请确认 kimi web 已在 WSL 中正常启动".to_string())
            }
            ConnectionTarget::Ssh { host, .. } => {
                // 认证类错误直接透出(文案已在 ssh.rs 友好化)
                if last_err.contains("SSH 认证") || last_err.contains("SSH 连接") {
                    Err(last_err)
                } else {
                    Err(format!(
                        "获取远端 kimi web token 失败({host}):启动横幅未输出 Token 行,且读取 server.token 失败({last_err})"
                    ))
                }
            }
        }
    }

    /// 单次读 server.token:Ok(None) 表示文件不存在/为空。
    /// 回收残留实例(server.rs reclaim)与 read_token 轮询共用此单次读取。
    pub(crate) async fn read_token_once(&self) -> Result<Option<String>, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_wire_lines_joins_model_and_timing() {
        let lines = vec![
            r#"{"type":"llm.request","kind":"loop","model":"kimi-for-coding","modelAlias":"kimi-code/kimi-for-coding","turnStep":"0.1","time":1783502095754}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"u1","turnId":"0","step":1,"usage":{"inputOther":7250,"output":69,"inputCacheRead":17920,"inputCacheCreation":0},"finishReason":"end_turn","llmFirstTokenLatencyMs":2178,"llmStreamDurationMs":35},"time":1783502097968}"#,
            r#"{"type":"usage.record","model":"kimi-code/kimi-for-coding","usage":{"inputOther":489,"output":1065,"inputCacheRead":19712,"inputCacheCreation":0},"usageScope":"turn","time":1783407794721}"#,
            // 顶层 step.end(旧格式)且 llm.request 缺失 → model 回退 unknown
            r#"{"type":"step.end","turnId":"1","step":2,"usage":{"inputOther":10,"output":5,"inputCacheRead":0,"inputCacheCreation":0},"time":1783502100000}"#,
        ];
        let parsed = parse_wire_lines(lines.into_iter());
        assert_eq!(parsed.records.len(), 1);
        assert_eq!(parsed.records[0].output, 1065);
        assert_eq!(parsed.api_calls.len(), 2);
        let c = &parsed.api_calls[0];
        assert_eq!(c.model, "kimi-code/kimi-for-coding");
        assert_eq!(c.time, 1783502097968);
        assert_eq!(c.input_other, 7250);
        assert_eq!(c.input_cache_read, 17920);
        assert_eq!(c.output, 69);
        assert_eq!(c.ttft_ms, Some(2178));
        assert_eq!(c.stream_ms, Some(35));
        assert_eq!(c.finish_reason.as_deref(), Some("end_turn"));
        let c2 = &parsed.api_calls[1];
        assert_eq!(c2.model, "unknown");
        assert_eq!(c2.ttft_ms, None);
    }

    #[test]
    fn experimental_envs_injection_rules() {
        // 未设置任何开关:仅二级模型(桌面默认开 ≠ CLI 默认关)注入 "1"
        crate::cli::set_experimental_flags(HashMap::new());
        assert_eq!(
            experimental_envs(),
            vec![(
                "KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL".to_string(),
                "1".to_string()
            )]
        );
        // 显式关闭 CLI 默认开启的 search_worker → 注入 "0";显式打开 tool_select → 注入 "1"
        crate::cli::set_experimental_flags(HashMap::from([
            ("KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER".to_string(), false),
            ("KIMI_CODE_EXPERIMENTAL_TOOL_SELECT".to_string(), true),
        ]));
        let envs: HashMap<String, String> = experimental_envs().into_iter().collect();
        assert_eq!(
            envs.get("KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER").map(String::as_str),
            Some("0")
        );
        assert_eq!(
            envs.get("KIMI_CODE_EXPERIMENTAL_TOOL_SELECT").map(String::as_str),
            Some("1")
        );
        // 二级模型未设置仍按桌面默认注入 "1"
        assert_eq!(
            envs.get("KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL").map(String::as_str),
            Some("1")
        );
        // 显式打开与 CLI 默认一致的项不注入
        crate::cli::set_experimental_flags(HashMap::from([(
            "KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER".to_string(),
            true,
        )]));
        let envs: HashMap<String, String> = experimental_envs().into_iter().collect();
        assert!(!envs.contains_key("KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER"));
        crate::cli::set_experimental_flags(HashMap::new()); // 复位,避免影响其他用例
    }

    #[test]
    fn wire_path_parts_extracts_agent() {
        let (wd, sid, agent) =
            wire_path_parts("/home/u/.kimi-code", "/home/u/.kimi-code/sessions/wd_a_0123456789ab/session_x/agents/main/wire.jsonl")
                .unwrap();
        assert_eq!(wd, "wd_a_0123456789ab");
        assert_eq!(sid, "session_x");
        assert_eq!(agent, "main");
        assert!(wire_path_parts("/home/u/.kimi-code", "/other/path").is_none());
    }
}
