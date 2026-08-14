/**
 * TrustBanner: 工作区信任提示条(CLI 0.31.1 新增 workspace trust 门控)。
 * 未信任的工作区不加载项目级 MCP 配置(<root>/.mcp.json、<root>/.kimi-code/mcp.json),
 * 已在 TUI/web 信任过的工作区服务端持久化,不会再提示。
 * 数据:GET/POST /api/v1/workspaces/{id}/trust → { trusted };
 * CLI < 0.31.1 无此端点,查询失败按 unknown 静默隐藏(向后兼容)。
 */
import { useEffect, useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { rest } from '../../api'
import { useSessions } from '../../stores/sessions'

type TrustState = 'unknown' | 'trusted' | 'untrusted'

const dismissKey = (wsId: string) => `kimi.trust.dismissed.${wsId}`

export function TrustBanner({ sessionId }: { sessionId: string }) {
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId))
  const workspaces = useSessions((s) => s.workspaces)
  const [state, setState] = useState<TrustState>('unknown')
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  // 优先用会话携带的 workspace_id;老会话没有该字段时按 cwd 匹配工作区根目录兜底
  const cwd = session?.metadata?.cwd ?? ''
  const wsId =
    session?.workspace_id ?? (cwd ? workspaces.find((w) => w.root === cwd)?.id : undefined)

  useEffect(() => {
    if (!wsId) return
    let cancelled = false
    setDismissed(!!localStorage.getItem(dismissKey(wsId)))
    rest<{ trusted?: boolean }>(`/api/v1/workspaces/${wsId}/trust`)
      .then((d) => {
        if (!cancelled) setState(d?.trusted ? 'trusted' : 'untrusted')
      })
      .catch(() => {
        if (!cancelled) setState('unknown')
      })
    return () => {
      cancelled = true
    }
  }, [wsId])

  if (!wsId || state !== 'untrusted' || dismissed) return null

  const trust = () => {
    setBusy(true)
    rest(`/api/v1/workspaces/${wsId}/trust`, { method: 'POST' })
      .then(() => setState('trusted'))
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  const dismiss = () => {
    localStorage.setItem(dismissKey(wsId), '1')
    setDismissed(true)
  }

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border-light bg-warning-soft px-4 py-2">
      <ShieldAlert size={14} className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1 text-[12.5px] leading-5 text-text-secondary">
        此工作区尚未被信任,项目级 MCP 配置(.mcp.json、.kimi-code/mcp.json)不会加载。
      </span>
      <button
        className="shrink-0 rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        disabled={busy}
        onClick={trust}
      >
        信任此工作区
      </button>
      <button
        className="shrink-0 rounded-lg p-1 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary"
        title="不再提示"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  )
}
