//! ws-client: kimi web WebSocket 通道(必须在主进程:Bearer 头认证)。
//! - server_hello 心跳(ping→pong)
//! - client_hello / subscribe / unsubscribe(不走 subscribe_v2:它会抑制 v1 会话事件)
//! - seq/epoch 游标跟踪,断线指数退避重连,重连后带游标恢复
//! - resync_required 事件上抛给前端处理

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::server::ServerInfo;

/// 订阅游标(事件水位):断线重连 client_hello / subscribe 帧携带;
/// 也是 ws_subscribe 的可选入参(前端传入权威快照水位)
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
    /// 创建时的服务代次:与 AppState::generation 不一致即为绑定旧 port/token 的僵尸连接
    generation: u64,
    subscriptions: tokio::sync::Mutex<HashSet<String>>,
    cursors: tokio::sync::Mutex<HashMap<String, Cursor>>,
    next_id: AtomicU64,
    closed: AtomicBool,
    /// 出站帧通道:连接存活期间由 run 循环持有接收端
    tx: tokio::sync::Mutex<Option<mpsc::UnboundedSender<String>>>,
}

impl WsClient {
    pub fn new(info: ServerInfo, app: AppHandle, log_dir: PathBuf, generation: u64) -> Arc<Self> {
        Arc::new(Self {
            info,
            app,
            log_dir,
            generation,
            subscriptions: tokio::sync::Mutex::new(HashSet::new()),
            cursors: tokio::sync::Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            tx: tokio::sync::Mutex::new(None),
        })
    }

    /// 创建时的服务代次(供命令层识别僵尸连接)
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// 启动连接主循环(含断线重连),对应 TS 的 ws.connect()
    pub fn start(self: &Arc<Self>) {
        let this = Arc::clone(self);
        tokio::spawn(async move {
            this.run().await;
        });
    }

    async fn run(self: &Arc<Self>) {
        let mut reconnect_attempts: u32 = 0;
        loop {
            if self.closed.load(Ordering::SeqCst) {
                return;
            }
            self.emit_state("connecting");
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
                    self.emit_state("open");
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
                    // 用户主动 close 时不发状态(TS 用 generation 防串代,close 事件被忽略)
                    if !self.closed.load(Ordering::SeqCst) {
                        self.emit_state("closed");
                        self.dbg("WS CLOSE");
                    }
                }
                Err(e) => {
                    self.dbg(&format!("WS ERR {e}"));
                    if !self.closed.load(Ordering::SeqCst) {
                        self.emit_state("closed");
                    }
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
                self.send("pong", Value::Object(p)).await;
                return;
            }
            "server_hello" | "ack" => return,
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
                    let mut info = json!({ "session_id": session_id, "reason": reason });
                    if let Some(cs) = p.get("current_seq") {
                        info["current_seq"] = cs.clone();
                    }
                    if let Some(ep) = p.get("epoch") {
                        info["epoch"] = ep.clone();
                    }
                    let _ = self.app.emit("ws:resync", info);
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
        // volatile 标志必须透传:volatile 帧(assistant.delta 等)的 seq 是当前水位而非自增,
        // 前端据此只对 durable 事件做 seq 去重,否则流式 delta 会被全部误杀
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
        let _ = self.app.emit("ws:session-event", Value::Object(evt));
    }

    /// 发送帧:连接未 OPEN 时静默丢弃(与 TS 的 readyState 检查一致)
    async fn send(&self, r#type: &str, payload: Value) {
        let tx = self.tx.lock().await;
        if let Some(tx) = tx.as_ref() {
            let id = self.next_id.fetch_add(1, Ordering::SeqCst);
            let frame = json!({
                "type": r#type,
                "id": format!("c{id}"),
                "payload": payload,
            });
            let _ = tx.send(frame.to_string());
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
        self.send(
            "subscribe",
            json!({ "session_ids": [session_id], "cursors": cursors }),
        )
        .await;
    }

    pub async fn unsubscribe(&self, session_id: &str) {
        {
            let mut subs = self.subscriptions.lock().await;
            if !subs.remove(session_id) {
                return;
            }
        }
        self.send("unsubscribe", json!({ "session_ids": [session_id] }))
            .await;
    }

    /// 用户主动关闭:置位 closed,断开出站通道,run 循环随之退出
    pub async fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.tx.lock().await.take();
    }

    fn emit_state(&self, state: &str) {
        let _ = self.app.emit("ws:state", state);
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
