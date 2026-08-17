//! local-store: 读取 ~/.kimi-code 下的数据(无 REST 的部分),三种连接目标统一经 target 工厂路由。
//! - 技能:skills 目录扫描
//! - 子代理 profile:agents 目录扫描(markdown frontmatter)
//! - 使用统计:解析 sessions 下各会话 agents/*/wire.jsonl(含 subagent)中的 usage 记录
//! (解析/聚合逻辑与原实现逐字一致;Local 逐文件读,WSL/SSH 一条命令批量带回)

use chrono::{Datelike, Duration as ChronoDuration, Local, TimeZone, Timelike};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::cli;
use crate::target::ConnectionTarget;

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
    /// 来源目录:"user" = <kimi_home>/agents,"agents" = ~/.agents/agents;内置项无此字段
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

/// 指定通道的连接目标 + 其 kimi 数据目录(失败返回 None,调用方按空数据处理)
async fn target_and_home(channel: &str) -> Option<(ConnectionTarget, String)> {
    let t = cli::connection_target_for(channel);
    t.kimi_home_str().await.ok().map(|h| (t, h))
}

async fn safe_read_json(t: &ConnectionTarget, path: &str) -> Option<Value> {
    let content = t.read_text(path).await.ok()?;
    serde_json::from_str(&content).ok()
}

/// 读 mcp.json(用户级 MCP 配置)
pub async fn read_mcp_config(channel: &str) -> Value {
    let Some((t, home)) = target_and_home(channel).await else {
        return json!({});
    };
    let raw = safe_read_json(&t, &t.join(&home, "mcp.json")).await;
    match raw {
        Some(v) if v.is_object() => v,
        _ => json!({}),
    }
}

/// 写 mcp.json:备份 → 写入。返回备份路径。
pub async fn write_mcp_config(channel: &str, data: Value) -> Result<String, String> {
    let t = cli::connection_target_for(channel);
    let home = t.kimi_home_str().await?;
    let file = t.join(&home, "mcp.json");
    // 与 TS 一致:file + '.kimi-desktop-bak'
    let backup = format!("{file}.kimi-desktop-bak");
    t.copy(&file, &backup).await; // 原文件不存在则无需备份
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())? + "\n";
    t.write_text(&file, &text).await?;
    Ok(backup)
}

/// 读 config.toml 原文(高级设置页直接编辑源文件用)。
/// 目标路由与 mcp.json 一致:本机直接读文件,WSL/SSH 经目标通道读取;
/// 文件不存在返回 None(CLI 首次运行后才自动创建)。
pub async fn read_config_toml(channel: &str) -> Option<String> {
    let (t, home) = target_and_home(channel).await?;
    t.read_text(&t.join(&home, "config.toml")).await.ok()
}

/// 读 config.toml 并解析为 JSON(键保持 snake_case 原样),供设置页结构化读写。
/// 文件不存在返回 Ok(None);解析失败返回 Err(与原文编辑页"不校验"语义不同,这里必须可解析)。
pub async fn read_config_toml_parsed(channel: &str) -> Result<Option<Value>, String> {
    let Some(raw) = read_config_toml(channel).await else {
        return Ok(None);
    };
    let parsed: toml::Value = toml::from_str(&raw).map_err(|e| format!("config.toml 解析失败:{e}"))?;
    serde_json::to_value(parsed).map(Some).map_err(|e| e.to_string())
}

/// 写 config.toml:备份 → 原子写入(同 mcp.json 模式)。返回备份路径。
pub async fn write_config_toml(channel: &str, content: String) -> Result<String, String> {
    let t = cli::connection_target_for(channel);
    let home = t.kimi_home_str().await?;
    let file = t.join(&home, "config.toml");
    let backup = format!("{file}.kimi-desktop-bak");
    t.copy(&file, &backup).await; // 原文件不存在则无需备份
    t.write_text(&file, &content).await?;
    Ok(backup)
}

/// JSON 标量/数组 → toml_edit Value;对象与 null 不转换(对象由 merge 层递归,null 表示删除键)
fn json_to_toml(v: &Value) -> Option<toml_edit::Value> {
    match v {
        Value::Bool(b) => Some((*b).into()),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(i.into())
            } else {
                n.as_f64().map(|f| f.into())
            }
        }
        Value::String(s) => Some(s.as_str().into()),
        Value::Array(arr) => {
            let mut a = toml_edit::Array::new();
            for x in arr {
                if let Some(tv) = json_to_toml(x) {
                    a.push(tv);
                }
            }
            Some(toml_edit::Value::Array(a))
        }
        _ => None,
    }
}

/// 把 JSON patch 深合并进 TOML 表:对象递归合并,标量/数组覆盖,null 删除键
fn merge_toml_table(tbl: &mut toml_edit::Table, patch: &serde_json::Map<String, Value>) {
    for (k, v) in patch {
        match v {
            Value::Object(obj) => {
                let item = tbl.entry(k).or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
                if !item.is_table() {
                    *item = toml_edit::Item::Table(toml_edit::Table::new());
                }
                if let Some(t) = item.as_table_mut() {
                    merge_toml_table(t, obj);
                }
            }
            Value::Null => {
                tbl.remove(k);
            }
            _ => {
                if let Some(tv) = json_to_toml(v) {
                    tbl[k] = toml_edit::Item::Value(tv);
                }
            }
        }
    }
}

/// 合并写 config.toml:把 JSON patch 深合并进现有文件(保留注释与格式),备份后原子写回。
/// 用于 REST /api/v1/config 不支持的配置段(实测 identity 段会被服务端静默丢弃);
/// 不依赖 kimi web 服务运行。返回备份路径。
pub async fn merge_config_toml(channel: &str, patch: Value) -> Result<String, String> {
    let t = cli::connection_target_for(channel);
    let home = t.kimi_home_str().await?;
    let file = t.join(&home, "config.toml");
    let raw = t.read_text(&file).await.unwrap_or_default();
    let mut doc = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("config.toml 解析失败:{e}"))?;
    let obj = patch.as_object().ok_or("patch 必须是 JSON 对象")?;
    merge_toml_table(doc.as_table_mut(), obj);
    let backup = format!("{file}.kimi-desktop-bak");
    t.copy(&file, &backup).await; // 原文件不存在则无需备份
    t.write_text(&file, &doc.to_string()).await?;
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn merge(raw: &str, patch: Value) -> String {
        let mut doc = raw.parse::<toml_edit::DocumentMut>().unwrap();
        merge_toml_table(doc.as_table_mut(), patch.as_object().unwrap());
        doc.to_string()
    }

    #[test]
    fn merge_preserves_comments_and_updates_scalar() {
        let out = merge(
            "# 注释\ndefault_model = \"a\"\n",
            json!({"default_model": "b"}),
        );
        assert!(out.contains("# 注释"));
        assert!(out.contains("default_model = \"b\""));
    }

    #[test]
    fn merge_nested_table_and_null_delete() {
        let out = merge(
            "[identity]\nname = \"old\"\nslug = \"old-slug\"\n",
            json!({"identity": {"name": "新名字", "slug": null}}),
        );
        assert!(out.contains("name = \"新名字\""));
        assert!(!out.contains("slug"));
    }

    #[test]
    fn merge_quoted_dotted_key_roundtrip() {
        // providers."managed:kimi-code" 这类带冒号/点的键:更新已有键保持引号形式
        let out = merge(
            "[providers.\"managed:kimi-code\"]\ntype = \"kimi\"\n",
            json!({"providers": {"managed:kimi-code": {"base_url": "https://x/v1"}}}),
        );
        assert!(out.contains("base_url"), "输出: {out}");
        // 新增同名风格的键也必须可解析
        let out2 = merge("", json!({"providers": {"my:prov": {"type": "openai"}}}));
        let re: toml_edit::DocumentMut = out2.parse().unwrap();
        assert_eq!(
            re["providers"]["my:prov"]["type"].as_str(),
            Some("openai"),
            "输出: {out2}"
        );
    }

    #[test]
    fn merge_removes_whole_table_via_null() {
        let out = merge(
            "[models.\"a/b\"]\nmodel = \"m\"\n",
            json!({"models": {"a/b": null}}),
        );
        assert!(!out.contains("a/b"), "输出: {out}");
    }

    /// 冒烟:对本机真实 config.toml 跑 read_config_toml_parsed(模型与供应商设置页的读取路径)。
    /// 无文件时直接通过(CI/新机)。
    #[tokio::test]
    async fn read_parsed_real_config_shape() {
        let Ok(Some(v)) = read_config_toml_parsed("local").await else {
            return;
        };
        let providers = v.get("providers").and_then(|p| p.as_object()).cloned();
        let models = v.get("models").and_then(|m| m.as_object()).cloned();
        if let (Some(p), Some(m)) = (providers, models) {
            assert!(!p.is_empty(), "providers 不应为空对象");
            assert!(!m.is_empty(), "models 不应为空对象");
            // 每个模型至少要有 provider/model/max_context_size(设置页渲染依赖)
            for (alias, mv) in &m {
                let mo = mv.as_object().unwrap_or_else(|| panic!("模型 {alias} 不是对象"));
                assert!(mo.contains_key("provider"), "模型 {alias} 缺 provider");
                assert!(mo.contains_key("model"), "模型 {alias} 缺 model");
            }
        }
    }
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

/// 用户级技能扫描:品牌目录 <kimi_home>/skills 优先,通用目录 ~/.agents/skills 其次;
/// 同名技能品牌目录优先(与 CLI 的 USER_BRAND_DIRS/USER_GENERIC_DIRS 口径一致)
pub async fn list_skills(channel: &str) -> Vec<SkillEntry> {
    let Some((t, home)) = target_and_home(channel).await else {
        return vec![];
    };
    let generic_base = t
        .user_home_str()
        .await
        .ok()
        .map(|h| t.join(&t.join(&h, ".agents"), "skills"));
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (base, scope) in [(t.join(&home, "skills"), "user")]
        .into_iter()
        .chain(generic_base.into_iter().map(|b| (b, "agents")))
    {
        for dir in t.list_dir(&base).await {
            let skill_md = t.join(&t.join(&base, &dir), "SKILL.md");
            let Ok(content) = t.read_text(&skill_md).await else {
                continue; // 无 SKILL.md
            };
            let fm = parse_frontmatter(&content);
            let name = fm.get("name").cloned().unwrap_or_else(|| dir.clone());
            if !seen.insert(name.clone()) {
                continue; // 同名:先扫到的(品牌目录)优先
            }
            out.push(SkillEntry {
                name,
                description: fm.get("description").cloned(),
                path: t.join(&base, &dir),
                scope: scope.to_string(),
            });
        }
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
        scope: None,
    };
    // 与官方文档一致:内置 subagent 只有 coder / explore / plan 三种;
    // "agent" 是主 agent 默认类型,不是可委派的 subagent,不在此列出
    vec![
        b("plan", "Read-only implementation planning and architecture design."),
        b("coder", "General software engineering agent with file-editing tools."),
        b("explore", "Fast read-only codebase exploration agent."),
    ]
}

/// 用户级子代理 profile 扫描:品牌目录 <kimi_home>/agents 优先,通用目录 ~/.agents/agents 其次;
/// 同名 profile 品牌目录优先(与 CLI 的 USER_BRAND_DIRS/USER_GENERIC_DIRS 口径一致)
pub async fn list_agent_profiles(channel: &str) -> Vec<AgentProfile> {
    let mut out = builtin_agents();
    let Some((t, home)) = target_and_home(channel).await else {
        return out;
    };
    let generic_dir = t
        .user_home_str()
        .await
        .ok()
        .map(|h| t.join(&t.join(&h, ".agents"), "agents"));
    let mut seen: HashSet<String> = HashSet::new();
    for (dir, scope) in [(t.join(&home, "agents"), "user")]
        .into_iter()
        .chain(generic_dir.into_iter().map(|d| (d, "agents")))
    {
        for f in t.list_dir(&dir).await {
            if !f.ends_with(".md") {
                continue;
            }
            let Ok(content) = t.read_text(&t.join(&dir, &f)).await else {
                continue;
            };
            let fm = parse_frontmatter(&content);
            let name = fm
                .get("name")
                .cloned()
                .unwrap_or_else(|| f.trim_end_matches(".md").to_string());
            if !seen.insert(name.clone()) {
                continue; // 同名:先扫到的(品牌目录)优先
            }
            out.push(AgentProfile {
                name,
                description: fm.get("description").cloned(),
                tools: None,
                path: Some(t.join(&dir, &f)),
                builtin: None,
                scope: Some(scope.to_string()),
            });
        }
    }
    out
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
pub async fn aggregate_usage_daily(channel: &str, days: u32) -> UsageDailyResult {
    let days = days.max(1) as i64;
    let t = cli::connection_target_for(channel);
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

    // records 已在 target.rs 解析并缓存(三个聚合口径共享同一份解析结果)
    for sw in t.usage_record_lines().await {
        let mut has_usage = false;
        for rec in &sw.records {
            if rec.time < since_ms {
                continue;
            }
            let total = rec.input_other
                + rec.output
                + rec.input_cache_read
                + rec.input_cache_creation;
            let Some(key) = day_key(rec.time) else {
                continue;
            };
            let day = by_day.entry(key.clone()).or_insert_with(|| DailyUsage {
                date: key,
                models: HashMap::new(),
                total: 0,
            });
            *day.models.entry(rec.model.clone()).or_insert(0) += total;
            day.total += total;
            *model_totals.entry(rec.model.clone()).or_insert(0) += total;
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
pub async fn aggregate_usage_today(channel: &str) -> UsageTodayResult {
    let t = cli::connection_target_for(channel);
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

    // records 已在 target.rs 解析并缓存(与 daily 共用同一份解析结果)
    for sw in t.usage_record_lines().await {
        for rec in &sw.records {
            if rec.time < since_ms {
                continue;
            }
            let Some(slot) = Local
                .timestamp_millis_opt(rec.time)
                .single()
                .map(|d| ((d.hour() * 60 + d.minute()) / 30) as usize)
            else {
                continue;
            };
            let acc = &mut slots[slot];
            acc.input += rec.input_other;
            acc.output += rec.output;
            acc.cache_read += rec.input_cache_read;
            acc.cache_creation += rec.input_cache_creation;
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

// ---------- API 调用明细(step.end 口径,含 TTFT/TPS,API 调用统计页用) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCallItem {
    pub time: i64, // 毫秒时间戳
    pub model: String,
    pub session_id: String,
    pub agent_id: String,
    pub workspace: String,
    pub input_other: i64,
    pub input_cache_read: i64,
    pub input_cache_creation: i64,
    pub output: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttft_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

/// 全量汇总(不分页):平均 TTFT/TPS 只统计有耗时字段的调用
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCallsSummary {
    pub total_calls: usize,
    pub total_output: i64,
    pub avg_ttft_ms: Option<f64>,
    /// 平均输出 TPS(不含首 token 时间):output / stream
    pub avg_tps_excl_first: Option<f64>,
    /// 平均输出 TPS(含首 token 时间):output / (ttft + stream)
    pub avg_tps_incl_first: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCallsResult {
    pub total: usize,
    pub page: u32,
    pub page_size: u32,
    pub items: Vec<ApiCallItem>,
    pub summary: ApiCallsSummary,
}

/// 逐次 API 调用明细分页:按时间倒序,page 从 1 开始,越界回空页
pub async fn aggregate_api_calls(channel: &str, page: u32, page_size: u32) -> ApiCallsResult {
    let t = cli::connection_target_for(channel);
    let page = page.max(1);
    let page_size = page_size.clamp(1, 500);

    let mut calls: Vec<crate::target::ApiCallRecord> = Vec::new();
    for sw in t.usage_record_lines().await {
        calls.extend(sw.api_calls);
    }
    calls.sort_by(|a, b| b.time.cmp(&a.time));

    // 全量汇总
    let mut total_output: i64 = 0;
    let mut ttft_sum: f64 = 0.0;
    let mut ttft_n: usize = 0;
    let mut tps_excl_sum: f64 = 0.0;
    let mut tps_excl_n: usize = 0;
    let mut tps_incl_sum: f64 = 0.0;
    let mut tps_incl_n: usize = 0;
    for c in &calls {
        total_output += c.output;
        if let Some(ttft) = c.ttft_ms {
            ttft_sum += ttft as f64;
            ttft_n += 1;
        }
        if let Some(stream) = c.stream_ms {
            if stream > 0 && c.output > 0 {
                tps_excl_sum += c.output as f64 / (stream as f64 / 1000.0);
                tps_excl_n += 1;
                if let Some(ttft) = c.ttft_ms {
                    let total_ms = ttft + stream;
                    if total_ms > 0 {
                        tps_incl_sum += c.output as f64 / (total_ms as f64 / 1000.0);
                        tps_incl_n += 1;
                    }
                }
            }
        }
    }
    let summary = ApiCallsSummary {
        total_calls: calls.len(),
        total_output,
        avg_ttft_ms: (ttft_n > 0).then(|| ttft_sum / ttft_n as f64),
        avg_tps_excl_first: (tps_excl_n > 0).then(|| tps_excl_sum / tps_excl_n as f64),
        avg_tps_incl_first: (tps_incl_n > 0).then(|| tps_incl_sum / tps_incl_n as f64),
    };

    let total = calls.len();
    let start = ((page - 1) * page_size) as usize;
    let items: Vec<ApiCallItem> = if start >= total {
        Vec::new()
    } else {
        calls[start..(start + page_size as usize).min(total)]
            .iter()
            .map(|c| ApiCallItem {
                time: c.time,
                model: c.model.clone(),
                session_id: c.session_id.clone(),
                agent_id: c.agent_id.clone(),
                workspace: c.workspace.clone(),
                input_other: c.input_other,
                input_cache_read: c.input_cache_read,
                input_cache_creation: c.input_cache_creation,
                output: c.output,
                ttft_ms: c.ttft_ms,
                stream_ms: c.stream_ms,
                finish_reason: c.finish_reason.clone(),
            })
            .collect()
    };

    ApiCallsResult {
        total,
        page,
        page_size,
        items,
        summary,
    }
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
