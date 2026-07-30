/**
 * MCP 设置:
 * - 服务器运行状态(GET /api/v1/mcp/servers)+ 重启(POST :restart)
 * - mcp.json 配置编辑(本地文件,IPC 读写,写入前主进程自动备份):可视化 / 原始 JSON 双模式
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, RefreshCw, RotateCw, Save, Server, Trash2, Undo2 } from 'lucide-react'
import { rest } from '@/api'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'

interface McpServerInfo {
  name: string
  id: string
  status: string
  toolCount: number | null
}

type ServerType = 'stdio' | 'http' | 'sse'

interface ServerDraft {
  type: ServerType
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  enabled: boolean
}

const KNOWN_KEYS = ['command', 'args', 'env', 'url', 'headers', 'type', 'enabled']

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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

function normalizeServer(s: Record<string, unknown>): McpServerInfo {
  const name = String(s.name ?? s.id ?? s.server_id ?? 'unknown')
  const id = String(s.id ?? s.name ?? name)
  const status = String(s.status ?? s.state ?? 'unknown')
  let toolCount: number | null = null
  if (Array.isArray(s.tools)) toolCount = s.tools.length
  else if (typeof s.tools === 'number') toolCount = s.tools
  else if (typeof s.tools_count === 'number') toolCount = s.tools_count
  else if (typeof s.tool_count === 'number') toolCount = s.tool_count
  return { name, id, status, toolCount }
}

function serversMap(c: Record<string, unknown> | null): Record<string, Record<string, unknown>> {
  if (!c) return {}
  const m = c.mcpServers
  return m && typeof m === 'object' && !Array.isArray(m)
    ? (m as Record<string, Record<string, unknown>>)
    : {}
}

function detectType(e: Record<string, unknown>): ServerType {
  if (typeof e.url === 'string') return e.type === 'sse' ? 'sse' : 'http'
  return 'stdio'
}

function kvText(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  return Object.entries(v as Record<string, unknown>)
    .map(([k, val]) => `${k}=${String(val ?? '')}`)
    .join('\n')
}

function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

function toDraft(e: Record<string, unknown>): ServerDraft {
  const type = detectType(e)
  return {
    type,
    command: typeof e.command === 'string' ? e.command : '',
    argsText: Array.isArray(e.args) ? (e.args as unknown[]).map(String).join('\n') : '',
    envText: kvText(e.env),
    url: typeof e.url === 'string' ? e.url : '',
    headersText: kvText(e.headers),
    enabled: e.enabled !== false
  }
}

/** 由草稿构建配置条目;保留原始条目中的未知字段,空值字段不写入。 */
function buildFromDraft(cur: Record<string, unknown>, d: ServerDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cur)) {
    if (!KNOWN_KEYS.includes(k)) out[k] = v
  }
  if (d.type === 'stdio') {
    out.command = d.command.trim()
    const args = d.argsText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (args.length) out.args = args
    const env = parseKV(d.envText)
    if (Object.keys(env).length) out.env = env
  } else {
    out.url = d.url.trim()
    const headers = parseKV(d.headersText)
    if (Object.keys(headers).length) out.headers = headers
    if (d.type === 'sse') out.type = 'sse'
  }
  if (!d.enabled) out.enabled = false
  return out
}

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-primary'
const fieldLabelCls = 'mb-1 block text-[12px] font-medium text-text-secondary'

export function McpSettings() {
  // ---------- 运行状态 ----------
  const [servers, setServers] = useState<McpServerInfo[] | null>(null)
  const [serversErr, setServersErr] = useState('')
  const [restarting, setRestarting] = useState<Record<string, boolean>>({})
  const [restartMsg, setRestartMsg] = useState<Record<string, { ok: boolean; text: string }>>({})

  const loadServers = useCallback(async () => {
    setServersErr('')
    try {
      const data = (await rest('/api/v1/mcp/servers')) as { servers?: unknown } | unknown[]
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { servers?: unknown[] }).servers)
          ? ((data as { servers: unknown[] }).servers)
          : []
      setServers((list as Record<string, unknown>[]).map(normalizeServer))
    } catch (e) {
      setServers([])
      setServersErr(errMsg(e))
    }
  }, [])

  const restart = async (s: McpServerInfo) => {
    setRestarting((r) => ({ ...r, [s.id]: true }))
    setRestartMsg((m) => ({ ...m, [s.id]: { ok: true, text: '' } }))
    try {
      await rest(`/api/v1/mcp/servers/${encodeURIComponent(s.id)}:restart`, { method: 'POST' })
      setRestartMsg((m) => ({ ...m, [s.id]: { ok: true, text: '已发送重启指令' } }))
      setTimeout(() => void loadServers(), 1200)
    } catch (e) {
      setRestartMsg((m) => ({ ...m, [s.id]: { ok: false, text: `重启失败:${errMsg(e)}` } }))
    } finally {
      setRestarting((r) => ({ ...r, [s.id]: false }))
    }
  }

  // ---------- 配置 ----------
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [configErr, setConfigErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [jsonText, setJsonText] = useState('{}')
  const [jsonErr, setJsonErr] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState<ServerDraft | null>(null)
  const [draftErr, setDraftErr] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadConfig = useCallback(async () => {
    setConfigErr('')
    try {
      const raw = (await window.kimiApi.localMcpRead()) as Record<string, unknown> | null
      const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      setConfig(cfg)
      setJsonText(JSON.stringify(cfg, null, 2))
      setDirty(false)
    } catch (e) {
      setConfig({})
      setConfigErr(errMsg(e))
    }
  }, [])

  useEffect(() => {
    void loadServers()
    void loadConfig()
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [loadServers, loadConfig])

  const flashSaveMsg = (msg: { ok: boolean; text: string }) => {
    setSaveMsg(msg)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setSaveMsg(null), 5000)
  }

  const map = serversMap(config)
  const names = Object.keys(map)

  const patchEntry = (name: string, patch: Record<string, unknown>) => {
    setConfig((c) => {
      if (!c) return c
      const m = serversMap(c)
      return { ...c, mcpServers: { ...m, [name]: { ...(m[name] ?? {}), ...patch } } }
    })
    setDirty(true)
  }

  const toggleEnabled = (name: string) => {
    const next = map[name]?.enabled === false // 当前禁用 → 启用
    patchEntry(name, { enabled: next })
    if (expanded === name) setDraft((d) => (d ? { ...d, enabled: next } : d))
  }

  const openEditor = (name: string) => {
    if (expanded === name) {
      setExpanded(null)
      setDraft(null)
      setDraftErr('')
      return
    }
    setExpanded(name)
    setDraft(toDraft(map[name] ?? {}))
    setDraftErr('')
    setConfirmDel(null)
  }

  const applyDraft = () => {
    if (!expanded || !draft) return
    if (draft.type === 'stdio' && !draft.command.trim()) {
      setDraftErr('stdio 类型必须填写 command')
      return
    }
    if (draft.type !== 'stdio' && !draft.url.trim()) {
      setDraftErr('http/sse 类型必须填写 url')
      return
    }
    const name = expanded
    setConfig((c) => {
      if (!c) return c
      const m = serversMap(c)
      return { ...c, mcpServers: { ...m, [name]: buildFromDraft(m[name] ?? {}, draft) } }
    })
    setDirty(true)
    setExpanded(null)
    setDraft(null)
    setDraftErr('')
  }

  const askDelete = (name: string) => {
    if (confirmDel === name) {
      setConfig((c) => {
        if (!c) return c
        const m = { ...serversMap(c) }
        delete m[name]
        return { ...c, mcpServers: m }
      })
      setDirty(true)
      setConfirmDel(null)
      if (expanded === name) {
        setExpanded(null)
        setDraft(null)
      }
    } else {
      setConfirmDel(name)
      setTimeout(() => setConfirmDel((v) => (v === name ? null : v)), 3000)
    }
  }

  // ---------- 添加服务器 ----------
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addType, setAddType] = useState<ServerType>('stdio')
  const [addCommand, setAddCommand] = useState('')
  const [addArgs, setAddArgs] = useState('')
  const [addEnv, setAddEnv] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addHeaders, setAddHeaders] = useState('')
  const [addErr, setAddErr] = useState('')

  const submitAdd = () => {
    const name = addName.trim()
    if (!name) return setAddErr('请填写服务器名称')
    if (serversMap(config)[name]) return setAddErr(`服务器 “${name}” 已存在`)
    if (addType === 'stdio' && !addCommand.trim()) return setAddErr('stdio 类型必须填写 command')
    if (addType !== 'stdio' && !addUrl.trim()) return setAddErr('http/sse 类型必须填写 url')
    const d: ServerDraft = {
      type: addType,
      command: addCommand,
      argsText: addArgs,
      envText: addEnv,
      url: addUrl,
      headersText: addHeaders,
      enabled: true
    }
    setConfig((c) => {
      const base = c ?? {}
      const m = serversMap(base)
      return { ...base, mcpServers: { ...m, [name]: buildFromDraft({}, d) } }
    })
    setDirty(true)
    setShowAdd(false)
    setAddErr('')
    setAddName('')
    setAddCommand('')
    setAddArgs('')
    setAddEnv('')
    setAddUrl('')
    setAddHeaders('')
    setAddType('stdio')
  }

  // ---------- 模式切换 / 保存 ----------
  const switchMode = (m: 'visual' | 'json') => {
    if (m === mode) return
    if (m === 'json') {
      setJsonText(JSON.stringify(config ?? {}, null, 2))
      setJsonErr('')
      setMode('json')
      return
    }
    try {
      const parsed = JSON.parse(jsonText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('顶层必须是 JSON 对象')
      if (JSON.stringify(parsed) !== JSON.stringify(config)) setDirty(true)
      setConfig(parsed as Record<string, unknown>)
      setJsonErr('')
      setMode('visual')
    } catch (e) {
      setJsonErr(`无法切换到可视化模式:${errMsg(e)}`)
    }
  }

  const save = async () => {
    let data: Record<string, unknown>
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(jsonText) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('顶层必须是 JSON 对象')
        data = parsed as Record<string, unknown>
        setJsonErr('')
      } catch (e) {
        setJsonErr(`JSON 解析失败:${errMsg(e)}`)
        return
      }
    } else {
      if (!config) return
      data = config
    }
    setSaving(true)
    try {
      await window.kimiApi.localMcpWrite(data)
      setConfig(data)
      setJsonText(JSON.stringify(data, null, 2))
      setDirty(false)
      flashSaveMsg({ ok: true, text: '已保存(配置已自动备份),重启 MCP 服务器后生效' })
    } catch (e) {
      flashSaveMsg({ ok: false, text: `保存失败:${errMsg(e)}` })
    } finally {
      setSaving(false)
    }
  }

  const undo = () => {
    void loadConfig()
    setSaveMsg(null)
    setExpanded(null)
    setDraft(null)
  }

  return (
    <Section title="MCP" desc="管理 MCP 服务器运行状态与用户级配置(~/.kimi-code/mcp.json)">
      {/* ---------- 服务器列表(运行状态) ---------- */}
      <GroupLabel>服务器列表</GroupLabel>
      {serversErr && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">
          服务器状态加载失败:{serversErr}
        </p>
      )}
      {servers === null ? (
        <Empty text="加载中…" />
      ) : servers.length === 0 ? (
        <Empty text="暂无 MCP 服务器" />
      ) : (
        <Card className="divide-y divide-border-light p-0">
          {servers.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Server size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{s.name}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="mt-0.5 text-[12px] text-text-tertiary">
                    {s.toolCount === null ? '工具数未知' : `${s.toolCount} 个工具`}
                  </p>
                </div>
                <button
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text disabled:opacity-50"
                  disabled={!!restarting[s.id]}
                  onClick={() => void restart(s)}
                >
                  <RotateCw size={12} className={restarting[s.id] ? 'animate-spin' : ''} />
                  {restarting[s.id] ? '重启中…' : '重启'}
                </button>
              </div>
              {restartMsg[s.id]?.text && (
                <p
                  className={`mt-2 text-[12px] ${restartMsg[s.id].ok ? 'text-success' : 'text-danger'}`}
                >
                  {restartMsg[s.id].text}
                </p>
              )}
            </div>
          ))}
        </Card>
      )}
      <div className="flex justify-end">
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text"
          onClick={() => void loadServers()}
        >
          <RefreshCw size={12} /> 刷新状态
        </button>
      </div>

      {/* ---------- 配置编辑器 ---------- */}
      <GroupLabel>配置编辑器</GroupLabel>
      <Card>
        {/* 工具栏:模式切换 + 撤销/保存 */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface-tertiary p-0.5">
            {(['visual', 'json'] as const).map((m) => (
              <button
                key={m}
                className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
                  mode === m ? 'bg-surface font-medium text-text shadow-sm' : 'text-text-secondary hover:text-text'
                }`}
                onClick={() => switchMode(m)}
              >
                {m === 'visual' ? '可视化' : '原始 JSON'}
              </button>
            ))}
          </div>
          {dirty && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> 有未保存的更改
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text disabled:opacity-50"
              disabled={!dirty || saving}
              onClick={undo}
            >
              <Undo2 size={12} /> 撤销
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              disabled={saving || (!dirty && mode === 'visual')}
              onClick={() => void save()}
            >
              <Save size={12} /> {saving ? '保存中…' : '保存配置'}
            </button>
          </div>
        </div>
        {saveMsg && (
          <p
            className={`mt-3 rounded-lg px-2.5 py-1.5 text-[12px] ${
              saveMsg.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
            }`}
          >
            {saveMsg.text}
          </p>
        )}
        {configErr && (
          <p className="mt-3 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
            配置读取失败(将使用空配置):{configErr}
          </p>
        )}

        {mode === 'json' ? (
          <div className="mt-3">
            <textarea
              className={`h-72 w-full resize-y rounded-lg border bg-surface-secondary p-3 font-mono text-[12px] leading-relaxed outline-none transition-colors focus:border-primary ${
                jsonErr ? 'border-danger' : 'border-border'
              }`}
              spellCheck={false}
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value)
                setDirty(true)
                setJsonErr('')
              }}
            />
            {jsonErr && <p className="mt-1.5 text-[12px] text-danger">{jsonErr}</p>}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {names.length === 0 && (
              <p className="rounded-lg border border-dashed border-border py-6 text-center text-[12.5px] text-text-tertiary">
                暂无 MCP 服务器配置,点击下方“添加服务器”开始
              </p>
            )}
            {names.map((name) => {
              const entry = map[name]
              const type = detectType(entry)
              const enabled = entry.enabled !== false
              const isOpen = expanded === name
              return (
                <div key={name} className="rounded-lg border border-border">
                  {/* 行头 */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => openEditor(name)}
                    >
                      <ChevronDown
                        size={14}
                        className={`shrink-0 text-text-tertiary transition-transform ${isOpen ? '' : '-rotate-90'}`}
                      />
                      <span className="truncate text-[13px] font-medium">{name}</span>
                      <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-text-secondary">
                        {type}
                      </span>
                      {!enabled && (
                        <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10.5px] text-text-tertiary">
                          已禁用
                        </span>
                      )}
                    </button>
                    <button
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        enabled ? 'bg-success' : 'bg-border'
                      }`}
                      title={enabled ? '点击禁用' : '点击启用'}
                      onClick={() => toggleEnabled(name)}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                          enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                    {confirmDel === name ? (
                      <button
                        className="shrink-0 rounded-lg bg-danger px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:opacity-90"
                        onClick={() => askDelete(name)}
                      >
                        确认删除?
                      </button>
                    ) : (
                      <button
                        className="shrink-0 rounded-lg border border-border p-1.5 text-text-tertiary transition-colors hover:bg-danger-soft hover:text-danger"
                        title="删除"
                        onClick={() => askDelete(name)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {/* 展开的编辑区 */}
                  {isOpen && draft && (
                    <div className="space-y-3 border-t border-border-light px-3 py-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={fieldLabelCls}>类型</label>
                          <select
                            className={inputCls}
                            value={draft.type}
                            onChange={(e) => setDraft({ ...draft, type: e.target.value as ServerType })}
                          >
                            <option value="stdio">stdio(本地命令)</option>
                            <option value="http">http(远程)</option>
                            <option value="sse">sse(远程)</option>
                          </select>
                        </div>
                        <div className="flex items-end pb-1.5">
                          <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
                            <button
                              className={`relative h-5 w-9 rounded-full transition-colors ${
                                draft.enabled ? 'bg-success' : 'bg-border'
                              }`}
                              onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
                            >
                              <span
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                                  draft.enabled ? 'left-[18px]' : 'left-0.5'
                                }`}
                              />
                            </button>
                            启用
                          </label>
                        </div>
                      </div>

                      {draft.type === 'stdio' ? (
                        <>
                          <div>
                            <label className={fieldLabelCls}>command</label>
                            <input
                              className={inputCls}
                              placeholder="npx / uvx / node …"
                              value={draft.command}
                              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className={fieldLabelCls}>args(每行一个)</label>
                            <textarea
                              className={`${inputCls} h-20 resize-y font-mono text-[12px]`}
                              placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path'}
                              value={draft.argsText}
                              onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className={fieldLabelCls}>env(每行 KEY=VALUE)</label>
                            <textarea
                              className={`${inputCls} h-16 resize-y font-mono text-[12px]`}
                              placeholder="API_KEY=xxx"
                              value={draft.envText}
                              onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <label className={fieldLabelCls}>url</label>
                            <input
                              className={inputCls}
                              placeholder="https://example.com/mcp"
                              value={draft.url}
                              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className={fieldLabelCls}>headers(每行 KEY=VALUE)</label>
                            <textarea
                              className={`${inputCls} h-16 resize-y font-mono text-[12px]`}
                              placeholder="Authorization=Bearer xxx"
                              value={draft.headersText}
                              onChange={(e) => setDraft({ ...draft, headersText: e.target.value })}
                            />
                          </div>
                        </>
                      )}

                      {draftErr && <p className="text-[12px] text-danger">{draftErr}</p>}
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-tertiary"
                          onClick={() => openEditor(name)}
                        >
                          取消
                        </button>
                        <button
                          className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover"
                          onClick={applyDraft}
                        >
                          应用更改
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* 添加服务器 */}
            {showAdd ? (
              <div className="space-y-3 rounded-lg border border-primary-border bg-primary-soft/40 px-3 py-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={fieldLabelCls}>名称</label>
                    <input
                      className={inputCls}
                      placeholder="my-server"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={fieldLabelCls}>类型</label>
                    <select
                      className={inputCls}
                      value={addType}
                      onChange={(e) => setAddType(e.target.value as ServerType)}
                    >
                      <option value="stdio">stdio(本地命令)</option>
                      <option value="http">http(远程)</option>
                      <option value="sse">sse(远程)</option>
                    </select>
                  </div>
                </div>
                {addType === 'stdio' ? (
                  <>
                    <div>
                      <label className={fieldLabelCls}>command</label>
                      <input
                        className={inputCls}
                        placeholder="npx"
                        value={addCommand}
                        onChange={(e) => setAddCommand(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelCls}>args(每行一个)</label>
                      <textarea
                        className={`${inputCls} h-20 resize-y font-mono text-[12px]`}
                        value={addArgs}
                        onChange={(e) => setAddArgs(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelCls}>env(每行 KEY=VALUE,可选)</label>
                      <textarea
                        className={`${inputCls} h-16 resize-y font-mono text-[12px]`}
                        value={addEnv}
                        onChange={(e) => setAddEnv(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className={fieldLabelCls}>url</label>
                      <input
                        className={inputCls}
                        placeholder="https://example.com/mcp"
                        value={addUrl}
                        onChange={(e) => setAddUrl(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelCls}>headers(每行 KEY=VALUE,可选)</label>
                      <textarea
                        className={`${inputCls} h-16 resize-y font-mono text-[12px]`}
                        value={addHeaders}
                        onChange={(e) => setAddHeaders(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {addErr && <p className="text-[12px] text-danger">{addErr}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-tertiary"
                    onClick={() => {
                      setShowAdd(false)
                      setAddErr('')
                    }}
                  >
                    取消
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover"
                    onClick={submitAdd}
                  >
                    <Plus size={12} /> 添加
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
                onClick={() => setShowAdd(true)}
              >
                <Plus size={13} /> 添加服务器
              </button>
            )}
          </div>
        )}
      </Card>
    </Section>
  )
}
