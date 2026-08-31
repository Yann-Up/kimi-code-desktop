import { useState } from 'react'
import { Gauge, Table2 } from 'lucide-react'
import { UsageSettings } from '../settings/UsageSettings'
import { ApiCallsTable } from './ApiCallsTable'
import { useT } from '../../i18n'

type StatsView = 'overview' | 'calls'

const SUB_TABS: { id: StatsView; labelKey: string; icon: typeof Gauge }[] = [
  { id: 'overview', labelKey: 'stats.tab.overview', icon: Gauge },
  { id: 'calls', labelKey: 'stats.tab.calls', icon: Table2 }
]

/** 统计 tab 容器:子页签切换「用量概览」(使用统计)/「API 调用」(逐次调用明细)。
 *  子页懒挂载:首次切到才渲染(避免冷缓存时两个子页并发触发全量扫描),挂载后常驻不丢状态 */
export function StatsPage() {
  const t = useT()
  const [sub, setSub] = useState<StatsView>('overview')
  // 已挂载过的子页集合:挂载后保持常驻(切页签只 hidden)
  const [mounted, setMounted] = useState<Set<StatsView>>(() => new Set(['overview']))

  const switchTo = (v: StatsView) => {
    setSub(v)
    setMounted((m) => (m.has(v) ? m : new Set(m).add(v)))
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* 子页签:样式对齐顶部 tab(border-b-2 高亮) */}
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border-light bg-surface px-6">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon
          const active = sub === tab.id
          return (
            <button
              key={tab.id}
              className={`flex h-10 items-center gap-1.5 px-3 text-[13px] transition-colors ${
                active
                  ? 'border-b-2 border-primary font-medium text-primary'
                  : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => switchTo(tab.id)}
            >
              <Icon size={14} /> {t(tab.labelKey)}
            </button>
          )
        })}
      </div>

      {mounted.has('overview') && (
        <div className={sub === 'overview' ? '' : 'hidden'}>
          <UsageSettings />
        </div>
      )}
      {mounted.has('calls') && (
        <div className={sub === 'calls' ? '' : 'hidden'}>
          <ApiCallsTable />
        </div>
      )}
    </div>
  )
}
