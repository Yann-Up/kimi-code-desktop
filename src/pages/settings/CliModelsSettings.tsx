/**
 * CLI 配置 · 模型与供应商:providers / models / default_model 的可视化管理。
 * 数据源为 config.toml 文件直读直写(cliConfigParsed / cliConfigMerge),不依赖 kimi web 服务:
 * REST 对部分配置段会静默丢弃(identity 实测),且文件合并写保留注释、自动备份。
 * 密钥以密码形式回显(默认掩码,可点眼睛查看明文),清空 = 保持不变;其他可选项留空 = 删除该键(null 合并语义)。
 */
import { useCallback, useEffect, useState } from 'react'
import { Boxes, ChevronDown, ChevronRight, Cpu, Eye, EyeOff, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { Card, Empty, GroupLabel, Section } from '../../components/settings/common'

/* ---------------- 数据提取小工具(config.toml 解析结果为 snake_case) ---------------- */

type Rec = Record<string, unknown>

const asRec = (v: unknown): Rec =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {}
const strOf = (v: unknown): string => (typeof v === 'string' ? v : '')
const numOf = (v: unknown): string => (typeof v === 'number' ? String(v) : '')
const listOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

const PROVIDER_TYPES = ['kimi', 'anthropic', 'openai', 'openai_responses', 'google-genai', 'vertexai']
const CAPABILITIES = ['thinking', 'always_thinking', 'image_in', 'video_in', 'audio_in', 'tool_use']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** 标签的中文悬浮提示 */
const CAPABILITY_HINTS: Record<string, string> = {
  thinking: '思考:支持推理过程(可按档位调节)',
  always_thinking: '始终思考:强制开启推理,不可关闭',
  image_in: '图像输入:可接收图片',
  video_in: '视频输入:可接收视频',
  audio_in: '音频输入:可接收音频',
  tool_use: '工具调用:支持 function calling'
}
const EFFORT_HINTS: Record<string, string> = {
  low: '低:最快,推理最少',
  medium: '中:速度与深度折中',
  high: '高:更深入的推理',
  xhigh: '极高:接近最强的推理深度',
  max: '最高:最完整推理,速度最慢'
}

/** 上下文大小紧凑显示:262144 → 256K,1048576 → 1M */
function fmtCtx(n: unknown): string {
  if (typeof n !== 'number' || n <= 0) return '—'
  if (n >= 1048576 && n % 1048576 === 0) return `${n / 1048576}M`
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`
  return String(n)
}

/* ---------------- 小控件 ---------------- */

const inputCls =
  'rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none transition-colors focus:border-primary placeholder:text-text-tertiary'

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-[12.5px] text-text-secondary">{props.label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{props.children}</div>
    </div>
  )
}

function TextInput(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <input
      className={`w-full max-w-xl ${inputCls} ${props.mono ? 'font-mono text-[12px]' : ''}`}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

function Select(props: { value: string; onChange: (v: string) => void; options: string[]; allowEmpty?: string }) {
  return (
    <select
      className={`w-full max-w-xl ${inputCls}`}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.allowEmpty !== undefined && <option value="">{props.allowEmpty}</option>}
      {props.options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/** 密钥输入:默认密码掩码回显,右侧眼睛可切换明文 */
function SecretInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative w-full max-w-xl">
      <input
        type={show ? 'text' : 'password'}
        className={`w-full pr-8 font-mono text-[12px] ${inputCls}`}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
        title={show ? '隐藏明文' : '显示明文'}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  )
}

/** 多选标签组(能力 / effort 档位);hints 提供每个选项的悬浮提示 */
function CheckTags(props: { options: string[]; values: string[]; onChange: (v: string[]) => void; hints?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {props.options.map((o) => {
        const on = props.values.includes(o)
        return (
          <button
            key={o}
            type="button"
            title={props.hints?.[o] ?? o}
            className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              on
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border text-text-tertiary hover:border-primary-border hover:text-primary'
            }`}
            onClick={() =>
              props.onChange(on ? props.values.filter((x) => x !== o) : [...props.values, o])
            }
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- 供应商编辑草稿 ---------------- */

interface ProviderDraft {
  name: string
  type: string
  base_url: string
  api_key: string
}

interface ModelDraft {
  alias: string
  provider: string
  model: string
  display_name: string
  max_context_size: string
  capabilities: string[]
  support_efforts: string[]
  default_effort: string
}

export function CliModelsSettings() {
  const [config, setConfig] = useState<Rec | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setConfig(await window.kimiApi.cliConfigParsed())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <Section
      title="模型与供应商"
      desc="可视化管理 config.toml 的 providers / models / default_model;直接写文件(保留注释、自动备份),不依赖服务运行"
    >
      {loading ? (
        <Empty text="加载中…" />
      ) : error ? (
        <>
          <Empty text={`读取失败:${error}`} />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
              onClick={() => void reload()}
            >
              重试
            </button>
          </div>
        </>
      ) : (
        <ModelsForm config={config ?? {}} reload={reload} />
      )}
    </Section>
  )
}

function ModelsForm({ config, reload }: { config: Rec; reload: () => Promise<void> }) {
  const providers = asRec(config.providers)
  const models = asRec(config.models)
  const defaultModel = strOf(config.default_model)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  // 行内编辑状态:null = 未编辑;'__add__' = 新增表单
  const [editProvider, setEditProvider] = useState<string | null>(null)
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null)
  const [editModel, setEditModel] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  // 二次确认删除
  const [confirmDel, setConfirmDel] = useState('')
  // 模型分组的折叠状态(按供应商名)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  /** 统一保存入口:合并写 → 重读文件 → 提示 */
  const apply = async (patch: Rec, okText: string) => {
    setSaving(true)
    setError('')
    setSavedMsg('')
    try {
      await window.kimiApi.cliConfigMerge(patch)
      await reload()
      setSavedMsg(`${okText};新会话生效(如未生效请重启服务)`)
      setTimeout(() => setSavedMsg(''), 4000)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  /* ---------------- 供应商 ---------------- */

  const startEditProvider = (name: string) => {
    const p = asRec(providers[name])
    setEditProvider(name)
    setProviderDraft({
      name,
      type: strOf(p.type) || 'openai',
      base_url: strOf(p.base_url),
      api_key: strOf(p.api_key)
    })
    setConfirmDel('')
  }

  const saveProvider = async () => {
    const d = providerDraft
    if (!d) return
    const name = d.name.trim()
    if (!name) return setError('供应商名称不能为空')
    if (editProvider === '__add__' && providers[name]) return setError(`供应商 ${name} 已存在`)
    if (!PROVIDER_TYPES.includes(d.type)) return setError('请选择供应商类型')
    const body: Rec = { type: d.type }
    // api_key 已回显进草稿:非空 = 写入,清空 = 删除该键(null 合并语义)
    body.api_key = d.api_key.trim() ? d.api_key.trim() : null
    body.base_url = d.base_url.trim() ? d.base_url.trim() : null
    const patch: Rec = { providers: { [name]: body } }
    if (await apply(patch, `供应商 ${name} 已保存`)) {
      setEditProvider(null)
      setProviderDraft(null)
    }
  }

  const removeProvider = async (name: string) => {
    const refs = Object.entries(models).filter(([, m]) => strOf(asRec(m).provider) === name)
    if (refs.length) {
      setError(`供应商 ${name} 被 ${refs.length} 个模型引用(${refs.map(([a]) => a).join('、')}),请先删除或改绑这些模型`)
      return
    }
    if (confirmDel !== `p:${name}`) return setConfirmDel(`p:${name}`)
    if (await apply({ providers: { [name]: null } }, `供应商 ${name} 已删除`)) setConfirmDel('')
  }

  /* ---------------- 模型 ---------------- */

  const startEditModel = (alias: string) => {
    const m = asRec(models[alias])
    setEditModel(alias)
    setModelDraft({
      alias,
      provider: strOf(m.provider) || Object.keys(providers)[0] || '',
      model: strOf(m.model),
      display_name: strOf(m.display_name),
      max_context_size: numOf(m.max_context_size),
      capabilities: listOf(m.capabilities),
      support_efforts: listOf(m.support_efforts),
      default_effort: strOf(m.default_effort)
    })
    setConfirmDel('')
  }

  const saveModel = async () => {
    const d = modelDraft
    if (!d) return
    const alias = d.alias.trim()
    if (!alias) return setError('模型别名不能为空')
    if (editModel === '__add__' && models[alias]) return setError(`模型别名 ${alias} 已存在`)
    if (!d.provider) return setError('请选择供应商')
    if (!providers[d.provider]) return setError(`供应商 ${d.provider} 不存在`)
    if (!d.model.trim()) return setError('模型 ID 不能为空')
    const ctx = Number(d.max_context_size.trim())
    if (!Number.isInteger(ctx) || ctx < 1) return setError('上下文大小必须是正整数(单位 token)')
    const body: Rec = {
      provider: d.provider,
      model: d.model.trim(),
      max_context_size: ctx,
      display_name: d.display_name.trim() ? d.display_name.trim() : null,
      capabilities: d.capabilities,
      support_efforts: d.support_efforts,
      default_effort: d.default_effort ? d.default_effort : null
    }
    if (await apply({ models: { [alias]: body } }, `模型 ${alias} 已保存`)) {
      setEditModel(null)
      setModelDraft(null)
    }
  }

  const removeModel = async (alias: string) => {
    if (alias === defaultModel) {
      setError(`${alias} 是默认模型,请先把默认模型切换为其他别名`)
      return
    }
    if (confirmDel !== `m:${alias}`) return setConfirmDel(`m:${alias}`)
    if (await apply({ models: { [alias]: null } }, `模型 ${alias} 已删除`)) setConfirmDel('')
  }

  const setDefault = async (alias: string) => {
    await apply({ default_model: alias }, `默认模型已切换为 ${alias}`)
  }

  /* ---------------- 渲染 ---------------- */

  /** 单个模型条目(分组视图内复用) */
  const renderModel = (alias: string, mv: unknown) => {
    const m = asRec(mv)
    const isDefault = alias === defaultModel
    const editing = editModel === alias && modelDraft
    return (
      <div key={alias} className="rounded-lg border border-border-light p-3">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="shrink-0 text-primary" />
          <span className="truncate font-mono text-[13px] font-medium">{alias}</span>
          {strOf(m.display_name) && (
            <span className="truncate text-[12px] text-text-tertiary">{strOf(m.display_name)}</span>
          )}
          {isDefault && (
            <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-white">默认</span>
          )}
          <div className="ml-auto flex shrink-0 gap-1.5">
            {!isDefault && (
              <button
                className="rounded-lg border border-border p-1.5 text-text-tertiary hover:border-primary-border hover:text-primary"
                title="设为默认模型"
                disabled={saving}
                onClick={() => void setDefault(alias)}
              >
                <Star size={13} />
              </button>
            )}
            <button
              className="rounded-lg border border-border p-1.5 text-text-tertiary hover:bg-surface-tertiary"
              title="编辑"
              onClick={() => (editing ? setEditModel(null) : startEditModel(alias))}
            >
              <Pencil size={13} />
            </button>
            <button
              className={`rounded-lg border p-1.5 transition-colors ${
                confirmDel === `m:${alias}`
                  ? 'border-danger bg-danger-soft text-danger'
                  : 'border-border text-text-tertiary hover:bg-danger-soft hover:text-danger'
              }`}
              title={confirmDel === `m:${alias}` ? '再点一次确认删除' : '删除'}
              onClick={() => void removeModel(alias)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {!editing && (
          <p className="mt-1 truncate font-mono text-[11.5px] text-text-tertiary">
            {strOf(m.model) || '?'} · 上下文 {fmtCtx(m.max_context_size)}
            {listOf(m.support_efforts).length > 0 && ` · efforts: ${listOf(m.support_efforts).join('/')}`}
            {strOf(m.default_effort) && `(默认 ${strOf(m.default_effort)})`}
          </p>
        )}
        {editing && (
          <ModelEditor
            draft={modelDraft}
            onChange={setModelDraft}
            providers={Object.keys(providers)}
            saving={saving}
            lockAlias
            onCancel={() => setEditModel(null)}
            onSave={() => void saveModel()}
          />
        )}
      </div>
    )
  }

  /** 按供应商分组:先按 providers 声明顺序,未匹配的归入"(未指定)" */
  const modelGroups: { provider: string; entries: [string, unknown][] }[] = []
  {
    const byProvider = new Map<string, [string, unknown][]>()
    for (const name of Object.keys(providers)) byProvider.set(name, [])
    for (const entry of Object.entries(models)) {
      const prov = strOf(asRec(entry[1]).provider)
      const key = prov && byProvider.has(prov) ? prov : '(未指定)'
      if (!byProvider.has(key)) byProvider.set(key, [])
      byProvider.get(key)!.push(entry)
    }
    for (const [provider, entries] of byProvider) {
      if (entries.length) modelGroups.push({ provider, entries })
    }
  }

  return (
    <>
      <GroupLabel>供应商(providers)</GroupLabel>
      <Card className="space-y-3">
        {Object.keys(providers).length === 0 && editProvider !== '__add__' && (
          <p className="text-[12.5px] text-text-tertiary">尚未配置供应商</p>
        )}
        {Object.entries(providers).map(([name, pv]) => {
          const p = asRec(pv)
          const editing = editProvider === name && providerDraft
          return (
            <div key={name} className="rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2">
                <Boxes size={14} className="shrink-0 text-primary" />
                <span className="truncate font-mono text-[13px] font-medium">{name}</span>
                <span className="rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-[11px] text-text-tertiary">
                  {strOf(p.type) || '?'}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    strOf(p.api_key) || asRec(p.oauth).key
                      ? 'bg-success-soft text-success'
                      : 'bg-surface-tertiary text-text-tertiary'
                  }`}
                >
                  {strOf(p.api_key) ? '密钥已配置' : asRec(p.oauth).key ? 'OAuth 登录' : '未配置密钥'}
                </span>
                <div className="ml-auto flex shrink-0 gap-1.5">
                  <button
                    className="rounded-lg border border-border p-1.5 text-text-tertiary hover:bg-surface-tertiary"
                    title="编辑"
                    onClick={() => (editing ? setEditProvider(null) : startEditProvider(name))}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className={`rounded-lg border p-1.5 transition-colors ${
                      confirmDel === `p:${name}`
                        ? 'border-danger bg-danger-soft text-danger'
                        : 'border-border text-text-tertiary hover:bg-danger-soft hover:text-danger'
                    }`}
                    title={confirmDel === `p:${name}` ? '再点一次确认删除' : '删除'}
                    onClick={() => void removeProvider(name)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {!editing && strOf(p.base_url) && (
                <p className="mt-1 truncate font-mono text-[11.5px] text-text-tertiary">{strOf(p.base_url)}</p>
              )}
              {editing && (
                <div className="mt-3 space-y-2 border-t border-border-light pt-3">
                  <Row label="类型">
                    <Select value={providerDraft.type} onChange={(v) => setProviderDraft({ ...providerDraft, type: v })} options={PROVIDER_TYPES} />
                  </Row>
                  <Row label="Base URL">
                    <TextInput mono value={providerDraft.base_url} onChange={(v) => setProviderDraft({ ...providerDraft, base_url: v })} placeholder="留空用类型默认端点" />
                  </Row>
                  <Row label="API Key">
                    <SecretInput value={providerDraft.api_key} onChange={(v) => setProviderDraft({ ...providerDraft, api_key: v })} placeholder="sk-...(清空则删除密钥)" />
                  </Row>
                  <div className="flex justify-end gap-2 pt-1">
                    <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text-secondary hover:bg-surface-tertiary" onClick={() => setEditProvider(null)}>
                      取消
                    </button>
                    <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={saving} onClick={() => void saveProvider()}>
                      {saving ? '保存中…' : '保存'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {editProvider === '__add__' && providerDraft && (
          <div className="rounded-lg border border-dashed border-primary-border bg-primary-soft/40 p-3">
            <div className="space-y-2">
              <Row label="名称">
                <TextInput mono value={providerDraft.name} onChange={(v) => setProviderDraft({ ...providerDraft, name: v })} placeholder="如 my-openai(字母数字、-、_、:)" />
              </Row>
              <Row label="类型">
                <Select value={providerDraft.type} onChange={(v) => setProviderDraft({ ...providerDraft, type: v })} options={PROVIDER_TYPES} />
              </Row>
              <Row label="Base URL">
                <TextInput mono value={providerDraft.base_url} onChange={(v) => setProviderDraft({ ...providerDraft, base_url: v })} placeholder="如 https://api.openai.com/v1" />
              </Row>
              <Row label="API Key">
                <SecretInput value={providerDraft.api_key} onChange={(v) => setProviderDraft({ ...providerDraft, api_key: v })} placeholder="sk-...(可留空)" />
              </Row>
              <div className="flex justify-end gap-2 pt-1">
                <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text-secondary hover:bg-surface-tertiary" onClick={() => setEditProvider(null)}>
                  取消
                </button>
                <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={saving} onClick={() => void saveProvider()}>
                  {saving ? '保存中…' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}
        {editProvider !== '__add__' && (
          <button
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
            onClick={() => {
              setEditProvider('__add__')
              setProviderDraft({ name: '', type: 'openai', base_url: '', api_key: '' })
              setConfirmDel('')
            }}
          >
            <Plus size={12} /> 添加供应商
          </button>
        )}
      </Card>

      <GroupLabel>模型(models,按供应商分组)</GroupLabel>
      <Card className="space-y-4">
        {Object.keys(models).length === 0 && editModel !== '__add__' && (
          <p className="text-[12.5px] text-text-tertiary">尚未配置模型;添加模型后即可在通用行为页设为默认</p>
        )}
        {modelGroups.map((g) => {
          const folded = collapsed.has(g.provider)
          return (
            <div key={g.provider} className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[12px] font-medium text-text-secondary hover:bg-surface-tertiary"
                title={folded ? '展开' : '折叠'}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    if (next.has(g.provider)) next.delete(g.provider)
                    else next.add(g.provider)
                    return next
                  })
                }
              >
                {folded ? (
                  <ChevronRight size={12} className="text-text-tertiary" />
                ) : (
                  <ChevronDown size={12} className="text-text-tertiary" />
                )}
                <Boxes size={12} className="text-text-tertiary" />
                <span className="font-mono">{g.provider}</span>
                <span className="text-text-tertiary">({g.entries.length})</span>
              </button>
              {!folded && (
                <div className="space-y-3">{g.entries.map(([alias, mv]) => renderModel(alias, mv))}</div>
              )}
            </div>
          )
        })}
        {editModel === '__add__' && modelDraft && (
          <div className="rounded-lg border border-dashed border-primary-border bg-primary-soft/40 p-3">
            <ModelEditor
              draft={modelDraft}
              onChange={setModelDraft}
              providers={Object.keys(providers)}
              saving={saving}
              onCancel={() => setEditModel(null)}
              onSave={() => void saveModel()}
            />
          </div>
        )}
        {editModel !== '__add__' && (
          <button
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
            disabled={Object.keys(providers).length === 0}
            title={Object.keys(providers).length === 0 ? '请先添加供应商' : ''}
            onClick={() => {
              setEditModel('__add__')
              setModelDraft({
                alias: '',
                provider: Object.keys(providers)[0] ?? '',
                model: '',
                display_name: '',
                max_context_size: '262144',
                capabilities: ['thinking', 'image_in', 'tool_use'],
                support_efforts: [],
                default_effort: ''
              })
              setConfirmDel('')
            }}
          >
            <Plus size={12} /> 添加模型
          </button>
        )}
      </Card>

      {error && <p className="text-[12px] text-danger">{error}</p>}
      {savedMsg && <p className="text-[12px] text-success">{savedMsg}</p>}
      <p className="text-[11.5px] text-text-tertiary">
        保存直接写入 config.toml(自动备份 .kimi-desktop-bak);模型别名习惯为 供应商/模型 形式,带 . 的别名在 TOML 中会自动加引号
      </p>
    </>
  )
}

/** 模型行内编辑表单:编辑时锁定别名(改名 = 删除+新增),新增时可填 */
function ModelEditor(props: {
  draft: ModelDraft
  onChange: (d: ModelDraft) => void
  providers: string[]
  saving: boolean
  lockAlias?: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const { draft: d, onChange } = props
  return (
    <div className="mt-3 space-y-2 border-t border-border-light pt-3">
      <Row label="别名">
        <TextInput mono value={d.alias} onChange={(v) => !props.lockAlias && onChange({ ...d, alias: v })} placeholder="如 kimi-code/k3(供应商/模型)" />
      </Row>
      <Row label="供应商">
        <Select value={d.provider} onChange={(v) => onChange({ ...d, provider: v })} options={props.providers} />
      </Row>
      <Row label="模型 ID">
        <TextInput mono value={d.model} onChange={(v) => onChange({ ...d, model: v })} placeholder="发给服务端的模型标识,如 k3" />
      </Row>
      <Row label="显示名">
        <TextInput value={d.display_name} onChange={(v) => onChange({ ...d, display_name: v })} placeholder="可选,UI 显示用" />
      </Row>
      <Row label="上下文大小">
        <TextInput mono value={d.max_context_size} onChange={(v) => onChange({ ...d, max_context_size: v })} placeholder="token 数,如 262144" />
      </Row>
      <Row label="能力">
        <CheckTags options={CAPABILITIES} values={d.capabilities} hints={CAPABILITY_HINTS} onChange={(v) => onChange({ ...d, capabilities: v })} />
      </Row>
      <Row label="思考档位">
        <CheckTags options={EFFORTS} values={d.support_efforts} hints={EFFORT_HINTS} onChange={(v) => onChange({ ...d, support_efforts: v, default_effort: v.includes(d.default_effort) ? d.default_effort : '' })} />
      </Row>
      <Row label="默认档位">
        <Select value={d.default_effort} onChange={(v) => onChange({ ...d, default_effort: v })} options={d.support_efforts} allowEmpty="未设置(跟随全局/内置)" />
      </Row>
      <div className="flex justify-end gap-2 pt-1">
        <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text-secondary hover:bg-surface-tertiary" onClick={props.onCancel}>
          取消
        </button>
        <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={props.saving} onClick={props.onSave}>
          {props.saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
