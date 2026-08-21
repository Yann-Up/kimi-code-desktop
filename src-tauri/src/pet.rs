//! pet: 桌宠悬浮窗管理(实验性功能,默认关闭)。
//! 透明无边框置顶小窗,只渲染打包进前端的本地 spritesheet,不触网、不接触 token。
//! 窗口 label 固定 "pet";开关持久化在 desktop-config.json 的 pet_enabled 字段,
//! 点击穿透在 pet_click_through(开启后窗口忽略鼠标事件,只能到设置页关闭)。
//!
//! 状态机(M2):ws.rs 的全量会话事件喂入 on_session_event,按会话聚合后
//! 只在状态跃迁时 emit pet:state(前端按状态切 spritesheet 行)。
//! 优先级:waiting(任一会话待审批/提问)> 一次性动作(jumping/failed)
//! > review(M4:review 子代理进行中)> running(任一有活跃 turn)> idle。
//! M4 另有 pet:tool 工具脉冲事件(同类 1s 节流,不进状态机)。规则详见 docs/desktop-pet-design.md。
//! M5 P2 信息型气泡 pet:bubble { text, tone }:turn 概要(turn.ended 成功)、
//! 审批详情(event.approval.requested)、配额提醒(ws.rs 周期任务调 quota_remind);
//! 同类 2s 合并、全局 1s 限流,见 emit_bubble。
//! M5 P4 子代理小跟班:全部活跃子代理计入 active_subagents(subagent.spawned
//! 不再按名称过滤),数量变化时广播 pet:minions { count }(归零也发一次);
//! review 状态仍按 name 含 "review" 从该集合派生,M4 优先级语义不变。
//! M5 P5 时间维度:running 持续超 3min 显示为 tired、无事件 idle 超 5min 显示为
//! sleep(均为显示态,优先级位不变;内置宠物无对应状态行,前端 resolveAnim 回退
//! running/idle);闲置散步由前端定时器驱动,经 pet_nudge 命令挪窗(见 lib.rs)。
//!
//! 宠物资产(M3):内置宠物硬编码;扫描 <config_dir>/pets/*(source custom,与 skins
//! 目录同级;导入的宠物落这里)、<kimi_home>/pets/*(source kimi-code,兼容旧布局)
//! 与 ~/.petdex/pets/*(source petdex)下的 pet.json,三种格式归一化为统一
//! PetMeta;外部精灵图经 pet:// 自定义协议(lib.rs 注册)按 slug 供图。
//!
//! 悬浮菜单(M5 P3):label "pet-menu" 的浮层窗口(menu_show/hide/toggle),
//! 锚定**角色视觉头顶**(按激活宠物 frame 高换算)居中,失焦自动收起(hide 保留
//! 状态);钉选会话持久化在 desktop-config.json 的 menu_pinned_sessions(命令见
//! lib.rs)。M6 视觉归一:菜单即"宠物的大气泡",show/hide 广播 pet:menu-visible
//! {visible},PetWindow 据此压制气泡(互斥,避免三层叠加)。

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

/// 点击穿透是否开启(缺省关):开启后悬浮窗忽略所有鼠标事件
pub fn click_through(app: &AppHandle) -> bool {
    crate::config::load(app).pet_click_through.unwrap_or(false)
}

/// 对已存在的桌宠窗应用点击穿透设置(窗口不存在时忽略,建窗时会在 show 里补)
pub fn apply_click_through(app: &AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = w.set_ignore_cursor_events(on);
    }
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
    // 建窗时补齐点击穿透(设置页/右键菜单改动走 apply_click_through)
    apply_click_through(app, click_through(app));
    // 晚开的窗口补齐当前状态(等 webview 加载完再 emit,800ms 经验值)
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        emit_state(&app2, machine().lock().unwrap().state);
    });
    Ok(())
}

/// 关闭桌宠窗口(不存在则忽略);悬浮菜单(M5 P3)一并收起
pub fn hide(app: &AppHandle) {
    menu_hide(app);
    if let Some(w) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = w.close();
    }
}

// ---------------------------------------------------------------------------
// 悬浮菜单(M5 P3):pet-menu 浮层窗口
// 透明无边框置顶,位于宠物窗上方居中;focused(true)(菜单有搜索框要输入)。
// 失焦自动收起(hide 不 close,保留前端搜索词等状态)。
// ---------------------------------------------------------------------------

/// 悬浮菜单窗口 label(前端经 ?window=pet-menu 识别并渲染 PetMenu)
pub const MENU_WINDOW_LABEL: &str = "pet-menu";
/// 菜单尺寸(逻辑像素):会话列表 + 底部快捷行
const MENU_WIDTH: f64 = 380.0;
const MENU_HEIGHT: f64 = 460.0;

/// 菜单与角色头顶的间距(逻辑像素):留给卡片尾巴,贴脸但不压住 sprite
const MENU_GAP: f64 = 3.0;

/// 菜单位置(物理像素):底边贴**角色视觉头顶**(非 pet 窗顶边)、水平居中。
/// sprite 在 pet 窗内水平居中、底边贴窗底,高 frame_h 逻辑 px(取当前激活宠物
/// 的 PetMeta,解析不到时 resolve_pet 回退内置 208),故头顶物理 y =
/// 窗顶 + 窗高 - frame_h*scale。pet 不在时落主显示器右下角(与 pet::show 落位
/// 一致);最后 clamp 进显示器范围——上方空间不够时菜单顶贴屏幕上沿,宁可盖住
/// 角色头顶也不裁菜单本身
fn menu_position(app: &AppHandle) -> Option<(f64, f64)> {
    let m = app.primary_monitor().ok().flatten()?;
    let scale = m.scale_factor();
    let size = m.size();
    let origin = m.position();
    let menu_w = MENU_WIDTH * scale;
    let menu_h = MENU_HEIGHT * scale;
    let (mut x, mut y) = match app.get_webview_window(PET_WINDOW_LABEL) {
        Some(p) => {
            let pos = p.outer_position().ok()?;
            let pet_size = p.outer_size().ok()?;
            // 混合 DPI 多显示器时 pet 窗缩放未必等于主显示器,用窗自身的
            let pet_scale = p.scale_factor().unwrap_or(scale);
            let frame_h = resolve_pet(&active_slug(app)).frame_h as f64;
            let head_top = pos.y as f64 + pet_size.height as f64 - frame_h * pet_scale;
            (
                pos.x as f64 + (pet_size.width as f64 - menu_w) / 2.0,
                head_top - menu_h - MENU_GAP * scale,
            )
        }
        None => (
            origin.x as f64 + size.width as f64 - menu_w - 48.0 * scale,
            origin.y as f64 + size.height as f64 - menu_h - 96.0 * scale,
        ),
    };
    x = x.clamp(
        origin.x as f64,
        origin.x as f64 + (size.width as f64 - menu_w).max(0.0),
    );
    y = y.clamp(
        origin.y as f64,
        origin.y as f64 + (size.height as f64 - menu_h).max(0.0),
    );
    Some((x, y))
}

/// M6 菜单可见性广播(pet:menu-visible {visible},无敏感信息):
/// PetWindow 据此在菜单开着期间压制气泡(菜单本身就是"宠物的大气泡")
fn emit_menu_visible(app: &AppHandle, visible: bool) {
    let _ = app.emit("pet:menu-visible", serde_json::json!({ "visible": visible }));
}

/// 创建并显示悬浮菜单(幂等:已存在则重新落位 + show + 聚焦)
pub fn menu_show(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MENU_WINDOW_LABEL) {
        if let Some((x, y)) = menu_position(app) {
            let _ = w.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
        let _ = w.show();
        let _ = w.set_focus();
        emit_menu_visible(app, true);
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        MENU_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=pet-menu".into()),
    )
    .title("Kimi Pet Menu")
    .inner_size(MENU_WIDTH, MENU_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    // 菜单要接收键盘输入(搜索框),必须可抢焦
    .focused(true)
    .disable_drag_drop_handler();
    if let Some((x, y)) = menu_position(app) {
        builder = builder.position(x, y);
    }
    let w = builder.build().map_err(|e| e.to_string())?;
    // 失焦自动收起:hide 不 close,前端状态(搜索词/滚动位)得以保留。
    // 建窗抢焦过程中可能闪过一次 Focused(false),只有真正获得过焦点后的
    // 失焦才算"用户离开",避免刚弹出就被误收起
    let ever_focused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = ever_focused.clone();
    let app2 = app.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(focused) = event {
            if *focused {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
            } else if flag.load(std::sync::atomic::Ordering::SeqCst) {
                menu_hide(&app2);
            }
        }
    });
    emit_menu_visible(app, true);
    Ok(())
}

/// 收起悬浮菜单(hide 不 close;不存在则忽略,幂等无错)
pub fn menu_hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MENU_WINDOW_LABEL) {
        let _ = w.hide();
        emit_menu_visible(app, false);
    }
}

/// 悬浮菜单开关:可见则收起,否则展开
pub fn menu_toggle(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MENU_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            menu_hide(app);
            return Ok(());
        }
    }
    menu_show(app)
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
    /// M5 P5:running 持续超 TIRED_AFTER 的显示态(与 running 同优先级位,
    /// 仅显示名不同;内置宠物无该状态行,前端 resolveAnim 回退 running)
    Tired,
    /// M5 P5:idle 持续超 SLEEP_AFTER 的显示态(任一事件活动后回 idle;
    /// 前端回退 idle 行)
    Sleep,
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
            PetState::Tired => "tired",
            PetState::Sleep => "sleep",
        }
    }
}

/// 一次性动作(jumping/failed)的播放时长:播完回到基底状态
const ONESHOT_DURATION: Duration = Duration::from_millis(1500);
/// 泄漏清扫:长时间没有任何会话事件(volatile 帧也算活跃)而状态非 idle,
/// 说明事件流断过,强制复位。取 60s:静默长命令(sleep/build 等)期间没有任何
/// 事件是常态,阈值太短会把正常执行误判成断流(10s 实测误杀,06:49)。
/// 清扫只清 active_turns/active_subagents/oneshot,不清 waiting——审批挂起几分钟
/// 无事件也是常态
const STALE_TIMEOUT: Duration = Duration::from_secs(60);
/// M5 P5 时间维度:任一会话的 turn 连续运行超此时长,running 显示为 tired(毫秒,
/// 与 TurnTrack.start_ts 同为事件时间戳口径)
const TIRED_AFTER_MS: u64 = 3 * 60 * 1000;
/// M5 P5:无任何会话事件超此时长,idle 显示为 sleep(任一事件刷新 last_activity 后回 idle)
const SLEEP_AFTER: Duration = Duration::from_secs(5 * 60);

/// M5 P2:按会话跟踪 turn 概要(开始时刻 + 工具计数),turn.ended 成功时组气泡文案
#[derive(Default)]
struct TurnTrack {
    /// 首个 prompt.submitted/turn.started/tool.call.started 的毫秒时间戳
    start_ts: Option<u64>,
    /// 本 turn 内 tool.call.started 累计
    tool_count: u32,
}

struct Machine {
    state: PetState,
    /// 有活跃 turn 的会话(prompt.submitted/turn.started 进入,turn.ended/prompt.aborted 退出)
    active_turns: HashSet<String>,
    /// 有待审批/提问的会话(并集语义:全清空才退出 waiting)
    waiting: HashSet<String>,
    /// M4→M5 P4:进行中的全部子代理,subagentId → subagentName(小写);
    /// spawned 一律进入,completed/failed/suspended 按 id 退出。
    /// review 状态判定 = 集合中任一 name 含 "review"(保留 M4 语义);
    /// 集合大小即小跟班数量(pet:minions 载荷)。用单个 HashMap 而非两个集合,
    /// 避免 review 集与全集的配对移除逻辑漂移
    active_subagents: HashMap<String, String>,
    /// M5 P2:各活跃会话的 turn 概要跟踪(turn.ended/prompt.aborted/泄漏清扫时清除)
    turn_tracks: HashMap<String, TurnTrack>,
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
            active_subagents: HashMap::new(),
            turn_tracks: HashMap::new(),
            oneshot: None,
            last_activity: Instant::now(),
        }
    }

    /// 由聚合输入重算目标状态(waiting > 一次性动作 > review > running > idle)。
    /// M5 P5 时间维度:running 位按 turn 时长细分 tired,idle 位按静默时长细分 sleep;
    /// 两者只是显示态,不改变上方高优先级语义,持续时间条件消失后自然回落
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
        } else if self.active_subagents.values().any(|n| n.contains("review")) {
            PetState::Review
        } else if !self.active_turns.is_empty() {
            // tired:任一在跑会话的 turn 起始时间戳(start_ts 缺失按未超时处理)
            // 距今超 TIRED_AFTER_MS;巡检循环每 500ms 重算,到点自动切换
            let now_ms = now_ms();
            let tired = self
                .active_turns
                .iter()
                .filter_map(|sid| self.turn_tracks.get(sid).and_then(|t| t.start_ts))
                .any(|start| now_ms.saturating_sub(start) > TIRED_AFTER_MS);
            if tired {
                PetState::Tired
            } else {
                PetState::Running
            }
        } else if self.last_activity.elapsed() > SLEEP_AFTER {
            PetState::Sleep
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

/// M5 P4 小跟班计数广播 { count }:仅在活跃子代理数变化(含清扫归零)时
/// 由调用方触发;spawn/complete 非高频事件,无需节流
fn emit_minions(app: &AppHandle, count: usize) {
    let _ = app.emit("pet:minions", serde_json::json!({ "count": count }));
}

/// M5 P2 信息型气泡广播 { text, tone }:同类(category)2s 内合并;
/// 不同类可插队,但全局 1s 内最多一条(防刷屏)。照 emit_tool 模式
fn emit_bubble(app: &AppHandle, category: &str, text: &str, tone: &str) {
    static LAST: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap();
        if let Some((c, t)) = &*last {
            let elapsed = t.elapsed();
            if elapsed < Duration::from_secs(1)
                || (c == category && elapsed < Duration::from_secs(2))
            {
                return;
            }
        }
        *last = Some((category.to_string(), Instant::now()));
    }
    let _ = app.emit("pet:bubble", serde_json::json!({ "text": text, "tone": tone }));
}

/// 当前毫秒时间戳(tired 判定用;与事件时间戳同一 epoch 口径,取不到按 0)
fn now_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0)
}

/// 事件毫秒时间戳(M5 P2):优先载荷 time 字段(新版服务端,毫秒),
/// 回退帧顶层 ISO timestamp;都取不到返回 None
fn evt_time_ms(evt: &serde_json::Map<String, Value>) -> Option<u64> {
    if let Some(ms) = evt.get("time").and_then(|v| v.as_u64()) {
        return Some(ms);
    }
    let s = evt.get("timestamp").and_then(|v| v.as_str())?;
    let ms = chrono::DateTime::parse_from_rfc3339(s).ok()?.timestamp_millis();
    u64::try_from(ms).ok()
}

/// M5 P2 配额提醒(ws.rs 周期任务调用):用量占比(0-100)达阈值时发 pet:bubble;
/// 每档每自然日(本地时区,项目约定)只提醒一次
pub fn quota_remind(app: &AppHandle, pct: f64) {
    let (tier, text, tone) = if pct >= 95.0 {
        (95u32, "额度快没了!", "warn")
    } else if pct >= 80.0 {
        (80u32, "额度用了八成多了", "info")
    } else {
        return;
    };
    // 每档一个静态槽(HashMap::new 非 const 不能进 static),存上次提醒的自然日
    static REMINDED_80: Mutex<Option<chrono::NaiveDate>> = Mutex::new(None);
    static REMINDED_95: Mutex<Option<chrono::NaiveDate>> = Mutex::new(None);
    let today = chrono::Local::now().date_naive();
    let slot = if tier == 95 { &REMINDED_95 } else { &REMINDED_80 };
    {
        let mut r = slot.lock().unwrap();
        if *r == Some(today) {
            return;
        }
        *r = Some(today);
    }
    emit_bubble(app, "quota", text, tone);
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
    // M5 P2 待发的信息型气泡(text, tone, category);锁内只组文案,emit 在锁外做
    let mut bubble: Option<(String, &'static str, &'static str)> = None;
    // M5 P4 待广播的小跟班计数(活跃子代理数变化时取新值,含归零)
    let mut minions: Option<usize> = None;
    match ftype {
        "prompt.submitted" | "turn.started" | "tool.call.started" | "turn.step.started" => {
            m.active_turns.insert(session_id.to_string());
            // M5 P2 turn 概要跟踪:首个事件记 start_ts;tool.call.started 累计工具数
            // (turn.step.started 只是步骤粒度,不参与)
            if ftype != "turn.step.started" {
                let track = m.turn_tracks.entry(session_id.to_string()).or_default();
                if track.start_ts.is_none() {
                    track.start_ts = evt_time_ms(evt);
                }
                if ftype == "tool.call.started" {
                    track.tool_count += 1;
                }
            }
        }
        "event.approval.requested" => {
            // M5 P2 审批详情气泡:同会话已在 waiting(连续多个审批)不重复发。
            // 详情字段实测(08-21,server/events jsonl):tool_input_display.command
            // (kind=command 的命令详情)→ action("Running: xxx")→ tool_name,全缺回退固定文案
            if !m.waiting.contains(session_id) {
                let detail = evt
                    .get("tool_input_display")
                    .and_then(|d| d.get("command"))
                    .and_then(|v| v.as_str())
                    .or_else(|| evt.get("action").and_then(|v| v.as_str()))
                    .or_else(|| evt.get("tool_name").and_then(|v| v.as_str()));
                let text = match detail.map(str::trim).filter(|d| !d.is_empty()) {
                    Some(d) => {
                        let truncated: String = d.chars().take(40).collect();
                        let ellipsis = if d.chars().count() > 40 { "…" } else { "" };
                        format!("想执行 `{truncated}{ellipsis}`?")
                    }
                    None => "等你审批".to_string(),
                };
                bubble = Some((text, "info", "approval"));
            }
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
            let track = m.turn_tracks.remove(session_id);
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
                // M5 P2 turn 概要气泡:耗时优先取载荷 durationMs(实测存在),
                // 缺省回退 start→ended 帧时间差;tool_count 为 0 时省略工具数
                let duration_ms = evt
                    .get("durationMs")
                    .and_then(|v| v.as_u64())
                    .or_else(|| {
                        let start = track.as_ref().and_then(|t| t.start_ts)?;
                        let end = evt_time_ms(evt)?;
                        Some(end.saturating_sub(start))
                    });
                let tools = track.map(|t| t.tool_count).unwrap_or(0);
                if let Some(ms) = duration_ms {
                    let secs = ms / 1000;
                    let dur = if secs >= 60 {
                        format!("{} 分 {} 秒", secs / 60, secs % 60)
                    } else {
                        format!("{secs} 秒")
                    };
                    let text = if tools > 0 {
                        format!("{dur} · {tools} 个工具,搞定!")
                    } else {
                        format!("{dur},搞定!")
                    };
                    bubble = Some((text, "info", "turn"));
                }
            }
        }
        "prompt.aborted" => {
            m.active_turns.remove(session_id);
            m.waiting.remove(session_id);
            m.turn_tracks.remove(session_id);
        }
        // M5 P4 子代理小跟班:spawned 一律入集(M4 的 review 名称过滤取消,
        // review 状态改由 recompute 按 name 派生);名字存小写省去判定时的重复转换。
        // CLI 无内置 review profile,该名字来自用户/项目自定义子代理
        "subagent.spawned" => {
            if let Some(id) = evt.get("subagentId").and_then(|v| v.as_str()) {
                let name = evt
                    .get("subagentName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_lowercase();
                let before = m.active_subagents.len();
                m.active_subagents.insert(id.to_string(), name);
                if m.active_subagents.len() != before {
                    minions = Some(m.active_subagents.len());
                }
            }
        }
        "subagent.completed" | "subagent.failed" | "subagent.suspended" => {
            if let Some(id) = evt.get("subagentId").and_then(|v| v.as_str()) {
                if m.active_subagents.remove(id).is_some() {
                    minions = Some(m.active_subagents.len());
                }
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
    // M5 P2 信息型气泡在状态跃迁 emit 之后发:前端单槽气泡后到者优先,
    // 审批详情得以覆盖 waiting 跃迁的通用文案(jumping 通用文案前端已摘除)
    if let Some((text, tone, category)) = bubble {
        emit_bubble(app, category, &text, tone);
    }
    // M5 P4 小跟班计数广播:归零也发,让前端清掉 overlay
    if let Some(count) = minions {
        emit_minions(app, count);
    }
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
/// active_turns/oneshot(waiting 保留,审批可能长时间无事件);
/// M5 P5 时长类显示态(running→tired、idle→sleep)也靠本循环每 tick 重算驱动。
/// 应用 setup 时调用一次。
pub fn init(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let mut m = machine().lock().unwrap();
            let stale = m.last_activity.elapsed() > STALE_TIMEOUT;
            // M5 P4:子代理集合被清扫时归零广播(锁内只记标志,emit 在锁外)
            let mut minions: Option<usize> = None;
            // sleep 与 idle 同为"无活动"显示态,不触发清扫(集合本就为空)
            if stale && !matches!(m.state, PetState::Idle | PetState::Sleep) {
                // waiting 不清:审批可以长时间挂起而无任何事件
                m.active_turns.clear();
                if !m.active_subagents.is_empty() {
                    m.active_subagents.clear();
                    minions = Some(0);
                }
                m.turn_tracks.clear();
                m.oneshot = None;
            }
            // 每 tick 无条件重算:tired/sleep 是时长驱动的显示态,无新事件也要到点切换
            // (emit_if_changed 挡重发,常态无事件时开销可忽略)
            let next = m.recompute();
            drop(m);
            emit_if_changed(&app, next);
            if let Some(count) = minions {
                emit_minions(&app, count);
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

/// 用户宠物目录(<config_dir>/pets,与 skins 目录同级;config 目录未初始化返回 None)。
/// 后续"自定义数据存储路径"功能落地时,此处随 config::config_dir 的解析一并切换
pub fn custom_pets_dir() -> Option<PathBuf> {
    crate::config::config_dir().map(|d| d.join("pets"))
}

/// 宠物扫描根目录:应用数据目录(custom,导入的宠物落这里)优先,其后 kimi-code 数据
/// 目录(兼容旧布局)与 petdex 社区目录;扫描去重与协议取图共用此序。
/// 不依赖 AppHandle(自定义协议 handler 里没有):config_dir 走 config 模块的全局缓存
fn scan_roots() -> Vec<(PathBuf, &'static str)> {
    let mut roots: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Some(d) = custom_pets_dir() {
        roots.push((d, "custom"));
    }
    roots.push((crate::cli::kimi_home().join("pets"), "kimi-code"));
    roots.push((crate::cli::home_dir().join(".petdex").join("pets"), "petdex"));
    roots
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

/// 取展示名:name → displayName(部分宠物包如 kimi-pet.v0 用此字段)→ 调用方兜底 slug
fn pet_name(v: &Value) -> Option<String> {
    v.get("name")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("displayName").and_then(|x| x.as_str()))
        .map(|s| s.to_string())
}

/// 格式一:原生 schema == "kimi-desktop-pet/1"
/// {schema, name, frameW, frameH, states{...}},states 值即 PetAnim,五状态缺一不可
fn parse_native(v: &Value, slug: &str, source: &str) -> Option<PetMeta> {
    let name = pet_name(v)?;
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
    let name = pet_name(v)
        .or_else(|| v.get("id").and_then(|x| x.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| slug.to_string());
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
    let name = pet_name(v).unwrap_or_else(|| slug.to_string());
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

/// 从 zip 字节导入宠物包到 <config_dir>/pets/<slug>/。
/// slug 决策:先读包内 pet.json 的标识字段(slug → id → displayName → name),
/// zip 文件名只作兜底——petdex 下载的包文件名都叫 zip.zip,按文件名命名会互相撞车。
/// 候选清洗规则:非法字符折成 '-',两端 '-' 去掉,首个清洗后合法的候选生效。
/// 包内定位 pet.json 与精灵图(可在根或单层/多层子目录,取最浅的一份);只解这三个文件,
/// 条目经 enclosed_name 过滤防 zip slip。无 pet.json 但有精灵图时按 petdex 布局兜底生成
/// 最小 pet.json;落盘后过一遍 parse_pet_dir 校验,失败清目录报错。同名目录已存在则拒绝
pub fn import_zip(zip_name: &str, bytes: &[u8]) -> Result<PetInfo, String> {
    const MAX_BYTES: usize = 32 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err("宠物包过大(上限 32MB)".to_string());
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("zip 解析失败: {e}"))?;
    const WANTED: [&str; 3] = ["pet.json", "spritesheet.webp", "spritesheet.png"];
    let split_entry = |f: &zip::read::ZipFile| -> Option<(String, String)> {
        let path = f.enclosed_name()?; // 过滤路径穿越
        let name = path.to_string_lossy().replace('\\', "/");
        let (prefix, file) = match name.rsplit_once('/') {
            Some((d, f)) => (d.to_string(), f.to_lowercase()),
            None => (String::new(), name.to_lowercase()),
        };
        Some((prefix, file))
    };
    // 第一遍:登记 目标文件名(小写)→ 所在目录前缀(根为 ""),供前缀决策
    let mut found: Vec<(String, String)> = Vec::new();
    for i in 0..archive.len() {
        let Ok(f) = archive.by_index(i) else {
            continue;
        };
        if let Some((prefix, file)) = split_entry(&f) {
            if WANTED.contains(&file.as_str()) {
                found.push((file, prefix));
            }
        }
    }
    // 前缀决策:pet.json 优先(取目录层级最浅的一份);没有 pet.json 则看精灵图
    let shallowest = |file_prefix: &str| {
        found
            .iter()
            .filter(|(f, _)| f == file_prefix || file_prefix.is_empty() && f.starts_with("spritesheet"))
            .min_by_key(|(_, p)| p.matches('/').count())
            .map(|(_, p)| p.clone())
    };
    let prefix = shallowest("pet.json")
        .or_else(|| shallowest(""))
        .ok_or_else(|| "包内未找到 pet.json 或精灵图(spritesheet.webp/png)".to_string())?;
    // slug 候选:目标前缀下 pet.json 的标识字段;zip 文件名最后兜底
    let mut candidates: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let Ok(mut f) = archive.by_index(i) else {
            continue;
        };
        let Some((p, file)) = split_entry(&f) else {
            continue;
        };
        if p != prefix || file != "pet.json" {
            continue;
        }
        let mut content = Vec::new();
        if std::io::Read::read_to_end(&mut f, &mut content).is_err() {
            break;
        }
        if let Ok(v) = serde_json::from_slice::<Value>(&content) {
            for key in ["slug", "id", "displayName", "name"] {
                if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
                    candidates.push(s.to_string());
                }
            }
        }
        break;
    }
    let stem = std::path::Path::new(zip_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| zip_name.to_string());
    candidates.push(stem);
    let sanitize = |s: &str| -> String {
        s.chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>()
            .trim_matches('-')
            .to_string()
    };
    let slug = candidates
        .iter()
        .map(|c| sanitize(c))
        .find(|s| valid_slug(s))
        .ok_or_else(|| format!("无法得到合法宠物标识(pet.json 标识字段与文件名均不可用): {zip_name}"))?;
    let dest = custom_pets_dir()
        .ok_or_else(|| "配置目录未就绪,无法导入".to_string())?
        .join(&slug);
    if dest.exists() {
        return Err(format!("已存在同名宠物: {slug}(先删除对应目录再导入)"));
    }
    // 第二遍:只解目标前缀下的三个文件,统一小写落盘
    std::fs::create_dir_all(&dest).map_err(|e| format!("创建宠物目录失败: {e}"))?;
    let mut has_json = false;
    let mut has_sheet = false;
    for i in 0..archive.len() {
        let Ok(mut f) = archive.by_index(i) else {
            continue;
        };
        let Some((p, file)) = split_entry(&f) else {
            continue;
        };
        if p != prefix || !WANTED.contains(&file.as_str()) {
            continue;
        }
        let mut content = Vec::new();
        std::io::Read::read_to_end(&mut f, &mut content)
            .map_err(|e| format!("解压 {file} 失败: {e}"))?;
        std::fs::write(dest.join(&file), &content).map_err(|e| format!("写入 {file} 失败: {e}"))?;
        has_json |= file == "pet.json";
        has_sheet |= file.starts_with("spritesheet");
    }
    if !has_sheet {
        let _ = std::fs::remove_dir_all(&dest);
        return Err("包内未找到精灵图(spritesheet.webp/png)".to_string());
    }
    if !has_json {
        // petdex 布局兜底:parse_pet_dir 对无格式标记的 pet.json 按固定行序解析
        let minimal = serde_json::json!({ "name": slug }).to_string();
        std::fs::write(dest.join("pet.json"), minimal).map_err(|e| format!("写入 pet.json 失败: {e}"))?;
    }
    match parse_pet_dir(&dest, &slug, "custom") {
        Some(meta) => Ok(meta.info()),
        None => {
            let _ = std::fs::remove_dir_all(&dest);
            Err("pet.json 校验失败:缺少关键字段(参考 docs/desktop-pet-design.md 的三种格式)".to_string())
        }
    }
}
