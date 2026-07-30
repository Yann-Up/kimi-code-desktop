//! local-store: 读取 ~/.kimi-code 下的数据(无 REST 的部分),三种连接目标统一经 target 工厂路由。
//! - 插件:plugins/installed.json
//! - 技能:skills 目录扫描
//! - 子代理 profile:agents 目录扫描(markdown frontmatter)
//! - 定时任务:sessions 下各会话 cron 目录扫描
//! - 使用统计:解析 sessions 下各会话 agents/main/wire.jsonl 中的 usage 记录
//! (解析/聚合逻辑与原实现逐字一致;Local 逐文件读,WSL/SSH 一条命令批量带回)

use chrono::{Datelike, Duration as ChronoDuration, Local, TimeZone, Timelike};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::cli;
use crate::target::ConnectionTarget;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    pub raw: Value,
}

#[derive(Serialize)]
pub struct SkillEntry {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub path: String,
    pub scope: String, // user | project
}

#[derive(Serialize)]
pub struct AgentProfile {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronEntry {
    pub session_id: String,
    pub file: String,
    pub data: Value,
}

/// 当前连接目标 + 其 kimi 数据目录(失败返回 None,调用方按空数据处理)
async fn target_and_home() -> Option<(ConnectionTarget, String)> {
    let t = cli::connection_target();
    t.kimi_home_str().await.ok().map(|h| (t, h))
}

async fn safe_read_json(t: &ConnectionTarget, path: &str) -> Option<Value> {
    let content = t.read_text(path).await.ok()?;
    serde_json::from_str(&content).ok()
}

/// 读 mcp.json(用户级 MCP 配置)
pub async fn read_mcp_config() -> Value {
    let Some((t, home)) = target_and_home().await else {
        return json!({});
    };
    let raw = safe_read_json(&t, &t.join(&home, "mcp.json")).await;
    match raw {
        Some(v) if v.is_object() => v,
        _ => json!({}),
    }
}

/// 写 mcp.json:备份 → 写入。返回备份路径。
pub async fn write_mcp_config(data: Value) -> Result<String, String> {
    let t = cli::connection_target();
    let home = t.kimi_home_str().await?;
    let file = t.join(&home, "mcp.json");
    // 与 TS 一致:file + '.kimi-desktop-bak'
    let backup = format!("{file}.kimi-desktop-bak");
    t.copy(&file, &backup).await; // 原文件不存在则无需备份
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())? + "\n";
    t.write_text(&file, &text).await?;
    Ok(backup)
}

pub async fn list_plugins() -> Vec<PluginEntry> {
    let Some((t, home)) = target_and_home().await else {
        return vec![];
    };
    let Some(raw) = safe_read_json(&t, &t.join(&t.join(&home, "plugins"), "installed.json")).await
    else {
        return vec![];
    };
    let mut out = Vec::new();
    let mut push = |id: String, v: &Value| {
        let obj = if v.is_object() { v.clone() } else { json!({}) };
        out.push(PluginEntry {
            id,
            version: obj.get("version").and_then(|x| x.as_str()).map(String::from),
            source: obj.get("source").and_then(|x| x.as_str()).map(String::from),
            installed_at: obj
                .get("installed_at")
                .and_then(|x| x.as_str())
                .map(String::from),
            raw: obj,
        });
    };
    if let Some(arr) = raw.as_array() {
        for item in arr {
            let id = item
                .get("id")
                .or_else(|| item.get("name"))
                .map(|x| match x {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .unwrap_or_else(|| "unknown".to_string());
            push(id, item);
        }
    } else if let Some(obj) = raw.as_object() {
        for (k, v) in obj {
            push(k.clone(), v);
        }
    }
    out
}

/// markdown frontmatter:--- 块内 key: value,去引号
fn parse_frontmatter(content: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    // 等价于 /^---\r?\n([\s\S]*?)\r?\n---/
    let after_open = if let Some(s) = content.strip_prefix("---\r\n") {
        s
    } else if let Some(s) = content.strip_prefix("---\n") {
        s
    } else {
        return out;
    };
    let Some(end) = after_open.find("\n---") else {
        return out;
    };
    let block = &after_open[..end];
    for line in block.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        // 等价于 /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/
        let bytes = line.as_bytes();
        if bytes.is_empty() {
            continue;
        }
        let first = bytes[0];
        if !(first.is_ascii_alphabetic() || first == b'_') {
            continue;
        }
        let mut i = 1;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'-') {
            i += 1;
        }
        let key = &line[..i];
        let rest = line[i..].trim_start();
        let Some(value) = rest.strip_prefix(':') else {
            continue;
        };
        let value = value.trim();
        // 去掉首尾引号(与 TS 的 /^["']|["']$/g 一致,各剥一层)
        let value = if value.len() >= 1 && (value.starts_with('"') || value.starts_with('\'')) {
            &value[1..]
        } else {
            value
        };
        let value = if value.len() >= 1 && (value.ends_with('"') || value.ends_with('\'')) {
            &value[..value.len() - 1]
        } else {
            value
        };
        out.insert(key.to_string(), value.to_string());
    }
    out
}

pub async fn list_skills() -> Vec<SkillEntry> {
    let Some((t, home)) = target_and_home().await else {
        return vec![];
    };
    let mut out = Vec::new();
    let base = t.join(&home, "skills");
    for dir in t.list_dir(&base).await {
        let skill_md = t.join(&t.join(&base, &dir), "SKILL.md");
        let Ok(content) = t.read_text(&skill_md).await else {
            continue; // 无 SKILL.md
        };
        let fm = parse_frontmatter(&content);
        out.push(SkillEntry {
            name: fm.get("name").cloned().unwrap_or_else(|| dir.clone()),
            description: fm.get("description").cloned(),
            path: t.join(&base, &dir),
            scope: "user".to_string(),
        });
    }
    out
}

fn builtin_agents() -> Vec<AgentProfile> {
    let b = |name: &str, description: &str| AgentProfile {
        name: name.to_string(),
        description: Some(description.to_string()),
        tools: None,
        path: None,
        builtin: Some(true),
    };
    vec![
        b("plan", "Read-only implementation planning and architecture design."),
        b("agent", "Default Kimi Code agent."),
        b("coder", "General software engineering agent with file-editing tools."),
        b("explore", "Fast read-only codebase exploration agent."),
    ]
}

pub async fn list_agent_profiles() -> Vec<AgentProfile> {
    let mut out = builtin_agents();
    let Some((t, home)) = target_and_home().await else {
        return out;
    };
    let dir = t.join(&home, "agents");
    for f in t.list_dir(&dir).await {
        if !f.ends_with(".md") {
            continue;
        }
        let Ok(content) = t.read_text(&t.join(&dir, &f)).await else {
            continue;
        };
        let fm = parse_frontmatter(&content);
        out.push(AgentProfile {
            name: fm
                .get("name")
                .cloned()
                .unwrap_or_else(|| f.trim_end_matches(".md").to_string()),
            description: fm.get("description").cloned(),
            tools: None,
            path: Some(t.join(&dir, &f)),
            builtin: None,
        });
    }
    out
}

pub async fn list_cron_jobs() -> Vec<CronEntry> {
    let t = cli::connection_target();
    let mut out = Vec::new();
    for f in t.cron_files().await {
        let Ok(data) = serde_json::from_str::<Value>(&f.content) else {
            continue;
        };
        if data.is_object() {
            out.push(CronEntry {
                session_id: f.sid,
                file: f.file,
                data,
            });
        }
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageByWorkdir {
    pub workdir: String,
    pub name: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_tokens: i64,
    pub sessions: i64,
}

/// wd_<slug>_<12位hash> → slug 作为显示名(等价 /^wd_(.+?)_[0-9a-f]{12}$/)
fn workdir_name(wd: &str) -> String {
    if let Some(rest) = wd.strip_prefix("wd_") {
        // 非 UTF-8 字符边界 split_at 会 panic(sessions/ 是用户目录,可能有怪目录名)
        if rest.len() > 13 && rest.is_char_boundary(rest.len() - 13) {
            let (slug, suffix) = rest.split_at(rest.len() - 13);
            let suffix_ok = suffix.starts_with('_')
                && suffix[1..].len() == 12
                && suffix[1..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
            if suffix_ok && !slug.is_empty() {
                return slug.to_string();
            }
        }
    }
    wd.to_string()
}

fn usage_num(rec: &Value, key: &str) -> i64 {
    rec.get("usage")
        .and_then(|u| u.get(key))
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
        .unwrap_or(0)
}

/// 解析 wire.jsonl 的 usage.record 记录,按工作区聚合。
pub async fn aggregate_usage() -> Vec<UsageByWorkdir> {
    let t = cli::connection_target();
    let mut order: Vec<String> = Vec::new();
    let mut map: HashMap<String, UsageByWorkdir> = HashMap::new();
    for sw in t.usage_record_lines().await {
        let agg = map.entry(sw.wd.clone()).or_insert_with(|| {
            order.push(sw.wd.clone());
            UsageByWorkdir {
                workdir: sw.wd.clone(),
                name: workdir_name(&sw.wd),
                input_tokens: 0,
                output_tokens: 0,
                cache_tokens: 0,
                sessions: 0,
            }
        });
        agg.sessions += 1;
        for line in &sw.lines {
            // 先字符串包含过滤再 JSON.parse(性能与 TS 一致)
            if !line.contains("\"usage.record\"") {
                continue;
            }
            let Ok(rec) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if rec.get("type").and_then(|t| t.as_str()) != Some("usage.record")
                || rec.get("usage").is_none()
            {
                continue;
            }
            agg.input_tokens += usage_num(&rec, "inputOther");
            agg.output_tokens += usage_num(&rec, "output");
            agg.cache_tokens += usage_num(&rec, "inputCacheRead");
        }
    }
    order
        .into_iter()
        .filter_map(|k| map.remove(&k))
        .filter(|v| v.sessions > 0)
        .collect()
}

#[derive(Serialize)]
pub struct DailyUsage {
    pub date: String, // YYYY-MM-DD
    pub models: HashMap<String, i64>, // model → tokens(in+out+cache)
    pub total: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDailyResult {
    pub days: Vec<DailyUsage>,
    pub model_totals: HashMap<String, i64>,
    pub active_days: usize,
    pub streak: u32,
    pub turns: i64,
    pub sessions: usize,
}

fn day_key(ms: i64) -> Option<String> {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|d| d.format("%Y-%m-%d").to_string())
}

/// 按天+按模型的用量聚合(使用统计页热力图/趋势/donut 用)
pub async fn aggregate_usage_daily(days: u32) -> UsageDailyResult {
    let days = days.max(1) as i64;
    let t = cli::connection_target();
    let today = Local::now().date_naive();
    let since_date = today - ChronoDuration::days(days - 1);
    let since_ms = since_date
        .and_hms_opt(0, 0, 0)
        .and_then(|dt| Local.from_local_datetime(&dt).single())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);

    let mut by_day: HashMap<String, DailyUsage> = HashMap::new();
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    let mut session_set: HashSet<String> = HashSet::new();
    let mut turns: i64 = 0;

    for sw in t.usage_record_lines().await {
        let mut has_usage = false;
        for line in &sw.lines {
            if !line.contains("\"usage.record\"") {
                continue;
            }
            let Ok(rec) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if rec.get("type").and_then(|t| t.as_str()) != Some("usage.record")
                || rec.get("usage").is_none()
            {
                continue;
            }
            let Some(time) = rec.get("time").and_then(|t| t.as_i64()) else {
                continue;
            };
            if time < since_ms {
                continue;
            }
            let total = usage_num(&rec, "inputOther")
                + usage_num(&rec, "output")
                + usage_num(&rec, "inputCacheRead")
                + usage_num(&rec, "inputCacheCreation");
            let Some(key) = day_key(time) else {
                continue;
            };
            let model = rec
                .get("model")
                .and_then(|m| m.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("unknown")
                .to_string();
            let day = by_day.entry(key.clone()).or_insert_with(|| DailyUsage {
                date: key,
                models: HashMap::new(),
                total: 0,
            });
            *day.models.entry(model.clone()).or_insert(0) += total;
            day.total += total;
            *model_totals.entry(model).or_insert(0) += total;
            turns += 1;
            has_usage = true;
        }
        if has_usage {
            session_set.insert(sw.sid);
        }
    }

    // 连续活跃天数(从今天或昨天往前)
    let active_set: HashSet<String> = by_day.keys().cloned().collect();
    let fmt = |d: chrono::NaiveDate| {
        format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day())
    };
    let mut streak = 0u32;
    let mut cursor = today;
    if !active_set.contains(&fmt(cursor)) {
        cursor -= ChronoDuration::days(1);
    }
    while active_set.contains(&fmt(cursor)) {
        streak += 1;
        cursor -= ChronoDuration::days(1);
    }

    let mut days_vec: Vec<DailyUsage> = by_day.into_values().collect();
    days_vec.sort_by(|a, b| a.date.cmp(&b.date));

    UsageDailyResult {
        days: days_vec,
        model_totals,
        active_days: active_set.len(),
        streak,
        turns,
        sessions: session_set.len(),
    }
}

// ---------- 今日分时统计(实时趋势图用,Tauri 专属) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotBucket {
    pub slot: u32, // 0..47,每 30 分钟一个(本地时区)
    pub input: i64,          // 新增输入(inputOther)
    pub output: i64,         // 输出
    pub cache_read: i64,     // 缓存命中(inputCacheRead)
    pub cache_creation: i64, // 缓存创建(inputCacheCreation)
    pub turns: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTodayResult {
    pub buckets: Vec<SlotBucket>, // 48 个,含零桶,前端直接按槽位绘制
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_read: i64,
    pub total_cache_creation: i64,
    pub total_turns: i64,
}

/// 今日 0 点(本地)起的 30 分钟粒度用量聚合(按输入/输出/缓存命中/缓存创建分系列)
pub async fn aggregate_usage_today() -> UsageTodayResult {
    let t = cli::connection_target();
    let today = Local::now().date_naive();
    let since_ms = today
        .and_hms_opt(0, 0, 0)
        .and_then(|dt| Local.from_local_datetime(&dt).single())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);

    #[derive(Default)]
    struct Acc {
        input: i64,
        output: i64,
        cache_read: i64,
        cache_creation: i64,
        turns: i64,
    }
    let mut slots: Vec<Acc> = (0..48).map(|_| Acc::default()).collect();

    for sw in t.usage_record_lines().await {
        for line in &sw.lines {
            if !line.contains("\"usage.record\"") {
                continue;
            }
            let Ok(rec) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if rec.get("type").and_then(|t| t.as_str()) != Some("usage.record")
                || rec.get("usage").is_none()
            {
                continue;
            }
            let Some(time) = rec.get("time").and_then(|t| t.as_i64()) else {
                continue;
            };
            if time < since_ms {
                continue;
            }
            let Some(slot) = Local
                .timestamp_millis_opt(time)
                .single()
                .map(|d| ((d.hour() * 60 + d.minute()) / 30) as usize)
            else {
                continue;
            };
            let acc = &mut slots[slot];
            acc.input += usage_num(&rec, "inputOther");
            acc.output += usage_num(&rec, "output");
            acc.cache_read += usage_num(&rec, "inputCacheRead");
            acc.cache_creation += usage_num(&rec, "inputCacheCreation");
            acc.turns += 1;
        }
    }

    let mut result = UsageTodayResult {
        buckets: Vec::with_capacity(48),
        total_input: 0,
        total_output: 0,
        total_cache_read: 0,
        total_cache_creation: 0,
        total_turns: 0,
    };
    for (s, acc) in slots.into_iter().enumerate() {
        result.total_input += acc.input;
        result.total_output += acc.output;
        result.total_cache_read += acc.cache_read;
        result.total_cache_creation += acc.cache_creation;
        result.total_turns += acc.turns;
        result.buckets.push(SlotBucket {
            slot: s as u32,
            input: acc.input,
            output: acc.output,
            cache_read: acc.cache_read,
            cache_creation: acc.cache_creation,
            turns: acc.turns,
        });
    }
    result
}

/// Windows 盘符检测:C:\ 到 Z:\ 存在性
pub fn list_drives() -> Vec<String> {
    let mut out = Vec::new();
    for c in b'C'..=b'Z' {
        let d = format!("{}:\\", c as char);
        if Path::new(&d).exists() {
            out.push(d);
        }
    }
    out
}
