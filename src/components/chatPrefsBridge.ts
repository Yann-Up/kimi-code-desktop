/**
 * chatPrefsBridge: 壳侧与对话 iframe 注入脚本(src-tauri/assets/chat_skin_inject.js
 * 尾部 prefs 模块)的桥接,把官方 web UI 的主题/语言同步到壳自定义页面。
 * 协议(postMessage,消息带 __kimiChatPrefs 标识,上行经 bridgeGuard 三重校验):
 *   iframe → 壳:{__kimiChatPrefs:'state', theme:'light'|'dark', locale:'zh'|'en', nonce}
 *   iframe → 壳:{__kimiChatPrefs:'health', ok, reason?, detail?, nonce}  每次页面加载自检一次
 * state 收到后写入 useUi(setter 自动持久化 kimi.theme/kimi.locale 并落地 data-theme),
 * 同源的其他窗口(桌宠/菜单)经 storage 事件跟随(见 stores/ui.ts 尾部);
 * health 写入 useUi.bridgeHealth,设置页"页面桥接"状态可见(官方改版导致契约失效时
 * 降级有感知,不再静默失效)。
 * 多通道各 iframe 偏好可能不一致(localStorage 按 origin 隔离),取最后上报——
 * 同一用户偏好,可接受;服务未启动时壳用上次持久化值。
 */
import { useEffect } from 'react'
import { useUi, type ShellLocale, type ShellTheme } from '../stores/ui'
import { LOOPBACK_ORIGIN, verifyBridgeMessage } from './bridgeGuard'

const TAG = '__kimiChatPrefs'

/** 壳侧主题切换(标题栏/设置页):反推所有受管对话 iframe。
 *  三态:light/dark 写存储+DOM 官方无刷新跟随;system 写 'system' 存储,DOM 置解析值。
 *  已知限制:官方主题选择器是挂载时读存储的 React 态(bundle 里无该键的 storage 监听),
 *  正打开着的官方设置页选中显示要重挂载才更新;CSS 与后续挂载均即时正确 */
export function pushThemeToFrames(theme: ShellTheme) {
  document.querySelectorAll('iframe').forEach((f) => {
    try {
      const origin = new URL(f.src).origin
      if (!LOOPBACK_ORIGIN.test(origin) || !f.contentWindow) return
      f.contentWindow.postMessage({ [TAG]: 'set', theme }, origin)
    } catch {
      /* 静默 */
    }
  })
}

/** 设置页语言切换:反推所有受管对话 iframe(注入脚本写 kimi-locale 存储;
 *  官方是否无刷新跟随取决于其自身实现,下次加载必然生效;壳自定义页面由 store 即时切换) */
export function pushLocaleToFrames(locale: ShellLocale) {
  document.querySelectorAll('iframe').forEach((f) => {
    try {
      const origin = new URL(f.src).origin
      if (!LOOPBACK_ORIGIN.test(origin) || !f.contentWindow) return
      f.contentWindow.postMessage({ [TAG]: 'set', locale }, origin)
    } catch {
      /* 静默 */
    }
  })
}

/** WebFrame 内挂载:监听注入脚本的 theme/locale/health 上报并写入全局 store */
export function useChatPrefsBridge() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || typeof d[TAG] !== 'string') return
      if (!verifyBridgeMessage(e)) return
      if (d[TAG] === 'state') {
        const { theme, locale, setTheme, setLocale } = useUi.getState()
        // themePref=官方三态原始偏好(light/dark/system);旧版注入脚本无此字段时回退解析值
        const pref: ShellTheme =
          d.themePref === 'light' || d.themePref === 'dark' || d.themePref === 'system'
            ? d.themePref
            : d.theme === 'dark'
              ? 'dark'
              : 'light'
        if (pref !== theme) setTheme(pref)
        if ((d.locale === 'zh' || d.locale === 'en') && d.locale !== locale) setLocale(d.locale)
      } else if (d[TAG] === 'health') {
        useUi.getState().setBridgeHealth({
          ok: d.ok === true,
          reason: typeof d.reason === 'string' ? d.reason : undefined,
          detail: typeof d.detail === 'string' ? d.detail : undefined
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
}
