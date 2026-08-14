import { useEffect, useState } from 'react'
import { rest, type SessionItem } from '../api'

/**
 * 当前活跃会话 id:轮询官方 API 会话列表(main_turn_active 优先,无标记取首个)。
 * 会话由官方 web UI(iframe)管理,壳侧无从直接感知,只能轮询;无会话时返回 null。
 * 技能/子智能体等需要"当前会话"上下文的设置页使用。
 */
export function useActiveSessionId(intervalMs = 5000): string | null {
  const [id, setId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      rest<{ items: SessionItem[] } | SessionItem[]>('/api/v1/sessions')
        .then((d) => {
          if (cancelled) return
          const list = Array.isArray(d) ? d : (d?.items ?? [])
          const active = list.find((s) => s.main_turn_active) ?? list[0]
          setId(active?.id ?? null)
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [intervalMs])

  return id
}
