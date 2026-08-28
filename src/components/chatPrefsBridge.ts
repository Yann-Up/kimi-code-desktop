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
import { useUi, type ShellTheme } from '../stores/ui'
import { LOOPBACK_ORIGIN, verifyBridgeMessage } from './bridgeGuard'

const TAG = '__kimiChatPrefs'

/** 壳标题栏主题切换:反推所有受管对话 iframe(注入脚本写官方存储+DOM,官方无刷新跟随) */
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

/** WebFrame 内挂载:监听注入脚本的 theme/locale/health 上报并写入全局 store */
export function useChatPrefsBridge() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || typeof d[TAG] !== 'string') return
      if (!verifyBridgeMessage(e)) return
      if (d[TAG] === 'state') {
        const { theme, locale, setTheme, setLocale } = useUi.getState()
        if ((d.theme === 'light' || d.theme === 'dark') && d.theme !== theme) setTheme(d.theme)
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
