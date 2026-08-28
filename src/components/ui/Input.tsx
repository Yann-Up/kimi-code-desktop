/**
 * Input / Textarea: 复刻官方 kimi web UI 的 .ui-input(官方为 Vue 自研组件,此处为 React 复刻)。
 * 关键样式(实测 CLI 0.39.0 dist-web):
 *   md 38px 圆角 8px / sm 32px 圆角 6px 字号 13px;px-3;0.5px border-strong 边;
 *   底色 surface-overlay(浅纯白 / 深 10% 白,即 --color-input-bg)+ shadow-xs;
 *   hover 无变化;focus = accent 边 + 3px accent-soft 蓝环;禁用 opacity .5;
 *   placeholder 用 text-tertiary(官方 text-faint 同值)。
 *   textarea:同契约,min-h 84px,padding 10px 12px,resize-y。
 * 用法:优先用 <Input>/<Textarea> 组件;需要塞进既有布局(自定义宽度/图标并排)时用
 * inputCls()/textareaCls() 类串,不要再手写 border/rounded 组合。
 */
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

type Size = 'md' | 'sm'

/** 尺寸相关:md = 38px/8px 圆角/14px;sm = 32px/6px 圆角/13px(搜索框、紧凑表单) */
const sizeCls: Record<Size, string> = {
  md: 'h-[38px] rounded-lg text-[14px]',
  sm: 'h-8 rounded-md text-[13px]'
}

const baseCls =
  'border-[0.5px] border-border-strong bg-input-bg px-3 text-text shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-text-tertiary focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] disabled:cursor-not-allowed disabled:opacity-50'

/** 单行输入框类串(extra 传宽度/字距等布局类,如 'w-64 font-mono') */
export function inputCls(size: Size = 'md', extra = ''): string {
  return `${sizeCls[size]} ${baseCls} ${extra}`.trim()
}

/** 多行输入框类串(自带 min-h-[84px] 与 py-2.5,可用 extra 覆盖高度) */
export function textareaCls(extra = ''): string {
  return `min-h-[84px] rounded-lg py-2.5 text-[14px] ${baseCls} resize-y ${extra}`.trim()
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: Size
}

export function Input({ size = 'md', className, ...rest }: InputProps) {
  return <input className={inputCls(size, className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={textareaCls(className)} {...rest} />
}
