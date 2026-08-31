/**
 * MCP 设置:全局(用户级)MCP 服务器配置编辑(~/.kimi-code/mcp.json,经目标通道 IPC 读写,
 * 写入前自动备份):可视化 / 原始 JSON 双模式。
 * 只管理全局配置 —— 项目级 .kimi-code/mcp.json 与服务器运行状态不在此处理。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { Section, Card, GroupLabel } from '../../components/settings/common'
import { Select } from '../../components/ui/Select'
import { Segmented } from '../../components/ui/Segmented'
import { Switch } from '../../components/ui/Switch'
import { inputCls as uiInputCls, textareaCls } from '../../components/ui/Input'
import { useT } from '../../i18n'

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

const inputCls = uiInputCls('md', 'w-full')
const fieldLabelCls = 'mb-1 block text-[12px] font-medium text-text-secondary'

export function McpSettings() {
  const t = useT()
  // 类型选项标签需随语言切换,由模块级常量移入组件内
  const TYPE_OPTIONS: { value: ServerType; label: string }[] = [
    { value: 'stdio', label: t('settings.mcp.typeStdio') },
    { value: 'http', label: t('settings.mcp.typeHttp') },
    { value: 'sse', label: t('settings.mcp.typeSse') }
  ]
  // ---------- 配置 ----------
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [configErr, setConfigErr] = useState('')
  // 当前生效的数据目录(描述里展示 mcp.json 的真实路径,避免与自定义目录歧义)
  const [kimiHome, setKimiHome] = useState('')
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
    void loadConfig()
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setKimiHome(String((h as { home?: string })?.home ?? '')))
      .catch(() => {})
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [loadConfig])

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
      setDraftErr(t('settings.mcp.errNeedCommand'))
      return
    }
    if (draft.type !== 'stdio' && !draft.url.trim()) {
      setDraftErr(t('settings.mcp.errNeedUrl'))
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
    if (!name) return setAddErr(t('settings.mcp.errNeedName'))
    if (serversMap(config)[name]) return setAddErr(t('settings.mcp.errNameExists', { name }))
    if (addType === 'stdio' && !addCommand.trim())
      return setAddErr(t('settings.mcp.errNeedCommand'))
    if (addType !== 'stdio' && !addUrl.trim()) return setAddErr(t('settings.mcp.errNeedUrl'))
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
        throw new Error(t('settings.mcp.errTopObject'))
      if (JSON.stringify(parsed) !== JSON.stringify(config)) setDirty(true)
      setConfig(parsed as Record<string, unknown>)
      setJsonErr('')
      setMode('visual')
    } catch (e) {
      setJsonErr(t('settings.mcp.errSwitchVisual', { error: errMsg(e) }))
    }
  }

  const save = async () => {
    let data: Record<string, unknown>
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(jsonText) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error(t('settings.mcp.errTopObject'))
        data = parsed as Record<string, unknown>
        setJsonErr('')
      } catch (e) {
        setJsonErr(t('settings.mcp.errJsonParse', { error: errMsg(e) }))
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
      flashSaveMsg({ ok: true, text: t('settings.mcp.savedOk') })
    } catch (e) {
      flashSaveMsg({ ok: false, text: t('settings.mcp.saveFailed', { error: errMsg(e) }) })
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
    <Section
      title="MCP"
      desc={t('settings.mcp.desc', {
        path: `${kimiHome || `<${t('settings.mcp.dataDirName')}>`}/mcp.json`
      })}
    >
      {/* ---------- 配置编辑器 ---------- */}
      <GroupLabel>{t('settings.mcp.serverConfig')}</GroupLabel>
      <Card>
        {/* 工具栏:模式切换 + 撤销/保存 */}
        <div className="flex items-center gap-2">
          <Segmented
            value={mode}
            options={[
              { value: 'visual', label: t('settings.mcp.modeVisual') },
              { value: 'json', label: t('settings.mcp.modeJson') }
            ]}
            onChange={(v) => switchMode(v as 'visual' | 'json')}
          />
          {dirty && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> {t('settings.mcp.unsaved')}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-text transition-colors hover:bg-fill disabled:opacity-50"
              disabled={!dirty || saving}
              onClick={undo}
            >
              <Undo2 size={12} /> {t('settings.mcp.undo')}
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              disabled={saving || (!dirty && mode === 'visual')}
              onClick={() => void save()}
            >
              <Save size={12} /> {saving ? t('settings.mcp.saving') : t('settings.mcp.save')}
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
            {t('settings.mcp.readFailed', { error: configErr })}
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
                {t('settings.mcp.empty')}
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
                      <span className="shrink-0 rounded bg-fill px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-text-secondary">
                        {type}
                      </span>
                      {!enabled && (
                        <span className="shrink-0 rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-text-tertiary">
                          {t('settings.mcp.disabled')}
                        </span>
                      )}
                    </button>
                    <Switch
                      checked={enabled}
                      title={enabled ? t('settings.mcp.clickDisable') : t('settings.mcp.clickEnable')}
                      onChange={() => toggleEnabled(name)}
                    />
                    {confirmDel === name ? (
                      <button
                        className="shrink-0 rounded-lg bg-danger px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:opacity-90"
                        onClick={() => askDelete(name)}
                      >
                        {t('settings.mcp.confirmDelete')}
                      </button>
                    ) : (
                      <button
                        className="shrink-0 rounded-lg border border-border p-1.5 text-text-tertiary transition-colors hover:bg-danger-soft hover:text-danger"
                        title={t('settings.mcp.delete')}
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
                          <label className={fieldLabelCls}>{t('settings.mcp.type')}</label>
                          <Select
                            className="w-full"
                            size="md"
                            value={draft.type}
                            onChange={(v) => setDraft({ ...draft, type: v as ServerType })}
                            options={TYPE_OPTIONS}
                          />
                        </div>
                        <div className="flex items-end pb-1.5">
                          <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
                            <Switch
                              checked={draft.enabled}
                              onChange={(next) => setDraft({ ...draft, enabled: next })}
                            />
                            {t('settings.mcp.enable')}
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
                            <label className={fieldLabelCls}>{t('settings.mcp.argsLabel')}</label>
                            <textarea
                              className={textareaCls('w-full h-20 font-mono')}
                              placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path'}
                              value={draft.argsText}
                              onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className={fieldLabelCls}>{t('settings.mcp.envLabel')}</label>
                            <textarea
                              className={textareaCls('w-full h-16 font-mono')}
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
                            <label className={fieldLabelCls}>{t('settings.mcp.headersLabel')}</label>
                            <textarea
                              className={textareaCls('w-full h-16 font-mono')}
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
                          className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text transition-colors hover:bg-fill"
                          onClick={() => openEditor(name)}
                        >
                          {t('settings.mcp.cancel')}
                        </button>
                        <button
                          className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover"
                          onClick={applyDraft}
                        >
                          {t('settings.mcp.apply')}
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
                    <label className={fieldLabelCls}>{t('settings.mcp.name')}</label>
                    <input
                      className={inputCls}
                      placeholder="my-server"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={fieldLabelCls}>{t('settings.mcp.type')}</label>
                    <Select
                      className="w-full"
                      size="md"
                      value={addType}
                      onChange={(v) => setAddType(v as ServerType)}
                      options={TYPE_OPTIONS}
                    />
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
                      <label className={fieldLabelCls}>{t('settings.mcp.argsLabel')}</label>
                      <textarea
                        className={textareaCls('w-full h-20 font-mono')}
                        value={addArgs}
                        onChange={(e) => setAddArgs(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelCls}>{t('settings.mcp.envLabelOptional')}</label>
                      <textarea
                        className={textareaCls('w-full h-16 font-mono')}
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
                      <label className={fieldLabelCls}>{t('settings.mcp.headersLabelOptional')}</label>
                      <textarea
                        className={textareaCls('w-full h-16 font-mono')}
                        value={addHeaders}
                        onChange={(e) => setAddHeaders(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {addErr && <p className="text-[12px] text-danger">{addErr}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text transition-colors hover:bg-fill"
                    onClick={() => {
                      setShowAdd(false)
                      setAddErr('')
                    }}
                  >
                    {t('settings.mcp.cancel')}
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover"
                    onClick={submitAdd}
                  >
                    <Plus size={12} /> {t('settings.mcp.add')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
                onClick={() => setShowAdd(true)}
              >
                <Plus size={13} /> {t('settings.mcp.addServer')}
              </button>
            )}
          </div>
        )}
      </Card>
    </Section>
  )
}
