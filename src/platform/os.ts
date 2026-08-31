/**
 * 运行平台判定(UA 方式;不引入 @tauri-apps/plugin-os 依赖)。
 * WebView2 的 UA 含 "Windows",macOS WKWebView 的 UA 含 "Macintosh; ... Mac OS X"。
 * 仅用于 UI 层平台分叉(如 WSL 入口仅 Windows 提供、自定义协议 URL 形态)。
 */
export const IS_MAC = /Mac OS X|Macintosh/.test(navigator.userAgent)
export const IS_WINDOWS = /Windows/.test(navigator.userAgent)
