//! rest-client: kimi web REST API 的类型化封装。
//! 统一信封 {code, msg, data, request_id},code=0 为成功。

use std::collections::HashMap;

use crate::server::ServerInfo;

/// 与 TS RestError 对齐:IPC 抛给前端的错误字符串就是 msg(与 Electron 版一致)
pub struct RestError {
    pub msg: String,
}

impl std::fmt::Display for RestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.msg)
    }
}

fn err(msg: impl Into<String>) -> RestError {
    RestError { msg: msg.into() }
}

/// Clone 为廉价 Arc clone(reqwest::Client 内部共享连接池),
/// 供命令层锁内 clone 后立即释放 Mutex,避免 HTTP await 期间全局串行化
#[derive(Clone)]
pub struct RestClient {
    info: ServerInfo,
    client: reqwest::Client,
}

impl RestClient {
    pub fn new(info: ServerInfo, client: reqwest::Client) -> Self {
        Self { info, client }
    }

    pub async fn request(
        &self,
        method: Option<&str>,
        path: &str,
        body: Option<serde_json::Value>,
        query: Option<HashMap<String, String>>,
    ) -> Result<serde_json::Value, RestError> {
        let method = method.unwrap_or("GET").to_uppercase();
        let m = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| err(format!("不支持的 HTTP 方法: {method}")))?;
        // query 参数跳过空串(TS 侧还跳过 undefined/null,桥接层不会传)
        let pairs: Vec<(String, String)> = query
            .unwrap_or_default()
            .into_iter()
            .filter(|(_, v)| !v.is_empty())
            .collect();
        let mut req = self
            .client
            .request(m, format!("{}{}", self.info.base_url, path))
            .bearer_auth(&self.info.token)
            .query(&pairs);
        if let Some(body) = body {
            req = req.json(&body);
        }
        let res = req.send().await.map_err(|e| err(e.to_string()))?;
        let status = res.status();
        if status == reqwest::StatusCode::NO_CONTENT {
            return Ok(serde_json::Value::Null);
        }
        let payload: Option<serde_json::Value> = res.json().await.ok();
        if !status.is_success() {
            let msg = payload
                .as_ref()
                .and_then(|p| p.get("msg"))
                .and_then(|m| m.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from)
                .unwrap_or_else(|| {
                    status
                        .canonical_reason()
                        .unwrap_or("request failed")
                        .to_string()
                });
            return Err(err(msg));
        }
        if let Some(p) = &payload {
            if let Some(code) = p.get("code").and_then(|c| c.as_i64()) {
                if code != 0 {
                    let msg = p
                        .get("msg")
                        .and_then(|m| m.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("request failed")
                        .to_string();
                    return Err(err(msg));
                }
            }
            // payload?.data ?? payload:data 为 null 时 TS 返回整个信封,保持一致
            if let Some(data) = p.get("data") {
                if !data.is_null() {
                    return Ok(data.clone());
                }
            }
        }
        Ok(payload.unwrap_or(serde_json::Value::Null))
    }
}
