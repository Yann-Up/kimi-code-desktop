import type { ReactNode } from 'react'

/** 设置页标准区块:标题 + 描述 + 内容卡片流(占满可用宽度,随窗口自适应) */
export function Section(props: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="px-8 py-6">
      <h2 className="text-xl font-semibold">{props.title}</h2>
      {props.desc && <p className="mb-5 mt-1 text-[13px] text-text-tertiary">{props.desc}</p>}
      <div className="mt-4 space-y-3">{props.children}</div>
    </div>
  )
}

/** 设置页标准卡片 */
export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-4 ${props.className ?? ''}`}
    >
      {props.children}
    </div>
  )
}

/** 小标题(蓝色,区块分组用,对齐截图风格) */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-5 text-[13px] font-semibold text-primary">{children}</h3>
}

/** 空态 */
export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border py-10 text-center text-[13px] text-text-tertiary">
      {text}
    </div>
  )
}
