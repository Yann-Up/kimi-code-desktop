/**
 * Select: 复刻官方 kimi web UI 的 .ui-select(官方为 Vue 自研组件库,此处为 React 复刻)。
 * 关键样式(实测 CLI 0.39.0 dist-web):
 *   触发器:md 38px(默认,对齐官方设置页控件高度)/ sm 32px(标题栏/表格工具栏等紧凑区),
 *           0.5px border-strong 边,打开/focus 时边框 accent + 3px accent-soft 蓝环,
 *           chevron 14px 打开翻转;禁用 opacity .5
 *   弹层:fixed 定位 + portal,menu-bg 毛玻璃(blur24 saturate1.8),0.5px 边,圆角 8px,padding 4px,
 *         menu-shadow,max-height 260px,menu-pop-in 动画(scale .97 + translateY 2px)
 *   选项:min-h 32px,圆角 3.5px(嵌套公式),hover/激活 = 中性灰 bg-hover(从不整行铺蓝),
 *         选中 = 行首蓝对勾(底色不变);分组标签 12px 灰字
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  /** 分组标签:与上一项不同则先渲染分组行 */
  group?: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  placeholder?: string
  /** 触发器附加类(宽度等) */
  className?: string
  title?: string
}

export function Select({
  value,
  options,
  onChange,
  size = 'md',
  disabled,
  placeholder,
  className,
  title
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean }>({
    left: 0,
    top: 0,
    width: 0,
    up: false
  })

  const selected = options.find((o) => o.value === value)

  // 打开时按触发器 rect 定位(fixed + portal,不被滚动容器裁剪);贴近底部时向上翻
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const menuH = Math.min(260, options.length * 32 + 8)
    const up = window.innerHeight - r.bottom < menuH + 8 && r.top > menuH + 8
    setPos({ left: r.left, top: up ? r.top - menuH - 4 : r.bottom + 4, width: r.width, up })
    setActiveIdx(options.findIndex((o) => o.value === value))
  }, [open, options.length, options, value])

  // 外部点击 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen(true)
    }
  }
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setActiveIdx((i) => {
        let n = i
        for (let k = 0; k < options.length; k++) {
          n = (n + dir + options.length) % options.length
          if (!options[n].disabled) break
        }
        return n
      })
    } else if (e.key === 'Enter' && activeIdx >= 0 && !options[activeIdx]?.disabled) {
      e.preventDefault()
      pick(options[activeIdx].value)
    }
  }

  const h = size === 'md' ? 'h-[38px] text-[14px]' : 'h-8 text-[13px]'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        className={`flex ${h} items-center justify-between gap-2 rounded-lg border-[0.5px] bg-transparent px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? 'border-primary shadow-[0_0_0_3px_var(--color-primary-soft)]'
            : 'border-border-strong'
        } ${className ?? ''}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`min-w-0 truncate ${selected ? 'text-text' : 'text-text-tertiary'}`}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-text-secondary transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            tabIndex={-1}
            className="menu-pop-in fixed z-[500] max-h-[260px] overflow-y-auto overscroll-contain rounded-lg border-[0.5px] border-border-strong bg-menu-bg p-1 shadow-[var(--menu-shadow)] backdrop-blur-[24px] backdrop-saturate-[1.8]"
            style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((o, i) => {
              const showGroup = o.group && (i === 0 || options[i - 1].group !== o.group)
              const isSel = o.value === value
              return (
                <div key={o.value}>
                  {showGroup && (
                    <div className="px-2 pb-1 pt-2 text-[12px] font-medium text-text-tertiary">
                      {o.group}
                    </div>
                  )}
                  <div
                    role="option"
                    aria-selected={isSel}
                    className={`flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[3.5px] px-2 py-1 text-[13px] text-text ${
                      o.disabled ? 'cursor-not-allowed opacity-45' : ''
                    } ${i === activeIdx ? 'bg-hover' : ''}`}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => !o.disabled && pick(o.value)}
                  >
                    <Check
                      size={14}
                      className={`shrink-0 ${isSel ? 'text-primary' : 'text-transparent'}`}
                    />
                    <span className="min-w-0 truncate">{o.label}</span>
                  </div>
                </div>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
