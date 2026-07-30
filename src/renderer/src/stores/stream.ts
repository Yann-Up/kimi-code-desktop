/**
 * stream store: 把 snapshot 水合 + WS session_event 归约为统一的渲染项列表。
 * 单一归一化入口,live 与回放走同一条 reducer 路径。
 */
import { create } from 'zustand'
import { rest } from '../api'

// ---------- 渲染项模型 ----------

export type ToolStatus = 'running' | 'success' | 'error'

export interface UserImage {
  /** base64 直显 */
  dataUrl?: string
  /** 服务端文件,经 IPC 拉取 */
  fileId?: string
  name?: string
}

/** 用户消息里的文件附件(非图片):CLI 存成 "Attached file ..." 文本,桌面解析回结构化 */
export interface UserFile {
  name: string
  mime?: string
  size?: number
  /** 服务端文件 id(从附件文件名前缀 f_<uuid> 解析),用于拉字节预览 */
  fileId?: string
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; time?: string; images?: UserImage[]; files?: UserFile[] }
  | { kind: 'assistant'; id: string; text: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; text: string; streaming?: boolean }
  | {
      kind: 'tool'
      id: string // tool_call_id
      name: string
      argsSummary: string
      args: string
      status: ToolStatus
      output?: string
      description?: string
    }
  | {
      kind: 'subagent'
      id: string
      name: string
      description?: string
      status: 'running' | 'completed' | 'failed' | 'suspended'
      summary?: string
    }
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'error'; id: string; text: string }

export interface SessionStatus {
  model?: string
  contextTokens?: number
  maxContextTokens?: number
  contextUsage?: number
  permission?: string
  planMode?: boolean
  busy?: boolean
  currentPromptId?: string
  pendingInteraction?: 'none' | 'approval' | 'question'
}

export interface PendingApproval {
  id: string
  tool_name?: string
  title?: string
  description?: string
  command?: string
  options?: { id: string; label: string }[]
  raw: Record<string, unknown>
}

export interface PendingQuestion {
  id: string
  questions: {
    id: string
    question: string
    header?: string
    multi_select?: boolean
    options: { id: string; label: string; description?: string }[]
  }[]
  raw: Record<string, unknown>
}

/** 发送附件:图片走 base64,文件先上传得到 file_id。 */
export interface PromptAttachment {
  type: 'image' | 'file'
  /** image:base64 数据 */
  data?: string
  /** file:上传后的文件 id */
  fileId?: string
  name?: string
  mimeType?: string
  size?: number
}

export interface SendPromptOptions {
  text: string
  attachments?: PromptAttachment[]
  model?: string
  profile?: string
  permissionMode?: string
  /** 思考强度(模型 support_efforts 中的值),不传则不启用 */
  thinking?: string
  planMode?: boolean
  swarmMode?: boolean
  goalObjective?: string
}

interface StreamState {
  sessionId: string | null
  items: ChatItem[]
  status: SessionStatus
  approvals: PendingApproval[]
  questions: PendingQuestion[]
  loading: boolean
  error: string | null
  /** 最近一次收到会话事件的时间(ms),用于事件流失联自愈 */
  lastEventAt: number
  /** snapshot 只带最近 100 条:更早的消息是否还有/正在加载 */
  hasMore: boolean
  loadingEarlier: boolean

  load: (sessionId: string, opts?: { quiet?: boolean }) => Promise<void>
  /** 向前翻一页更早的消息(prepend),返回是否实际发起了加载 */
  loadEarlier: () => Promise<boolean>
  handleEvent: (evt: Record<string, unknown>) => void
  handleResync: () => void
  refreshPending: () => Promise<void>
  sendPrompt: (opts: SendPromptOptions) => Promise<void>
  abort: () => Promise<void>
  /** 返回是否提交成功,失败时调用方应保留卡片并提示重试 */
  answerApproval: (id: string, decision: string, scope?: string, feedback?: string) => Promise<boolean>
  answerQuestion: (id: string, answers: Record<string, unknown>) => Promise<boolean>
  dismissQuestion: (id: string) => Promise<boolean>
  reset: () => void
}

// ---------- 工具函数 ----------

let itemSeq = 0
const nid = () => `local_${++itemSeq}`

/** 当前已加载的最早消息 id(loadEarlier 的分页游标,随 load/loadEarlier 更新) */
let oldestMessageId = ''

/** CLI 把文件附件转成 "Attached file ..." 说明文本;解析回结构化附件 */
const ATTACHED_FILE_RE =
  /^Attached file "([^"]+)" \(([^,)]+), (\d+) bytes\): (.+?) — open it with the Read tool$/

function parseAttachedFile(text: string): UserFile | null {
  const m = ATTACHED_FILE_RE.exec(text.trim())
  if (!m) return null
  const base = m[4].split(/[\\/]/).pop() ?? ''
  const idm = /^(f_[0-9a-fA-F-]{36})-/.exec(base)
  return { name: m[1], mime: m[2], size: Number(m[3]), fileId: idm?.[1] }
}

/** 从消息 content 提取附件说明文本(解析失败的保留原文) */
function filesOfContent(content: unknown): UserFile[] {
  if (!Array.isArray(content)) return []
  const out: UserFile[] = []
  for (const part of content) {
    const c = part as Record<string, unknown>
    if (c?.type !== 'text' || typeof c.text !== 'string') continue
    const f = parseAttachedFile(c.text)
    if (f) out.push(f)
  }
  return out
}

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((c): c is { type: string; text?: string } => !!c && typeof c === 'object')
    .filter((c) => c.type === 'text' && typeof c.text === 'string' && !parseAttachedFile(c.text))
    .map((c) => c.text!)
    .join('')
}

/** 从消息 content 提取图片部分(base64 直显 / file_id 拉取 / url 直显) */
function imagesOfContent(content: unknown): UserImage[] {
  if (!Array.isArray(content)) return []
  const out: UserImage[] = []
  for (const part of content) {
    const c = part as Record<string, unknown>
    if (!c || c.type !== 'image' || !c.source || typeof c.source !== 'object') continue
    const s = c.source as Record<string, unknown>
    if (s.kind === 'base64' && typeof s.data === 'string') {
      out.push({ dataUrl: `data:${String(s.media_type ?? 'image/png')};base64,${s.data}` })
    } else if (s.kind === 'file' && typeof s.file_id === 'string') {
      out.push({ fileId: s.file_id })
    } else if (s.kind === 'url' && typeof s.url === 'string') {
      out.push({ dataUrl: s.url })
    }
  }
  return out
}

function summarizeArgs(name: string, input: unknown): { summary: string; args: string } {
  const args = typeof input === 'string' ? input : JSON.stringify(input ?? {}, null, 0)
  let summary = ''
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    if (name === 'Bash' || name === 'Shell') summary = String(o.command ?? '').split('\n')[0]
    else if (['Read', 'Write', 'Edit', 'ReadMediaFile'].includes(name))
      summary = String(o.path ?? '')
    else if (name === 'Grep' || name === 'Glob') summary = String(o.pattern ?? '')
    else if (name === 'Agent' || name === 'AgentSwarm') summary = String(o.description ?? '')
    else if (name === 'WebSearch') summary = String(o.query ?? '')
    else if (name === 'FetchURL') summary = String(o.url ?? '')
    else if (name === 'TodoList') summary = '更新任务清单'
    else summary = args.slice(0, 80)
  }
  if (!summary) summary = args.slice(0, 80)
  return { summary: summary.slice(0, 120), args: args.slice(0, 20000) }
}

/** snapshot.messages → ChatItem[] */
function hydrateMessages(messages: unknown[]): ChatItem[] {
  const items: ChatItem[] = []
  const toolById = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()

  const attachResult = (toolCallId: string, output: string, isError: boolean) => {
    const t = toolById.get(toolCallId)
    if (t) {
      t.output = output.slice(0, 20000)
      t.status = isError ? 'error' : 'success'
    }
  }

  for (const msg of messages) {
    const m = msg as { id?: string; role?: string; content?: unknown[]; created_at?: string }
    if (!Array.isArray(m.content)) continue
    // 用户消息:文本 + 图片 + 文件附件一起收
    if (m.role === 'user') {
      const texts: string[] = []
      const images: UserImage[] = []
      const files: UserFile[] = []
      for (const part of m.content) {
        const c = part as Record<string, unknown>
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
          const t = c.text.trim()
          const f = parseAttachedFile(t)
          if (f) files.push(f)
          else if (!t.startsWith('<system-reminder>') && !t.startsWith('<notification')) texts.push(c.text)
        } else if (c.type === 'image' && c.source && typeof c.source === 'object') {
          const s = c.source as Record<string, unknown>
          if (s.kind === 'base64' && typeof s.data === 'string') {
            images.push({ dataUrl: `data:${String(s.media_type ?? 'image/png')};base64,${s.data}` })
          } else if (s.kind === 'file' && typeof s.file_id === 'string') {
            images.push({ fileId: s.file_id })
          } else if (s.kind === 'url' && typeof s.url === 'string') {
            images.push({ dataUrl: s.url })
          }
        }
      }
      if (texts.length || images.length || files.length) {
        items.push({
          kind: 'user',
          id: m.id ?? nid(),
          text: texts.join('\n'),
          time: m.created_at,
          images: images.length ? images : undefined,
          files: files.length ? files : undefined
        })
      }
      continue
    }
    for (const part of m.content) {
      const c = part as Record<string, unknown>
      if (m.role === 'assistant') {
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
          items.push({ kind: 'assistant', id: `${m.id}_t${items.length}`, text: c.text })
        } else if (c.type === 'thinking' && typeof c.thinking === 'string' && c.thinking.trim()) {
          items.push({ kind: 'thinking', id: `${m.id}_th${items.length}`, text: c.thinking })
        } else if (c.type === 'tool_use') {
          const { summary, args } = summarizeArgs(String(c.tool_name ?? ''), c.input)
          const t: Extract<ChatItem, { kind: 'tool' }> = {
            kind: 'tool',
            id: String(c.tool_call_id ?? nid()),
            name: String(c.tool_name ?? 'tool'),
            argsSummary: summary,
            args,
            status: 'running'
          }
          toolById.set(t.id, t)
          items.push(t)
        }
      } else if (m.role === 'tool') {
        if (c.type === 'tool_result') {
          attachResult(
            String(c.tool_call_id ?? ''),
            typeof c.output === 'string' ? c.output : JSON.stringify(c.output ?? ''),
            !!c.is_error
          )
        }
      }
    }
  }
  // 没有结果的 tool 视为历史中断,标记 success 避免永远转圈
  for (const t of toolById.values()) {
    if (t.status === 'running') t.status = 'success'
  }
  return items
}

// ---------- store ----------

export const useStream = create<StreamState>((set, get) => ({
  sessionId: null,
  items: [],
  status: {},
  approvals: [],
  questions: [],
  loading: false,
  error: null,
  lastEventAt: 0,
  hasMore: false,
  loadingEarlier: false,

  loadEarlier: async () => {
    const { sessionId, hasMore, loadingEarlier } = get()
    if (!sessionId || !hasMore || loadingEarlier) return false
    const targetId = sessionId
    set({ loadingEarlier: true })
    try {
      // 游标 = 当前最早一条渲染项对应的消息 id(load 时记录)
      const before = oldestMessageId
      const page = await rest<{ items: { id: string }[]; has_more: boolean }>(
        `/api/v1/sessions/${sessionId}/messages`,
        { query: { before_id: before, page_size: 100 } }
      )
      if (get().sessionId !== targetId) return false
      const raw = Array.isArray(page.items) ? page.items : []
      // 列表接口按时间倒序返回,翻转为正序后 prepend
      const older = hydrateMessages([...raw].reverse())
      if (raw.length) oldestMessageId = String(raw[raw.length - 1].id ?? before)
      set((s) => ({ items: [...older, ...s.items], hasMore: !!page.has_more }))
      return true
    } catch {
      return false
    } finally {
      if (get().sessionId === targetId) set({ loadingEarlier: false })
    }
  },

  load: async (sessionId, opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true
    // 记录目标会话:快速切换时旧会话的异步结果不得落地(await 后落地前校验)
    const targetId = sessionId
    const stale = () => get().sessionId !== targetId
    set((s) => ({
      sessionId,
      items: quiet ? s.items : [],
      status: quiet ? s.status : {},
      approvals: [],
      questions: [],
      loading: quiet ? s.loading : true,
      hasMore: false,
      loadingEarlier: false,
      error: null
    }))
    try {
      const snap = await rest<{
        as_of_seq: number
        epoch: string
        session: {
          busy?: boolean
          current_prompt_id?: string
          pending_interaction?: 'none' | 'approval' | 'question'
          agent_config?: { model?: string }
        }
        messages?: { items: unknown[] }
        subagents?: unknown[]
        pending_approvals?: unknown[]
        pending_questions?: unknown[]
      }>(`/api/v1/sessions/${sessionId}/snapshot`)
      if (stale()) return

      const items = hydrateMessages(snap.messages?.items ?? [])
      // snapshot 仅含最近 100 条:记录分页游标(正序首条)与 has_more,供 loadEarlier 翻页
      const snapFirst = snap.messages?.items?.[0] as { id?: unknown } | undefined
      oldestMessageId = typeof snapFirst?.id === 'string' ? snapFirst.id : ''
      // 进行中的轮次(静默重载时把 in_flight 内容也渲染出来,WS 断流也能看到过程)
      const flight = (snap as { in_flight_turn?: Record<string, unknown> | null }).in_flight_turn
      if (flight) {
        const th = typeof flight.thinking_text === 'string' ? flight.thinking_text : ''
        if (th) items.push({ kind: 'thinking', id: 'flight_th', text: th, streaming: true })
        const at = typeof flight.assistant_text === 'string' ? flight.assistant_text : ''
        if (at) items.push({ kind: 'assistant', id: 'flight_at', text: at, streaming: true })
        if (Array.isArray(flight.running_tools)) {
          for (const rt of flight.running_tools) {
            const r = rt as Record<string, unknown>
            const { summary, args } = summarizeArgs(String(r.name ?? ''), r.args)
            items.push({
              kind: 'tool',
              id: String(r.tool_call_id ?? nid()),
              name: String(r.name ?? 'tool'),
              argsSummary: summary,
              args,
              status: 'running'
            })
          }
        }
      }
      // 子代理状态
      for (const sa of snap.subagents ?? []) {
        const a = sa as Record<string, unknown>
        items.push({
          kind: 'subagent',
          id: String(a.id ?? nid()),
          name: String(a.subagent_type ?? a.kind ?? 'subagent'),
          description: String(a.description ?? ''),
          status:
            a.status === 'completed'
              ? 'completed'
              : a.status === 'failed'
                ? 'failed'
                : a.status === 'suspended'
                  ? 'suspended'
                  : 'running',
          summary: typeof a.result_summary === 'string' ? a.result_summary.slice(0, 500) : undefined
        })
      }

      set({
        items,
        loading: false,
        hasMore: !!(snap.messages as { has_more?: boolean } | undefined)?.has_more,
        status: {
          busy: snap.session.busy,
          currentPromptId: snap.session.current_prompt_id,
          pendingInteraction: snap.session.pending_interaction ?? 'none',
          model: snap.session.agent_config?.model
        }
      })
      await get().refreshPending()
      if (stale()) return
      // 补充实时状态(上下文用量/模型/思考档位),供用量环与回显
      try {
        const st = await rest<{
          model?: string
          thinking_level?: string
          permission?: string
          context_tokens?: number
          max_context_tokens?: number
          context_usage?: number
        }>(`/api/v1/sessions/${sessionId}/status`)
        if (stale()) return
        set((s) => ({
          status: {
            ...s.status,
            model: st.model || s.status.model,
            permission: st.permission ?? s.status.permission,
            contextTokens: st.context_tokens ?? s.status.contextTokens,
            maxContextTokens: st.max_context_tokens ?? s.status.maxContextTokens,
            contextUsage: st.context_usage ?? s.status.contextUsage
          }
        }))
      } catch {
        /* 状态接口非关键 */
      }
    } catch (e) {
      if (stale()) return
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  handleEvent: (evt) => {
    const { sessionId } = get()
    if (!sessionId || evt.session_id !== sessionId) return
    const type = String(evt.type ?? '')
    set({ lastEventAt: Date.now() })

    set((state) => {
      const items = [...state.items]
      const status = { ...state.status }
      const last = () => items[items.length - 1]

      switch (type) {
        case 'prompt.submitted': {
          const content = (evt as { content?: unknown }).content
          const text = textOfContent(content)
          const images = imagesOfContent(content)
          const files = filesOfContent(content)
          if (text || images.length || files.length) {
            const promptId = String(evt.promptId ?? '')
            // 去重:sendPrompt 乐观渲染的本地消息(local_ 前缀 id)与服务端回显是同一条,
            // 命中则只把 id 换成 promptId,避免双条用户消息
            let dupIdx = -1
            if (promptId) {
              for (let i = items.length - 1; i >= 0; i--) {
                const it = items[i]
                if (it.kind === 'user' && it.id.startsWith('local_') && it.text === text) {
                  dupIdx = i
                  break
                }
              }
            }
            if (dupIdx >= 0) {
              items[dupIdx] = {
                ...(items[dupIdx] as Extract<ChatItem, { kind: 'user' }>),
                id: promptId
              }
            } else {
              items.push({
                kind: 'user',
                id: promptId || nid(),
                text,
                images: images.length ? images : undefined,
                files: files.length ? files : undefined
              })
            }
          }
          status.busy = true
          break
        }
        case 'turn.started':
          status.busy = true
          break
        case 'assistant.delta': {
          const delta = String(evt.delta ?? '')
          const l = last()
          if (l?.kind === 'assistant' && l.streaming) l.text += delta
          else items.push({ kind: 'assistant', id: String(evt.turnId ?? nid()), text: delta, streaming: true })
          break
        }
        case 'thinking.delta': {
          const delta = String(evt.delta ?? '')
          const l = last()
          if (l?.kind === 'thinking' && l.streaming) l.text += delta
          else items.push({ kind: 'thinking', id: `th_${evt.turnId ?? nid()}`, text: delta, streaming: true })
          break
        }
        case 'tool.call.started': {
          const input = evt.args
          const { summary, args } = summarizeArgs(String(evt.name ?? ''), input)
          items.push({
            kind: 'tool',
            id: String(evt.toolCallId ?? nid()),
            name: String(evt.name ?? 'tool'),
            argsSummary: summary,
            args,
            status: 'running',
            description: typeof evt.description === 'string' ? evt.description : undefined
          })
          break
        }
        case 'tool.result': {
          const id = String(evt.toolCallId ?? '')
          const t = items.find((x): x is Extract<ChatItem, { kind: 'tool' }> => x.kind === 'tool' && x.id === id)
          if (t) {
            t.output = String(evt.output ?? '').slice(0, 20000)
            t.status = evt.isError ? 'error' : 'success'
          }
          break
        }
        case 'turn.ended': {
          status.busy = false
          for (const it of items) {
            if (it.kind === 'assistant' || it.kind === 'thinking') it.streaming = false
          }
          break
        }
        case 'prompt.completed':
        case 'prompt.aborted':
          status.busy = false
          for (const it of items) {
            if (it.kind === 'assistant' || it.kind === 'thinking') it.streaming = false
          }
          break
        case 'subagent.spawned':
        case 'subagent.started': {
          items.push({
            kind: 'subagent',
            id: String(evt.subagentId ?? nid()),
            name: String(evt.subagentName ?? 'subagent'),
            description: typeof evt.description === 'string' ? evt.description : undefined,
            status: 'running'
          })
          break
        }
        case 'subagent.completed':
        case 'subagent.failed':
        case 'subagent.suspended': {
          const id = String(evt.subagentId ?? '')
          const sa = items.find(
            (x): x is Extract<ChatItem, { kind: 'subagent' }> => x.kind === 'subagent' && x.id === id
          )
          if (sa) {
            sa.status = type === 'subagent.completed' ? 'completed' : type === 'subagent.failed' ? 'failed' : 'suspended'
            if (typeof evt.resultSummary === 'string') sa.summary = evt.resultSummary.slice(0, 500)
          }
          break
        }
        case 'agent.status.updated': {
          const m = evt.model as string
          if (m) status.model = m
          const ct = evt.contextTokens as number
          if (typeof ct === 'number') status.contextTokens = ct
          const mct = evt.maxContextTokens as number
          if (typeof mct === 'number' && mct > 0) status.maxContextTokens = mct
          const cu = evt.contextUsage as number
          if (typeof cu === 'number') status.contextUsage = cu
          status.permission = (evt.permission as string) ?? status.permission
          status.planMode = (evt.planMode as boolean) ?? status.planMode
          break
        }
        case 'event.session.work_changed': {
          status.busy = evt.busy as boolean
          status.pendingInteraction = evt.pending_interaction as SessionStatus['pendingInteraction']
          break
        }
        case 'compaction.started':
          items.push({ kind: 'notice', id: nid(), text: '正在压缩上下文…' })
          break
        case 'compaction.completed':
          items.push({ kind: 'notice', id: nid(), text: '上下文压缩完成' })
          break
        case 'error': {
          items.push({
            kind: 'error',
            id: nid(),
            text: String(evt.message ?? evt.code ?? '未知错误')
          })
          status.busy = false
          break
        }
        default:
          return state
      }
      return { items, status }
    })

    // 待交互状态变化时刷新审批/问答
    if (
      type === 'event.session.work_changed' ||
      type === 'turn.ended' ||
      type === 'tool.call.started'
    ) {
      void get().refreshPending()
    }

    // 事件流自愈:轮次结束但本轮没有任何助手输出(疑似 delta 丢失),重载快照兜底
    if (type === 'turn.ended' || type === 'prompt.completed' || type === 'prompt.aborted') {
      const cur = get().items
      const lastItem = cur[cur.length - 1]
      if (lastItem?.kind === 'user') {
        void get().load(sessionId)
      }
    }

    // 窗口失焦时的桌面通知:任务完成 / 等待审批 / 等待回答
    if (type === 'turn.ended') {
      void window.kimiApi.isFocused().then((focused: boolean) => {
        if (!focused) void window.kimiApi.notify('Kimi Code Desktop', '任务已完成')
      })
    }
    if (type === 'event.session.work_changed') {
      const pi = (evt as { pending_interaction?: string }).pending_interaction
      if (pi === 'approval' || pi === 'question') {
        void window.kimiApi.isFocused().then((focused: boolean) => {
          if (!focused) {
            void window.kimiApi.notify(
              'Kimi Code Desktop',
              pi === 'approval' ? '有一个工具调用等待你的审批' : 'Kimi 想问你几个问题'
            )
          }
        })
      }
    }
  },

  handleResync: () => {
    const { sessionId } = get()
    if (sessionId) void get().load(sessionId)
  },

  refreshPending: async () => {
    const { sessionId } = get()
    if (!sessionId) return
    try {
      const [approvalsRes, questionsRes] = await Promise.all([
        rest<unknown>(`/api/v1/sessions/${sessionId}/approvals`, {
          query: { status: 'pending' }
        }).catch(() => null),
        rest<unknown>(`/api/v1/sessions/${sessionId}/questions`, {
          query: { status: 'pending' }
        }).catch(() => null)
      ])
      const unwrap = (v: unknown): unknown[] => {
        if (Array.isArray(v)) return v
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>
          if (Array.isArray(o.items)) return o.items
        }
        return []
      }
      const normApprovals: PendingApproval[] = unwrap(approvalsRes).map((a) => {
        const o = a as Record<string, unknown>
        const display = (o.tool_input_display ?? {}) as Record<string, unknown>
        return {
          id: String(o.approval_id ?? o.id ?? ''),
          tool_name: String(o.tool_name ?? ''),
          title: String(o.action ?? o.tool_name ?? '工具审批'),
          description: typeof o.description === 'string' ? o.description : undefined,
          command:
            typeof display.command === 'string'
              ? display.command
              : o.tool_input
                ? JSON.stringify(o.tool_input).slice(0, 500)
                : undefined,
          options: Array.isArray(o.options)
            ? (o.options as { id?: string; label?: string }[]).map((x) => ({
                id: String(x.id ?? ''),
                label: String(x.label ?? x.id ?? '')
              }))
            : undefined,
          raw: o
        }
      })
      const normQuestions: PendingQuestion[] = unwrap(questionsRes).map((q) => {
        const o = q as Record<string, unknown>
        const qs = Array.isArray(o.questions) ? o.questions : [o]
        return {
          id: String(o.question_id ?? o.id ?? ''),
          questions: (qs as Record<string, unknown>[]).map((x, i) => ({
            id: String(x.id ?? `q${i}`),
            question: String(x.question ?? ''),
            header: typeof x.header === 'string' ? x.header : undefined,
            multi_select: !!x.multi_select,
            options: Array.isArray(x.options)
              ? (x.options as Record<string, unknown>[]).map((op) => ({
                  id: String(op.id ?? op.option_id ?? op.label ?? ''),
                  label: String(op.label ?? op.id ?? ''),
                  description: typeof op.description === 'string' ? op.description : undefined
                }))
              : []
          })),
          raw: o
        }
      })
      set({ approvals: normApprovals, questions: normQuestions })
    } catch {
      /* 忽略 */
    }
  },

  sendPrompt: async (opts) => {
    const { sessionId } = get()
    const { text, attachments } = opts
    if (!sessionId || (!text.trim() && !attachments?.length)) return
    const content: Record<string, unknown>[] = []
    for (const att of attachments ?? []) {
      if (att.type === 'image') {
        content.push({
          type: 'image',
          source: { kind: 'base64', media_type: att.mimeType, data: att.data }
        })
      } else {
        content.push({
          type: 'file',
          file_id: att.fileId,
          name: att.name,
          media_type: att.mimeType,
          size: att.size
        })
      }
    }
    if (text.trim()) content.push({ type: 'text', text })
    // 乐观渲染用户消息(带图片缩略图与文件附件卡片)
    const optImages: UserImage[] = (attachments ?? [])
      .filter((a) => a.type === 'image' && a.data)
      .map((a) => ({ dataUrl: `data:${a.mimeType ?? 'image/png'};base64,${a.data}` }))
    const optFiles: UserFile[] = (attachments ?? [])
      .filter((a) => a.type === 'file')
      .map((a) => ({ name: a.name ?? '附件', mime: a.mimeType, size: a.size, fileId: a.fileId }))
    set((s) => ({
      items: [
        ...s.items,
        {
          kind: 'user',
          id: nid(),
          text,
          images: optImages.length ? optImages : undefined,
          files: optFiles.length ? optFiles : undefined
        }
      ],
      status: { ...s.status, busy: true }
    }))
    try {
      await rest(`/api/v1/sessions/${sessionId}/prompts`, {
        method: 'POST',
        body: {
          content,
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.profile ? { profile: opts.profile } : {}),
          ...(opts.permissionMode ? { permission_mode: opts.permissionMode } : {}),
          ...(opts.thinking ? { thinking: opts.thinking } : {}),
          ...(opts.planMode ? { plan_mode: true } : {}),
          ...(opts.swarmMode ? { swarm_mode: true } : {}),
          ...(opts.goalObjective ? { goal_objective: opts.goalObjective } : {})
        }
      })
    } catch (e) {
      set((s) => ({
        items: [
          ...s.items,
          { kind: 'error', id: nid(), text: `发送失败:${e instanceof Error ? e.message : e}` }
        ],
        status: { ...s.status, busy: false }
      }))
    }
  },

  abort: async () => {
    const { sessionId, status } = get()
    if (!sessionId) return
    try {
      if (status.currentPromptId) {
        await rest(`/api/v1/sessions/${sessionId}/prompts/${status.currentPromptId}:abort`, {
          method: 'POST'
        })
      } else {
        await rest(`/api/v1/sessions/${sessionId}:abort`, { method: 'POST' })
      }
    } catch (e) {
      // 冲突类错误(409/40903:任务已结束或无进行中任务)视为已停止,其它错误保留 busy
      const msg = e instanceof Error ? e.message : String(e)
      if (!/409|40903/.test(msg)) {
        console.error('abort 失败,服务端任务可能仍在运行:', e)
        return
      }
    }
    set((s) => ({ status: { ...s.status, busy: false } }))
  },

  answerApproval: async (id, decision, scope, feedback) => {
    const { sessionId } = get()
    if (!sessionId) return false
    try {
      await rest(`/api/v1/sessions/${sessionId}/approvals/${id}`, {
        method: 'POST',
        body: { decision, ...(scope ? { scope } : {}), ...(feedback ? { feedback } : {}) }
      })
    } catch (e) {
      console.error('提交审批失败:', e)
      return false
    }
    await get().refreshPending()
    return true
  },

  answerQuestion: async (id, answers) => {
    const { sessionId } = get()
    if (!sessionId) return false
    try {
      await rest(`/api/v1/sessions/${sessionId}/questions/${id}`, {
        method: 'POST',
        body: { answers }
      })
    } catch (e) {
      console.error('提交回答失败:', e)
      return false
    }
    await get().refreshPending()
    return true
  },

  dismissQuestion: async (id) => {
    const { sessionId } = get()
    if (!sessionId) return false
    try {
      await rest(`/api/v1/sessions/${sessionId}/questions/${id}:dismiss`, {
        method: 'POST',
        body: {}
      })
    } catch (e) {
      console.error('忽略问题失败:', e)
      return false
    }
    await get().refreshPending()
    return true
  },

  reset: () =>
    set({
      sessionId: null,
      items: [],
      status: {},
      approvals: [],
      questions: [],
      error: null,
      hasMore: false,
      loadingEarlier: false
    })
}))
