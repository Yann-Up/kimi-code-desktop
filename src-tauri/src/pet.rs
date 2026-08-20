//! pet: 桌宠悬浮窗管理(实验性功能,默认关闭)。
//! 透明无边框置顶小窗,只渲染打包进前端的本地 spritesheet,不触网、不接触 token。
//! 窗口 label 固定 "pet";开关持久化在 desktop-config.json 的 pet_enabled 字段。
//!
//! 状态机(M2):ws.rs 的全量会话事件喂入 on_session_event,按会话聚合后
//! 只在状态跃迁时 emit pet:state(前端按状态切 spritesheet 行)。
//! 优先级:waiting(任一会话待审批/提问)> 一次性动作(jumping/failed)
//! > review(M4:review 子代理进行中)> running(任一有活跃 turn)> idle。
//! M4 另有 pet:tool 工具脉冲事件(同类 1s 节流,不进状态机)。规则详见 docs/desktop-pet-design.md。
//!
//! 宠物资产(M3):内置宠物硬编码;扫描 <kimi_home>/pets/*(source kimi-code)
//! 与 ~/.petdex/pets/*(source petdex)下的 pet.json,三种格式归一化为统一
//! PetMeta;外部精灵图经 pet:// 自定义协议(lib.rs 注册)按 slug 供图。

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 桌宠窗口 label(前端经 ?window=pet 识别并渲染 PetWindow)
pub const PET_WINDOW_LABEL: &str = "pet";
/// 窗口尺寸(逻辑像素):略大于 192x208 的精灵帧,底部留呼吸空间
const PET_WIDTH: f64 = 240.0;
const PET_HEIGHT: f64 = 250.0;

/// 桌宠是否启用(缺省关)
pub fn enabled(app: &AppHandle) -> bool {
    crate::config::load(app).pet_enabled.unwrap_or(false)
}

/// 创建并显示桌宠窗口(幂等:已存在则仅 show)
pub fn show(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = w.show();
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        PET_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=pet".into()),
    )
    .title("Kimi Pet")
    .inner_size(PET_WIDTH, PET_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    // 与主窗口一致:禁用系统拖拽导航,防止拖文件进窗导致 webview 跳转
    .disable_drag_drop_handler();
    // 默认落位主显示器右下角(留边距);position 取物理像素,需乘 scale_factor
    if let Ok(Some(m)) = app.primary_monitor() {
        let scale = m.scale_factor();
        let size = m.size();
        let origin = m.position();
        let x = origin.x as f64 + size.width as f64 - (PET_WIDTH + 48.0) * scale;
        let y = origin.y as f64 + size.height as f64 - (PET_HEIGHT + 96.0) * scale;
        builder = builder.position(x.max(origin.x as f64), y.max(origin.y as f64));
    }
    builder.build().map_err(|e| e.to_string())?;
    // 晚开的窗口补齐当前状态(等 webview 加载完再 emit,800ms 经验值)
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        emit_state(&app2, machine().lock().unwrap().state);
    });
    Ok(())
}

/// 关闭桌宠窗口(不存在则忽略)
pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = w.close();
    }
}

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/// 桌宠状态(与前端 PetState、spritesheet 状态行一一对应)
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PetState {
    Idle,
    Running,
    Waiting,
    Jumping,
    Failed,
    /// M4:会话中有 review 类子代理在跑(subagent.spawned 的 subagentName 含 "review")
    Review,
}

impl PetState {
    fn as_str(self) -> &'static str {
        match self {
            PetState::Idle => "idle",
            PetState::Running => "running",
            PetState::Waiting => "waiting",
            PetState::Jumping => "jumping",
            PetState::Failed => "failed",
            PetState::Review => "review",
        }
    }
}

/// 一次性动作(jumping/failed)的播放时长:播完回到基底状态
const ONESHOT_DURATION: Duration = Duration::from_millis(1500);
/// 泄漏清扫:长时间没有任何会话事件(volatile 帧也算活跃)而状态非 idle,
/// 说明事件流断过,强制复位。取 60s:静默长命令(sleep/build 等)期间没有任何
/// 事件是常态,阈值太短会把正常执行误判成断流(10s 实测误杀,06:49)。
/// 清扫只清 active_turns/oneshot,不清 waiting——审批挂起几分钟无事件也是常态
const STALE_TIMEOUT: Duration = Duration::from_secs(60);

struct Machine {
    state: PetState,
    /// 有活跃 turn 的会话(prompt.submitted/turn.started 进入,turn.ended/prompt.aborted 退出)
    active_turns: HashSet<String>,
    /// 有待审批/提问的会话(并集语义:全清空才退出 waiting)
    waiting: HashSet<String>,
    /// M4:进行中的 review 子代理(subagent.spawned 按 subagentId 进入,completed/failed/suspended 退出)
    review_agents: HashSet<String>,
    /// 一次性动作的结束时刻(jumping/failed 播 ONESHOT_DURATION)
    oneshot: Option<(PetState, Instant)>,
    /// 最近一次非 volatile 会话事件(泄漏清扫用)
    last_activity: Instant,
}

impl Machine {
    fn new() -> Self {
        Self {
            state: PetState::Idle,
            active_turns: HashSet::new(),
            waiting: HashSet::new(),
            review_agents: HashSet::new(),
            oneshot: None,
            last_activity: Instant::now(),
        }
    }

    /// 由聚合输入重算目标状态(waiting > 一次性动作 > review > running > idle)
    fn recompute(&mut self) -> PetState {
        let now = Instant::now();
        // 一次性动作到期即清除
        if let Some((_, until)) = self.oneshot {
            if now >= until {
                self.oneshot = None;
            }
        }
        let next = if !self.waiting.is_empty() {
            PetState::Waiting
        } else if let Some((s, _)) = self.oneshot {
            s
        } else if !self.review_agents.is_empty() {
            PetState::Review
        } else if !self.active_turns.is_empty() {
            PetState::Running
        } else {
            PetState::Idle
        };
        self.state = next;
        next
    }
}

static MACHINE: OnceLock<Mutex<Machine>> = OnceLock::new();

fn machine() -> &'static Mutex<Machine> {
    MACHINE.get_or_init(|| Mutex::new(Machine::new()))
}

/// 状态跃迁时广播(无 pet 窗口时无人监听,开销可忽略)
fn emit_state(app: &AppHandle, state: PetState) {
    let _ = app.emit("pet:state", state.as_str());
}

/// M4 工具脉冲广播:同类 kind 1s 节流合并(与状态机解耦,前端本地 oneshot 消费)
fn emit_tool(app: &AppHandle, kind: &str) {
    static LAST: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap();
        if let Some((k, t)) = &*last {
            if k == kind && t.elapsed() < Duration::from_secs(1) {
                return;
            }
        }
        *last = Some((kind.to_string(), Instant::now()));
    }
    let _ = app.emit("pet:tool", serde_json::json!({ "kind": kind }));
}

/// WS 会话事件入口(ws.rs handle_frame 每条会话事件都会调)。
/// 只改聚合集合,状态跃迁才 emit;tool.call.started 等高频事件天然被
/// "只在跃迁时 emit" 节流,无需额外计时器。
pub fn on_session_event(app: &AppHandle, ftype: &str, session_id: &str, evt: &serde_json::Map<String, Value>) {
    // M4 工具脉冲(差异化动作 + 气泡文案):独立 pet:tool 事件,不进主状态机
    // (oneshot 单槽会被高频工具事件打爆);载荷 display.kind 服务端 schema 已核实
    if ftype == "tool.call.started" {
        let kind = evt
            .get("display")
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str())
            .unwrap_or("other");
        emit_tool(app, kind);
    }
    let mut m = machine().lock().unwrap();
    // 任何会话事件(含 volatile 的 assistant.delta/thinking.delta)都证明流活着:
    // 长思考期间只有 volatile 帧,若不计活跃度会被 STALE 清扫误杀(06:49 实测)
    m.last_activity = Instant::now();
    // volatile 帧只刷活跃度,不参与状态驱动
    if evt.get("volatile").and_then(|v| v.as_bool()).unwrap_or(false) {
        return;
    }
    match ftype {
        "prompt.submitted" | "turn.started" | "tool.call.started" | "turn.step.started" => {
            m.active_turns.insert(session_id.to_string());
        }
        "event.approval.requested" => {
            m.waiting.insert(session_id.to_string());
        }
        "event.approval.resolved" => {
            m.waiting.remove(session_id);
        }
        "event.session.work_changed" => {
            match evt.get("pending_interaction").and_then(|v| v.as_str()) {
                Some("approval") | Some("question") => {
                    m.waiting.insert(session_id.to_string());
                }
                _ => {
                    m.waiting.remove(session_id);
                }
            }
        }
        "turn.ended" => {
            m.active_turns.remove(session_id);
            m.waiting.remove(session_id);
            // 失败/中断不庆祝:reason 含 error/fail → failed;含 abort/interrupt → 无动作
            let reason = evt
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            if reason.contains("error") || reason.contains("fail") {
                m.oneshot = Some((PetState::Failed, Instant::now() + ONESHOT_DURATION));
            } else if !reason.contains("abort") && !reason.contains("interrupt") {
                m.oneshot = Some((PetState::Jumping, Instant::now() + ONESHOT_DURATION));
            }
        }
        "prompt.aborted" => {
            m.active_turns.remove(session_id);
            m.waiting.remove(session_id);
        }
        // M4 review:subagentName 含 "review"(大小写不敏感)的子代理进入;
        // CLI 无内置 review profile,该名字来自用户/项目自定义子代理
        "subagent.spawned" => {
            let name = evt
                .get("subagentName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            if name.contains("review") {
                if let Some(id) = evt.get("subagentId").and_then(|v| v.as_str()) {
                    m.review_agents.insert(id.to_string());
                }
            }
        }
        "subagent.completed" | "subagent.failed" | "subagent.suspended" => {
            if let Some(id) = evt.get("subagentId").and_then(|v| v.as_str()) {
                m.review_agents.remove(id);
            }
        }
        "error" => {
            m.oneshot = Some((PetState::Failed, Instant::now() + ONESHOT_DURATION));
        }
        _ => {}
    }
    let next = m.recompute();
    drop(m);
    emit_if_changed(app, next);
}

/// recompute 前后的状态比较在锁内做不出(已写回),这里用"上次 emit 值"判跃迁
fn emit_if_changed(app: &AppHandle, next: PetState) {
    static LAST_EMITTED: Mutex<Option<PetState>> = Mutex::new(None);
    let mut last = LAST_EMITTED.lock().unwrap();
    if *last != Some(next) {
        *last = Some(next);
        emit_state(app, next);
    }
}

/// 启动后台巡检:一次性动作到期回基底;事件流断裂超 STALE_TIMEOUT 清扫
/// active_turns/oneshot(waiting 保留,审批可能长时间无事件)。应用 setup 时调用一次。
pub fn init(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let mut m = machine().lock().unwrap();
            let stale = m.last_activity.elapsed() > STALE_TIMEOUT;
            let oneshot_expired = m
                .oneshot
                .map(|(_, until)| Instant::now() >= until)
                .unwrap_or(false);
            if stale && m.state != PetState::Idle {
                // waiting 不清:审批可以长时间挂起而无任何事件
                m.active_turns.clear();
                m.review_agents.clear();
                m.oneshot = None;
            }
            if stale || oneshot_expired {
                let next = m.recompute();
                drop(m);
                emit_if_changed(&app, next);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// 宠物资产(M3):内置宠物 / 目录扫描 / 三种 pet.json 格式归一化
// 与前端 src/platform/kimi-api.ts 的 PetAnim/PetMeta/PetInfo 严格同形(camelCase)
// ---------------------------------------------------------------------------

/// 五状态 key(states 映射的固定键集,与 PetState 一一对应)
const STATE_KEYS: [&str; 5] = ["idle", "running", "waiting", "jumping", "failed"];

/// 单个状态的动画参数(serde camelCase;loop 是 Rust 关键字,字段名用 is_loop)
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetAnim {
    /// 精灵图内所在行(从 0 起)
    pub row: u32,
    /// 该行帧数
    pub frames: u32,
    /// 播放帧率
    pub fps: u32,
    /// 是否循环播放(false 播完停末帧)
    #[serde(rename = "loop")]
    pub is_loop: bool,
}

/// 宠物完整元信息(pet_active_get 返回;states 以五状态名为 key)
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetMeta {
    /// 唯一标识(内置为 "kimi",外部为目录名)
    pub slug: String,
    /// 展示名
    pub name: String,
    /// 来源:builtin(内置)/ kimi-code(~/.kimi-code/pets)/ petdex(~/.petdex/pets)
    pub source: String,
    /// 单帧宽度(px)
    pub frame_w: u32,
    /// 单帧高度(px)
    pub frame_h: u32,
    /// 各状态动画参数
    pub states: HashMap<String, PetAnim>,
}

impl PetMeta {
    /// 列表项形态(pet_list 用)
    pub fn info(&self) -> PetInfo {
        PetInfo {
            slug: self.slug.clone(),
            name: self.name.clone(),
            source: self.source.clone(),
        }
    }
}

/// 宠物列表项(pet_list 返回;内置排第一)
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetInfo {
    pub slug: String,
    pub name: String,
    pub source: String,
}

/// 默认内置宠物 slug(desktop-config.json 未设置 pet_slug 时的回退)
pub const BUILTIN_SLUG: &str = "kimi";

/// petdex 布局的九状态行映射(行序:idle,running-right,running-left,waving,
/// jumping,failed,waiting,running,review)。frames 按各宠物每行实际帧数声明;
/// 前端 detectFrames 会再按内容截断行尾空帧
fn petdex_states(frames: u32) -> HashMap<String, PetAnim> {
    let anim = |row: u32, fps: u32, is_loop: bool| PetAnim {
        row,
        frames,
        fps,
        is_loop,
    };
    HashMap::from([
        ("idle".to_string(), anim(0, 4, true)),
        ("running".to_string(), anim(7, 10, true)),
        ("waiting".to_string(), anim(6, 3, true)),
        ("jumping".to_string(), anim(4, 8, false)),
        ("failed".to_string(), anim(5, 4, true)),
        // M4:拖拽方向与 review;waving 留给点击交互(本地 oneshot)
        ("running-right".to_string(), anim(1, 10, true)),
        ("running-left".to_string(), anim(2, 10, true)),
        ("waving".to_string(), anim(3, 8, false)),
        ("review".to_string(), anim(8, 6, true)),
    ])
}

/// 内置宠物注册表(素材在 src/assets/pets/<slug>/ 下,前端 import.meta.glob 取图):
/// - kimi: Kimi 团子,192x208 帧、每行 7 帧(网格 8 列,第 8 列是首帧副本不参与播放)
/// - xiao-k: 小K,petdex 标准布局 8 帧/行(部分行只有 6 帧,由前端探测截断)
pub fn builtin_pets() -> Vec<PetMeta> {
    let meta = |slug: &str, name: &str, frames: u32| PetMeta {
        slug: slug.to_string(),
        name: name.to_string(),
        source: "builtin".to_string(),
        frame_w: 192,
        frame_h: 208,
        states: petdex_states(frames),
    };
    vec![meta("kimi", "Kimi 团子", 7), meta("xiao-k", "小K", 8), meta("maoniang", "猫娘", 8)]
}

/// 默认内置宠物(Kimi 团子)
pub fn builtin_pet() -> PetMeta {
    builtin_pets().into_iter().next().expect("内置宠物注册表为空")
}

/// slug 白名单校验:仅 [A-Za-z0-9_-],防路径穿越(pet:// 协议 handler 与扫描均用)
pub fn valid_slug(slug: &str) -> bool {
    // 允许 Unicode 字母/数字(支持中文文件名),仍拒绝 '.'、'/'、'\\' 等,防路径穿越
    !slug.is_empty()
        && slug
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
}

/// 宠物扫描根目录:扫描去重与协议取图共用此序(kimi-code 优先于 petdex)。
/// 不依赖 AppHandle(自定义协议 handler 里没有):kimi_home 走 cli 的现有 helper
fn scan_roots() -> [(PathBuf, &'static str); 2] {
    [
        (crate::cli::kimi_home().join("pets"), "kimi-code"),
        (crate::cli::home_dir().join(".petdex").join("pets"), "petdex"),
    ]
}

/// 从 JSON 值解析一条 PetAnim(缺字段/类型错返回 None)
fn anim_from_value(v: &Value) -> Option<PetAnim> {
    Some(PetAnim {
        row: v.get("row")?.as_u64()? as u32,
        frames: v.get("frames")?.as_u64()? as u32,
        fps: v.get("fps")?.as_u64()? as u32,
        is_loop: v.get("loop")?.as_bool()?,
    })
}

/// 格式一:原生 schema == "kimi-desktop-pet/1"
/// {schema, name, frameW, frameH, states{...}},states 值即 PetAnim,五状态缺一不可
fn parse_native(v: &Value, slug: &str, source: &str) -> Option<PetMeta> {
    let name = v.get("name")?.as_str()?.to_string();
    let frame_w = v.get("frameW")?.as_u64()? as u32;
    let frame_h = v.get("frameH")?.as_u64()? as u32;
    let states_v = v.get("states")?;
    let mut states = HashMap::new();
    for key in STATE_KEYS {
        states.insert(key.to_string(), anim_from_value(states_v.get(key)?)?);
    }
    Some(PetMeta {
        slug: slug.to_string(),
        name,
        source: source.to_string(),
        frame_w,
        frame_h,
        states,
    })
}

/// 格式二:schemaVersion == "kimi-pet.v0"(参考 github.com/FeiZhuLulu/kimi-pet)
/// animations 映射:idle→idle;thinking/tool_use/editing/terminal→running;
/// waiting_approval→waiting;success→jumping;error→failed;帧尺寸取 asset.cellWidth/cellHeight
fn parse_kimi_pet_v0(v: &Value, slug: &str, source: &str) -> Option<PetMeta> {
    let asset = v.get("asset")?;
    let frame_w = asset.get("cellWidth")?.as_u64()? as u32;
    let frame_h = asset.get("cellHeight")?.as_u64()? as u32;
    let name = v
        .get("displayName")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("id").and_then(|x| x.as_str()))
        .unwrap_or(slug)
        .to_string();
    let anims = v.get("animations")?;
    // 同一目标状态多个候选动画时,按给定顺序取第一个可用的
    let pick = |keys: &[&str]| {
        keys.iter()
            .find_map(|k| anims.get(k).and_then(anim_from_value))
    };
    let mut states = HashMap::new();
    states.insert("idle".to_string(), pick(&["idle"])?);
    states.insert(
        "running".to_string(),
        pick(&["thinking", "tool_use", "editing", "terminal"])?,
    );
    states.insert("waiting".to_string(), pick(&["waiting_approval"])?);
    states.insert("jumping".to_string(), pick(&["success"])?);
    states.insert("failed".to_string(), pick(&["error"])?);
    Some(PetMeta {
        slug: slug.to_string(),
        name,
        source: source.to_string(),
        frame_w,
        frame_h,
        states,
    })
}

/// 格式三(无格式标记):petdex 布局兜底 —— 192x208 帧、每行 8 帧、
/// 固定行序 idle,running-right,running-left,waving,jumping,failed,waiting,running,review;
/// 直接复用内置宠物的 states(行序一致,M4 起九状态全映射)
fn petdex_fallback(v: &Value, slug: &str, source: &str) -> PetMeta {
    let name = v
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or(slug)
        .to_string();
    PetMeta {
        slug: slug.to_string(),
        name,
        source: source.to_string(),
        frame_w: 192,
        frame_h: 208,
        // 按满网格声明 8 帧,行尾空帧由前端 detectFrames 截断
        states: petdex_states(8),
    }
}

/// 解析单个宠物目录的 pet.json 为 PetMeta;解析失败(无 pet.json / JSON 坏 / 缺关键字段)返回 None
fn parse_pet_dir(dir: &std::path::Path, slug: &str, source: &str) -> Option<PetMeta> {
    let raw = std::fs::read_to_string(dir.join("pet.json")).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    if v.get("schema").and_then(|x| x.as_str()) == Some("kimi-desktop-pet/1") {
        parse_native(&v, slug, source)
    } else if v.get("schemaVersion").and_then(|x| x.as_str()) == Some("kimi-pet.v0") {
        parse_kimi_pet_v0(&v, slug, source)
    } else {
        Some(petdex_fallback(&v, slug, source))
    }
}

/// 扫描外部宠物:kimi-code 目录优先(同 slug 去重),坏条目跳过不致命。
/// 不含内置宠物(由 pet_list 命令拼装时排第一)
pub fn scan_pets() -> Vec<PetMeta> {
    let mut out: Vec<PetMeta> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (root, source) in scan_roots() {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if !ft.is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().into_owned();
            if !valid_slug(&slug) || seen.contains(&slug) {
                continue;
            }
            if let Some(meta) = parse_pet_dir(&entry.path(), &slug, source) {
                seen.insert(slug);
                out.push(meta);
            }
        }
    }
    out
}

/// 按 slug 解析宠物元信息:内置注册表直接返回;外部在扫描结果中找,找不到回退默认内置
pub fn resolve_pet(slug: &str) -> PetMeta {
    if let Some(p) = builtin_pets().into_iter().find(|p| p.slug == slug) {
        return p;
    }
    scan_pets()
        .into_iter()
        .find(|p| p.slug == slug)
        .unwrap_or_else(builtin_pet)
}

/// 当前激活宠物 slug(desktop-config.json 的 pet_slug,缺省/未设置为内置)
pub fn active_slug(app: &AppHandle) -> String {
    crate::config::load(app)
        .pet_slug
        .unwrap_or_else(|| BUILTIN_SLUG.to_string())
}

/// 按 slug 读取外部宠物精灵图(优先 spritesheet.webp,其次 spritesheet.png;
/// 目录查找顺序与扫描一致:kimi-code 优先)。返回字节与 mime,找不到返回 None
pub fn load_spritesheet(slug: &str) -> Option<(Vec<u8>, &'static str)> {
    // 内置宠物的图打包在前端资产里(import.meta.glob),不走 pet:// 协议
    if !valid_slug(slug) || builtin_pets().iter().any(|p| p.slug == slug) {
        return None;
    }
    for (root, _) in scan_roots() {
        let dir = root.join(slug);
        for (name, mime) in [
            ("spritesheet.webp", "image/webp"),
            ("spritesheet.png", "image/png"),
        ] {
            let path = dir.join(name);
            if path.is_file() {
                return std::fs::read(&path).ok().map(|bytes| (bytes, mime));
            }
        }
    }
    None
}
