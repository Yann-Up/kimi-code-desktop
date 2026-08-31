/**
 * 自定义协议(pet:// / skin://)供图 URL 的平台分叉:
 * Tauri v2 在 Windows/Linux(WebView2/WebKitGTK)下自定义 scheme 映射为
 * http://<scheme>.localhost/<path>,macOS/iOS(WKWebView)下为 <scheme>://localhost/<path>。
 * Rust 侧 handler 按 uri().path() 解析,两种形态一致;CSP(index.html)两种形态均已放行。
 */
import { IS_MAC } from './os'

export function customProtocolUrl(scheme: 'pet' | 'skin', slug: string): string {
  return IS_MAC ? `${scheme}://localhost/${slug}` : `http://${scheme}.localhost/${slug}`
}
