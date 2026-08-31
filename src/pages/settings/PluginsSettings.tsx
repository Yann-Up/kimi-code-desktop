import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Puzzle, RefreshCw, Trash2 } from 'lucide-react'
import { rest } from '../../api'
import { Section, Card, Empty } from '../../components/settings/common'
import { useT } from '../../i18n'

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

// 非中文来源标签(URL/GitHub 不译);local-path 的「本地」在组件内经 t() 取值
const SOURCE_LABEL: Record<string, string> = {
  'zip-url': 'URL',
  github: 'GitHub'
}

/** 来源徽标(已安装列表用) */
function SourceBadge({ source }: { source?: string }) {
  const t = useT()
  if (!source) return null
  return (
    <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10.5px] text-text-tertiary">
      {source === 'local-path' ? t('settings.plugins.sourceLocal') : (SOURCE_LABEL[source] ?? source)}
    </span>
  )
}

/** 市场层级徽标 */
function TierBadge({ tier }: { tier?: string }) {
  const t = useT()
  if (tier === 'official')
    return (
      <span className="shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-[10.5px] font-medium text-primary">
        {t('settings.plugins.tierOfficial')}
      </span>
    )
  if (tier === 'curated')
    return (
      <span className="shrink-0 rounded bg-success-soft px-1.5 py-0.5 text-[10.5px] font-medium text-success">
        {t('settings.plugins.tierCurated')}
      </span>
    )
  return null
}

/** 插件设置:经 kimi web REST(/api/v1/plugins*)管理,安装/启停/移除均由 CLI 自身落盘,语义与 TUI /plugins 一致 */
export function PluginsSettings() {
  const t = useT()
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
      flashMsg({
        ok: true,
        text: t(next ? 'settings.plugins.flashEnabled' : 'settings.plugins.flashDisabled', {
          name: p.displayName || p.id
        })
      })
    } catch (e) {
      setInstalled((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: !next } : x)))
      flashMsg({
        ok: false,
        text: t('settings.plugins.opFailed', { error: e instanceof Error ? e.message : String(e) })
      })
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
      flashMsg({
        ok: true,
        text: t('settings.plugins.flashRemoved', { name: p.displayName || p.id })
      })
      await load()
    } catch (e) {
      flashMsg({
        ok: false,
        text: t('settings.plugins.removeFailed', { error: e instanceof Error ? e.message : String(e) })
      })
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
      flashMsg({ ok: true, text: t('settings.plugins.installDone') })
      if (fromCustom) {
        setCustomSource('')
        setTab('installed')
      }
      await load()
    } catch (e) {
      flashMsg({
        ok: false,
        text: t('settings.plugins.installFailed', { error: e instanceof Error ? e.message : String(e) })
      })
    } finally {
      if (fromCustom) setInstalling(false)
      else setBusyId(null)
    }
  }

  const capabilitySummary = (p: PluginSummary) => {
    const parts: string[] = []
    if (p.skillCount) parts.push(t('settings.plugins.capSkills', { count: p.skillCount }))
    if (p.mcpServerCount) parts.push(`MCP ${p.enabledMcpServerCount ?? 0}/${p.mcpServerCount}`)
    if (p.commandCount) parts.push(t('settings.plugins.capCommands', { count: p.commandCount }))
    if (p.hookCount) parts.push(t('settings.plugins.capHooks', { count: p.hookCount }))
    return parts.join(' · ')
  }

  return (
    <Section title={t('settings.plugins.title')} desc={t('settings.plugins.desc')}>
      {/* 子 tab + 刷新 */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-surface-tertiary p-0.5">
          {(
            [
              [
                'installed',
                t('settings.plugins.tabInstalled') + (installed.length ? ` (${installed.length})` : '')
              ],
              ['market', t('settings.plugins.tabMarket')]
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
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {t('settings.plugins.refresh')}
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
            <p className="text-[13px] text-text-tertiary">{t('settings.plugins.needBackend')}</p>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              disabled={starting}
              onClick={() => void startBackend()}
            >
              {starting && <Loader2 size={12} className="animate-spin" />}
              {starting ? t('settings.plugins.starting') : t('settings.plugins.startBackend')}
            </button>
          </Card>
        ) : loadErr.kind === 'unsupported' ? (
          <Empty text={t('settings.plugins.unsupported')} />
        ) : (
          <Empty text={t('settings.plugins.loadFailed', { error: loadErr.text })} />
        )
      ) : loading ? (
        <Empty text={t('settings.plugins.loading')} />
      ) : tab === 'installed' ? (
        installed.length === 0 ? (
          <Empty text={t('settings.plugins.emptyInstalled')} />
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
                        {t('settings.plugins.badgeError')}
                      </span>
                    )}
                    {!p.enabled && (
                      <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10.5px] text-text-tertiary">
                        {t('settings.plugins.badgeDisabled')}
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
                  title={p.enabled ? t('settings.plugins.clickDisable') : t('settings.plugins.clickEnable')}
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
                    {t('settings.plugins.confirmRemove')}
                  </button>
                ) : (
                  <button
                    className="shrink-0 rounded-lg border border-border p-1.5 text-text-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    title={t('settings.plugins.removeTitle')}
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
        <Empty text={t('settings.plugins.emptyMarket')} />
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
                      {t('settings.plugins.installedLabel')}
                      {installedEntry.version ? ` v${installedEntry.version}` : ''}
                      {installedEntry.enabled === false ? t('settings.plugins.installedDisabled') : ''}
                    </span>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void install(m.source, m.id, false)}
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {m.updateAvailable ? t('settings.plugins.update') : t('settings.plugins.install')}
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
          <p className="text-[13px] font-medium">{t('settings.plugins.fromUrlTitle')}</p>
          <p className="mt-0.5 text-[12px] text-text-tertiary">{t('settings.plugins.fromUrlDesc')}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 font-mono text-[12.5px] outline-none transition-colors focus:border-primary"
              placeholder={t('settings.plugins.fromUrlPlaceholder')}
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
              {installing ? t('settings.plugins.installing') : t('settings.plugins.install')}
            </button>
          </div>
        </Card>
      )}
    </Section>
  )
}
