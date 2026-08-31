/**
 * CLI 配置 · 模型与供应商:providers / models / default_model 的可视化管理。
 * 数据源为 config.toml 文件直读直写(cliConfigParsed / cliConfigMerge),不依赖 kimi web 服务:
 * REST 对部分配置段会静默丢弃(identity 实测),且文件合并写保留注释、自动备份。
 * 密钥以密码形式回显(默认掩码,可点眼睛查看明文),清空 = 保持不变;其他可选项留空 = 删除该键(null 合并语义)。
 */
import { useCallback, useEffect, useState } from 'react'
import { Bot, Boxes, ChevronDown, ChevronRight, Cpu, Eye, EyeOff, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { Card, Empty, GroupLabel, Section } from '../../components/settings/common'
import { Select as UiSelect } from '../../components/ui/Select'
import { inputCls as uiInputCls } from '../../components/ui/Input'
import { ToggleField } from './cliForm'
import { useT } from '../../i18n'

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

/** 未匹配任何供应商的模型归入的分组键(内部哨兵,不在供应商名合法字符集内;显示时经 i18n 翻译) */
const UNGROUPED_KEY = '(ungrouped)'

/** 上下文大小紧凑显示:262144 → 256K,1048576 → 1M */
function fmtCtx(n: unknown): string {
  if (typeof n !== 'number' || n <= 0) return '—'
  if (n >= 1048576 && n % 1048576 === 0) return `${n / 1048576}M`
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`
  return String(n)
}

/* ---------------- 小控件 ---------------- */

const inputCls = uiInputCls('md')

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
      className={`w-full max-w-xl ${inputCls} ${props.mono ? 'font-mono' : ''}`}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

function Select(props: { value: string; onChange: (v: string) => void; options: string[]; allowEmpty?: string }) {
  const opts = [
    ...(props.allowEmpty !== undefined ? [{ value: '', label: props.allowEmpty }] : []),
    ...props.options.map((o) => ({ value: o, label: o }))
  ]
  return (
    <UiSelect className="w-full max-w-xl" value={props.value} options={opts} onChange={props.onChange} />
  )
}

/** 密钥输入:默认密码掩码回显,右侧眼睛可切换明文 */
function SecretInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useT()
  const [show, setShow] = useState(false)
  return (
    <div className="relative w-full max-w-xl">
      <input
        type={show ? 'text' : 'password'}
        className={`w-full pr-8 font-mono ${inputCls}`}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
        title={show ? t('settings.cliModels.hideSecret') : t('settings.cliModels.showSecret')}
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

/** 子智能体模型池条目草稿:alias 引用 models 中的模型别名,description 是主 agent 的挑选依据 */
interface SecModelDraft {
  alias: string
  description: string
}

export function CliModelsSettings() {
  const t = useT()
  const [config, setConfig] = useState<Rec | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /** silent = true 时后台刷新(保存后调用):不卸载表单,避免页面高度塌陷导致滚动跳顶 */
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      setConfig(await window.kimiApi.cliConfigParsed())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <Section
      title={t('settings.cliModels.title')}
      desc={t('settings.cliModels.desc')}
    >
      {loading ? (
        <Empty text={t('settings.cliModels.loading')} />
      ) : error ? (
        <>
          <Empty text={t('settings.cliModels.readFailed', { error })} />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover"
              onClick={() => void reload()}
            >
              {t('settings.cliModels.retry')}
            </button>
          </div>
        </>
      ) : (
        <ModelsForm config={config ?? {}} reload={reload} />
      )}
    </Section>
  )
}

function ModelsForm({ config, reload }: { config: Rec; reload: (silent?: boolean) => Promise<void> }) {
  const t = useT()
  const providers = asRec(config.providers)
  const models = asRec(config.models)
  const defaultModel = strOf(config.default_model)
  // 子智能体模型池:[secondary_model] default_model + [secondary_model.models] 别名 → 描述 + force
  // 官方语义:仅写 default_model(无 models 表)= 隐式单条目池;有 models 表时 default_model 必填且必须是池中 key;
  // force = true 收回主 agent 选择权(需 default_model,与 models 表互斥);primary 为保留字,不能作池中 key
  const secModel = asRec(config.secondary_model)
  const secModels = asRec(secModel.models)
  const secDefault = strOf(secModel.default_model)
  const secForce = secModel.force === true
  // 非规范键(model / default_effort 不在官方 secondary_model 字段中),提示用户迁移
  const secLegacyModel = strOf(secModel.model)
  const secLegacyEffort = strOf(secModel.default_effort)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  // 行内编辑状态:null = 未编辑;'__add__' = 新增表单
  const [editProvider, setEditProvider] = useState<string | null>(null)
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null)
  const [editModel, setEditModel] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  const [editSecModel, setEditSecModel] = useState<string | null>(null)
  const [secDraft, setSecDraft] = useState<SecModelDraft | null>(null)
  // 二次确认删除
  const [confirmDel, setConfirmDel] = useState('')
  // 模型分组的折叠状态(按供应商名)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  /** 统一保存入口:合并写 → 静默重读文件(不卸载表单,保持滚动位置)→ 提示 */
  const apply = async (patch: Rec, okText: string) => {
    setSaving(true)
    setError('')
    setSavedMsg('')
    try {
      await window.kimiApi.cliConfigMerge(patch)
      await reload(true)
      setSavedMsg(t('settings.cliModels.savedSuffix', { text: okText }))
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
    if (!name) return setError(t('settings.cliModels.errProviderNameEmpty'))
    if (editProvider === '__add__' && providers[name])
      return setError(t('settings.cliModels.errProviderExists', { name }))
    if (!PROVIDER_TYPES.includes(d.type)) return setError(t('settings.cliModels.errProviderType'))
    const body: Rec = { type: d.type }
    // api_key 已回显进草稿:非空 = 写入,清空 = 删除该键(null 合并语义)
    body.api_key = d.api_key.trim() ? d.api_key.trim() : null
    body.base_url = d.base_url.trim() ? d.base_url.trim() : null
    const patch: Rec = { providers: { [name]: body } }
    if (await apply(patch, t('settings.cliModels.providerSaved', { name }))) {
      setEditProvider(null)
      setProviderDraft(null)
    }
  }

  const removeProvider = async (name: string) => {
    const refs = Object.entries(models).filter(([, m]) => strOf(asRec(m).provider) === name)
    if (refs.length) {
      setError(
        t('settings.cliModels.providerReferenced', {
          name,
          count: refs.length,
          list: refs.map(([a]) => a).join(t('settings.cliModels.listSep'))
        })
      )
      return
    }
    if (confirmDel !== `p:${name}`) return setConfirmDel(`p:${name}`)
    if (await apply({ providers: { [name]: null } }, t('settings.cliModels.providerDeleted', { name })))
      setConfirmDel('')
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
    if (!alias) return setError(t('settings.cliModels.errAliasEmpty'))
    if (editModel === '__add__' && models[alias])
      return setError(t('settings.cliModels.errAliasExists', { alias }))
    if (!d.provider) return setError(t('settings.cliModels.errNoProvider'))
    if (!providers[d.provider])
      return setError(t('settings.cliModels.errProviderMissing', { name: d.provider }))
    if (!d.model.trim()) return setError(t('settings.cliModels.errModelIdEmpty'))
    const ctx = Number(d.max_context_size.trim())
    if (!Number.isInteger(ctx) || ctx < 1) return setError(t('settings.cliModels.errCtxInvalid'))
    const body: Rec = {
      provider: d.provider,
      model: d.model.trim(),
      max_context_size: ctx,
      display_name: d.display_name.trim() ? d.display_name.trim() : null,
      capabilities: d.capabilities,
      support_efforts: d.support_efforts,
      default_effort: d.default_effort ? d.default_effort : null
    }
    if (await apply({ models: { [alias]: body } }, t('settings.cliModels.modelSaved', { alias }))) {
      setEditModel(null)
      setModelDraft(null)
    }
  }

  const removeModel = async (alias: string) => {
    if (alias === defaultModel) {
      setError(t('settings.cliModels.errIsDefault', { alias }))
      return
    }
    if (confirmDel !== `m:${alias}`) return setConfirmDel(`m:${alias}`)
    if (await apply({ models: { [alias]: null } }, t('settings.cliModels.modelDeleted', { alias })))
      setConfirmDel('')
  }

  const setDefault = async (alias: string) => {
    await apply({ default_model: alias }, t('settings.cliModels.defaultSwitched', { alias }))
  }

  /* ---------------- 子智能体模型池(secondary_model) ---------------- */

  const startEditSecModel = (alias: string) => {
    setEditSecModel(alias)
    setSecDraft({ alias, description: strOf(secModels[alias]) })
    setConfirmDel('')
  }

  const saveSecModel = async () => {
    const d = secDraft
    if (!d) return
    const alias = d.alias.trim()
    if (!alias) return setError(t('settings.cliModels.errAliasEmpty'))
    if (alias === 'primary') return setError(t('settings.cliModels.errReservedPrimary'))
    if (!models[alias]) return setError(t('settings.cliModels.errAliasNotConfigured', { alias }))
    if (editSecModel === '__add__' && secModels[alias] !== undefined)
      return setError(t('settings.cliModels.errAlreadyInPool', { alias }))
    const pool: Rec = { [alias]: d.description.trim() }
    // 从隐式单条目池(仅 default_model)扩建时,给默认模型补一条空描述,保持 default_model 是池中 key(同 /secondary-model 行为)
    if (Object.keys(secModels).length === 0 && secDefault && secDefault !== alias && models[secDefault])
      pool[secDefault] = ''
    const sec: Rec = { models: pool }
    // 此前连 default_model 也未配置时,池内第一个模型自动成为默认,避免 default_model 缺失导致启动报错
    if (Object.keys(secModels).length === 0 && !secDefault) sec.default_model = alias
    // force 与 models 表互斥,建表时清除
    if (secForce) sec.force = null
    // 顺带清掉非规范键
    if (secLegacyModel) sec.model = null
    if (secLegacyEffort) sec.default_effort = null
    if (await apply({ secondary_model: sec }, t('settings.cliModels.secAdded', { alias }))) {
      setEditSecModel(null)
      setSecDraft(null)
    }
  }

  const removeSecModel = async (alias: string) => {
    if (confirmDel !== `s:${alias}`) return setConfirmDel(`s:${alias}`)
    const remaining = Object.keys(secModels).filter((a) => a !== alias)
    // 有 models 表时 default_model 必须是池中 key:删默认项须先切换默认
    if (alias === secDefault && remaining.length > 0) {
      setConfirmDel('')
      return setError(t('settings.cliModels.errSecIsDefault', { alias }))
    }
    // 删除最后一个条目:整表移除;若 default_model 指向它,保留 default_model 即降级为合法的隐式单条目池
    const patch: Rec =
      remaining.length === 0
        ? { secondary_model: { models: null } }
        : { secondary_model: { models: { [alias]: null } } }
    if (await apply(patch, t('settings.cliModels.secRemoved', { alias }))) setConfirmDel('')
  }

  const setSecDefault = async (alias: string) => {
    await apply(
      { secondary_model: { default_model: alias } },
      t('settings.cliModels.secDefaultSwitched', { alias })
    )
  }

  /** force 开关:固定所有 subagent 到 default_model,主 agent 不可改选(需 default_model,与 models 表互斥) */
  const toggleForce = async (on: boolean) => {
    if (on && !secDefault) return setError(t('settings.cliModels.errForceNeedDefault'))
    await apply(
      { secondary_model: { force: on ? true : null } },
      on ? t('settings.cliModels.forceOn') : t('settings.cliModels.forceOff')
    )
  }

  /** 非规范键迁移:default_model 单写即为合法的单条目隐式池 */
  const migrateLegacy = async () => {
    if (!models[secLegacyModel])
      return setError(t('settings.cliModels.errMigrateNotConfigured', { alias: secLegacyModel }))
    await apply(
      { secondary_model: { default_model: secLegacyModel, model: null, default_effort: null } },
      t('settings.cliModels.migrated')
    )
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
            <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-white">
              {t('settings.cliModels.badgeDefault')}
            </span>
          )}
          <div className="ml-auto flex shrink-0 gap-1.5">
            {!isDefault && (
              <button
                className="rounded-lg border border-border p-1.5 text-text-tertiary hover:border-primary-border hover:text-primary"
                title={t('settings.cliModels.setDefault')}
                disabled={saving}
                onClick={() => void setDefault(alias)}
              >
                <Star size={13} />
              </button>
            )}
            <button
              className="rounded-lg border border-border p-1.5 text-text-tertiary hover:bg-fill hover:text-text"
              title={t('settings.cliModels.edit')}
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
              title={
                confirmDel === `m:${alias}`
                  ? t('settings.cliModels.confirmDelete')
                  : t('settings.cliModels.delete')
              }
              onClick={() => void removeModel(alias)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {!editing && (
          <p className="mt-1 truncate font-mono text-[11.5px] text-text-tertiary">
            {strOf(m.model) || '?'} · {t('settings.cliModels.ctx', { size: fmtCtx(m.max_context_size) })}
            {listOf(m.support_efforts).length > 0 && ` · efforts: ${listOf(m.support_efforts).join('/')}`}
            {strOf(m.default_effort) &&
              t('settings.cliModels.defaultEffort', { effort: strOf(m.default_effort) })}
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

  /** 按供应商分组:先按 providers 声明顺序,未匹配的归入 UNGROUPED_KEY 哨兵组(显示时翻译) */
  const modelGroups: { provider: string; entries: [string, unknown][] }[] = []
  {
    const byProvider = new Map<string, [string, unknown][]>()
    for (const name of Object.keys(providers)) byProvider.set(name, [])
    for (const entry of Object.entries(models)) {
      const prov = strOf(asRec(entry[1]).provider)
      const key = prov && byProvider.has(prov) ? prov : UNGROUPED_KEY
      if (!byProvider.has(key)) byProvider.set(key, [])
      byProvider.get(key)!.push(entry)
    }
    for (const [provider, entries] of byProvider) {
      if (entries.length) modelGroups.push({ provider, entries })
    }
  }

  return (
    <>
      <GroupLabel>{t('settings.cliModels.providersLabel')}</GroupLabel>
      <Card className="space-y-3">
        {Object.keys(providers).length === 0 && editProvider !== '__add__' && (
          <p className="text-[12.5px] text-text-tertiary">{t('settings.cliModels.noProviders')}</p>
        )}
        {Object.entries(providers).map(([name, pv]) => {
          const p = asRec(pv)
          const editing = editProvider === name && providerDraft
          return (
            <div key={name} className="rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2">
                <Boxes size={14} className="shrink-0 text-primary" />
                <span className="truncate font-mono text-[13px] font-medium">{name}</span>
                <span className="rounded bg-fill px-1.5 py-0.5 font-mono text-[11px] text-text-tertiary">
                  {strOf(p.type) || '?'}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    strOf(p.api_key) || asRec(p.oauth).key
                      ? 'bg-success-soft text-success'
                      : 'bg-fill text-text-tertiary'
                  }`}
                >
                  {strOf(p.api_key)
                    ? t('settings.cliModels.keyConfigured')
                    : asRec(p.oauth).key
                      ? t('settings.cliModels.oauthLoggedIn')
                      : t('settings.cliModels.noKey')}
                </span>
                <div className="ml-auto flex shrink-0 gap-1.5">
                  <button
                    className="rounded-lg border border-border p-1.5 text-text-tertiary hover:bg-fill hover:text-text"
                    title={t('settings.cliModels.edit')}
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
                    title={
                      confirmDel === `p:${name}`
                        ? t('settings.cliModels.confirmDelete')
                        : t('settings.cliModels.delete')
                    }
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
                  <Row label={t('settings.cliModels.type')}>
                    <Select value={providerDraft.type} onChange={(v) => setProviderDraft({ ...providerDraft, type: v })} options={PROVIDER_TYPES} />
                  </Row>
                  <Row label="Base URL">
                    <TextInput mono value={providerDraft.base_url} onChange={(v) => setProviderDraft({ ...providerDraft, base_url: v })} placeholder={t('settings.cliModels.baseUrlPlaceholder')} />
                  </Row>
                  <Row label="API Key">
                    <SecretInput value={providerDraft.api_key} onChange={(v) => setProviderDraft({ ...providerDraft, api_key: v })} placeholder={t('settings.cliModels.apiKeyPlaceholderEdit')} />
                  </Row>
                  <div className="flex justify-end gap-2 pt-1">
                    <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text hover:bg-fill" onClick={() => setEditProvider(null)}>
                      {t('settings.cliModels.cancel')}
                    </button>
                    <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={saving} onClick={() => void saveProvider()}>
                      {saving ? t('settings.cliModels.saving') : t('settings.cliModels.save')}
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
              <Row label={t('settings.cliModels.name')}>
                <TextInput mono value={providerDraft.name} onChange={(v) => setProviderDraft({ ...providerDraft, name: v })} placeholder={t('settings.cliModels.providerNamePlaceholder')} />
              </Row>
              <Row label={t('settings.cliModels.type')}>
                <Select value={providerDraft.type} onChange={(v) => setProviderDraft({ ...providerDraft, type: v })} options={PROVIDER_TYPES} />
              </Row>
              <Row label="Base URL">
                <TextInput mono value={providerDraft.base_url} onChange={(v) => setProviderDraft({ ...providerDraft, base_url: v })} placeholder={t('settings.cliModels.baseUrlExamplePlaceholder')} />
              </Row>
              <Row label="API Key">
                <SecretInput value={providerDraft.api_key} onChange={(v) => setProviderDraft({ ...providerDraft, api_key: v })} placeholder={t('settings.cliModels.apiKeyPlaceholderAdd')} />
              </Row>
              <div className="flex justify-end gap-2 pt-1">
                <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text hover:bg-fill" onClick={() => setEditProvider(null)}>
                  {t('settings.cliModels.cancel')}
                </button>
                <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={saving} onClick={() => void saveProvider()}>
                  {saving ? t('settings.cliModels.saving') : t('settings.cliModels.add')}
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
            <Plus size={12} /> {t('settings.cliModels.addProvider')}
          </button>
        )}
      </Card>

      <GroupLabel>{t('settings.cliModels.modelsLabel')}</GroupLabel>
      <Card className="space-y-4">
        {Object.keys(models).length === 0 && editModel !== '__add__' && (
          <p className="text-[12.5px] text-text-tertiary">{t('settings.cliModels.noModels')}</p>
        )}
        {modelGroups.map((g) => {
          const folded = collapsed.has(g.provider)
          return (
            <div key={g.provider} className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[12px] font-medium text-text-secondary hover:bg-fill hover:text-text"
                title={folded ? t('settings.cliModels.expand') : t('settings.cliModels.collapse')}
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
                <span className="font-mono">
                  {g.provider === UNGROUPED_KEY ? t('settings.cliModels.ungrouped') : g.provider}
                </span>
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
            title={Object.keys(providers).length === 0 ? t('settings.cliModels.addModelNeedProvider') : ''}
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
            <Plus size={12} /> {t('settings.cliModels.addModel')}
          </button>
        )}
      </Card>

      <GroupLabel>{t('settings.cliModels.secLabel')}</GroupLabel>
      <Card className="space-y-3">
        <p className="text-[12px] text-text-tertiary">{t('settings.cliModels.secDesc')}</p>
        {Object.keys(secModels).length > 0 && !secDefault && (
          <p className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {t('settings.cliModels.warnNoDefault')}
          </p>
        )}
        {Object.keys(secModels).length > 0 && secDefault && !(secDefault in secModels) && (
          <p className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            default_model(<span className="font-mono">{secDefault}</span>
            {t('settings.cliModels.warnDefaultNotInPoolSuffix')}
          </p>
        )}
        {secForce && Object.keys(secModels).length > 0 && (
          <p className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {t('settings.cliModels.warnForceConflict')}
          </p>
        )}
        {Object.keys(secModels).length === 0 &&
          editSecModel !== '__add__' &&
          (secLegacyModel ? (
            <div className="rounded-lg border border-warning/20 bg-warning-soft px-3 py-2">
              <p className="text-[12.5px] text-warning">
                {t('settings.cliModels.legacyKeys')}
                <span className="font-mono">model = "{secLegacyModel}"</span>
                {secLegacyEffort && (
                  <span className="font-mono">
                    {t('settings.cliModels.legacyEffortPart', { effort: secLegacyEffort })}
                  </span>
                )}
                {t('settings.cliModels.legacySuffix')}
              </p>
              <p className="mt-1 text-[12px] text-text-tertiary">{t('settings.cliModels.legacyDesc')}</p>
              <button
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:text-primary"
                disabled={saving}
                onClick={() => void migrateLegacy()}
              >
                <Plus size={12} /> {t('settings.cliModels.migrateBtn')}
              </button>
            </div>
          ) : secDefault ? (
            <div className="rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2">
                <Bot size={14} className="shrink-0 text-primary" />
                <span className="truncate font-mono text-[13px] font-medium">{secDefault}</span>
                <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {t('settings.cliModels.badgeDefault')}
                </span>
                {!models[secDefault] && (
                  <span
                    className="rounded bg-danger-soft px-1.5 py-0.5 text-[11px] text-danger"
                    title={t('settings.cliModels.modelMissingTitle')}
                  >
                    {t('settings.cliModels.modelMissing')}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-text-tertiary">
                {t('settings.cliModels.implicitPoolDesc')}
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-text-tertiary">{t('settings.cliModels.secEmpty')}</p>
          ))}
        {Object.keys(secModels).length === 0 && (
          <ToggleField
            label={t('settings.cliModels.forceLabel')}
            desc={t('settings.cliModels.forceDesc')}
            checked={secForce}
            onChange={(v) => void toggleForce(v)}
          />
        )}
        {Object.entries(secModels).map(([alias, desc]) => {
          const isDefault = alias === secDefault
          const editing = editSecModel === alias && secDraft
          const missing = !models[alias]
          return (
            <div key={alias} className="rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2">
                <Bot size={14} className="shrink-0 text-primary" />
                <span className="truncate font-mono text-[13px] font-medium">{alias}</span>
                {isDefault && (
                  <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-white">
                    {t('settings.cliModels.badgeDefault')}
                  </span>
                )}
                {missing && (
                  <span
                    className="rounded bg-danger-soft px-1.5 py-0.5 text-[11px] text-danger"
                    title={t('settings.cliModels.modelMissingTitle')}
                  >
                    {t('settings.cliModels.modelMissing')}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 gap-1.5">
                  {!isDefault && (
                    <button
                      className="rounded-lg border border-border p-1.5 text-text-tertiary hover:border-primary-border hover:text-primary"
                      title={t('settings.cliModels.setSecDefault')}
                      disabled={saving}
                      onClick={() => void setSecDefault(alias)}
                    >
                      <Star size={13} />
                    </button>
                  )}
                  <button
                    className="rounded-lg border border-border p-1.5 text-text-tertiary hover:bg-fill hover:text-text"
                    title={t('settings.cliModels.editDesc')}
                    onClick={() => (editing ? setEditSecModel(null) : startEditSecModel(alias))}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className={`rounded-lg border p-1.5 transition-colors ${
                      confirmDel === `s:${alias}`
                        ? 'border-danger bg-danger-soft text-danger'
                        : 'border-border text-text-tertiary hover:bg-danger-soft hover:text-danger'
                    }`}
                    title={
                      confirmDel === `s:${alias}`
                        ? t('settings.cliModels.confirmRemove')
                        : t('settings.cliModels.removeFromPool')
                    }
                    onClick={() => void removeSecModel(alias)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {!editing && (
                <p className="mt-1 text-[12px] text-text-tertiary">
                  {strOf(desc) || t('settings.cliModels.noDesc')}
                </p>
              )}
              {editing && (
                <div className="mt-3 space-y-2 border-t border-border-light pt-3">
                  <Row label={t('settings.cliModels.aliasLabel')}>
                    <span className="font-mono text-[12.5px] text-text-secondary">{secDraft.alias}</span>
                  </Row>
                  <Row label={t('settings.cliModels.descLabel')}>
                    <TextInput
                      value={secDraft.description}
                      onChange={(v) => setSecDraft({ ...secDraft, description: v })}
                      placeholder={t('settings.cliModels.secDescPlaceholderEdit')}
                    />
                  </Row>
                  <div className="flex justify-end gap-2 pt-1">
                    <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text hover:bg-fill" onClick={() => setEditSecModel(null)}>
                      {t('settings.cliModels.cancel')}
                    </button>
                    <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={saving} onClick={() => void saveSecModel()}>
                      {saving ? t('settings.cliModels.saving') : t('settings.cliModels.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {editSecModel === '__add__' && secDraft && (
          <div className="rounded-lg border border-dashed border-primary-border bg-primary-soft/40 p-3">
            <div className="space-y-2">
              <Row label={t('settings.cliModels.aliasLabel')}>
                <Select
                  value={secDraft.alias}
                  onChange={(v) => setSecDraft({ ...secDraft, alias: v })}
                  options={Object.keys(models).filter((a) => !(a in secModels))}
                />
              </Row>
              <Row label={t('settings.cliModels.descLabel')}>
                <TextInput
                  value={secDraft.description}
                  onChange={(v) => setSecDraft({ ...secDraft, description: v })}
                  placeholder={t('settings.cliModels.secDescPlaceholderAdd')}
                />
              </Row>
              <div className="flex justify-end gap-2 pt-1">
                <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text hover:bg-fill" onClick={() => setEditSecModel(null)}>
                  {t('settings.cliModels.cancel')}
                </button>
                <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={saving} onClick={() => void saveSecModel()}>
                  {saving ? t('settings.cliModels.saving') : t('settings.cliModels.add')}
                </button>
              </div>
            </div>
          </div>
        )}
        {editSecModel !== '__add__' && (
          <button
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary disabled:opacity-50"
            disabled={Object.keys(models).filter((a) => !(a in secModels)).length === 0}
            title={
              Object.keys(models).length === 0
                ? t('settings.cliModels.addModelFirst')
                : Object.keys(models).filter((a) => !(a in secModels)).length === 0
                  ? t('settings.cliModels.allInPool')
                  : ''
            }
            onClick={() => {
              setEditSecModel('__add__')
              setSecDraft({ alias: Object.keys(models).filter((a) => !(a in secModels))[0] ?? '', description: '' })
              setConfirmDel('')
            }}
          >
            <Plus size={12} /> {t('settings.cliModels.addSecModel')}
          </button>
        )}
      </Card>

      {error && <p className="text-[12px] text-danger">{error}</p>}
      {savedMsg && <p className="text-[12px] text-success">{savedMsg}</p>}
      <p className="text-[11.5px] text-text-tertiary">{t('settings.cliModels.footnote')}</p>
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
  const t = useT()
  const { draft: d, onChange } = props
  /** 能力标签的悬浮提示 */
  const capabilityHints: Record<string, string> = {
    thinking: t('settings.cliModels.capHint.thinking'),
    always_thinking: t('settings.cliModels.capHint.always_thinking'),
    image_in: t('settings.cliModels.capHint.image_in'),
    video_in: t('settings.cliModels.capHint.video_in'),
    audio_in: t('settings.cliModels.capHint.audio_in'),
    tool_use: t('settings.cliModels.capHint.tool_use')
  }
  /** 思考档位的悬浮提示 */
  const effortHints: Record<string, string> = {
    low: t('settings.cliModels.effortHint.low'),
    medium: t('settings.cliModels.effortHint.medium'),
    high: t('settings.cliModels.effortHint.high'),
    xhigh: t('settings.cliModels.effortHint.xhigh'),
    max: t('settings.cliModels.effortHint.max')
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border-light pt-3">
      <Row label={t('settings.cliModels.alias')}>
        <TextInput mono value={d.alias} onChange={(v) => !props.lockAlias && onChange({ ...d, alias: v })} placeholder={t('settings.cliModels.aliasPlaceholder')} />
      </Row>
      <Row label={t('settings.cliModels.provider')}>
        <Select value={d.provider} onChange={(v) => onChange({ ...d, provider: v })} options={props.providers} />
      </Row>
      <Row label={t('settings.cliModels.modelId')}>
        <TextInput mono value={d.model} onChange={(v) => onChange({ ...d, model: v })} placeholder={t('settings.cliModels.modelIdPlaceholder')} />
      </Row>
      <Row label={t('settings.cliModels.displayName')}>
        <TextInput value={d.display_name} onChange={(v) => onChange({ ...d, display_name: v })} placeholder={t('settings.cliModels.displayNamePlaceholder')} />
      </Row>
      <Row label={t('settings.cliModels.ctxSize')}>
        <TextInput mono value={d.max_context_size} onChange={(v) => onChange({ ...d, max_context_size: v })} placeholder={t('settings.cliModels.ctxPlaceholder')} />
      </Row>
      <Row label={t('settings.cliModels.capabilities')}>
        <CheckTags options={CAPABILITIES} values={d.capabilities} hints={capabilityHints} onChange={(v) => onChange({ ...d, capabilities: v })} />
      </Row>
      <Row label={t('settings.cliModels.efforts')}>
        <CheckTags options={EFFORTS} values={d.support_efforts} hints={effortHints} onChange={(v) => onChange({ ...d, support_efforts: v, default_effort: v.includes(d.default_effort) ? d.default_effort : '' })} />
      </Row>
      <Row label={t('settings.cliModels.defaultEffortLabel')}>
        <Select value={d.default_effort} onChange={(v) => onChange({ ...d, default_effort: v })} options={d.support_efforts} allowEmpty={t('settings.cliModels.effortUnset')} />
      </Row>
      <div className="flex justify-end gap-2 pt-1">
        <button className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-text hover:bg-fill" onClick={props.onCancel}>
          {t('settings.cliModels.cancel')}
        </button>
        <button className="rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-50" disabled={props.saving} onClick={props.onSave}>
          {props.saving ? t('settings.cliModels.saving') : t('settings.cliModels.save')}
        </button>
      </div>
    </div>
  )
}
