import { create } from 'zustand'
import { rest, type SessionItem, type WorkspaceItem } from '../api'
import { useUi } from './ui'

interface SessionsState {
  workspaces: WorkspaceItem[]
  sessions: SessionItem[]
  archived: SessionItem[]
  showArchived: boolean
  activeSessionId: string | null
  loading: boolean
  search: string

  refresh: () => Promise<void>
  loadArchived: () => Promise<void>
  toggleArchived: () => void
  setSearch: (s: string) => void
  setActive: (id: string | null) => void
  createSession: (cwd: string) => Promise<SessionItem>
  archiveSession: (id: string) => Promise<void>
  restoreSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  exportSession: (id: string) => Promise<void>
  upsertSession: (s: SessionItem) => void
}

async function fetchAllSessions(query: Record<string, string | number | boolean | undefined>) {
  const items: SessionItem[] = []
  let before: string | undefined
  for (;;) {
    const page = await rest<{ items: SessionItem[]; has_more: boolean }>('/api/v1/sessions', {
      query: { ...query, page_size: 100, before_id: before }
    })
    items.push(...(page.items ?? []))
    const next = page.items?.length ? page.items[page.items.length - 1].id : undefined
    // 无进展守卫:游标未前进或本页为空即退出,避免服务端异常返回时死循环
    if (!page.has_more || !next || next === before) break
    before = next
  }
  return items
}

export const useSessions = create<SessionsState>((set, get) => ({
  workspaces: [],
  sessions: [],
  archived: [],
  showArchived: false,
  activeSessionId: null,
  loading: false,
  search: '',

  refresh: async () => {
    set({ loading: true })
    try {
      const [wsRes, sessions] = await Promise.all([
        rest<{ items: WorkspaceItem[] }>('/api/v1/workspaces').catch(() => ({ items: [] })),
        fetchAllSessions({})
      ])
      set({ workspaces: wsRes.items ?? [], sessions, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  loadArchived: async () => {
    const archived = await fetchAllSessions({ archived_only: true })
    set({ archived })
  },

  toggleArchived: () => {
    const next = !get().showArchived
    set({ showArchived: next })
    if (next) void get().loadArchived()
  },

  setSearch: (s) => set({ search: s }),
  // 选中会话时同时切回聊天视图(否则在首页/设置视图下点会话无视觉反馈)
  setActive: (id) => {
    set({ activeSessionId: id })
    if (id) useUi.getState().closeSettings()
  },

  createSession: async (cwd) => {
    // 新会话必须显式带模型,否则 agent_config.model 为空串会报 model.not_configured
    let model: string | undefined
    try {
      const cfg = await rest<{ default_model?: string }>('/api/v1/config')
      model = cfg.default_model || undefined
    } catch {
      /* 用服务端默认 */
    }
    const session = await rest<SessionItem>('/api/v1/sessions', {
      method: 'POST',
      body: { metadata: { cwd }, ...(model ? { agent_config: { model } } : {}) }
    })
    set({ activeSessionId: session.id })
    await get().refresh()
    return session
  },

  archiveSession: async (id) => {
    await rest(`/api/v1/sessions/${id}:archive`, { method: 'POST' })
    const { activeSessionId } = get()
    if (activeSessionId === id) set({ activeSessionId: null })
    await get().refresh()
  },

  restoreSession: async (id) => {
    await rest(`/api/v1/sessions/${id}:restore`, { method: 'POST' })
    await Promise.all([get().refresh(), get().loadArchived()])
  },

  renameSession: async (id, title) => {
    await rest(`/api/v1/sessions/${id}/profile`, { method: 'POST', body: { title } })
    await get().refresh()
  },

  exportSession: async (id) => {
    // 导出返回 zip;经主进程下载由后续迭代完善,这里先调用端点
    await rest(`/api/v1/sessions/${id}/export`, { method: 'POST' })
  },

  upsertSession: (s) => {
    set((state) => {
      const idx = state.sessions.findIndex((x) => x.id === s.id)
      if (idx === -1) return { sessions: [s, ...state.sessions] }
      const sessions = [...state.sessions]
      sessions[idx] = { ...sessions[idx], ...s }
      return { sessions }
    })
  }
}))

/** 按工作区分组(用 workspace_id,回退 cwd)。
 *  workspace_id 存在但工作区已注销(移除)的会话不再显示——与官方"移除工作区"行为一致 */
export function groupSessions(
  sessions: SessionItem[],
  workspaces: WorkspaceItem[],
  search: string
): { key: string; name: string; root: string; items: SessionItem[] }[] {
  const q = search.trim().toLowerCase()
  const filtered = q
    ? sessions.filter(
        (s) =>
          (s.title ?? '').toLowerCase().includes(q) ||
          (s.last_prompt ?? '').toLowerCase().includes(q) ||
          (s.metadata?.cwd ?? '').toLowerCase().includes(q)
      )
    : sessions
  const groups = new Map<string, { key: string; name: string; root: string; items: SessionItem[] }>()
  const wsById = new Map(workspaces.map((w) => [w.id, w]))
  for (const s of filtered) {
    // 工作区已被移除:其会话在项目树中隐藏(会话文件仍保留在磁盘上)
    if (s.workspace_id && !wsById.has(s.workspace_id)) continue
    const ws = s.workspace_id ? wsById.get(s.workspace_id) : undefined
    const root = ws?.root ?? s.metadata?.cwd ?? ''
    const key = ws?.id ?? (root || '_unknown')
    const name = ws?.display_name ?? ws?.name ?? baseName(root) ?? '未分组'
    let g = groups.get(key)
    if (!g) {
      g = { key, name, root, items: [] }
      groups.set(key, g)
    }
    g.items.push(s)
  }
  const list = [...groups.values()]
  for (const g of list) g.items.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  list.sort((a, b) => {
    const ta = a.items[0]?.updated_at ?? ''
    const tb = b.items[0]?.updated_at ?? ''
    return tb.localeCompare(ta)
  })
  return list
}

function baseName(p: string): string {
  if (!p) return ''
  const norm = p.replace(/[/\\]+$/, '')
  return norm.split(/[/\\]/).pop() || norm
}
