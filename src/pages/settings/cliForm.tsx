/**
 * CLI 配置表单共享原语:字段行 + 输入控件 + 保存栏 + 加载/离线门面。
 * 风格对齐 components/settings/common 的白底卡片(13px 左右字号、border-border 圆角)。
 * 约定:空输入不提交对应键(服务端为深合并语义,无法删除已设置的键)。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Section, Empty } from '../../components/settings/common'
import type { CliConfig } from '../../hooks/useCliConfig'

/** 按路径取嵌套值;路径段可为 string 或候选键数组(兼容 snake/camel 差异),取到即返回 */
export function nested(cfg: CliConfig | null, ...path: (string | string[])[]): unknown {
  if (!cfg) return undefined
  let cur: unknown = cfg
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    const obj = cur as Record<string, unknown>
    const keys = Array.isArray(seg) ? seg : [seg]
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
        <p className="text-[13.5px] font-medium">{props.label}</p>
        {props.desc && <p className="mt-0.5 text-[12px] text-text-tertiary">{props.desc}</p>}
      </div>
      <div className="flex shrink-0 items-center">{props.control}</div>
    </div>
  )
}

const controlCls =
  'w-64 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-primary placeholder:text-text-tertiary'

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
          className={`${controlCls} ${props.mono ? 'font-mono text-[12px]' : ''}`}
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
          className={`${controlCls} font-mono text-[12px]`}
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
        <select
          className={controlCls}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        >
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      }
    />
  )
}

/** 开关行(与 MCP 设置页的开关同款) */
export function ToggleField(props: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <FieldRow
      label={props.label}
      desc={props.desc}
      control={
        <button
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            props.checked ? 'bg-success' : 'bg-border'
          }`}
          onClick={() => props.onChange(!props.checked)}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
              props.checked ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </button>
      }
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
  return (
    <div>
      <p className="text-[13.5px] font-medium">{props.label}</p>
      {props.desc && <p className="mt-0.5 text-[12px] text-text-tertiary">{props.desc}</p>}
      <div className="mt-2 space-y-1.5">
        {props.values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none transition-colors focus:border-primary placeholder:text-text-tertiary"
              placeholder={props.placeholder}
              value={v}
              onChange={(e) => props.onChange(props.values.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              className="shrink-0 rounded-lg border border-border p-1.5 text-text-tertiary transition-colors hover:bg-danger-soft hover:text-danger"
              title="删除该行"
              onClick={() => props.onChange(props.values.filter((_, j) => j !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
        onClick={() => props.onChange([...props.values, ''])}
      >
        <Plus size={12} /> 添加路径
      </button>
    </div>
  )
}

/** 保存栏:保存按钮 + 短暂"已保存"反馈 / 错误文案 */
export function SaveBar(props: { saving: boolean; saved: boolean; error: string; onSave: () => void }) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border-light pt-3">
      {props.saved && <span className="text-[12px] text-success">已保存</span>}
      {props.error && (
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-danger">{props.error}</span>
      )}
      <button
        className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        disabled={props.saving}
        onClick={props.onSave}
      >
        {props.saving ? '保存中…' : '保存'}
      </button>
    </div>
  )
}

/** 合并语义提示(空输入不提交,已设置的键无法删除) */
export function MergeNote() {
  return (
    <p className="text-[11.5px] text-text-tertiary">
      写回为合并语义:仅提交本页涉及且已填写的键;留空项不会改动,已设置的键无法通过表单删除
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

/** CLI 配置页门面:加载中 / 服务未启动 / 加载失败 三态,通过后渲染表单内容 */
export function CliConfigGate(props: {
  title: string
  desc: string
  loading: boolean
  error: string
  onRetry: () => void
  children: ReactNode
}) {
  if (props.loading) {
    return (
      <Section title={props.title} desc={props.desc}>
        <Empty text="加载中…" />
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
              ? '服务未启动,CLI 配置不可编辑,请先在对话页启动服务'
              : `配置加载失败:${props.error}`
          }
        />
        <div className="flex justify-end">
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
            onClick={props.onRetry}
          >
            重试
          </button>
        </div>
      </Section>
    )
  }
  return (
    <Section title={props.title} desc={props.desc}>
      {props.children}
    </Section>
  )
}
