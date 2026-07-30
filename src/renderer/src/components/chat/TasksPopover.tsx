/**
 * TasksPopover:状态条 chip 的上弹层,展示后台任务 / 子代理 / 待办三类内容。
 * 纯展示组件:数据与轮询由 StatusBar 统一管理后透传。
 */
import { CheckCircle2, Circle, Loader2, Terminal, X } from 'lucide-react'

export type PopoverTab = 'tasks' | 'children' | 'todos'

export interface TaskEntry {
  id: string
  kind: string
  description: string
  status: string
  command: string
  created_at?: string
  started_at?: string
}

export interface ChildEntry {
  id: string
  kind: string
  description: string
  status: string
  created_at?: string
}

export interface TodoEntry {
  title: string
  status: string
}

// ---------- 工具函数 ----------

function statusKind(status: string): 'running' | 'completed' | 'failed' {
  const s = status.toLowerCase()
  if (['failed', 'error', 'errored', 'crashed'].includes(s)) return 'failed'
  if (
    ['completed', 'done', 'finished', 'succeeded', 'success', 'stopped', 'cancelled', 'canceled'].includes(s)
  )
    return 'completed'
  return 'running'
}

/** 状态徽标:运行中=蓝色脉冲、完成=绿、失败=红。 */
function StatusBadge({ status }: { status: string }) {
  const kind = statusKind(status)
  const cls =
    kind === 'failed'
      ? 'border-danger/20 bg-danger-soft text-danger'
      : kind === 'completed'
        ? 'border-success/20 bg-success-soft text-success'
        : 'border-primary-border bg-primary-soft text-primary'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${cls}`}
    >
      {kind === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
      {status || '运行中'}
    </span>
  )
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-6 text-center text-[12px] text-text-tertiary">{text}</p>
}

function LoadFailed() {
  return <p className="px-3 py-6 text-center text-[12px] text-danger">加载失败</p>
}

// ---------- 弹层 ----------

interface TasksPopoverProps {
  tab: PopoverTab
  tasks: TaskEntry[]
  childEntries: ChildEntry[]
  todos: TodoEntry[]
  tasksError: boolean
  childrenError: boolean
  onClose: () => void
}

const TITLES: Record<PopoverTab, string> = {
  tasks: '后台任务',
  children: '子代理',
  todos: '待办清单'
}

export function TasksPopover(props: TasksPopoverProps) {
  const { tab, tasks, childEntries, todos, tasksError, childrenError, onClose } = props

  return (
    <div
      className="absolute bottom-full left-0 z-30 mb-2 w-[440px] max-w-[calc(100vw-4rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-border-light px-3 py-2">
        <span className="text-[12.5px] font-medium text-text-secondary">{TITLES[tab]}</span>
        <button
          className="rounded-md p-1 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-1.5">
        {tab === 'tasks' &&
          (tasksError ? (
            <LoadFailed />
          ) : tasks.length === 0 ? (
            <Empty text="没有后台任务" />
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="rounded-lg px-2 py-1.5 hover:bg-surface-secondary">
                <div className="flex items-center gap-2">
                  <Terminal size={13} className="shrink-0 text-text-tertiary" />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[12px] text-text"
                    title={t.command || t.description}
                  >
                    {(t.command || t.description || t.id).slice(0, 100)}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
                {(t.created_at || t.started_at) && (
                  <p className="mt-0.5 pl-[21px] text-[11px] text-text-tertiary">
                    {timeAgo(t.started_at ?? t.created_at)}
                  </p>
                )}
              </div>
            ))
          ))}

        {tab === 'children' &&
          (childrenError ? (
            <LoadFailed />
          ) : childEntries.length === 0 ? (
            <Empty text="当前会话没有子代理" />
          ) : (
            childEntries.map((c) => (
              <div key={c.id} className="rounded-lg px-2 py-1.5 hover:bg-surface-secondary">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded border border-border bg-surface-secondary px-1.5 py-px font-mono text-[11px] text-text-secondary">
                    {c.kind || 'subagent'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" title={c.description}>
                    {c.description || c.id}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                {c.created_at && (
                  <p className="mt-0.5 text-[11px] text-text-tertiary">{timeAgo(c.created_at)}</p>
                )}
              </div>
            ))
          ))}

        {tab === 'todos' &&
          (todos.length === 0 ? (
            <Empty text="暂无待办" />
          ) : (
            todos.map((t, i) => {
              const st = t.status
              const done = st === 'done' || st === 'completed'
              const active = st === 'in_progress'
              return (
                <div
                  key={`${t.title}-${i}`}
                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                    active ? 'bg-primary-soft' : 'hover:bg-surface-secondary'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
                  ) : active ? (
                    <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Circle size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
                  )}
                  <span
                    className={`min-w-0 flex-1 break-words text-[12.5px] leading-5 ${
                      done
                        ? 'text-text-tertiary line-through'
                        : active
                          ? 'font-medium text-primary'
                          : 'text-text-secondary'
                    }`}
                  >
                    {t.title || '(未命名待办)'}
                  </span>
                </div>
              )
            })
          ))}
      </div>
    </div>
  )
}
