/**
 * chatSkinBridge: 壳侧与对话 iframe 注入脚本(src-tauri/assets/chat_skin_inject.js)的桥接。
 * 协议(postMessage,消息均带 __kimiChatSkin 标识):
 *   iframe → 壳:{__kimiChatSkin:'ready'}              注入脚本初始化完主动要配置
 *   壳 → iframe:{__kimiChatSkin:'cfg', enabled, dataUrl}  配置下发(dataUrl 为皮肤图 data: URL)
 * 素材经壳侧 fetch(skin.url) 转 dataURL 投递(内置/自选统一,iframe 侧零协议依赖),按 slug 缓存。
 * 仅 cfg.enabled && cfg.inChat 且未被会话级隐藏时下发立绘;多通道常驻 iframe 经 broadcast 全覆盖;
 * 任何 fetch/postMessage 异常静默吞掉,绝不影响官方页面。
 *
 * 会话级隐藏(sessionHidden):对话页右下悬浮按钮切换,不落配置、不持久化——
 * 审阅面板等右侧内容被立绘遮挡时临时关闭,重启应用或重开窗口自动恢复。
 */
import { useEffect, useRef, useState } from 'react'
import type { SkinConfig } from '../platform/kimi-api'
import { listAllSkins, resolveSkin, type SkinInfo } from './skins'

const TAG = '__kimiChatSkin'
/** 回环源判定:与注入脚本一致(本机/WSL/SSH 通道的 web UI 均经回环访问) */
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/

/** 拉取皮肤图并转 data: URL(经 FileReader,兼容自定义协议返回的 blob) */
async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export interface ChatSkinBridge {
  /** 对话页内立绘已启用(皮肤开启且 inChat 开启):据此渲染快捷显隐按钮 */
  active: boolean
  /** 会话级隐藏中(按钮可恢复) */
  hidden: boolean
  /** 切换会话级隐藏并广播到所有对话 iframe */
  toggleHidden: () => void
}

/** WebFrame 内挂载:负责 ready 应答、配置变更广播与会话级快捷显隐 */
export function useChatSkinBridge(): ChatSkinBridge {
  const cfgRef = useRef<SkinConfig>({ enabled: false, slug: null, opacity: 82, inChat: false })
  const skinsRef = useRef<SkinInfo[]>([])
  const dataUrlCache = useRef(new Map<string, string>())
  const hiddenRef = useRef(false)
  const disposedRef = useRef(false)
  const [active, setActive] = useState(false)
  const [hidden, setHidden] = useState(false)

  const buildPayload = async (): Promise<{ [TAG]: 'cfg'; enabled: boolean; dataUrl?: string }> => {
    const cfg = cfgRef.current
    const skin =
      cfg.enabled && cfg.inChat && !hiddenRef.current ? resolveSkin(skinsRef.current, cfg.slug) : null
    if (!skin) return { [TAG]: 'cfg', enabled: false }
    let dataUrl = dataUrlCache.current.get(skin.slug)
    if (!dataUrl) {
      dataUrl = await toDataUrl(skin.url)
      dataUrlCache.current.set(skin.slug, dataUrl)
    }
    return { [TAG]: 'cfg', enabled: true, dataUrl }
  }

  /** 向单个 iframe 投递(targetOrigin 锁定其 src 的回环 origin,不用 *) */
  const deliver = async (frame: HTMLIFrameElement) => {
    try {
      const origin = new URL(frame.src).origin
      if (!LOOPBACK_ORIGIN.test(origin) || !frame.contentWindow) return
      const payload = await buildPayload()
      if (!disposedRef.current) frame.contentWindow.postMessage(payload, origin)
    } catch {
      /* 静默 */
    }
  }

  /** 配置/显隐变更:广播给所有常驻对话 iframe(多通道) */
  const broadcast = () => {
    document.querySelectorAll('iframe').forEach((f) => void deliver(f))
  }

  const toggleHidden = () => {
    hiddenRef.current = !hiddenRef.current
    setHidden(hiddenRef.current)
    broadcast()
  }

  useEffect(() => {
    disposedRef.current = false

    /** ready 应答:回复发起方(e.source),targetOrigin 用其实际 origin */
    const onMessage = (e: MessageEvent) => {
      if (!e.data || e.data[TAG] !== 'ready') return
      if (!LOOPBACK_ORIGIN.test(e.origin)) return
      void buildPayload()
        .then((payload) => {
          if (!disposedRef.current) (e.source as WindowProxy | null)?.postMessage(payload, e.origin)
        })
        .catch(() => {})
    }
    window.addEventListener('message', onMessage)

    const applyCfg = (c: SkinConfig) => {
      cfgRef.current = c
      setActive(c.enabled && c.inChat)
      // 配置变更时重扫皮肤列表(同 SkinStandee):运行期间新增的自选皮肤才能解析到
      listAllSkins()
        .then((list) => {
          skinsRef.current = list
          broadcast()
        })
        .catch(() => broadcast())
    }
    window.kimiApi.skinConfigGet().then(applyCfg).catch(() => {})
    listAllSkins()
      .then((list) => {
        skinsRef.current = list
        broadcast()
      })
      .catch(() => {})
    const off = window.kimiApi.onSkinConfigChanged(applyCfg)

    return () => {
      disposedRef.current = true
      off()
      window.removeEventListener('message', onMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { active, hidden, toggleHidden }
}
