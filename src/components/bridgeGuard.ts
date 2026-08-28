/**
 * bridgeGuard:壳↔对话 iframe 桥接消息的共享校验(皮肤 chatSkinBridge / 主题语言
 * chatPrefsBridge 共用)。三重校验,参考 kickside 的桥安全模型:
 *   1. origin 必须是回环源(本机/WSL/SSH 通道的 web UI 均经 127.0.0.1 回环访问)
 *   2. e.source 必须能对应到当前文档里某个受管 iframe 的 contentWindow
 *   3. 消息 nonce 必须等于该 iframe 的 name(壳建 iframe 时经 name 属性下发,
 *      注入脚本以 window.name 回传;防同进程其他框架伪造上行消息)
 */

/** 回环源判定:与注入脚本一致 */
export const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/

/** 生成 iframe 桥 nonce(经 iframe name 属性下发,注入脚本 window.name 读取) */
export function newBridgeNonce(): string {
  return crypto.randomUUID()
}

/** 校验上行消息来自受管 iframe 且 nonce 匹配;不通过一律拒收 */
export function verifyBridgeMessage(e: MessageEvent): boolean {
  if (!LOOPBACK_ORIGIN.test(e.origin)) return false
  const nonce = (e.data as { nonce?: unknown } | null)?.nonce
  if (typeof nonce !== 'string' || !nonce) return false
  for (const frame of document.querySelectorAll('iframe')) {
    if (frame.contentWindow === e.source) return frame.name === nonce
  }
  return false
}
