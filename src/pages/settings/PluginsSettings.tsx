import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Puzzle, RefreshCw, Trash2 } from 'lucide-react'
import { rest } from '../../api'
import { Section, Card, Empty } from '../../components/settings/common'

/** kimi web REST /api/v1/plugins 返回的已安装插件摘要 */
export interface PluginSummary {
  id: string
  displayName?: string
  version?: string
  enabled: boolean
  state?: 'ok' | 'error'
  skillCount?: number
  mcpServerCount?: number
  enabledMcpServerCount?: number
  hookCount?: number
  commandCount?: number
  hasErrors?: boolean
  source?: 'local-path' | 'zip-url' | 'github'
  originalSource?: string
}

/** /api/v1/plugins/marketplace 条目(installed/updateAvailable 由服务端合并本地状态) */
export interface MarketplaceEntry {
  id: string
  displayName?: string
  version?: string
  description?: string
  homepage?: string
  keywords?: string[]
  tier?: 'official' | 'curated'
  source: string
  installed?: { version?: string; enabled?: boolean }
  updateAvailable?: boolean
}

type LoadError = { kind: 'notReady' | 'unsupported' | 'other'; text: string } | null

function classifyError(e: unknown): NonNullable<LoadError> {
  const text = e instanceof Error && e.message ? e.message : String(e)
  if (text.includes('server not ready')) return { kind: 'notReady', text }
  // 老版本 CLI 无 /api/v1/plugins 路由,REST 层回落为状态码文案(Not Found)
  if (/404|not found/i.test(text)) return { kind: 'unsupported', text }
  return { kind: 'other', text }
}

const SOURCE_LABEL: Record<string, string> = {
  'local-path': '本地',
  'zip-url': 'URL',
  github: 'GitHub'
}

/** 来源徽标(已安装列表用) */
function SourceBadge({ source }: { source?: string }) {
  if (!source) return null
  return (
    <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10.5px] text-text-tertiary">
      {SOURCE_LABEL[source] ?? source}
    </span>
  )
}

/** 市场层级徽标 */
function TierBadge({ tier }: { tier?: string }) {
  if (tier === 'official')
    return (
      <span className="shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-[10.5px] font-medium text-primary">
        官方
      </span>
    )
  if (tier === 'curated')
    return (
      <span className="shrink-0 rounded bg-success-soft px-1.5 py-0.5 text-[10.5px] font-medium text-success">
        精选
      </span>
    )
  return null
}

/** 插件设置:经 kimi web REST(/api/v1/plugins*)管理,安装/启停/移除均由 CLI 自身落盘,语义与 TUI /plugins 一致 */
export function PluginsSettings() {
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  const [installed, setInstalled] = useState<PluginSummary[]>([])
  const [market, setMarket] = useState<MarketplaceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<LoadError>(null)
  const [starting, setStarting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [customSource, setCustomSource] = useState('')
  const [installing, setInstalling] = useState(false)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashMsg = (msg: { ok: boolean; text: string }) => {
    setFlash(msg)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 5000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const [p, m] = await Promise.all([
        rest<{ plugins?: PluginSummary[] }>('/api/v1/plugins'),
        rest<{ entries?: MarketplaceEntry[] }>('/api/v1/plugins/marketplace')
      ])
      setInstalled(Array.isArray(p?.plugins) ? p.plugins : [])
      setMarket(Array.isArray(m?.entries) ? m.entries : [])
    } catch (e) {
      setLoadErr(classifyError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [load])

  const startBackend = async () => {
    setStarting(true)
    try {
      await window.kimiApi.startBackend()
      await load()
    } catch (e) {
      setLoadErr({ kind: 'other', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setStarting(false)
    }
  }

  /** 启用/禁用:乐观切换,失败回滚 */
  const toggleEnabled = async (p: PluginSummary) => {
    const next = !p.enabled
    setInstalled((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: next } : x)))
    try {
      await rest(`/api/v1/plugins/${encodeURIComponent(p.id)}:${next ? 'enable' : 'disable'}`, {
        method: 'POST'
      })
      flashMsg({ ok: true, text: `${p.displayName || p.id} 已${next ? '启用' : '禁用'}(/reload 或新会话生效)` })
    } catch (e) {
      setInstalled((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: !next } : x)))
      flashMsg({ ok: false, text: `操作失败:${e instanceof Error ? e.message : String(e)}` })
    }
  }

  /** 移除:二次确认(3s 超时还原);CLI 只删安装记录,托管副本保留在磁盘 */
  const askRemove = async (p: PluginSummary) => {
    if (confirmDel !== p.id) {
      setConfirmDel(p.id)
      setTimeout(() => setConfirmDel((v) => (v === p.id ? null : v)), 3000)
      return
    }
    setConfirmDel(null)
    setBusyId(p.id)
    try {
      await rest(`/api/v1/plugins/${encodeURIComponent(p.id)}:remove`, { method: 'POST' })
      flashMsg({ ok: true, text: `已移除 ${p.displayName || p.id}(/reload 或新会话生效)` })
      await load()
    } catch (e) {
      flashMsg({ ok: false, text: `移除失败:${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusyId(null)
    }
  }

  /** 安装(市场条目或自定义 source 共用) */
  const install = async (source: string, key: string, fromCustom: boolean) => {
    if (fromCustom) setInstalling(true)
    else setBusyId(key)
    try {
      await rest('/api/v1/plugins', { method: 'POST', body: { source } })
      flashMsg({ ok: true, text: '安装完成(/reload 或新会话生效)' })
      if (fromCustom) {
        setCustomSource('')
        setTab('installed')
      }
      await load()
    } catch (e) {
      flashMsg({ ok: false, text: `安装失败:${e instanceof Error ? e.message : String(e)}` })
    } finally {
      if (fromCustom) setInstalling(false)
      else setBusyId(null)
    }
  }

  const capabilitySummary = (p: PluginSummary) => {
    const parts: string[] = []
    if (p.skillCount) parts.push(`技能 ${p.skillCount}`)
    if (p.mcpServerCount) parts.push(`MCP ${p.enabledMcpServerCount ?? 0}/${p.mcpServerCount}`)
    if (p.commandCount) parts.push(`命令 ${p.commandCount}`)
    if (p.hookCount) parts.push(`钩子 ${p.hookCount}`)
    return parts.join(' · ')
  }

  return (
    <Section
      title="插件"
      desc={'管理 Kimi Code 插件(与 TUI /plugins 等效,经本机 kimi web 服务操作)\n插件变更需在会话中运行 /reload 或开新会话后生效'}
    >
      {/* 子 tab + 刷新 */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-surface-tertiary p-0.5">
          {(
            [
              ['installed', `已安装${installed.length ? ` (${installed.length})` : ''}`],
              ['market', '插件市场']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
                tab === id ? 'bg-surface font-medium text-text shadow-sm' : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      {flash && (
        <p
          className={`rounded-lg px-2.5 py-1.5 text-[12px] ${
            flash.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
          }`}
        >
          {flash.text}
        </p>
      )}

      {loadErr ? (
        loadErr.kind === 'notReady' ? (
          <Card className="flex flex-col items-center gap-3 py-8">
            <p className="text-[13px] text-text-tertiary">插件管理需后端服务运行中(kimi web)</p>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              disabled={starting}
              onClick={() => void startBackend()}
            >
              {starting && <Loader2 size={12} className="animate-spin" />}
              {starting ? '启动中…' : '启动后端服务'}
            </button>
          </Card>
        ) : loadErr.kind === 'unsupported' ? (
          <Empty text="当前 CLI 版本不支持插件管理,请先升级 CLI(设置 → 常规)" />
        ) : (
          <Empty text={`加载失败:${loadErr.text}`} />
        )
      ) : loading ? (
        <Empty text="加载中…" />
      ) : tab === 'installed' ? (
        installed.length === 0 ? (
          <Empty text="尚未安装插件,可到「插件市场」或下方从 URL 安装" />
        ) : (
          <div className="space-y-2">
            {installed.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
                <Puzzle size={14} className="shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{p.displayName || p.id}</span>
                    {p.version && (
                      <span className="shrink-0 text-[11px] text-text-tertiary">v{p.version}</span>
                    )}
                    <SourceBadge source={p.source} />
                    {(p.state === 'error' || p.hasErrors) && (
                      <span className="shrink-0 rounded bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-medium text-danger">
                        异常
                      </span>
                    )}
                    {!p.enabled && (
                      <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10.5px] text-text-tertiary">
                        已禁用
                      </span>
                    )}
                  </div>
                  {(capabilitySummary(p) || p.originalSource) && (
                    <p className="mt-0.5 truncate text-[11.5px] text-text-tertiary" title={p.originalSource}>
                      {capabilitySummary(p) || p.originalSource}
                    </p>
                  )}
                </div>
                <button
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    p.enabled ? 'bg-success' : 'bg-border'
                  }`}
                  title={p.enabled ? '点击禁用' : '点击启用'}
                  onClick={() => void toggleEnabled(p)}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      p.enabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
                {confirmDel === p.id ? (
                  <button
                    className="shrink-0 rounded-lg bg-danger px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                    disabled={busyId === p.id}
                    onClick={() => void askRemove(p)}
                  >
                    确认移除?
                  </button>
                ) : (
                  <button
                    className="shrink-0 rounded-lg border border-border p-1.5 text-text-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    title="移除(仅删安装记录,文件保留在磁盘)"
                    disabled={busyId === p.id}
                    onClick={() => void askRemove(p)}
                  >
                    {busyId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : market.length === 0 ? (
        <Empty text="插件市场暂无条目" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {market.map((m) => {
            const installedEntry = m.installed
            const busy = busyId === m.id
            return (
              <Card key={m.id} className="flex flex-col">
                <div className="flex items-center gap-2">
                  <Puzzle size={14} className="shrink-0 text-primary" />
                  <span className="truncate text-[13.5px] font-medium">{m.displayName || m.id}</span>
                  <TierBadge tier={m.tier} />
                  {m.version && (
                    <span className="shrink-0 text-[11px] text-text-tertiary">v{m.version}</span>
                  )}
                </div>
                {m.description && (
                  <p className="mt-1 line-clamp-2 flex-1 text-[12px] text-text-tertiary">{m.description}</p>
                )}
                <div className="mt-2.5 flex items-center justify-end">
                  {installedEntry && !m.updateAvailable ? (
                    <span className="text-[12px] text-text-tertiary">
                      已安装{installedEntry.version ? ` v${installedEntry.version}` : ''}
                      {installedEntry.enabled === false ? '(已禁用)' : ''}
                    </span>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void install(m.source, m.id, false)}
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {m.updateAvailable ? '更新' : '安装'}
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* 从 URL / 路径安装 */}
      {!loadErr && (
        <Card>
          <p className="text-[13px] font-medium">从 URL 安装</p>
          <p className="mt-0.5 text-[12px] text-text-tertiary">
            支持 GitHub 仓库 URL(可带 /tree/&lt;ref&gt;、/releases/tag/&lt;tag&gt;、/commit/&lt;sha&gt;)、zip 包 URL、本地绝对路径
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 font-mono text-[12.5px] outline-none transition-colors focus:border-primary"
              placeholder="https://github.com/owner/repo 或 https://…/plugin.zip 或 D:\path\to\plugin"
              spellCheck={false}
              value={customSource}
              onChange={(e) => setCustomSource(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customSource.trim() && !installing)
                  void install(customSource.trim(), '', true)
              }}
            />
            <button
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              disabled={!customSource.trim() || installing}
              onClick={() => void install(customSource.trim(), '', true)}
            >
              {installing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {installing ? '安装中…' : '安装'}
            </button>
          </div>
        </Card>
      )}
    </Section>
  )
}
