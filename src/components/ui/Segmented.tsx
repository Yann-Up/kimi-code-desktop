/**
 * Segmented: 复刻官方 kimi web UI 的分段选择器(官方为 Vue 自研组件,此处为 React 复刻)。
 * 槽:透明底(不加背景色)+ 0.5px border-strong 边,圆角 10px,内边距 3px;
 * 项:h-7 px-3,圆角 7px,未选中 text-secondary(hover 变深);
 * 选中:elevated 凸起面 + 轻投影 + text 加粗(浅色下为白底浮于灰槽,深色下为亮灰)。
 * 适合 2-4 个短选项(权限模式/字体大小等);选项多或动态时用 Select。
 */
import type { ReactNode } from 'react'

export interface SegmentedOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export function Segmented(props: {
  value: string
  options: SegmentedOption[]
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      className={`inline-flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-border-strong p-[3px] ${
        props.disabled ? 'pointer-events-none opacity-50' : ''
      } ${props.className ?? ''}`}
    >
      {props.options.map((o) => {
        const sel = o.value === props.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={o.disabled}
            className={`flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              sel
                ? 'bg-elevated font-medium text-text shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
