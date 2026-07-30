import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FileText,
  Globe,
  Pencil,
  Search,
  Terminal,
  Wrench,
  XCircle,
  Bot
} from 'lucide-react'
import type { ChatItem } from '../../stores/stream'
import { Markdown } from '../Markdown'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

function toolIcon(name: string) {
  if (name === 'Bash' || name === 'Shell') return <Terminal size={13} />
  if (name === 'Read' || name === 'Write' || name === 'ReadMediaFile') return <FileText size={13} />
  if (name === 'Edit') return <Pencil size={13} />
  if (name === 'Grep' || name === 'Glob' || name === 'WebSearch') return <Search size={13} />
  if (name === 'FetchURL') return <Globe size={13} />
  if (name === 'Agent' || name === 'AgentSwarm') return <Bot size={13} />
  return <Wrench size={13} />
}

export function ToolCallCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-secondary"
        onClick={() => setOpen(!open)}
      >
        <span className="text-text-tertiary">{toolIcon(item.name)}</span>
        <span className="font-mono text-[12.5px] font-medium text-text">{item.name}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
          {item.argsSummary}
        </span>
        {item.status === 'running' ? (
          <CircleDashed size={14} className="shrink-0 animate-spin text-primary" />
        ) : item.status === 'success' ? (
          <CheckCircle2 size={14} className="shrink-0 text-success" />
        ) : (
          <XCircle size={14} className="shrink-0 text-danger" />
        )}
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-text-tertiary" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-text-tertiary" />
        )}
      </button>
      {open && (
        <div className="border-t border-border-light bg-surface-secondary px-3 py-2">
          {item.args && (
            <pre className="mb-1 max-h-60 overflow-auto whitespace-pre-wrap break-all text-[12px] text-text-secondary">
              {item.args}
            </pre>
          )}
          {item.output && (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all border-t border-border-light pt-1 text-[12px] text-text-secondary">
              {item.output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** 连续工具调用聚合:>=3 个折叠成组 */
export function ToolGroup({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false)
  const done = items.filter((i) => i.status !== 'running').length
  const names = [...new Set(items.map((i) => i.name))].slice(0, 3).join(' · ')
  if (items.length < 3) {
    return (
      <div className="space-y-1.5">
        {items.map((i) => (
          <ToolCallCard key={i.id} item={i} />
        ))}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-secondary"
        onClick={() => setOpen(!open)}
      >
        <Wrench size={13} className="text-text-tertiary" />
        <span className="text-[12.5px] font-medium">{items.length} 个工具调用</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">{names} …</span>
        <span className="text-[11px] text-text-tertiary">
          {done}/{items.length}
        </span>
        {open ? (
          <ChevronDown size={13} className="text-text-tertiary" />
        ) : (
          <ChevronRight size={13} className="text-text-tertiary" />
        )}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border-light bg-surface-secondary p-2">
          {items.map((i) => (
            <ToolCallCard key={i.id} item={i} />
          ))}
        </div>
      )}
    </div>
  )
}
