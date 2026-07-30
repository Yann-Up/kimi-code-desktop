import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  Bot,
  Brain,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  PencilLine,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  X,
  XCircle,
  Zap
} from 'lucide-react'
import { rest } from '@/api'
import type { ModelItem } from '@/api'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'

/* ---------------- 类型 ---------------- */

interface UsageRow {
  label?: string
  used?: number
  limit?: number
  reset_hint?: string
  /** 服务端实际形态(kap-server usageRowSchema):窗口 + 重置时间戳 */
  window?: { duration?: number; unit?: string }
  reset_at?: string
}

interface UsageData {
  kind?: string
  summary?: UsageRow
  limits?: unknown
  extra_usage?: unknown
}

interface ProviderItem {
  id?: string
  name?: string
  type?: string
  base_url?: string
  models?: unknown
  custom_headers?: unknown
  [k: string]: unknown
}

interface ProviderModelRow {
  id: string
  display_name: string
}

/**
 * 滑出面板的模型表单行。providers REST 的 models 必须是对象数组,
 * 每项 max_context_size 必填;support_efforts/default_effort 等从 config 带入,非空才回传。
 */
interface PanelModelRow {
  model: string
  display_name: string
  maxCtx: string
  support_efforts: string
  default_effort: string
  capabilities?: string[]
  max_output_size?: number
}

interface HeaderRow {
  name: string
  value: string
}

/** /api/v1/config 中 models 段的单条覆盖配置 */
interface ModelOverride {
  display_name?: string
  max_context_size?: number
  capabilities?: string[]
  support_efforts?: string[]
  default_effort?: string
}

type OauthState =
  | { stage: 'idle' }
  | { stage: 'starting' }
  | { stage: 'waiting'; userCode: string; verifyUrl: string }

type PanelReq = { mode: 'create' } | { mode: 'edit'; id: string }

/* ---------------- 样式常量 ---------------- */

const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50'
const btnAddRow =
  'inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[12px] text-text-secondary transition-colors hover:border-primary hover:text-primary'
const inputCls =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-primary'
const inputErrCls =
  'w-full rounded-lg border border-danger bg-surface px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-danger'

const PROVIDER_TYPES = ['kimi', 'anthropic', 'openai', 'openai_responses', 'google-genai', 'vertexai']
const PROVIDER_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}\-_ ]*$/u
const PROVIDER_ID_HINT = '支持字母、数字、连字符、下划线和空格,需以字母或数字开头'
const CAPABILITY_OPTIONS = ['thinking', 'always_thinking', 'image_in', 'video_in', 'audio_in', 'tool_use']
const DEFAULT_CONTEXT = 262144

/* ---------------- 纯工具函数 ---------------- */

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    for (const k of ['message', 'msg', 'error', 'detail']) {
      if (typeof o[k] === 'string' && o[k]) return o[k] as string
    }
  }
  return '请求失败'
}

const isPlainObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** 后端列表可能直接是数组,也可能包在 items/providers/data 里 */
function asArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (isPlainObj(raw)) {
    for (const k of ['items', 'providers', 'models', 'data']) {
      if (Array.isArray(raw[k])) return raw[k] as T[]
    }
  }
  return []
}

/** 供应商的 models 字段兼容 string[] 与 {id, display_name}[] 两种形态 */
function parseProviderModels(raw: unknown): ProviderModelRow[] {
  if (!Array.isArray(raw)) return []
  const out: ProviderModelRow[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ id: item.trim(), display_name: '' })
    } else if (isPlainObj(item)) {
      const id = typeof item.id === 'string' ? item.id : typeof item.model === 'string' ? item.model : ''
      const dn =
        typeof item.display_name === 'string' ? item.display_name : typeof item.name === 'string' ? item.name : ''
      if (id.trim()) out.push({ id: id.trim(), display_name: dn })
    }
  }
  return out
}

/** custom_headers 兼容 {name: value} 映射与 [{name, value}] 数组 */
function parseHeaders(raw: unknown): HeaderRow[] {
  if (Array.isArray(raw)) {
    return raw
      .filter(isPlainObj)
      .map((h) => ({
        name: typeof h.name === 'string' ? h.name : typeof h.key === 'string' ? h.key : '',
        value: typeof h.value === 'string' ? h.value : ''
      }))
      .filter((h) => h.name)
  }
  if (isPlainObj(raw)) {
    return Object.entries(raw)
      .filter(([, v]) => typeof v === 'string')
      .map(([name, value]) => ({ name, value: value as string }))
  }
  return []
}

function headersToBody(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.name.trim()
    if (k) out[k] = r.value.trim()
  }
  return out
}

const emptyPanelModelRow = (): PanelModelRow => ({
  model: '',
  display_name: '',
  maxCtx: String(DEFAULT_CONTEXT),
  support_efforts: '',
  default_effort: ''
})

/** 从 /api/v1/config 的 models 段条目构建面板模型行,缺失元数据时回退默认值。
 *  注意 REST 返回 camelCase(displayName/maxContextSize/supportEfforts/defaultEffort),两种写法都兼容。 */
function panelRowFromConfig(model: string, entry: Record<string, unknown> | undefined): PanelModelRow {
  const e = entry ?? {}
  const ctx =
    typeof e.max_context_size === 'number'
      ? e.max_context_size
      : typeof e.maxContextSize === 'number'
        ? e.maxContextSize
        : DEFAULT_CONTEXT
  const dn =
    typeof e.display_name === 'string'
      ? e.display_name
      : typeof e.displayName === 'string'
        ? e.displayName
        : ''
  const se = Array.isArray(e.support_efforts)
    ? e.support_efforts
    : Array.isArray(e.supportEfforts)
      ? e.supportEfforts
      : undefined
  const de =
    typeof e.default_effort === 'string'
      ? e.default_effort
      : typeof e.defaultEffort === 'string'
        ? e.defaultEffort
        : ''
  return {
    model,
    display_name: dn,
    maxCtx: String(ctx > 0 ? ctx : DEFAULT_CONTEXT),
    support_efforts: se ? se.map(String).join(',') : '',
    default_effort: de,
    capabilities: Array.isArray(e.capabilities) ? e.capabilities.map(String) : undefined,
    max_output_size: typeof e.max_output_size === 'number' ? e.max_output_size : undefined
  }
}

/** 从 /api/v1/config 的 models 段取某模型的覆盖配置,键优先 provider/model,其次裸 model。
 *  注意:REST 返回的是 camelCase(maxContextSize/supportEfforts/defaultEffort/displayName),
 *  config.toml 落盘为 snake_case,这里两种都要兼容。 */
function overrideFor(config: Record<string, unknown> | null, m: ModelItem): ModelOverride {
  const cfgObj = config ?? {}
  const models = isPlainObj(cfgObj.models) ? (cfgObj.models as Record<string, unknown>) : {}
  const raw = models[`${m.provider}/${m.model}`] ?? models[m.model]
  if (!isPlainObj(raw)) return {}
  const r = raw as Record<string, unknown>
  const num = (a: unknown, b: unknown) =>
    typeof a === 'number' ? a : typeof b === 'number' ? b : undefined
  const str = (a: unknown, b: unknown) =>
    typeof a === 'string' ? a : typeof b === 'string' ? b : undefined
  const strArr = (a: unknown, b: unknown) =>
    Array.isArray(a) ? a.map(String) : Array.isArray(b) ? b.map(String) : undefined
  return {
    display_name: str(r.display_name, r.displayName),
    max_context_size: num(r.max_context_size, r.maxContextSize),
    capabilities: strArr(r.capabilities, r.capabilities),
    support_efforts: strArr(r.support_efforts, r.supportEfforts),
    default_effort: str(r.default_effort, r.defaultEffort)
  }
}

/** 262144 → 262K,1048576 → 1M */
function fmtContext(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 1000) {
    const v = n / 1000
    return `${v >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(n)
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return n.toLocaleString('zh-CN')
}

/** 从认证快照里探测身份显示名(邮箱/账号等) */
function probeWho(o: Record<string, unknown>): string {
  for (const k of ['email', 'account', 'username', 'user_name', 'nickname', 'name', 'user_id']) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  for (const k of ['user', 'account', 'profile']) {
    const v = o[k]
    if (isPlainObj(v)) {
      for (const k2 of ['email', 'name', 'username', 'nickname', 'id']) {
        const v2 = v[k2]
        if (typeof v2 === 'string' && v2.trim()) return v2.trim()
      }
    }
  }
  return ''
}

/** GET /api/v1/auth 的字段名未知,尽量容错地判断"是否已连接" */
function probeAuth(raw: unknown): { connected: boolean; who: string } {
  const fallback = { connected: false, who: '' }
  if (!isPlainObj(raw)) return fallback
  const who = probeWho(raw)
  for (const k of [
    'logged_in',
    'loggedIn',
    'authenticated',
    'connected',
    'ready',
    'auth_ready',
    'is_logged_in',
    'is_authenticated',
    'ok'
  ]) {
    if (typeof raw[k] === 'boolean') return { connected: raw[k] as boolean, who }
  }
  for (const k of ['status', 'state']) {
    const v = raw[k]
    if (typeof v === 'string') {
      const s = v.toLowerCase()
      return {
        connected: ['ok', 'ready', 'connected', 'authenticated', 'logged_in', 'active', 'authorized'].includes(s),
        who
      }
    }
  }
  if (who) return { connected: true, who }
  for (const k of ['auth', 'kimi', 'account', 'session']) {
    const nested = raw[k]
    if (isPlainObj(nested)) {
      const inner = probeAuth(nested)
      if (inner.connected || inner.who) return { connected: inner.connected || !!inner.who, who: inner.who || who }
    }
  }
  return fallback
}

/** 从 POST /api/v1/oauth/login 响应里取用户码与验证地址 */
function probeDeviceGrant(raw: unknown): { userCode: string; verifyUrl: string } {
  const o = isPlainObj(raw) ? raw : {}
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = o[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  return {
    userCode: pick('user_code', 'userCode', 'display_code', 'code'),
    verifyUrl: pick('verification_url', 'verification_uri_complete', 'verification_uri', 'verify_url', 'url', 'link')
  }
}

type PollOutcome = 'pending' | 'done' | 'failed'

/** 轮询 GET /api/v1/oauth/login 的结果判断 */
function probePoll(raw: unknown): { outcome: PollOutcome; message?: string } {
  const o = isPlainObj(raw) ? raw : {}
  const status = typeof o.status === 'string' ? (o.status as string).toLowerCase() : ''
  if (['complete', 'completed', 'success', 'done', 'authorized', 'approved', 'logged_in', 'ready'].includes(status)) {
    return { outcome: 'done' }
  }
  if (['expired', 'error', 'denied', 'rejected', 'cancelled', 'canceled', 'failed', 'timeout'].includes(status)) {
    return { outcome: 'failed', message: typeof o.message === 'string' ? (o.message as string) : undefined }
  }
  for (const k of ['done', 'complete', 'completed', 'authenticated', 'logged_in', 'authorized']) {
    if (o[k] === true) return { outcome: 'done' }
  }
  if (typeof o.access_token === 'string' && o.access_token) return { outcome: 'done' }
  if (typeof o.error === 'string' && o.error) return { outcome: 'failed', message: o.error as string }
  return { outcome: 'pending' }
}

/** summary + limits + extra_usage 拍平成可渲染的行 */
/** 额度标签中文化(旧形态:label 字符串) */
function zhLabel(label: string | undefined): string {
  if (!label) return '—'
  if (/weekly/i.test(label)) return '周限额'
  if (/^5h/i.test(label) || /5\s*小时/.test(label)) return '5 小时限额'
  return label
}

/** 窗口对象 → 中文标签(服务端实际形态:{duration:5,unit:"hour"} → "5 小时限额") */
function windowQuotaLabel(w: UsageRow['window']): string {
  const d = w?.duration ?? 0
  switch (w?.unit) {
    case 'hour':
      return `${d} 小时限额`
    case 'day':
      return d === 1 ? '日限额' : `${d} 天限额`
    case 'week':
      return d === 1 ? '周限额' : `${d} 周限额`
    case 'month':
      return d === 1 ? '月度限额' : `${d} 月限额`
    default:
      return '限额'
  }
}

/** 窗口排序:小时 < 天 < 周 < 月 < 其它 */
function windowQuotaRank(w: UsageRow['window']): number {
  const order: Record<string, number> = { hour: 0, day: 1, week: 2, month: 3 }
  return order[w?.unit ?? ''] ?? 4
}

/** reset_at 时间戳 → "3 小时后重置"(服务端实际形态) */
function resetCountdown(resetAt: string | undefined): string {
  if (!resetAt) return ''
  const ms = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return '即将重置'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(1, m)} 分钟后重置`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时后重置`
  return `${Math.floor(h / 24)} 天后重置`
}

/** "resets in 1d 18h 56m" → "1 天 18 小时 56 分后重置"(旧形态) */
function zhResetHint(hint: string | undefined): string {
  if (!hint) return ''
  const m = hint.match(/resets in\s+(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?/i)
  if (!m) return hint
  const parts: string[] = []
  if (m[1]) parts.push(`${m[1]} 天`)
  if (m[2]) parts.push(`${m[2]} 小时`)
  if (m[3]) parts.push(`${m[3]} 分`)
  return parts.length ? `${parts.join(' ')}后重置` : hint
}

function usageRows(d: UsageData | null): UsageRow[] {
  if (!d || (typeof d.kind === 'string' && d.kind !== 'ok')) return []
  const out: UsageRow[] = []
  if (isPlainObj(d.summary)) out.push(d.summary as UsageRow)
  for (const src of [d.limits, d.extra_usage]) {
    if (Array.isArray(src)) out.push(...(src.filter(isPlainObj) as UsageRow[]))
  }
  // 两种数据形态兼容:window+reset_at(当前服务端)/ label+reset_hint(旧形态);
  // 中文化 + 排序(5 小时在前,周/月在后)
  return out
    .map((r) =>
      r.window && (r.window.duration || r.window.unit)
        ? { ...r, label: windowQuotaLabel(r.window), reset_hint: resetCountdown(r.reset_at) }
        : { ...r, label: zhLabel(r.label), reset_hint: zhResetHint(r.reset_hint) }
    )
    .sort((a, b) => {
      const rank = (r: UsageRow) =>
        r.window ? windowQuotaRank(r.window) : /5 小时/.test(r.label ?? '') ? 0 : /周限额/.test(r.label ?? '') ? 2 : 3
      return rank(a) - rank(b)
    })
}

/* ---------------- 小组件 ---------------- */

function InlineError({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={`flex items-start gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] leading-5 text-danger ${className ?? ''}`}
    >
      <XCircle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-all">{text}</span>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-2 text-[12.5px] text-success">
      <Check size={13} className="shrink-0" /> {text}
    </div>
  )
}

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      /* 剪贴板不可用时静默 */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11.5px] text-text-secondary transition-colors hover:bg-surface-secondary"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function IconBtn(props: {
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        props.danger
          ? 'text-text-tertiary hover:bg-danger-soft hover:text-danger'
          : 'text-text-tertiary hover:bg-surface-tertiary hover:text-text'
      }`}
    >
      {props.children}
    </button>
  )
}

function StatusPill({ on, loading }: { on: boolean; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2 py-0.5 text-[11px] font-medium text-text-tertiary">
        <Loader2 size={11} className="animate-spin" /> 检测中
      </span>
    )
  }
  return on ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" /> 已连接
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2 py-0.5 text-[11px] font-medium text-text-tertiary">
      <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" /> 未连接
    </span>
  )
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function UsageRowView({ row, first }: { row: UsageRow; first: boolean }) {
  const used = typeof row.used === 'number' ? row.used : 0
  const limit = typeof row.limit === 'number' && Number.isFinite(row.limit) ? row.limit : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`truncate ${first ? 'text-[12.5px] font-medium' : 'text-[12px] text-text-secondary'}`}>
          {row.label || '—'}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-text-secondary">
          {fmtNum(used)}
          {limit > 0 ? ` / ${fmtNum(limit)}` : ''}
        </span>
      </div>
      {limit > 0 && <Meter used={used} limit={limit} />}
      {typeof row.reset_hint === 'string' && row.reset_hint && (
        <p className="text-[11px] text-text-tertiary">{row.reset_hint}</p>
      )}
    </div>
  )
}

function UsageCard(props: {
  title: string
  icon: ReactNode
  data: UsageData | null
  loading: boolean
  loggedIn: boolean
}) {
  const rows = usageRows(props.data)
  const extraText =
    props.data && typeof props.data.extra_usage === 'string' ? (props.data.extra_usage as string) : ''
  return (
    <Card className="flex-1">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary">{props.icon}</span>
        <h3 className="text-[13.5px] font-semibold">{props.title}</h3>
      </div>
      {props.loading ? (
        <div className="space-y-2.5">
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-tertiary" />
          <div className="h-1.5 w-full animate-pulse rounded-full bg-surface-tertiary" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tertiary" />
        </div>
      ) : rows.length > 0 ? (
        <div className="space-y-3.5">
          {rows.map((r, i) => (
            <UsageRowView key={`${r.label ?? 'row'}-${i}`} row={r} first={i === 0} />
          ))}
          {extraText && <p className="text-[11.5px] text-text-tertiary">{extraText}</p>}
        </div>
      ) : (
        <div>
          <p className="text-[22px] font-semibold leading-none text-text-tertiary">—</p>
          <p className="mt-1.5 text-[12px] text-text-tertiary">
            {props.loggedIn ? '暂无额度数据' : '登录 Kimi 账号后查看额度'}
          </p>
        </div>
      )}
    </Card>
  )
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3.5 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-surface-tertiary" />
          <div className="h-4 w-16 animate-pulse rounded bg-surface-tertiary" />
          <div className="ml-auto h-7 w-20 animate-pulse rounded-lg bg-surface-tertiary" />
        </div>
      ))}
    </div>
  )
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-text-secondary">{props.label}</span>
      {props.children}
      {props.hint && <span className="mt-1 block text-[11px] leading-4 text-text-tertiary">{props.hint}</span>}
    </label>
  )
}

function StepNo({ n }: { n: number }) {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
      {n}
    </span>
  )
}

function DeviceFlow(props: {
  userCode: string
  verifyUrl: string
  cancelling: boolean
  onCancel: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        正在等待验证…
      </div>
      <div className="flex items-start gap-2.5">
        <StepNo n={1} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-text-secondary">在浏览器中打开验证地址</p>
          <div className="mt-1 flex items-center gap-2">
            {props.verifyUrl ? (
              <>
                <a
                  href={props.verifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-[12.5px] text-primary hover:underline"
                >
                  <span className="max-w-[280px] truncate">{props.verifyUrl}</span>
                  <ExternalLink size={12} className="shrink-0" />
                </a>
                <CopyChip value={props.verifyUrl} />
              </>
            ) : (
              <span className="text-[12px] text-text-tertiary">—</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <StepNo n={2} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-text-secondary">在验证页面中输入验证码</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="rounded-lg border border-dashed border-primary-border bg-primary-soft px-3 py-1.5 font-mono text-[15px] font-semibold tracking-[0.18em] text-primary">
              {props.userCode || '—'}
            </code>
            {props.userCode && <CopyChip value={props.userCode} />}
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="button" className={btnGhost} onClick={props.onCancel} disabled={props.cancelling}>
          {props.cancelling ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
          取消登录
        </button>
      </div>
    </div>
  )
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
        on ? 'bg-primary' : 'bg-surface-tertiary'
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

/* ---------------- 供应商滑出编辑面板 ---------------- */

function ProviderPanel(props: { req: PanelReq | null; onSaved: () => void; onClose: () => void }) {
  const { req, onClose, onSaved } = props
  const open = req !== null

  /* 挂载与滑动动画 */
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      const t = setTimeout(() => setShown(true), 20)
      return () => clearTimeout(t)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 240)
    return () => clearTimeout(t)
  }, [open])

  /* Esc 关闭 */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /* 表单状态 */
  const [pid, setPid] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelRows, setModelRows] = useState<PanelModelRow[]>([emptyPanelModelRow()])
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [idTouched, setIdTouched] = useState(false)

  /* 打开目标变化时,在渲染阶段重置表单,避免上一份数据闪现 */
  const [tracked, setTracked] = useState<PanelReq | null>(null)
  if (req !== tracked) {
    setTracked(req)
    setError('')
    setIdTouched(false)
    setSubmitting(false)
    if (req?.mode === 'create') {
      setPid('')
      setName('')
      setType('openai')
      setBaseUrl('')
      setApiKey('')
      setModelRows([emptyPanelModelRow()])
      setHeaderRows([])
      setLoading(false)
    } else if (req?.mode === 'edit') {
      setPid(req.id)
      setName('')
      setType('openai')
      setBaseUrl('')
      setApiKey('')
      setModelRows([emptyPanelModelRow()])
      setHeaderRows([])
      setLoading(true)
    }
  }

  /* 编辑模式:并行拉取供应商全量与 config,预填模型行(含元数据)与请求头 */
  useEffect(() => {
    if (!req || req.mode !== 'edit') return
    let cancelled = false
    void (async () => {
      try {
        const [full, cfg] = await Promise.all([
          rest<Record<string, unknown>>(`/api/v1/providers/${encodeURIComponent(req.id)}`),
          rest<Record<string, unknown>>('/api/v1/config').catch(() => null)
        ])
        if (cancelled) return
        const o = isPlainObj(full) ? full : {}
        setName(typeof o.name === 'string' ? o.name : '')
        setType(typeof o.type === 'string' && o.type ? o.type : 'openai')
        setBaseUrl(typeof o.base_url === 'string' ? o.base_url : '')
        setApiKey(typeof o.api_key === 'string' ? o.api_key : '')

        /* GET providers/{id} 的 models 只是别名字符串数组,没有元数据;
           完整定义(display_name/max_context_size 等)从 config 的 models 段按 provider === id 筛取 */
        const modelsSection =
          isPlainObj(cfg) && isPlainObj(cfg.models) ? (cfg.models as Record<string, unknown>) : {}
        const cfgByModel = new Map<string, Record<string, unknown>>()
        for (const v of Object.values(modelsSection)) {
          if (isPlainObj(v) && v.provider === req.id && typeof v.model === 'string' && v.model) {
            cfgByModel.set(v.model, v)
          }
        }
        const aliases = (Array.isArray(o.models) ? o.models : []).filter(
          (x): x is string => typeof x === 'string' && !!x.trim()
        )
        const rows: PanelModelRow[] = []
        const seen = new Set<string>()
        for (const alias of aliases) {
          const bare = alias.startsWith(`${req.id}/`) ? alias.slice(req.id.length + 1) : alias
          rows.push(panelRowFromConfig(bare, cfgByModel.get(bare)))
          seen.add(bare)
        }
        /* config 里有、别名列表里没有的模型也带出,避免 PUT 整体替换时丢模型 */
        for (const [modelId, entry] of cfgByModel) {
          if (!seen.has(modelId)) rows.push(panelRowFromConfig(modelId, entry))
        }
        setModelRows(rows.length ? rows : [emptyPanelModelRow()])

        /* custom_headers 不在 providers REST,从 config 的 providers.<id>.custom_headers 表回显 */
        const providersSection =
          isPlainObj(cfg) && isPlainObj(cfg.providers) ? (cfg.providers as Record<string, unknown>) : {}
        const selfRaw = providersSection[req.id]
        const selfCfg = isPlainObj(selfRaw) ? selfRaw : {}
        setHeaderRows(parseHeaders(selfCfg.custom_headers))
      } catch (e) {
        if (!cancelled) setError(errText(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [req])

  const idInvalid = pid.trim() !== '' && !PROVIDER_ID_RE.test(pid.trim())

  const submit = async () => {
    if (!req) return
    const idv = pid.trim()
    if (req.mode === 'create') {
      if (!idv) {
        setError('请填写提供商 ID')
        setIdTouched(true)
        return
      }
      if (!PROVIDER_ID_RE.test(idv)) {
        setError(`提供商 ID 不合法:${PROVIDER_ID_HINT}`)
        setIdTouched(true)
        return
      }
    }
    if (!name.trim()) {
      setError('请填写显示名称')
      return
    }
    const rows = modelRows
      .map((r) => ({ ...r, model: r.model.trim(), display_name: r.display_name.trim() }))
      .filter((r) => r.model)
    if (!rows.length) {
      setError('请至少填写一个模型 ID')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      /* 后端要求 models 为对象数组,max_context_size 必填;非必填字段留空不放 */
      const modelObjs = rows.map((r) => {
        const obj: Record<string, unknown> = { model: r.model }
        const n = Number(r.maxCtx)
        obj.max_context_size = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_CONTEXT
        if (r.display_name) obj.display_name = r.display_name
        if (r.capabilities?.length) obj.capabilities = r.capabilities
        const efforts = r.support_efforts.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        if (efforts.length) obj.support_efforts = efforts
        if (r.default_effort.trim()) obj.default_effort = r.default_effort.trim()
        if (typeof r.max_output_size === 'number') obj.max_output_size = r.max_output_size
        return obj
      })
      const targetId = req.mode === 'create' ? idv : req.id
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type,
        base_url: baseUrl.trim(),
        models: modelObjs
      }
      if (apiKey.trim()) payload.api_key = apiKey.trim()
      if (req.mode === 'create') {
        await rest('/api/v1/providers', { method: 'POST', body: { id: targetId, ...payload } })
      } else {
        /* PUT 为整体替换:先取全量合并,保留 default_model 等未暴露字段 */
        const full = await rest<Record<string, unknown>>(`/api/v1/providers/${encodeURIComponent(req.id)}`)
        const base = isPlainObj(full) ? full : {}
        await rest(`/api/v1/providers/${encodeURIComponent(req.id)}`, {
          method: 'PUT',
          body: { ...base, ...payload }
        })
      }
      /* custom_headers 不在 providers REST:主体保存成功后,合并写入 config 的
         providers.<id>.custom_headers 表(会真实随请求发送) */
      const headers = headersToBody(headerRows)
      if (Object.keys(headers).length) {
        try {
          await rest('/api/v1/config', {
            method: 'POST',
            body: { providers: { [targetId]: { custom_headers: headers } } }
          })
        } catch (e) {
          setError(`供应商已保存,但请求头写入失败:${errText(e)}`)
          return
        }
      }
      onSaved()
    } catch (e) {
      setError(errText(e))
    } finally {
      setSubmitting(false)
    }
  }

  /* 关闭动画期间保留最后一份内容 */
  const lastReq = useRef<PanelReq | null>(null)
  if (req) lastReq.current = req
  if (!mounted || !lastReq.current) return null
  const editing = lastReq.current.mode === 'edit'

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-[420px] flex-col bg-surface shadow-xl transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center gap-1.5 border-b border-border-light px-3 py-2.5">
          <IconBtn title="返回" onClick={onClose}>
            <ArrowLeft size={16} />
          </IconBtn>
          <h3 className="flex-1 text-[14px] font-semibold">自定义提供商</h3>
          <IconBtn title="关闭" onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="space-y-3">
              <div className="h-8 animate-pulse rounded-lg bg-surface-tertiary" />
              <div className="h-8 animate-pulse rounded-lg bg-surface-tertiary" />
              <div className="h-8 w-2/3 animate-pulse rounded-lg bg-surface-tertiary" />
              <div className="h-24 animate-pulse rounded-lg bg-surface-tertiary" />
            </div>
          ) : (
            <>
              <Field
                label="提供商 ID"
                hint={editing ? '创建后不可修改' : PROVIDER_ID_HINT}
              >
                <input
                  className={idInvalid && idTouched ? inputErrCls : inputCls}
                  placeholder="例如 my-openai"
                  value={pid}
                  readOnly={editing}
                  onChange={(e) => setPid(e.target.value)}
                  onBlur={() => setIdTouched(true)}
                />
                {idInvalid && idTouched && (
                  <span className="mt-1 block text-[11px] text-danger">{PROVIDER_ID_HINT}</span>
                )}
              </Field>
              <Field label="显示名称">
                <input
                  className={inputCls}
                  placeholder="例如:我的 OpenAI 代理"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="类型">
                <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                  {PROVIDER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="基础 URL">
                <input
                  className={inputCls}
                  placeholder="https://api.example.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </Field>
              <Field label="API 密钥" hint="可选,如通过请求头管理认证可留空">
                <input
                  type="password"
                  className={inputCls}
                  placeholder="sk-…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>

              <Field label="模型" hint="模型 ID 必填;上下文默认 262144(256K),为必填项;至少保留一行">
                <div className="space-y-2">
                  {modelRows.map((r, i) => (
                    <div key={i} className="rounded-lg border border-border-light bg-surface-secondary p-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          className={`${inputCls} min-w-0 flex-1`}
                          placeholder="模型 ID,如 gpt-4o"
                          value={r.model}
                          onChange={(e) =>
                            setModelRows(modelRows.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))
                          }
                        />
                        <IconBtn
                          title="删除该模型"
                          disabled={modelRows.length <= 1}
                          danger
                          onClick={() => setModelRows(modelRows.filter((_, j) => j !== i))}
                        >
                          <Trash2 size={14} />
                        </IconBtn>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="shrink-0 text-[11px] text-text-tertiary">名称</span>
                        <input
                          className={`${inputCls} min-w-0 flex-1`}
                          placeholder="显示名称(可选,留空用模型 ID)"
                          value={r.display_name}
                          onChange={(e) =>
                            setModelRows(
                              modelRows.map((x, j) => (j === i ? { ...x, display_name: e.target.value } : x))
                            )
                          }
                        />
                        <span className="shrink-0 text-[11px] text-text-tertiary">上下文</span>
                        <input
                          type="number"
                          min={1}
                          title="最大上下文(max_context_size)"
                          className={`${inputCls} w-24 shrink-0`}
                          value={r.maxCtx}
                          onChange={(e) =>
                            setModelRows(modelRows.map((x, j) => (j === i ? { ...x, maxCtx: e.target.value } : x)))
                          }
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={btnAddRow}
                    onClick={() => setModelRows([...modelRows, emptyPanelModelRow()])}
                  >
                    <Plus size={13} /> 添加模型
                  </button>
                </div>
              </Field>

              <Field label="请求头(可选)" hint="自定义请求头,可用于注入认证等信息">
                <div className="space-y-2">
                  {headerRows.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        className={`${inputCls} min-w-0 flex-[2]`}
                        placeholder="Header-Name"
                        value={r.name}
                        onChange={(e) =>
                          setHeaderRows(headerRows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                        }
                      />
                      <input
                        className={`${inputCls} min-w-0 flex-[3]`}
                        placeholder="value"
                        value={r.value}
                        onChange={(e) =>
                          setHeaderRows(headerRows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                        }
                      />
                      <IconBtn
                        title="删除该请求头"
                        danger
                        onClick={() => setHeaderRows(headerRows.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={14} />
                      </IconBtn>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={btnAddRow}
                    onClick={() => setHeaderRows([...headerRows, { name: '', value: '' }])}
                  >
                    <Plus size={13} /> 添加请求头
                  </button>
                </div>
              </Field>
            </>
          )}
        </div>

        <footer className="border-t border-border-light px-4 py-3">
          {error && <InlineError className="mb-2" text={error} />}
          <button
            type="button"
            className={`${btnPrimary} w-full justify-center`}
            onClick={() => void submit()}
            disabled={submitting || loading}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            提交
          </button>
        </footer>
      </aside>
    </div>
  )
}

/* ---------------- 模型深度配置(内联编辑卡) ---------------- */

function ModelDeepConfig(props: {
  m: ModelItem
  override: ModelOverride
  onSaved: (cfg: Record<string, unknown>) => void
}) {
  const { m, override } = props
  const [displayName, setDisplayName] = useState(override.display_name ?? m.display_name ?? '')
  const [maxCtx, setMaxCtx] = useState(
    String(override.max_context_size ?? m.max_context_size ?? DEFAULT_CONTEXT)
  )
  const [caps, setCaps] = useState<string[]>(override.capabilities ?? m.capabilities ?? [])
  const [efforts, setEfforts] = useState(
    (override.support_efforts ?? m.support_efforts ?? []).join(',')
  )
  const [defaultEffort, setDefaultEffort] = useState(override.default_effort ?? m.default_effort ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const toggleCap = (c: string) => {
    setSaved(false)
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      /* 读取 models 段 → 合并修改 → POST(merge 语义) */
      const cfg = await rest<Record<string, unknown>>('/api/v1/config')
      const base = isPlainObj(cfg) ? cfg : {}
      const modelsSection = isPlainObj(base.models) ? { ...(base.models as Record<string, unknown>) } : {}
      const fullKey = `${m.provider}/${m.model}`
      const key = modelsSection[fullKey] !== undefined ? fullKey : modelsSection[m.model] !== undefined ? m.model : fullKey
      const entry: Record<string, unknown> = { ...(isPlainObj(modelsSection[key]) ? modelsSection[key] : {}) }
      const dn = displayName.trim()
      if (dn) entry.display_name = dn
      else delete entry.display_name
      const n = Number(maxCtx)
      entry.max_context_size = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_CONTEXT
      entry.capabilities = caps
      const eff = efforts.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      if (eff.length) entry.support_efforts = eff
      else delete entry.support_efforts
      const de = defaultEffort.trim()
      if (de) entry.default_effort = de
      else delete entry.default_effort
      modelsSection[key] = entry
      const optimistic = { ...base, models: modelsSection }
      await rest('/api/v1/config', { method: 'POST', body: { models: modelsSection } })
      /* 回读一次,保证界面与服务端一致;失败则用本地合并结果兜底 */
      let next: Record<string, unknown> = optimistic
      try {
        const fresh = await rest<Record<string, unknown>>('/api/v1/config')
        if (isPlainObj(fresh)) next = fresh
      } catch {
        /* 保存已成功,仅回读失败 */
      }
      props.onSaved(next)
      setSaved(true)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-primary-border bg-primary-soft/40 p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="显示名称">
          <input
            className={inputCls}
            placeholder={m.model}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
              setSaved(false)
            }}
          />
        </Field>
        <Field label="最大上下文" hint={`默认 ${DEFAULT_CONTEXT}(即 256K)`}>
          <input
            type="number"
            min={1}
            className={inputCls}
            value={maxCtx}
            onChange={(e) => {
              setMaxCtx(e.target.value)
              setSaved(false)
            }}
          />
        </Field>
      </div>
      <div className="mt-3">
        <p className="mb-1.5 text-[12px] font-medium text-text-secondary">能力(capabilities)</p>
        <div className="flex flex-wrap gap-1.5">
          {CAPABILITY_OPTIONS.map((c) => {
            const on = caps.includes(c)
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCap(c)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11.5px] transition-colors ${
                  on
                    ? 'border-primary-border bg-primary-soft text-primary'
                    : 'border-border bg-surface text-text-tertiary hover:bg-surface-secondary hover:text-text-secondary'
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="support_efforts" hint="思考强度档位,名称数量因模型而异,如 low,high,max;留空则不限制">
          <input
            className={inputCls}
            placeholder="low,high,max"
            value={efforts}
            onChange={(e) => {
              setEfforts(e.target.value)
              setSaved(false)
            }}
          />
        </Field>
        <Field label="default_effort(可选)">
          <input
            className={inputCls}
            placeholder="例如 high"
            value={defaultEffort}
            onChange={(e) => {
              setDefaultEffort(e.target.value)
              setSaved(false)
            }}
          />
        </Field>
      </div>
      {error && <InlineError className="mt-3" text={error} />}
      <div className="mt-3 flex items-center justify-end gap-2">
        {saved && <Notice text="已保存" />}
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          保存
        </button>
      </div>
    </div>
  )
}

/* ---------------- 次主力模型 ---------------- */

function SecondaryModelCard(props: {
  models: ModelItem[]
  config: Record<string, unknown> | null
  onSaved: (cfg: Record<string, unknown>) => void
}) {
  const cur = isPlainObj(props.config?.secondary_model)
    ? (props.config?.secondary_model as Record<string, unknown>)
    : {}
  const curModel = typeof cur.model === 'string' ? cur.model : ''
  const curEffort = typeof cur.default_effort === 'string' ? cur.default_effort : ''

  const optVal = (m: ModelItem): string => `${m.provider}/${m.model}`
  const match = props.models.find((m) => optVal(m) === curModel || m.model === curModel)

  const [model, setModel] = useState(match ? optVal(match) : curModel)
  const [effort, setEffort] = useState(curEffort)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  /* config 异步到达/保存后,未改动时同步回显 */
  useEffect(() => {
    if (dirty) return
    const m2 = props.models.find((x) => optVal(x) === curModel || x.model === curModel)
    setModel(m2 ? optVal(m2) : curModel)
    setEffort(curEffort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.config, props.models])

  const save = async () => {
    if (!model) {
      setError('请选择模型')
      return
    }
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const value: Record<string, unknown> = { model }
      if (effort.trim()) value.default_effort = effort.trim()
      const optimistic = { ...(props.config ?? {}), secondary_model: value }
      await rest('/api/v1/config', { method: 'POST', body: { secondary_model: value } })
      let next: Record<string, unknown> = optimistic
      try {
        const fresh = await rest<Record<string, unknown>>('/api/v1/config')
        if (isPlainObj(fresh)) next = fresh
      } catch {
        /* 保存已成功,仅回读失败 */
      }
      props.onSaved(next)
      setDirty(false)
      setSaved(true)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary">
          <Bot size={15} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold">次主力模型</h3>
          <p className="text-[11.5px] text-text-tertiary">子 Agent 派生时默认绑定的模型(实验功能)</p>
        </div>
      </div>
      <div className="space-y-3">
        <Field label="模型">
          <select
            className={inputCls}
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              setDirty(true)
              setSaved(false)
            }}
          >
            <option value="">选择模型…</option>
            {props.models.map((m) => (
              <option key={optVal(m)} value={optVal(m)}>
                {m.display_name || m.model}({m.provider})
              </option>
            ))}
            {curModel && !match && <option value={curModel}>{curModel}(不在当前列表)</option>}
          </select>
        </Field>
        <Field label="default_effort(可选)">
          <input
            className={inputCls}
            placeholder="例如 high"
            value={effort}
            onChange={(e) => {
              setEffort(e.target.value)
              setDirty(true)
              setSaved(false)
            }}
          />
        </Field>
      </div>
      {error && <InlineError className="mt-3" text={error} />}
      <div className="mt-3 flex items-center justify-end gap-2">
        {saved && <Notice text="已保存" />}
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          保存
        </button>
      </div>
    </Card>
  )
}

/* ---------------- 思考(thinking) ---------------- */

function ThinkingCard(props: { config: Record<string, unknown> | null; onSaved: (cfg: Record<string, unknown>) => void }) {
  const cur = isPlainObj(props.config?.thinking) ? (props.config?.thinking as Record<string, unknown>) : {}
  const curEnabled = cur.enabled === true
  const curEffort = typeof cur.effort === 'string' ? cur.effort : ''
  const curKeep = cur.keep === 'off' ? 'off' : 'all'

  const [enabled, setEnabled] = useState(curEnabled)
  const [effort, setEffort] = useState(curEffort)
  const [keep, setKeep] = useState(curKeep)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (dirty) return
    setEnabled(curEnabled)
    setEffort(curEffort)
    setKeep(curKeep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.config])

  const save = async () => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const value: Record<string, unknown> = { enabled, keep }
      if (effort.trim()) value.effort = effort.trim()
      const optimistic = { ...(props.config ?? {}), thinking: value }
      await rest('/api/v1/config', { method: 'POST', body: { thinking: value } })
      let next: Record<string, unknown> = optimistic
      try {
        const fresh = await rest<Record<string, unknown>>('/api/v1/config')
        if (isPlainObj(fresh)) next = fresh
      } catch {
        /* 保存已成功,仅回读失败 */
      }
      props.onSaved(next)
      setDirty(false)
      setSaved(true)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary">
          <Brain size={15} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold">思考</h3>
          <p className="text-[11.5px] text-text-tertiary">深度思考的全局开关、强度与保留策略</p>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-3 py-2.5">
        <span className="text-[12.5px] font-medium">启用思考</span>
        <Switch
          on={enabled}
          onToggle={() => {
            setEnabled((v) => !v)
            setDirty(true)
            setSaved(false)
          }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="effort(可选)" hint="如 low/medium/high/xhigh/max,需为当前模型支持档位,非必填">
          <input
            className={inputCls}
            placeholder="例如 high"
            value={effort}
            onChange={(e) => {
              setEffort(e.target.value)
              setDirty(true)
              setSaved(false)
            }}
          />
        </Field>
        <Field label="keep" hint="思考内容保留策略">
          <select
            className={inputCls}
            value={keep}
            onChange={(e) => {
              setKeep(e.target.value)
              setDirty(true)
              setSaved(false)
            }}
          >
            <option value="all">all</option>
            <option value="off">off</option>
          </select>
        </Field>
      </div>
      {error && <InlineError className="mt-3" text={error} />}
      <div className="mt-3 flex items-center justify-end gap-2">
        {saved && <Notice text="已保存" />}
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          保存
        </button>
      </div>
    </Card>
  )
}

/* ---------------- 主页面 ---------------- */

export function ModelsSettings() {
  /* 账号 */
  const [authReady, setAuthReady] = useState<boolean | null>(null)
  const [authWho, setAuthWho] = useState('')
  const [authError, setAuthError] = useState('')
  const [logoutBusy, setLogoutBusy] = useState(false)

  /* OAuth 设备码流程 */
  const [oauth, setOauth] = useState<OauthState>({ stage: 'idle' })
  const [oauthError, setOauthError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCount = useRef(0)

  /* 额度 */
  const [tokenUsage, setTokenUsage] = useState<UsageData | null>(null)
  const [mcpUsage, setMcpUsage] = useState<UsageData | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)

  /* 模型与配置 */
  const [models, setModels] = useState<ModelItem[] | null>(null)
  const [modelError, setModelError] = useState('')
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [settingModel, setSettingModel] = useState<string | null>(null)
  const [deepKey, setDeepKey] = useState<string | null>(null)

  /* 供应商 */
  const [providers, setProviders] = useState<ProviderItem[] | null>(null)
  const [providerError, setProviderError] = useState('')
  const [providerNotice, setProviderNotice] = useState('')
  const [panelReq, setPanelReq] = useState<PanelReq | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  /* ---- 数据加载 ---- */

  const loadAuth = useCallback(async () => {
    try {
      const raw = await rest<unknown>('/api/v1/auth')
      const { connected, who } = probeAuth(raw)
      setAuthReady(connected)
      setAuthWho(who)
      setAuthError('')
    } catch (e) {
      setAuthReady(false)
      setAuthWho('')
      setAuthError(errText(e))
    }
  }, [])

  const loadUsage = useCallback(async () => {
    setUsageLoading(true)
    const [t, m] = await Promise.allSettled([
      rest<UsageData>('/api/v1/oauth/usage'),
      rest<UsageData>('/api/v1/oauth/usage', { query: { provider: 'mcp' } })
    ])
    setTokenUsage(t.status === 'fulfilled' ? t.value : null)
    setMcpUsage(m.status === 'fulfilled' ? m.value : null)
    setUsageLoading(false)
  }, [])

  const loadModels = useCallback(async () => {
    try {
      const raw = await rest<unknown>('/api/v1/models')
      setModels(asArray<ModelItem>(raw))
      setModelError('')
    } catch (e) {
      setModelError(errText(e))
    }
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await rest<Record<string, unknown>>('/api/v1/config')
      setConfig(isPlainObj(cfg) ? cfg : {})
    } catch {
      /* 默认徽标与深度配置缺失可接受 */
    }
  }, [])

  const loadProviders = useCallback(async () => {
    try {
      const raw = await rest<unknown>('/api/v1/providers')
      setProviders(asArray<ProviderItem>(raw))
      setProviderError('')
    } catch (e) {
      setProviderError(errText(e))
    }
  }, [])

  /* ---- OAuth 设备码流程 ---- */

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const onLoginDone = useCallback(async () => {
    setOauth({ stage: 'idle' })
    setOauthError('')
    await Promise.all([loadAuth(), loadUsage(), loadModels()])
  }, [loadAuth, loadUsage, loadModels])

  const startPolling = useCallback(() => {
    stopPolling()
    pollCount.current = 0
    pollTimer.current = setInterval(() => {
      pollCount.current += 1
      if (pollCount.current > 240) {
        // ~10 分钟
        stopPolling()
        setOauth({ stage: 'idle' })
        setOauthError('等待验证超时,请重新发起登录')
        return
      }
      void (async () => {
        try {
          const raw = await rest<unknown>('/api/v1/oauth/login')
          const r = probePoll(raw)
          if (r.outcome === 'done') {
            stopPolling()
            await onLoginDone()
          } else if (r.outcome === 'failed') {
            stopPolling()
            setOauth({ stage: 'idle' })
            setOauthError(r.message || '授权失败,请重试')
          }
        } catch {
          /* 网络抖动时继续轮询 */
        }
      })()
    }, 2500)
  }, [stopPolling, onLoginDone])

  const startLogin = async () => {
    setOauthError('')
    setOauth({ stage: 'starting' })
    try {
      const raw = await rest<unknown>('/api/v1/oauth/login', { method: 'POST', body: {} })
      if (probePoll(raw).outcome === 'done') {
        await onLoginDone()
        return
      }
      const grant = probeDeviceGrant(raw)
      setOauth({ stage: 'waiting', userCode: grant.userCode, verifyUrl: grant.verifyUrl })
      startPolling()
    } catch (e) {
      setOauth({ stage: 'idle' })
      setOauthError(errText(e))
    }
  }

  const cancelLogin = async () => {
    setCancelling(true)
    stopPolling()
    try {
      await rest('/api/v1/oauth/login', { method: 'DELETE' })
    } catch {
      /* 尽力取消 */
    }
    setOauth({ stage: 'idle' })
    setCancelling(false)
  }

  const logout = async () => {
    setLogoutBusy(true)
    setAuthError('')
    try {
      await rest('/api/v1/oauth/logout', { method: 'POST', body: {} })
      await Promise.all([loadAuth(), loadUsage()])
    } catch (e) {
      setAuthError(errText(e))
    } finally {
      setLogoutBusy(false)
    }
  }

  /* ---- 模型 ---- */

  const defaultModel = typeof config?.default_model === 'string' ? config.default_model : ''

  const applyDefault = async (m: ModelItem) => {
    setSettingModel(m.model)
    setModelError('')
    try {
      // POST /api/v1/models/{alias} 在 0.29.2 报 unsupported action,改用 config merge
      await rest('/api/v1/config', { method: 'POST', body: { default_model: m.model } })
      await loadConfig()
    } catch (e) {
      setModelError(`设为默认失败:${errText(e)}`)
    } finally {
      setSettingModel(null)
    }
  }

  /* ---- 供应商 ---- */

  const removeProvider = async (id: string) => {
    setBusyId(id)
    setProviderError('')
    try {
      await rest(`/api/v1/providers/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setConfirmId(null)
      setProviderNotice('供应商已删除')
      await loadProviders()
    } catch (e) {
      setProviderError(`删除失败:${errText(e)}`)
    } finally {
      setBusyId(null)
    }
  }

  const refreshProvider = async (id: string) => {
    setBusyId(id)
    setProviderError('')
    try {
      await rest(`/api/v1/providers/${encodeURIComponent(id)}:refresh`, { method: 'POST' })
      setProviderNotice('模型列表已刷新')
      await Promise.all([loadProviders(), loadModels()])
    } catch (e) {
      setProviderError(`刷新失败:${errText(e)}`)
    } finally {
      setBusyId(null)
    }
  }

  const onPanelSaved = async () => {
    setPanelReq(null)
    setProviderNotice('供应商已保存')
    await Promise.all([loadProviders(), loadModels()])
  }

  /* ---- 生命周期 ---- */

  useEffect(() => {
    void loadAuth()
    void loadUsage()
    void loadModels()
    void loadConfig()
    void loadProviders()
    return stopPolling
  }, [loadAuth, loadUsage, loadModels, loadConfig, loadProviders, stopPolling])

  useEffect(() => {
    if (!providerNotice) return
    const t = setTimeout(() => setProviderNotice(''), 2500)
    return () => clearTimeout(t)
  }, [providerNotice])

  const isDefault = (m: ModelItem): boolean =>
    !!defaultModel && (m.model === defaultModel || `${m.provider}/${m.model}` === defaultModel)

  const customIds = new Set((providers ?? []).map((p) => p.id ?? p.name ?? '').filter(Boolean))
  const modelKey = (m: ModelItem): string => `${m.provider}/${m.model}`

  /* ---------------- 渲染 ---------------- */

  return (
    <Section title="模型" desc="管理 Kimi 账号、托管额度与可用模型">
      {/* Kimi 账号 */}
      <GroupLabel>Kimi 账号</GroupLabel>
      <Card>
        {oauth.stage === 'waiting' ? (
          <DeviceFlow
            userCode={oauth.userCode}
            verifyUrl={oauth.verifyUrl}
            cancelling={cancelling}
            onCancel={() => void cancelLogin()}
          />
        ) : (
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[13.5px] font-semibold">托管账号</p>
                <StatusPill on={authReady === true} loading={authReady === null} />
              </div>
              <p className="mt-0.5 truncate text-[12px] text-text-tertiary">
                {authReady === null
                  ? '正在检测连接状态…'
                  : authReady
                    ? (authWho || '已连接,可使用 Kimi 托管额度与模型')
                    : '登录后可使用 Kimi 托管额度与模型'}
              </p>
            </div>
            {authReady === true ? (
              <button type="button" className={btnGhost} onClick={() => void logout()} disabled={logoutBusy}>
                {logoutBusy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                登出
              </button>
            ) : (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void startLogin()}
                disabled={oauth.stage === 'starting' || authReady === null}
              >
                {oauth.stage === 'starting' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                登录 Kimi
              </button>
            )}
          </div>
        )}
        {authError && <InlineError className="mt-3" text={authError} />}
        {oauthError && <InlineError className="mt-3" text={oauthError} />}
      </Card>

      {/* 额度 */}
      <GroupLabel>额度</GroupLabel>
      <div className="flex gap-3">
        <UsageCard
          title="Token 额度"
          icon={<Zap size={15} />}
          data={tokenUsage}
          loading={usageLoading}
          loggedIn={authReady === true}
        />
        {/* MCP 额度:当前服务端(CLI 0.29.x)对 ?provider=mcp 返回与 Token 完全相同的
            payload,展示即重复;仅当数据真正不同时才渲染(服务端区分后自动恢复) */}
        {JSON.stringify(mcpUsage?.summary ?? null) !==
          JSON.stringify(tokenUsage?.summary ?? null) ||
        JSON.stringify(mcpUsage?.limits ?? null) !== JSON.stringify(tokenUsage?.limits ?? null) ? (
          <UsageCard
            title="MCP 额度"
            icon={<Plug size={15} />}
            data={mcpUsage}
            loading={usageLoading}
            loggedIn={authReady === true}
          />
        ) : null}
      </div>

      {/* 模型列表 */}
      <GroupLabel>模型</GroupLabel>
      {modelError && <InlineError className="mb-2" text={modelError} />}
      <Card className="overflow-hidden p-0">
        {models === null ? (
          <ListSkeleton rows={4} />
        ) : models.length === 0 ? (
          <div className="p-4">
            <Empty text="暂无可用模型" />
          </div>
        ) : (
          <ul className="divide-y divide-border-light">
            {models.map((m) => {
              const caps = Array.isArray(m.capabilities) ? m.capabilities : []
              const key = modelKey(m)
              const editable = customIds.has(m.provider)
              const expanded = deepKey === key
              return (
                <li key={key} className="px-4 py-3 transition-colors hover:bg-surface-secondary">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium">
                          {m.display_name || m.model}
                        </span>
                        {isDefault(m) && (
                          <span className="shrink-0 rounded-full border border-primary-border bg-primary-soft px-2 py-px text-[11px] font-medium text-primary">
                            默认
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-text-tertiary">
                        <span className="truncate font-mono">{m.model}</span>
                        <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-px font-mono text-[11px]">
                          {fmtContext(m.max_context_size)}
                        </span>
                        {m.provider && (
                          <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-px text-[11px]">
                            {m.provider}
                          </span>
                        )}
                        {caps.slice(0, 3).map((c) => (
                          <span
                            key={c}
                            className="hidden shrink-0 rounded bg-surface-tertiary px-1.5 py-px text-[11px] sm:inline"
                          >
                            {String(c)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        className={`${btnGhost} shrink-0`}
                        onClick={() => setDeepKey(expanded ? null : key)}
                      >
                        <PencilLine size={13} />
                        {expanded ? '收起' : '编辑'}
                      </button>
                    )}
                    {!isDefault(m) && (
                      <button
                        type="button"
                        className={`${btnGhost} shrink-0`}
                        onClick={() => void applyDefault(m)}
                        disabled={settingModel !== null}
                      >
                        {settingModel === m.model && <Loader2 size={13} className="animate-spin" />}
                        设为默认
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      <ModelDeepConfig
                        m={m}
                        override={overrideFor(config, m)}
                        onSaved={(cfg) => {
                          setConfig(cfg)
                          void loadModels()
                        }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* 自定义供应商 */}
      <GroupLabel>自定义供应商</GroupLabel>
      {providerError && <InlineError className="mb-2" text={providerError} />}
      {providerNotice && (
        <div className="mb-2">
          <Notice text={providerNotice} />
        </div>
      )}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
          <p className="text-[12.5px] text-text-secondary">
            {providers === null ? '加载中…' : `共 ${providers.length} 个供应商`}
          </p>
          <button type="button" className={btnPrimary} onClick={() => setPanelReq({ mode: 'create' })}>
            <Plus size={14} />
            添加供应商
          </button>
        </div>
        {providers === null ? (
          <ListSkeleton rows={2} />
        ) : providers.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-text-tertiary">
            还没有自定义供应商,添加后可接入自有模型服务
          </div>
        ) : (
          <ul className="divide-y divide-border-light">
            {providers.map((p) => {
              const pid = p.id ?? p.name ?? ''
              const count = parseProviderModels(p.models).length
              return (
                <li key={pid || JSON.stringify(p)} className="px-4 py-3 transition-colors hover:bg-surface-secondary">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                      onClick={() => pid && setPanelReq({ mode: 'edit', id: pid })}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-tertiary text-text-secondary">
                        <Server size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium">{p.name || pid || '未命名'}</span>
                          {p.type && (
                            <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-px font-mono text-[11px] text-text-secondary">
                              {p.type}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[12px] text-text-tertiary">
                          {p.base_url || '—'} · {count} 个模型
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconBtn
                        title="刷新模型列表"
                        onClick={() => void refreshProvider(pid)}
                        disabled={!pid || busyId === pid}
                      >
                        {busyId === pid ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      </IconBtn>
                      {confirmId === pid ? (
                        <button
                          type="button"
                          className="rounded-lg bg-danger px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
                          onClick={() => void removeProvider(pid)}
                          disabled={busyId === pid}
                        >
                          {busyId === pid ? <Loader2 size={12} className="animate-spin" /> : '确认删除'}
                        </button>
                      ) : (
                        <IconBtn
                          title="删除供应商"
                          danger
                          onClick={() => setConfirmId(pid)}
                        >
                          <Trash2 size={14} />
                        </IconBtn>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* 深度配置 */}
      <GroupLabel>深度配置</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <SecondaryModelCard models={models ?? []} config={config} onSaved={setConfig} />
        <ThinkingCard config={config} onSaved={setConfig} />
      </div>

      {/* 供应商滑出编辑面板 */}
      <ProviderPanel req={panelReq} onClose={() => setPanelReq(null)} onSaved={() => void onPanelSaved()} />
    </Section>
  )
}
