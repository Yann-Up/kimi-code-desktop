/**
 * StatusBar:输入框正上方的状态条。
 * 一行 chips:后台 Bash(N)/ 子 Agent(N)/ 待办(完成数/总数),有内容才显示。
 * 数据轮询:会话 busy 时每 3 秒,空闲每 10 秒;待办直接从 stream items 归约。
 */
import { useEffect, useMemo, useState } from 'react'
import { Bot, ListTodo, Terminal } from 'lucide-react'
import { rest } from '@/api'
import { useStream } from '@/stores/stream'
import {
  TasksPopover,
  type ChildEntry,
  type PopoverTab,
  type TaskEntry,
  type TodoEntry
} from './TasksPopover'

type Raw = Record<string, unknown>

/** 容错地把接口返回规范为对象数组(支持裸数组或 items/children 包裹)。 */
function asList(v: unknown): Raw[] {
  if (Array.isArray(v)) return v as Raw[]
  if (v && typeof v === 'object') {
    const o = v as Raw
    for (const key of ['items', 'children', 'tasks', 'subagents']) {
      if (Array.isArray(o[key])) return o[key] as Raw[]
    }
  }
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function toTask(r: Raw, i: number): TaskEntry {
  return {
    id: str(r.id) || `task-${i}`,
    kind: str(r.kind) || str(r.type),
    description: str(r.description) || str(r.title),
    status: str(r.status) || str(r.state),
    command: str(r.command),
    created_at: str(r.created_at) || undefined,
    started_at: str(r.started_at) || undefined
  }
}

function toChild(r: Raw, i: number): ChildEntry {
  return {
    id: str(r.id) || str(r.session_id) || `child-${i}`,
    kind: str(r.subagent_type) || str(r.kind) || str(r.type) || 'subagent',
    description: str(r.description) || str(r.title),
    status: str(r.status) || str(r.state),
    created_at: str(r.created_at) || undefined
  }
}

/** 从 stream items 里取最后一个含 todos 数组的 TodoList 工具项。 */
function extractTodos(items: ReturnType<typeof useStream.getState>['items']): TodoEntry[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== 'tool' || it.name !== 'TodoList') continue
    try {
      const args = JSON.parse(it.args) as { todos?: { title?: unknown; status?: unknown }[] }
      if (Array.isArray(args.todos)) {
        return args.todos.map((t) => ({
          title: typeof t.title === 'string' ? t.title : String(t.title ?? ''),
          status: typeof t.status === 'string' ? t.status : 'pending'
        }))
      }
    } catch {
      /* args 截断或非法 JSON,继续向前找 */
    }
  }
  return []
}

export function StatusBar({ sessionId }: { sessionId: string }) {
  const busy = useStream((s) => !!s.status.busy)
  const items = useStream((s) => s.items)

  const [tasks, setTasks] = useState<TaskEntry[]>([])
  const [children, setChildren] = useState<ChildEntry[]>([])
  const [tasksError, setTasksError] = useState(false)
  const [childrenError, setChildrenError] = useState(false)
  const [openTab, setOpenTab] = useState<PopoverTab | null>(null)

  // 轮询:busy 时 3 秒,空闲 10 秒
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await rest<unknown>(`/api/v1/sessions/${sessionId}/tasks`)
        if (!cancelled) {
          setTasks(asList(r).map(toTask))
          setTasksError(false)
        }
      } catch {
        if (!cancelled) setTasksError(true)
      }
      try {
        const r = await rest<unknown>(`/api/v1/sessions/${sessionId}/children`)
        if (!cancelled) {
          setChildren(asList(r).map(toChild))
          setChildrenError(false)
        }
      } catch {
        if (!cancelled) setChildrenError(true)
      }
    }
    void load()
    const timer = setInterval(() => void load(), busy ? 3000 : 10000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, busy])

  // 点击外部关闭弹层
  useEffect(() => {
    if (!openTab) return
    const close = () => setOpenTab(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [openTab])

  const todos = useMemo(() => extractTodos(items), [items])
  const doneCount = todos.filter((t) => t.status === 'done' || t.status === 'completed').length

  const bashTasks = tasks.filter((t) => t.kind.toLowerCase() === 'bash')
  const otherTasks = tasks.filter((t) => t.kind.toLowerCase() !== 'bash')
  // 子代理优先用 /children 结果,接口无数据时回退 tasks 里非 bash 项
  const childEntries = children.length > 0 ? children : otherTasks

  if (bashTasks.length === 0 && childEntries.length === 0 && todos.length === 0) return null

  const chipCls = (tab: PopoverTab) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
      openTab === tab
        ? 'border-primary-border bg-primary-soft text-primary'
        : 'border-border bg-surface-secondary text-text-secondary hover:border-primary-border hover:bg-primary-soft hover:text-primary'
    }`

  return (
    <div className="relative mb-2 flex flex-wrap items-center gap-1.5">
      {bashTasks.length > 0 && (
        <button
          className={chipCls('tasks')}
          onClick={(e) => {
            e.stopPropagation()
            setOpenTab(openTab === 'tasks' ? null : 'tasks')
          }}
        >
          <Terminal size={13} /> 后台 Bash ({bashTasks.length})
        </button>
      )}
      {childEntries.length > 0 && (
        <button
          className={chipCls('children')}
          onClick={(e) => {
            e.stopPropagation()
            setOpenTab(openTab === 'children' ? null : 'children')
          }}
        >
          <Bot size={13} /> 子 Agent ({childEntries.length})
        </button>
      )}
      {todos.length > 0 && (
        <button
          className={chipCls('todos')}
          onClick={(e) => {
            e.stopPropagation()
            setOpenTab(openTab === 'todos' ? null : 'todos')
          }}
        >
          <ListTodo size={13} /> 待办 ({doneCount}/{todos.length})
        </button>
      )}

      {openTab && (
        <TasksPopover
          tab={openTab}
          tasks={bashTasks}
          childEntries={childEntries}
          todos={todos}
          tasksError={tasksError}
          childrenError={childrenError}
          onClose={() => setOpenTab(null)}
        />
      )}
    </div>
  )
}
