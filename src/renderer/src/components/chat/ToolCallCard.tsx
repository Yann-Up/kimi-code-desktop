import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FileText,
  Globe,
  ListTodo,
  Pencil,
  Search,
  Terminal,
  Wrench,
  XCircle
} from 'lucide-react'
import type { ChatItem } from '../../stores/stream'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** 工具中文名:对齐 kimi web 的展示风格 */
const TOOL_LABELS: Record<string, string> = {
  Read: '读取',
  Write: '写入',
  Edit: '编辑',
  ReadMediaFile: '读取',
  Bash: '运行',
  Shell: '运行',
  Grep: '搜索',
  Glob: '查找文件',
  WebSearch: '网页搜索',
  FetchURL: '抓取网页',
  Agent: '子代理',
  AgentSwarm: '子代理',
  TodoList: '更新待办',
  Skill: '技能',
  TaskList: '任务列表',
  TaskOutput: '任务输出',
  CronCreate: '定时任务'
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

function toolIcon(name: string) {
  if (name === 'Bash' || name === 'Shell') return <Terminal size={13} />
  if (name === 'Read' || name === 'Write' || name === 'ReadMediaFile') return <FileText size={13} />
  if (name === 'Edit') return <Pencil size={13} />
  if (name === 'Grep' || name === 'Glob' || name === 'WebSearch') return <Search size={13} />
  if (name === 'FetchURL') return <Globe size={13} />
  if (name === 'Agent' || name === 'AgentSwarm') return <Bot size={13} />
  if (name === 'TodoList') return <ListTodo size={13} />
  return <Wrench size={13} />
}

const lineCount = (v: unknown): number => (typeof v === 'string' && v ? v.split('\n').length : 0)

/** 行级统计:Edit → +新增 −删除;Write → +行数;Read → 输出 N 行(对齐 kimi web 行尾展示) */
function toolStat(item: ToolItem): { added?: number; removed?: number; lines?: number } | null {
  if (item.name === 'Read' || item.name === 'ReadMediaFile') {
    if (item.status === 'running' || !item.output) return null
    return { lines: lineCount(item.output) }
  }
  if (item.name !== 'Edit' && item.name !== 'Write') return null
  let input: Record<string, unknown> | null = null
  try {
    const p = JSON.parse(item.args || '{}')
    if (p && typeof p === 'object') input = p as Record<string, unknown>
  } catch {
    input = null
  }
  if (!input) return null
  if (item.name === 'Edit') {
    const added = lineCount(input.new_string)
    const removed = lineCount(input.old_string)
    return added || removed ? { added, removed } : null
  }
  const added = lineCount(input.content)
  return added ? { added } : null
}

function StatusIcon({ status }: { status: ToolItem['status'] }) {
  if (status === 'running') return <CircleDashed size={14} className="shrink-0 animate-spin text-primary" />
  if (status === 'success') return <CheckCircle2 size={14} className="shrink-0 text-success" />
  return <XCircle size={14} className="shrink-0 text-danger" />
}

/** 单个工具调用行:图标 + 中文名 + 参数摘要 + 行级统计 + 状态,点击展开参数/结果 */
function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const stat = toolStat(item)
  return (
    <div>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-secondary"
        onClick={() => setOpen(!open)}
      >
        <span className="shrink-0 text-text-tertiary">{toolIcon(item.name)}</span>
        <span className="shrink-0 text-[12.5px] font-medium text-text-secondary">
          {toolLabel(item.name)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-tertiary">
          {item.argsSummary}
        </span>
        {stat?.lines != null && (
          <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{stat.lines} 行</span>
        )}
        {stat?.added != null && stat.added > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-success">+{stat.added}</span>
        )}
        {stat?.removed != null && stat.removed > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-danger">−{stat.removed}</span>
        )}
        <StatusIcon status={item.status} />
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

/**
 * 连续工具调用聚合卡片(kimi web 同款):
 * 头部 "N 个工具调用 · 名称…",运行中自动展开、全部结束自动收起(用户手动操作后不干预);
 * 单个工具调用直接渲染为一行。
 */
export function ToolGroup({ items }: { items: ToolItem[] }) {
  const anyRunning = items.some((i) => i.status === 'running')
  const [open, setOpen] = useState(anyRunning)
  const userToggled = useRef(false)

  /* 非用户干预时跟随运行状态:运行中展开,结束收起 */
  useEffect(() => {
    if (!userToggled.current) setOpen(anyRunning)
  }, [anyRunning])

  if (items.length === 1) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <ToolRow item={items[0]} />
      </div>
    )
  }

  const done = items.filter((i) => i.status !== 'running').length
  const hasError = items.some((i) => i.status === 'error')
  const names = [...new Set(items.map((i) => toolLabel(i.name)))].slice(0, 3).join(' · ')
  const statusText = anyRunning ? `${done}/${items.length}` : hasError ? '有失败' : '已完成'

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-secondary"
        onClick={() => {
          userToggled.current = true
          setOpen(!open)
        }}
      >
        {anyRunning ? (
          <CircleDashed size={14} className="shrink-0 animate-spin text-primary" />
        ) : hasError ? (
          <XCircle size={14} className="shrink-0 text-danger" />
        ) : (
          <CheckCircle2 size={14} className="shrink-0 text-success" />
        )}
        <span className="shrink-0 text-[12.5px] font-medium">{items.length} 个工具调用</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">{names} …</span>
        <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{statusText}</span>
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-text-tertiary" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-text-tertiary" />
        )}
      </button>
      {open && (
        <div className="divide-y divide-border-light border-t border-border-light">
          {items.map((i) => (
            <ToolRow key={i.id} item={i} />
          ))}
        </div>
      )}
    </div>
  )
}
