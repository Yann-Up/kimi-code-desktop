/**
 * chatSkinBridge: 壳侧与对话 iframe 注入脚本(src-tauri/assets/chat_skin_inject.js)的桥接。
 * 协议(postMessage,消息均带 __kimiChatSkin 标识):
 *   iframe → 壳:{__kimiChatSkin:'ready'}              注入脚本初始化完主动要配置
 *   壳 → iframe:{__kimiChatSkin:'cfg', enabled, dataUrl}  配置下发(dataUrl 为皮肤图 data: URL)
 * 素材经壳侧 fetch(skin.url) 转 dataURL 投递(内置/自选统一,iframe 侧零协议依赖),按 slug 缓存。
 * 仅 cfg.enabled && cfg.inChat 时下发立绘;多通道常驻 iframe 经 broadcast 全覆盖;
 * 任何 fetch/postMessage 异常静默吞掉,绝不影响官方页面。
 */
import { useEffect } from 'react'
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

/** WebFrame 内挂载:负责 ready 应答与配置变更广播 */
export function useChatSkinBridge() {
  useEffect(() => {
    let cfg: SkinConfig = { enabled: false, slug: null, opacity: 82, inChat: false }
    let skins: SkinInfo[] = []
    const dataUrlCache = new Map<string, string>()
    let disposed = false

    const buildPayload = async (): Promise<{ [TAG]: 'cfg'; enabled: boolean; dataUrl?: string }> => {
      const skin = cfg.enabled && cfg.inChat ? resolveSkin(skins, cfg.slug) : null
      if (!skin) return { [TAG]: 'cfg', enabled: false }
      let dataUrl = dataUrlCache.get(skin.slug)
      if (!dataUrl) {
        dataUrl = await toDataUrl(skin.url)
        dataUrlCache.set(skin.slug, dataUrl)
      }
      return { [TAG]: 'cfg', enabled: true, dataUrl }
    }

    /** 向单个 iframe 投递(targetOrigin 锁定其 src 的回环 origin,不用 *) */
    const deliver = async (frame: HTMLIFrameElement) => {
      try {
        const origin = new URL(frame.src).origin
        if (!LOOPBACK_ORIGIN.test(origin) || !frame.contentWindow) return
        const payload = await buildPayload()
        if (!disposed) frame.contentWindow.postMessage(payload, origin)
      } catch {
        /* 静默 */
      }
    }

    /** 配置变更:广播给所有常驻对话 iframe(多通道) */
    const broadcast = () => {
      document.querySelectorAll('iframe').forEach((f) => void deliver(f))
    }

    /** ready 应答:回复发起方(e.source),targetOrigin 用其实际 origin */
    const onMessage = (e: MessageEvent) => {
      if (!e.data || e.data[TAG] !== 'ready') return
      if (!LOOPBACK_ORIGIN.test(e.origin)) return
      void buildPayload()
        .then((payload) => {
          if (!disposed) (e.source as WindowProxy | null)?.postMessage(payload, e.origin)
        })
        .catch(() => {})
    }
    window.addEventListener('message', onMessage)

    window.kimiApi
      .skinConfigGet()
      .then((c) => {
        cfg = c
        broadcast()
      })
      .catch(() => {})
    listAllSkins()
      .then((list) => {
        skins = list
        broadcast()
      })
      .catch(() => {})
    const off = window.kimiApi.onSkinConfigChanged((c) => {
      cfg = c
      broadcast()
    })

    return () => {
      disposed = true
      off()
      window.removeEventListener('message', onMessage)
    }
  }, [])
}
