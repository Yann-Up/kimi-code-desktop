//! ws-client: kimi web WebSocket 通道(必须在主进程:Bearer 头认证)。
//! 已从"前端事件转发"精简为"内部通知订阅器":
//! - server_hello 心跳(ping→pong)
//! - client_hello / subscribe(不走 subscribe_v2:它会抑制 v1 会话事件)
//! - seq/epoch 游标跟踪,断线指数退避重连,重连后带游标恢复
//! - 周期枚举会话并逐个订阅(协议无通配符);subscribe/client_hello 的 ack 做
//!   not_found/resync_required 对账——服务端只对存活会话接受订阅,被拒的移出
//!   本地订阅集合待重试;全局事件(meta.updated/event.session.*)到达即触发补订。
//!   turn.ended / event.session.work_changed 转为桌面通知与 session:turn-ended 事件,
//!   不再向前端转发全量事件

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::rest::RestClient;
use crate::server::ServerInfo;

/// 会话枚举周期:新会话最迟一个周期内被订阅(协议无通配符订阅,只能逐会话)
const ENUMERATE_INTERVAL: Duration = Duration::from_secs(30);
/// M5 P2 配额提醒轮询周期(前端 QuotaStrip 的刷新间隔是 localStorage 值,Rust
/// 拿不到,固定 5min;提醒本体按档位每自然日只发一次,轮询频率不直接影响打扰)
const QUOTA_POLL_INTERVAL: Duration = Duration::from_secs(300);
/// 通知去重集合容量上限,超出即整体清空(有界,防长期运行无界增长)
const NOTIFY_DEDUP_CAP: usize = 256;

/// 订阅游标(事件水位):断线重连 client_hello / subscribe 帧携带
#[derive(Clone, Serialize, serde::Deserialize)]
pub struct Cursor {
    #[serde(default)]
    seq: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    epoch: Option<String>,
}

pub struct WsClient {
    info: ServerInfo,
    app: AppHandle,
    log_dir: PathBuf,
    /// 会话枚举(周期 GET /api/v1/sessions)用;服务代次与 info 绑定,随 client 一起重建
    rest: RestClient,
    /// 创建时的服务代次:与 AppState::generation 不一致即为绑定旧 port/token 的僵尸连接
    generation: u64,
    subscriptions: tokio::sync::Mutex<HashSet<String>>,
    cursors: tokio::sync::Mutex<HashMap<String, Cursor>>,
    /// 已发出但未收到 ack 的 subscribe 帧:请求 id → 会话 id 列表(ack  reconciliation 用)
    pending_subs: tokio::sync::Mutex<HashMap<String, Vec<String>>>,
    next_id: AtomicU64,
    closed: AtomicBool,
    /// 出站帧通道:连接存活期间由 run 循环持有接收端
    tx: tokio::sync::Mutex<Option<mpsc::UnboundedSender<String>>>,
    /// 审批/提问通知去重:(session_id, pending_interaction),容量有界
    notified: tokio::sync::Mutex<HashSet<(String, String)>>,
}

impl WsClient {
    pub fn new(
        info: ServerInfo,
        app: AppHandle,
        log_dir: PathBuf,
        generation: u64,
        rest: RestClient,
    ) -> Arc<Self> {
        Arc::new(Self {
            info,
            app,
            log_dir,
            rest,
            generation,
            subscriptions: tokio::sync::Mutex::new(HashSet::new()),
            cursors: tokio::sync::Mutex::new(HashMap::new()),
            pending_subs: tokio::sync::Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            tx: tokio::sync::Mutex::new(None),
            notified: tokio::sync::Mutex::new(HashSet::new()),
        })
    }

    /// 创建时的服务代次(供命令层识别僵尸连接)
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// 启动连接主循环(含断线重连)与会话枚举循环
    pub fn start(self: &Arc<Self>) {
        let this = Arc::clone(self);
        tokio::spawn(async move {
            this.run().await;
        });
        // 会话枚举:启动立即跑一次,之后每 30s;服务停止(close 置 closed)后退出
        let this = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                if this.closed.load(Ordering::SeqCst) {
                    return;
                }
                this.enumerate_sessions().await;
                tokio::time::sleep(ENUMERATE_INTERVAL).await;
            }
        });
        // M5 P2 配额提醒轮询:复用本代次的 RestClient(token 不出主进程);
        // 服务停止 close 后退出,请求失败(服务没跑/未登录)静默跳过
        let this = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                if this.closed.load(Ordering::SeqCst) {
                    return;
                }
                this.quota_check().await;
                tokio::time::sleep(QUOTA_POLL_INTERVAL).await;
            }
        });
    }

    async fn run(self: &Arc<Self>) {
        let mut reconnect_attempts: u32 = 0;
        loop {
            if self.closed.load(Ordering::SeqCst) {
                return;
            }
            self.dbg("WS CONNECTING");
            let url = format!("ws://127.0.0.1:{}/api/v1/ws", self.info.port);
            let connect = async {
                let mut req = url.into_client_request().map_err(|e| e.to_string())?;
                req.headers_mut().insert(
                    "authorization",
                    format!("Bearer {}", self.info.token)
                        .parse()
                        .map_err(|_| "invalid bearer header".to_string())?,
                );
                tokio_tungstenite::connect_async(req)
                    .await
                    .map_err(|e| e.to_string())
            };
            match connect.await {
                Ok((stream, _)) => {
                    reconnect_attempts = 0;
                    // close() 可能在 connect_async 在途时被调用(彼时 tx 为 None 断不到);
                    // 连接建立后、写入 tx 前再查 closed,已关闭则直接丢弃连接,避免僵尸连接
                    if self.closed.load(Ordering::SeqCst) {
                        drop(stream);
                        return;
                    }
                    self.dbg("WS OPEN");
                    let (mut write, mut read) = stream.split();
                    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                    *self.tx.lock().await = Some(tx);

                    // client_hello:带上当前订阅与游标,断线重连后恢复
                    let hello = {
                        let subs = self.subscriptions.lock().await;
                        let cursors = self.cursors.lock().await;
                        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
                        json!({
                            "type": "client_hello",
                            "id": format!("c{id}"),
                            "payload": {
                                "client_id": format!("kimi-desktop-{}", chrono::Utc::now().timestamp_millis()),
                                "subscriptions": subs.iter().collect::<Vec<_>>(),
                                "cursors": &*cursors,
                            }
                        })
                    };
                    // client_hello 发送失败则不进读循环,直接落入下方关闭/重连流程
                    let hello_sent =
                        write.send(Message::Text(hello.to_string().into())).await.is_ok();
                    while hello_sent {
                        tokio::select! {
                            msg = read.next() => {
                                match msg {
                                    Some(Ok(Message::Text(t))) => {
                                        self.handle_frame(&t.to_string()).await;
                                    }
                                    Some(Ok(Message::Close(_))) | None => break,
                                    Some(Err(e)) => {
                                        self.dbg(&format!("WS ERR {e}"));
                                        // close 事件随后触发,统一在那里处理重连
                                        break;
                                    }
                                    Some(Ok(_)) => { /* 二进制/Ping/Pong 协议帧忽略 */ }
                                }
                            }
                            out = rx.recv() => {
                                match out {
                                    Some(s) => {
                                        if write.send(Message::Text(s.into())).await.is_err() {
                                            break;
                                        }
                                    }
                                    None => break,
                                }
                            }
                        }
                    }
                    *self.tx.lock().await = None;
                    // 用户主动 close 时不发状态(代次防串代逻辑已随命令层删除,仅留日志)
                    if !self.closed.load(Ordering::SeqCst) {
                        self.dbg("WS CLOSE");
                    }
                }
                Err(e) => {
                    self.dbg(&format!("WS ERR {e}"));
                }
            }
            if self.closed.load(Ordering::SeqCst) {
                return;
            }
            // 指数退避重连:1000 * 2^n,封顶 15000ms
            let delay = (1000u64 * 2u64.saturating_pow(reconnect_attempts.min(20))).min(15_000);
            reconnect_attempts += 1;
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
    }

    /// 帧处理:与 TS handleFrame 逐行对齐
    async fn handle_frame(&self, text: &str) {
        let Ok(frame) = serde_json::from_str::<Value>(text) else {
            return;
        };
        let ftype = frame.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let payload = frame.get("payload");
        match ftype {
            "ping" => {
                // ping→pong(带 nonce,缺省时 TS 序列化为 {})
                let mut p = serde_json::Map::new();
                if let Some(nonce) = payload.and_then(|p| p.get("nonce")) {
                    p.insert("nonce".to_string(), nonce.clone());
                }
                let _ = self.send("pong", Value::Object(p)).await;
                return;
            }
            "server_hello" => return,
            "ack" => {
                self.handle_ack(&frame).await;
                return;
            }
            "error" => {
                // 连接级错误,暂只忽略(会话级 error 事件有 session_id,走下方事件分支)
                if frame.get("session_id").is_none() {
                    return;
                }
            }
            "resync_required" => {
                let p = if payload.is_some_and(|p| p.is_object()) {
                    payload.unwrap()
                } else {
                    &frame
                };
                let session_id = p.get("session_id").and_then(|v| v.as_str());
                if let Some(session_id) = session_id {
                    let reason = p
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    // 就地更新游标到 current_seq:不更新的话,重连 client_hello 仍带过期
                    // 游标,服务端再次 resync_required,死循环(上游 ws.ts 同款处理)
                    if let Some(cs) = p.get("current_seq").and_then(|v| v.as_f64()) {
                        let epoch = p.get("epoch").and_then(|v| v.as_str()).map(String::from);
                        self.cursors
                            .lock()
                            .await
                            .insert(session_id.to_string(), Cursor { seq: cs, epoch });
                    }
                    self.dbg(&format!(
                        "RESYNC {session_id} {reason} seq={}",
                        p.get("current_seq")
                            .and_then(|v| v.as_f64())
                            .unwrap_or_default()
                    ));
                }
                return;
            }
            _ => {}
        }
        // 会话事件:帧顶层带 type(事件名)/seq/epoch/session_id,业务字段在 payload
        let session_id = frame
            .get("session_id")
            .and_then(|v| v.as_str())
            .or_else(|| payload.and_then(|p| p.get("sessionId")).and_then(|v| v.as_str()))
            .or_else(|| payload.and_then(|p| p.get("session_id")).and_then(|v| v.as_str()));
        let Some(session_id) = session_id else {
            self.dbg(&format!("DROP no-session {ftype}"));
            return;
        };
        let seq = frame.get("seq").and_then(|v| v.as_f64());
        let epoch = frame
            .get("epoch")
            .and_then(|v| v.as_str())
            .map(String::from);
        if let Some(seq) = seq {
            self.cursors
                .lock()
                .await
                .insert(session_id.to_string(), Cursor { seq, epoch: epoch.clone() });
        }
        // 事件对象 = payload 展开 + 顶层 type/seq/epoch/session_id/timestamp(undefined 的键丢弃);
        // volatile 标志必须透传:volatile 帧(assistant.delta 等)的 seq 是当前水位而非自增
        let mut evt = payload
            .and_then(|p| p.as_object())
            .cloned()
            .unwrap_or_default();
        evt.insert("type".to_string(), json!(ftype));
        if let Some(seq) = seq {
            evt.insert("seq".to_string(), json!(seq));
        }
        if let Some(ep) = &epoch {
            evt.insert("epoch".to_string(), json!(ep));
        }
        if let Some(v) = frame.get("volatile") {
            evt.insert("volatile".to_string(), v.clone());
        }
        evt.insert("session_id".to_string(), json!(session_id));
        if let Some(ts) = frame.get("timestamp") {
            evt.insert("timestamp".to_string(), ts.clone());
        }
        self.dbg(&format!("EVT {ftype} {session_id}"));
        // 存活会话补订钩子:全局事件(session.meta.updated / event.session.*)无需订阅
        // 即可收到,它的到达本身证明会话此刻在服务端存活(createSessionState 成功),
        // 是补订的最佳时机——新会话(event.session.created)与曾被 not_found 拒掉的
        // 历史会话(用户重新打开时)都靠它即时挂上,不必等 30s 枚举周期
        if ftype == "session.meta.updated" || ftype.starts_with("event.session.") {
            self.ensure_subscribed(session_id).await;
        }
        // 不再向前端转发全量事件,只做内部通知拦截
        self.handle_notify(ftype, &evt, session_id).await;
        // 桌宠状态机(内部聚合,只在跃迁时 emit pet:state)
        crate::pet::on_session_event(&self.app, ftype, session_id, &evt);
    }

    /// 内部通知拦截:
    /// - turn.ended:主窗口失焦时发桌面通知「任务已完成」;无论是否聚焦都
    ///   emit session:turn-ended(供 Git 面板刷新)
    /// - event.session.work_changed 且 pending_interaction 为 approval/question:
    ///   发通知(该事件服务端只在事实变化时触发,去重仅防重连重放等边缘重复)
    async fn handle_notify(&self, ftype: &str, evt: &serde_json::Map<String, Value>, session_id: &str) {
        // 主窗口聚焦时不打扰(用户在看着),与旧前端行为一致
        let focused = self
            .app
            .get_webview_window("main")
            .map(|w| w.is_focused().unwrap_or(false))
            .unwrap_or(true);
        match ftype {
            "turn.ended" => {
                if !focused {
                    self.notify("Kimi Code Desktop", "任务已完成");
                }
                let _ = self
                    .app
                    .emit("session:turn-ended", json!({ "session_id": session_id }));
            }
            "event.session.work_changed" => {
                if focused {
                    return;
                }
                let interaction = evt
                    .get("pending_interaction")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if interaction == "approval" || interaction == "question" {
                    // 事件载荷无 prompt_id/turn 标识,以 (session_id, interaction) 去重
                    let key = (session_id.to_string(), interaction.to_string());
                    let mut seen = self.notified.lock().await;
                    if !seen.contains(&key) {
                        if seen.len() >= NOTIFY_DEDUP_CAP {
                            seen.clear();
                        }
                        seen.insert(key);
                        let body = if interaction == "approval" {
                            "有一个工具调用等待你的审批"
                        } else {
                            "Kimi 想问你几个问题"
                        };
                        self.notify("Kimi Code Desktop", body);
                    }
                }
            }
            _ => {}
        }
    }

    /// 桌面通知(窗口失焦等前置判断由调用方完成)
    fn notify(&self, title: &str, body: &str) {
        use tauri_plugin_notification::NotificationExt;
        let _ = self.app.notification().builder().title(title).body(body).show();
    }

    /// 周期枚举会话并逐个订阅(幂等:subscribe 内部对已订阅会话去重);
    /// 服务端对无游标订阅只从当前水位开始推新事件,不回放历史
    async fn enumerate_sessions(&self) {
        let data = match self
            .rest
            .request(Some("GET"), "/api/v1/sessions", None, None)
            .await
        {
            Ok(data) => data,
            Err(e) => {
                self.dbg(&format!("LIST sessions {e}"));
                return;
            }
        };
        // 列表信封 {items:[...]};容错裸数组
        let items = data
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(|| data.as_array().cloned().unwrap_or_default());
        for item in items {
            let sid = item
                .get("id")
                .and_then(|v| v.as_str())
                .or_else(|| item.as_str());
            if let Some(sid) = sid {
                self.subscribe(sid, None).await;
            }
        }
    }

    /// M5 P2:轮询 /api/v1/oauth/usage,取 summary/limits 各窗口用量占比的最大值
    /// 交给 pet::quota_remind 按阈值提醒(每档每自然日一次);失败静默跳过
    async fn quota_check(&self) {
        let Ok(data) = self
            .rest
            .request(Some("GET"), "/api/v1/oauth/usage", None, None)
            .await
        else {
            return;
        };
        // 响应结构与前端 QuotaStrip 对齐:{kind:"ok", summary, limits:[{used, limit, ...}]}
        let mut max_pct = 0.0f64;
        let mut consider = |w: &Value| {
            let used = w.get("used").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let limit = w.get("limit").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if limit > 0.0 {
                max_pct = max_pct.max(used / limit * 100.0);
            }
        };
        if let Some(summary) = data.get("summary") {
            consider(summary);
        }
        if let Some(limits) = data.get("limits").and_then(|v| v.as_array()) {
            for w in limits {
                consider(w);
            }
        }
        if max_pct > 0.0 {
            crate::pet::quota_remind(&self.app, max_pct);
        }
    }

    /// 发送帧:连接未 OPEN 时静默丢弃(与 TS 的 readyState 检查一致)。
    /// 返回实际发出的请求 id(未发送为 None),供 subscribe 登记 pending 待 ack 对账
    async fn send(&self, r#type: &str, payload: Value) -> Option<String> {
        let tx = self.tx.lock().await;
        let tx = tx.as_ref()?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let id = format!("c{id}");
        let frame = json!({
            "type": r#type,
            "id": id,
            "payload": payload,
        });
        let _ = tx.send(frame.to_string());
        Some(id)
    }

    /// 订阅 ack 对账:服务端只对存活会话接受订阅(createSessionState 走
    /// getLiveSessionById,历史会话未打开时返回 not_found;hello 恢复失败则进
    /// resync_required)。被拒的会话必须从本地订阅集合移除,否则 subscribe 的
    /// 去重会让它永远不再重试,该会话只剩全局广播事件(桌宠/通知随之静默)。
    /// (实测 08-18 16:17:重启后枚举订阅历史会话被拒,执行任务全程只有
    /// work_changed/meta.updated 两条全局广播)
    async fn handle_ack(&self, frame: &Value) {
        let id = frame.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let Some(payload) = frame.get("payload") else { return };
        let list = |key: &str| -> Vec<String> {
            payload
                .get(key)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        };
        // subscribe 的 ack:{accepted, not_found, resync_required};
        // client_hello 的 ack:{accepted_subscriptions, resync_required}(无 not_found,
        // 未找到也并入 resync_required)
        let failed: Vec<String> = if payload.get("accepted_subscriptions").is_some() {
            list("resync_required")
        } else {
            // 只处理发出过的 subscribe 帧的 ack(unsubscribe 等其余 ack 忽略)
            if self.pending_subs.lock().await.remove(id).is_none() {
                return;
            }
            let mut f = list("not_found");
            f.extend(list("resync_required"));
            f
        };
        if failed.is_empty() {
            return;
        }
        {
            let mut subs = self.subscriptions.lock().await;
            for sid in &failed {
                subs.remove(sid);
            }
        }
        self.dbg(&format!("ACK {id} failed:{}", failed.join(",")));
    }

    /// 若本地未标记订阅则立即订阅(供全局事件钩子;subscribe 内部仍有去重)
    async fn ensure_subscribed(&self, session_id: &str) {
        if !self.subscriptions.lock().await.contains(session_id) {
            self.subscribe(session_id, None).await;
        }
    }

    /// v1 订阅(注意:subscribe_v2 会把服务端推送切换成 transcript.ops 通道
    /// 并抑制 v1 会话事件(0.29.2 实测),导致流式事件丢失,不要移植 v2)。
    /// cursor 为前端快照水位(as_of_seq/epoch):本地无游标或 epoch 不同(服务端
    /// 事件流重置)时采用前端权威水位;同 epoch 取较大 seq,避免游标回退引发重复回放
    pub async fn subscribe(&self, session_id: &str, cursor: Option<Cursor>) {
        if let Some(c) = cursor {
            let mut cursors = self.cursors.lock().await;
            let adopt = match cursors.get(session_id) {
                None => true,
                Some(local) => local.epoch != c.epoch || c.seq > local.seq,
            };
            if adopt {
                cursors.insert(session_id.to_string(), c);
            }
        }
        {
            let mut subs = self.subscriptions.lock().await;
            if !subs.insert(session_id.to_string()) {
                return;
            }
        }
        let state = if self.tx.lock().await.is_some() { 1 } else { 3 };
        self.dbg(&format!("SUB {session_id} ws-state {state}"));
        let cursor = self.cursors.lock().await.get(session_id).cloned();
        let cursors = match cursor {
            Some(c) => json!({ session_id: c }),
            None => json!({}),
        };
        if let Some(id) = self
            .send(
                "subscribe",
                json!({ "session_ids": [session_id], "cursors": cursors }),
            )
            .await
        {
            // 登记 pending:服务端在 ack 里回 accepted/not_found/resync_required,
            // handle_ack 据此对账(被拒的移出订阅集合,否则去重逻辑会让它永远不再重试)
            self.pending_subs
                .lock()
                .await
                .insert(id, vec![session_id.to_string()]);
        }
    }

    pub async fn unsubscribe(&self, session_id: &str) {
        {
            let mut subs = self.subscriptions.lock().await;
            if !subs.remove(session_id) {
                return;
            }
        }
        let _ = self
            .send("unsubscribe", json!({ "session_ids": [session_id] }))
            .await;
    }

    /// 用户主动关闭:置位 closed,断开出站通道,run/枚举循环随之退出
    pub async fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.tx.lock().await.take();
    }

    /// WS 诊断日志:默认开启,写 <app_data_dir>/logs/ws.log,超过 1MB 滚动为 ws.1.log
    fn dbg(&self, msg: &str) {
        let dir = self.log_dir.clone();
        let line = format!(
            "{} {}\n",
            chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ"),
            msg
        );
        // 同步 fs 写放到 blocking 线程池,避免阻塞 tokio worker(写失败静默忽略)
        tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&dir).ok();
            let file = dir.join("ws.log");
            if let Ok(meta) = std::fs::metadata(&file) {
                if meta.len() > 1024 * 1024 {
                    let _ = std::fs::rename(&file, dir.join("ws.1.log"));
                }
            }
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
                let _ = f.write_all(line.as_bytes());
            }
        });
    }
}
