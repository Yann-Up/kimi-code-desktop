/**
 * 插件管理:已安装插件(本地 installed.json)、技能包(只读)、MCP 运行摘要。
 * kimi web 0.29.2 无插件 REST API,数据来自本地文件(IPC);桌面端不做任何写操作。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Database, Download, Puzzle, RefreshCw, Search, Trash2, Wand2 } from 'lucide-react'
import { rest } from '@/api'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'
import { useUi } from '../../stores/ui'

interface PluginEntry {
  id: string
  version?: string
  source?: string
  installedAt?: string
  raw: Record<string, unknown>
}

interface SkillEntry {
  name: string
  description?: string
  path: string
  scope: 'user' | 'project'
}

interface McpSummary {
  name: string
  status: string
}

const MANAGE_HINT = '当前 CLI 版本(0.29.2)不支持桌面端管理,请使用 kimi CLI'
const INSTALL_HINT = '该版本 CLI 暂不支持远程安装,请使用 kimi CLI 安装'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function fmtTime(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

function statusKind(status: string): 'running' | 'stopped' | 'error' | 'unknown' {
  const s = status.toLowerCase()
  if (['running', 'online', 'active', 'connected', 'ready', 'healthy', 'ok'].some((k) => s.includes(k)))
    return 'running'
  if (['error', 'fail', 'crash', 'dead', 'unreachable'].some((k) => s.includes(k))) return 'error'
  if (['stop', 'offline', 'inactive', 'disabled', 'down', 'idle', 'not_started'].some((k) => s.includes(k)))
    return 'stopped'
  return 'unknown'
}

function StatusBadge({ status }: { status: string }) {
  const kind = statusKind(status)
  const cls =
    kind === 'running'
      ? 'bg-success-soft text-success'
      : kind === 'error'
        ? 'bg-danger-soft text-danger'
        : 'bg-surface-tertiary text-text-tertiary'
  const label =
    kind === 'running' ? '运行中' : kind === 'error' ? '错误' : kind === 'stopped' ? '已停止' : status || '未知'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${kind === 'running' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}

export function PluginsSettings() {
  const setSettingsSection = useUi((s) => s.setSettingsSection)

  const [tab, setTab] = useState<'installed' | 'discover'>('installed')
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const [plugins, setPlugins] = useState<PluginEntry[] | null>(null)
  const [pluginsErr, setPluginsErr] = useState('')
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [mcpServers, setMcpServers] = useState<McpSummary[] | null>(null)
  const [mcpErr, setMcpErr] = useState('')

  const [installUrl, setInstallUrl] = useState('')
  const [installHint, setInstallHint] = useState(false)
  const [hintFor, setHintFor] = useState<string | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadAll = useCallback(async () => {
    setRefreshing(true)
    setPluginsErr('')
    setMcpErr('')
    try {
      setPlugins(((await window.kimiApi.localPlugins()) as PluginEntry[]) ?? [])
    } catch (e) {
      setPlugins([])
      setPluginsErr(errMsg(e))
    }
    try {
      setSkills(((await window.kimiApi.localSkills()) as SkillEntry[]) ?? [])
    } catch {
      setSkills([])
    }
    try {
      const data = (await rest('/api/v1/mcp/servers')) as { servers?: unknown } | unknown[]
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { servers?: unknown[] }).servers)
          ? ((data as { servers: unknown[] }).servers)
          : []
      setMcpServers(
        (list as Record<string, unknown>[]).map((s) => ({
          name: String(s.name ?? s.id ?? 'unknown'),
          status: String(s.status ?? s.state ?? 'unknown')
        }))
      )
    } catch (e) {
      setMcpServers(null)
      setMcpErr(errMsg(e))
    }
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void loadAll()
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current)
    }
  }, [loadAll])

  const showManageHint = (id: string) => {
    setHintFor(id)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHintFor(null), 4000)
  }

  const q = query.trim().toLowerCase()
  const filtered = (plugins ?? []).filter(
    (p) =>
      !q ||
      p.id.toLowerCase().includes(q) ||
      (p.source ?? '').toLowerCase().includes(q) ||
      (p.version ?? '').toLowerCase().includes(q)
  )

  return (
    <Section title="插件管理" desc="查看本地已安装的插件与技能包(数据来自 ~/.kimi-code,只读)">
      {/* 顶部:页签 + 搜索 + 刷新 */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-surface-tertiary p-0.5">
          {(['installed', 'discover'] as const).map((t) => (
            <button
              key={t}
              className={`rounded-md px-3 py-1 text-[13px] transition-colors ${
                tab === t ? 'bg-surface font-medium text-text shadow-sm' : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => setTab(t)}
            >
              {t === 'installed' ? `已安装${plugins ? ` (${plugins.length})` : ''}` : '发现'}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            className="w-48 rounded-lg border border-border bg-surface py-1.5 pl-8 pr-2.5 text-[13px] outline-none transition-colors focus:border-primary"
            placeholder="搜索插件…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="rounded-lg border border-border p-1.5 text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text"
          title="刷新"
          onClick={() => void loadAll()}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {tab === 'discover' && (
        <Card>
          <p className="text-[13.5px] font-medium">从 URL / GitHub 安装</p>
          <p className="mt-0.5 text-[12px] text-text-tertiary">输入插件仓库地址或下载链接</p>
          <div className="mt-3 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-primary"
              placeholder="https://github.com/org/plugin"
              value={installUrl}
              onChange={(e) => {
                setInstallUrl(e.target.value)
                setInstallHint(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && setInstallHint(true)}
            />
            <button
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover"
              onClick={() => setInstallHint(true)}
            >
              <Download size={13} /> 安装
            </button>
          </div>
          {installHint && (
            <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning">{INSTALL_HINT}</p>
          )}
        </Card>
      )}

      {tab === 'installed' && (
        <>
          {pluginsErr && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">
              插件列表加载失败:{pluginsErr}
            </p>
          )}
          {plugins === null ? (
            <Empty text="加载中…" />
          ) : filtered.length === 0 ? (
            <Empty text={q ? '未找到匹配的插件' : '暂无已安装插件'} />
          ) : (
            <Card className="divide-y divide-border-light p-0">
              {filtered.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <Puzzle size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium">{p.id}</span>
                        {p.version && (
                          <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary">
                            v{p.version}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-text-tertiary">
                        {p.source ? `来源 ${p.source} · ` : ''}安装于 {fmtTime(p.installedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        className="relative h-5 w-9 rounded-full bg-success transition-colors"
                        title="禁用"
                        onClick={() => showManageHint(p.id)}
                      >
                        <span className="absolute left-[18px] top-0.5 h-4 w-4 rounded-full bg-white shadow" />
                      </button>
                      <button
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[12px] text-danger transition-colors hover:bg-danger-soft"
                        onClick={() => showManageHint(p.id)}
                      >
                        <Trash2 size={12} /> 卸载
                      </button>
                    </div>
                  </div>
                  {hintFor === p.id && (
                    <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning">
                      {MANAGE_HINT}
                    </p>
                  )}
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {/* 技能包(只读) */}
      <GroupLabel>
        <span className="inline-flex items-center gap-1.5">
          <Wand2 size={13} /> 技能(只读)
        </span>
      </GroupLabel>
      {skills === null ? (
        <Empty text="加载中…" />
      ) : skills.length === 0 ? (
        <Empty text="暂无已安装技能" />
      ) : (
        <Card className="divide-y divide-border-light p-0">
          {skills.map((s) => (
            <div key={s.path} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium">{s.name}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                      s.scope === 'user' ? 'bg-primary-soft text-primary' : 'bg-surface-tertiary text-text-secondary'
                    }`}
                  >
                    {s.scope === 'user' ? '用户' : '项目'}
                  </span>
                </div>
                {s.description && <p className="mt-0.5 line-clamp-2 text-[12px] text-text-secondary">{s.description}</p>}
                <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{s.path}</p>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* MCP 运行摘要(只读) */}
      <GroupLabel>
        <span className="inline-flex items-center gap-1.5">
          <Database size={13} /> MCP 服务器(只读摘要)
        </span>
      </GroupLabel>
      {mcpErr ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">MCP 状态加载失败:{mcpErr}</p>
      ) : mcpServers === null ? (
        <Empty text="加载中…" />
      ) : mcpServers.length === 0 ? (
        <Empty text="暂无 MCP 服务器" />
      ) : (
        <Card className="divide-y divide-border-light p-0">
          {mcpServers.map((s) => (
            <button
              key={s.name}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-secondary"
              onClick={() => setSettingsSection('mcp')}
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
              <StatusBadge status={s.status} />
              <ArrowRight size={13} className="shrink-0 text-text-tertiary" />
            </button>
          ))}
        </Card>
      )}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-tertiary">点击任意服务器可前往 MCP 设置页查看详情与编辑配置</p>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text"
          onClick={() => setSettingsSection('mcp')}
        >
          前往 MCP 设置 <ArrowRight size={12} />
        </button>
      </div>
    </Section>
  )
}
