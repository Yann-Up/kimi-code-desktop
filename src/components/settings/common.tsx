import type { ReactNode } from 'react'

/** 设置页标准区块:标题 + 描述 + 内容卡片流(占满可用宽度,随窗口自适应);fill=true 时内容区占满剩余高度(用于编辑器等场景) */
export function Section(props: { title: string; desc?: string; children: ReactNode; fill?: boolean }) {
  return (
    <div className={props.fill ? 'flex h-full min-h-0 flex-col px-8 py-6' : 'px-8 py-6'}>
      <h2 className="text-[16px] font-semibold">{props.title}</h2>
      {props.desc && <p className="mb-5 mt-1 whitespace-pre-line text-[13px] text-text-tertiary">{props.desc}</p>}
      <div className={props.fill ? 'mt-4 flex min-h-0 flex-1 flex-col space-y-3' : 'mt-4 space-y-3'}>
        {props.children}
      </div>
    </div>
  )
}

/** 设置页标准卡片:官方 kimi web 设置页风格——填充式灰面板(surface-tertiary,浅 #f5f5f5 / 深 #1f1f1f),
 *  大圆角、无边框;面板上的徽章/控件槽用 bg-fill,按钮/选中项用 bg-elevated。
 *  skin-card:皮肤立绘开启时半透明 + 毛玻璃,见 theme.css */
export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`skin-card rounded-2xl bg-surface-tertiary p-4 ${props.className ?? ''}`}
    >
      {props.children}
    </div>
  )
}

/** 分组小标题(官方风格:15px 半粗正文色,与卡片间距拉开;不用强调色) */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-6 text-[15px] font-semibold text-text">{children}</h3>
}

/** 空态 */
export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-surface-tertiary py-10 text-center text-[13px] text-text-tertiary">
      {text}
    </div>
  )
}
