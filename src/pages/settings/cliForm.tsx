/**
 * CLI 配置表单共享原语:字段行 + 输入控件 + 保存栏 + 加载/离线门面。
 * 风格对齐官方设置页灰面板(components/settings/common 的 Card + components/ui 控件)。
 * 约定:空输入不提交对应键(服务端为深合并语义,无法删除已设置的键)。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { Section, Empty } from '../../components/settings/common'
import { FolderPickerDialog } from '../../components/FolderPickerDialog'
import { Select } from '../../components/ui/Select'
import { Switch } from '../../components/ui/Switch'
import { inputCls as uiInputCls } from '../../components/ui/Input'
import type { CliConfig } from '../../hooks/useCliConfig'
import { useT } from '../../i18n'

/**
 * 单键的 snake_case ↔ camelCase 变体候选(原键优先)。
 * 在线 REST 返回顶层 snake、嵌套块 camelCase;离线直读 config.toml 为纯 snake_case,
 * 因此每个路径段都要同时兼容两种命名,否则离线模式会读成默认值并在保存时覆盖真实配置。
 */
function keyVariants(k: string): string[] {
  const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  return [...new Set([k, snake, camel])]
}

/** 按路径取嵌套值;路径段可为 string 或候选键数组,每键自动兼容 snake/camel 变体,取到即返回 */
export function nested(cfg: CliConfig | null, ...path: (string | string[])[]): unknown {
  if (!cfg) return undefined
  let cur: unknown = cfg
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    const obj = cur as Record<string, unknown>
    const keys = (Array.isArray(seg) ? seg : [seg]).flatMap(keyVariants)
    const hit = keys.find((k) => k in obj)
    if (hit === undefined) return undefined
    cur = obj[hit]
  }
  return cur
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 布尔取值:非布尔按文档默认回退 */
export function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt
}

/** 数字 → 表单输入串;非数字返回空串(代表未设置) */
export function numStr(v: unknown): string {
  return typeof v === 'number' ? String(v) : ''
}

/** 数组 → 字符串列表;非数组返回空列表 */
export function listStr(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map(String) : []
}

/** 去除空行后返回;空结果表示不提交该键 */
export function cleanList(v: string[]): string[] {
  return v.map((s) => s.trim()).filter(Boolean)
}

/** 字段行:左侧标题+说明,右侧控件(固定宽度,对齐 SSH 设置输入框观感) */
export function FieldRow(props: { label: string; desc?: string; control: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-[475]">{props.label}</p>
        {props.desc && <p className="mt-0.5 text-[12px] text-text-tertiary">{props.desc}</p>}
      </div>
      <div className="flex shrink-0 items-center">{props.control}</div>
    </div>
  )
}

const controlCls = uiInputCls('md', 'w-64')

export function TextField(props: {
  label: string
  desc?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <FieldRow
      label={props.label}
      desc={props.desc}
      control={
        <input
          className={`${controlCls} ${props.mono ? 'font-mono' : ''}`}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      }
    />
  )
}

/** 数字输入:表单层以字符串保存,空串 = 不提交该键 */
export function NumberField(props: {
  label: string
  desc?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <FieldRow
      label={props.label}
      desc={props.desc}
      control={
        <input
          className={`${controlCls} font-mono`}
          inputMode="numeric"
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value.replace(/[^0-9]/g, ''))}
        />
      }
    />
  )
}

export function SelectField(props: {
  label: string
  desc?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  /** 非空时追加一个空值占位项(未设置) */
  placeholder?: string
}) {
  const opts = props.placeholder ? [{ value: '', label: props.placeholder }, ...props.options] : props.options
  return (
    <FieldRow
      label={props.label}
      desc={props.desc}
      control={
        <Select className="w-64" value={props.value} options={opts} onChange={props.onChange} />
      }
    />
  )
}

/** 开关行(复刻官方 .ui-switch,见 components/ui/Switch) */
export function ToggleField(props: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <FieldRow
      label={props.label}
      desc={props.desc}
      control={<Switch checked={props.checked} onChange={props.onChange} />}
    />
  )
}

/** 路径列表编辑器:每行一个路径 + 删除按钮,末尾"添加路径" */
export function PathListField(props: {
  label: string
  desc?: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  // 「浏览选择」弹层:经 FolderPickerDialog(REST fs:browse)选目录后追加为一行;手动输入仍可用
  const [picking, setPicking] = useState(false)
  const t = useT()
  return (
    <div>
      <p className="text-[13px] font-[475]">{props.label}</p>
      {props.desc && <p className="mt-0.5 text-[12px] text-text-tertiary">{props.desc}</p>}
      <div className="mt-2 space-y-1.5">
        {props.values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={uiInputCls('sm', 'min-w-0 flex-1 font-mono')}
              placeholder={props.placeholder}
              value={v}
              onChange={(e) => props.onChange(props.values.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              className="shrink-0 rounded-lg border border-border p-1.5 text-text-tertiary transition-colors hover:bg-danger-soft hover:text-danger"
              title={t('cliGeneral.form.deleteRow')}
              onClick={() => props.onChange(props.values.filter((_, j) => j !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
          onClick={() => props.onChange([...props.values, ''])}
        >
          <Plus size={12} /> {t('cliGeneral.form.addPath')}
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
          onClick={() => setPicking(true)}
        >
          <FolderOpen size={12} /> {t('cliGeneral.form.browse')}
        </button>
      </div>
      {picking && (
        <FolderPickerDialog
          title={t('cliGeneral.form.pickDirTitle')}
          subtitle={props.label}
          confirmLabel={t('cliGeneral.form.pickDirConfirm')}
          onSelect={(p) => {
            setPicking(false)
            // 已存在则不再重复添加
            if (!props.values.includes(p)) props.onChange([...props.values, p])
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** 保存栏:保存按钮 + 短暂"已保存"反馈 / 错误文案;savedText 可定制成功文案(如离线直写时提示重启生效) */
export function SaveBar(props: { saving: boolean; saved: boolean; error: string; onSave: () => void; savedText?: string }) {
  const t = useT()
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border-light pt-3">
      {props.saved && <span className="text-[12px] text-success">{props.savedText ?? t('cliGeneral.form.saved')}</span>}
      {props.error && (
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-danger">{props.error}</span>
      )}
      <button
        className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        disabled={props.saving}
        onClick={props.onSave}
      >
        {props.saving ? t('cliGeneral.form.saving') : t('cliGeneral.form.save')}
      </button>
    </div>
  )
}

/** 合并语义提示(空输入不提交,已设置的键无法删除) */
export function MergeNote() {
  const t = useT()
  return (
    <p className="text-[11.5px] text-text-tertiary">
      {t('cliGeneral.form.mergeNote')}
    </p>
  )
}

/** 表单保存状态机:onSave 成功后短暂显示"已保存",失败展示错误文案 */
export function useSaveState() {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = async (fn: () => Promise<void>) => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await fn()
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return { saving, saved, error, save }
}

/** 服务离线判定:rest 在服务未启动时报 "server not ready" */
export function isServerOffline(error: string): boolean {
  return error.toLowerCase().includes('server not ready')
}

/** 离线直写提醒:服务未启动时 useCliConfig 降级为直读直写 config.toml,保存需重启服务生效 */
export function OfflineNotice() {
  const t = useT()
  return (
    <p className="rounded-lg border border-warning/20 bg-warning-soft px-3 py-2 text-[12px] text-warning">
      {t('cliGeneral.form.offlineNotice')}
    </p>
  )
}

/** CLI 配置页门面:加载中 / 加载失败 两态拦截,通过后渲染表单内容;offline 时在顶部展示直写提醒 */
export function CliConfigGate(props: {
  title: string
  desc: string
  loading: boolean
  error: string
  onRetry: () => void
  offline?: boolean
  children: ReactNode
}) {
  const t = useT()
  if (props.loading) {
    return (
      <Section title={props.title} desc={props.desc}>
        <Empty text={t('cliGeneral.form.loading')} />
      </Section>
    )
  }
  if (props.error) {
    const offline = isServerOffline(props.error)
    return (
      <Section title={props.title} desc={props.desc}>
        <Empty
          text={
            offline
              ? t('cliGeneral.form.offlineReadFailed')
              : t('cliGeneral.form.loadFailed', { error: props.error })
          }
        />
        <div className="flex justify-end">
          <button
            className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover"
            onClick={props.onRetry}
          >
            {t('cliGeneral.form.retry')}
          </button>
        </div>
      </Section>
    )
  }
  return (
    <Section title={props.title} desc={props.desc}>
      {props.offline && <OfflineNotice />}
      {props.children}
    </Section>
  )
}
