/**
 * Composer:聊天输入区,对齐 Kimi Web 体验。
 * 结构:StatusBar(状态条)→ 附件预览 → 输入行(附件按钮/textarea)→ 工具行(权限/模式/模型/思考强度 + 上下文环/发送)→ 目标输入。
 * 附件支持任意文件:图片走 base64,其它文件先上传再附 file_id;支持粘贴图片与拖拽文件。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Cpu,
  File as FileIcon,
  ListChecks,
  Loader2,
  MessageSquare,
  Network,
  Paperclip,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Target,
  X
} from 'lucide-react'
import { useStream } from '@/stores/stream'
import { useUi } from '@/stores/ui'
import { useSessions } from '@/stores/sessions'
import { rest, type ModelItem } from '@/api'
import { useDelegate } from '@/pages/settings/SubagentsSettings'
import { StatusBar } from './StatusBar'

// ---------- 类型与常量 ----------

interface AttachmentBase {
  id: string
  name: string
  mimeType: string
  size: number
}

type Attachment =
  | (AttachmentBase & { kind: 'image'; data: string })
  | (AttachmentBase & { kind: 'file'; fileId?: string; uploading?: boolean; error?: boolean })

interface ComposerModel extends ModelItem {
  support_efforts?: string[]
  default_effort?: string
}

/** GET /sessions/{id}/skills 返回的技能项 */
interface SkillInfo {
  name: string
  description?: string
  source?: string
  type?: string
}

/** / 面板条目:内置指令(前端执行)或技能(填入 /name 交由后端解析) */
interface SlashItem {
  name: string
  desc: string
  kind: 'builtin' | 'skill'
  run?: () => void
}

interface ThinkingConfig {
  enabled?: boolean
  effort?: string
}

/**
 * 计算思考强度回显,优先级:
 * 1. 会话当前值(agent_config.thinking 或 status.thinking_level,非空时)
 * 2. 全局 config.thinking.effort(仅当在模型 support_efforts 列表中)
 * 3. 模型 default_effort
 * 4. support_efforts 第一项
 * always_thinking 模型关不掉思考:会话值为 off 时回退到默认档位。
 */
function resolveEcho(
  model: ComposerModel | undefined,
  sessionVal: string | null,
  cfg: ThinkingConfig | null
): string {
  const caps = model?.capabilities ?? []
  const always = caps.includes('always_thinking')
  if (!always && !caps.includes('thinking')) return ''
  const efforts = (model?.support_efforts ?? []).filter((s): s is string => typeof s === 'string')
  const fallback = (): string => {
    if (efforts.length === 0) return 'on'
    // 模型自己的默认档位优先,没有才回退全局配置
    const de = typeof model?.default_effort === 'string' ? model.default_effort : ''
    if (de && efforts.includes(de)) return de
    if (cfg?.effort && efforts.includes(cfg.effort)) return cfg.effort
    return efforts[0]
  }
  if (sessionVal) {
    if (sessionVal === 'off') return always ? fallback() : 'off'
    if (efforts.includes(sessionVal)) return sessionVal
    if (sessionVal === 'on') return fallback()
    // 未知值落到默认推导
  }
  if (cfg?.enabled === false && !always) return 'off'
  return fallback()
}

type Mode = 'default' | 'plan' | 'swarm' | 'goal'
type PopName = 'permission' | 'mode' | 'model'

const MAX_FILES = 4
const MAX_SIZE = 10 * 1024 * 1024

/** 上下文用量环:kimi web 同款,弧线表示占比,hover 显示明细 */
function ContextRing(props: { used: number; max: number; pct: number }) {
  const { used, max, pct } = props
  const r = 8
  const c = 2 * Math.PI * r
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      : n >= 1000
        ? `${Math.round(n / 1000)}k`
        : String(Math.round(n))
  return (
    <div className="group relative shrink-0">
      <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90">
        <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2.5" className="stroke-surface-tertiary" />
        <circle
          cx="11"
          cy="11"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          className={pct > 0.85 ? 'stroke-danger' : 'stroke-primary'}
        />
      </svg>
      <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden whitespace-nowrap rounded-lg bg-text px-2.5 py-1.5 text-[11.5px] text-white shadow-lg group-hover:block">
        使用 {fmt(used)} / {fmt(max)} tokens({Math.round(pct * 100)}%)
      </div>
    </div>
  )
}

const PERMISSIONS: { value: string; label: string; desc: string }[] = [
  { value: 'manual', label: '逐条确认', desc: '每个工具操作都需要你手动确认' },
  { value: 'yolo', label: '自动通过', desc: '自动批准工具操作,但遇到关键问题仍会询问' },
  { value: 'auto', label: '完全自主', desc: '完全自主运行,智能体自己做决定,不再询问' }
]

const MODES: { value: Mode; label: string; desc: string; icon: typeof MessageSquare }[] = [
  { value: 'default', label: '默认', desc: '常规对话执行', icon: MessageSquare },
  { value: 'plan', label: '计划', desc: '先出计划再执行', icon: ListChecks },
  { value: 'swarm', label: 'Swarm', desc: '多代理并行', icon: Network },
  { value: 'goal', label: '目标', desc: '设定目标持续推进', icon: Target }
]

// ---------- 工具函数 ----------

let attSeq = 0
const uid = () => `att_${++attSeq}_${Date.now().toString(36)}`

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function fmtContext(n?: number): string {
  if (!n) return ''
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

// ---------- 组件 ----------

export function Composer({ sessionId }: { sessionId: string }) {
  const { sendPrompt, abort, status } = useStream()
  const { profile: delegateProfile, setProfile: setDelegateProfile } = useDelegate()

  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachNote, setAttachNote] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const [models, setModels] = useState<ComposerModel[]>([])
  const [model, setModel] = useState('')
  const [userPicked, setUserPicked] = useState(false)
  const [globalDefault, setGlobalDefault] = useState('')
  const [permission, setPermission] = useState('yolo')
  const [mode, setMode] = useState<Mode>('default')
  const [goal, setGoal] = useState('')
  const [openPop, setOpenPop] = useState<PopName | null>(null)

  // 思考强度:用户手动选择(null=未选择,跟随回显) + 回显数据源(全局 config / 会话当前值)
  const [userThinking, setUserThinking] = useState<string | null>(null)
  const [thinkCfg, setThinkCfg] = useState<ThinkingConfig | null>(null)
  const [sessionThinking, setSessionThinking] = useState<string | null>(null)

  // / 指令面板:技能列表 + 键盘导航 + Esc 消隐
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const slashListRef = useRef<HTMLDivElement>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const noteTimer = useRef<number | null>(null)

  const busy = !!status.busy

  useEffect(() => {
    rest<{ default_model?: string }>('/api/v1/config')
      .then((c) => setGlobalDefault(c.default_model ?? ''))
      .catch(() => {})
    // 空屏发射台带过来的草稿:消费一次并聚焦
    const draft = useUi.getState().draftPrompt
    if (draft) {
      setText(draft)
      useUi.getState().setDraftPrompt(null)
      taRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    rest<{ items: ComposerModel[] }>('/api/v1/models')
      .then((r) => setModels(r.items ?? []))
      .catch(() => {})
  }, [])

  // 会话可用技能(/ 面板的技能段);会话未激活等失败场景静默降级为空
  useEffect(() => {
    setSkills([])
    rest<{ skills?: SkillInfo[] }>(`/api/v1/sessions/${sessionId}/skills`)
      .then((r) => setSkills(Array.isArray(r.skills) ? r.skills : []))
      .catch(() => {})
  }, [sessionId])

  // 模型回显(用户未手动选择时):会话当前模型 → 全局默认模型 → 列表第一项
  useEffect(() => {
    if (userPicked) return
    setModel(status.model || globalDefault || (models[0]?.model ?? ''))
  }, [sessionId, status.model, globalDefault, models, userPicked])

  // 切换会话:重置为"跟随会话"状态,思考回显自动重算
  useEffect(() => {
    setUserPicked(false)
  }, [sessionId])

  // 全局思考配置(回显优先级 2)
  useEffect(() => {
    rest<{ thinking?: ThinkingConfig }>('/api/v1/config')
      .then((c) => setThinkCfg(c.thinking ?? {}))
      .catch(() => {})
  }, [])

  // 会话当前思考值(回显优先级 1):agent_config.thinking 非空优先,否则 status.thinking_level
  useEffect(() => {
    let cancelled = false
    setSessionThinking(null)
    const load = async () => {
      let val = ''
      try {
        const s = await rest<{ agent_config?: { thinking?: unknown } }>(
          `/api/v1/sessions/${sessionId}`
        )
        if (typeof s.agent_config?.thinking === 'string') val = s.agent_config.thinking
      } catch {
        /* 忽略,继续尝试 status */
      }
      if (!val) {
        try {
          const st = await rest<{ thinking_level?: unknown }>(
            `/api/v1/sessions/${sessionId}/status`
          )
          if (typeof st.thinking_level === 'string') val = st.thinking_level
        } catch {
          /* 忽略 */
        }
      }
      if (!cancelled) setSessionThinking(val)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // WS 实时同步思考档位(仅在用户未手动选择时影响回显)
  useEffect(() => {
    const off = window.kimiApi.onSessionEvent((evt) => {
      const e = evt as Record<string, unknown>
      if (e.type !== 'agent.status.updated' || e.session_id !== sessionId) return
      if (typeof e.thinkingEffort === 'string' && e.thinkingEffort) setSessionThinking(e.thinkingEffort)
    })
    return off
  }, [sessionId])

  // 切换会话 / 切换模型:清除用户手动选择,回显自动重算
  useEffect(() => {
    setUserThinking(null)
  }, [sessionId, model])

  // textarea 自动增高
  useEffect(() => {
    const ta = taRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
    }
  }, [text])

  // 点击外部关闭 popover
  useEffect(() => {
    if (!openPop) return
    const close = () => setOpenPop(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [openPop])

  useEffect(() => {
    return () => {
      if (noteTimer.current) window.clearTimeout(noteTimer.current)
    }
  }, [])

  const selectedModel = models.find((m) => m.model === model)
  const efforts = useMemo(
    () =>
      (Array.isArray(selectedModel?.support_efforts) ? selectedModel!.support_efforts! : []).filter(
        (s): s is string => typeof s === 'string'
      ),
    [selectedModel]
  )

  // 思考强度展示:always_thinking 无"关";有 thinking 无档位时仅 开/关;无能力则隐藏
  const caps = selectedModel?.capabilities ?? []
  const alwaysThinking = caps.includes('always_thinking')
  const canThink = alwaysThinking || caps.includes('thinking')
  const pills = useMemo(() => {
    if (!canThink) return []
    if (efforts.length > 0) return alwaysThinking ? efforts : ['off', ...efforts]
    return alwaysThinking ? [] : ['off', 'on']
  }, [canThink, alwaysThinking, efforts])

  const echo = useMemo(
    () => resolveEcho(selectedModel, sessionThinking, thinkCfg),
    [selectedModel, sessionThinking, thinkCfg]
  )
  // 当前生效档位:用户手动选择优先,否则回显
  const thinking = userThinking ?? echo

  const flash = (msg: string) => {
    setAttachNote(msg)
    if (noteTimer.current) window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setAttachNote(''), 2500)
  }

  // ---------- / 指令面板 ----------

  const BUILTINS: SlashItem[] = [
    {
      name: 'new',
      desc: '创建新会话',
      kind: 'builtin',
      run: () => {
        const st = useSessions.getState()
        const cwd = st.sessions.find((s) => s.id === sessionId)?.metadata?.cwd
        if (cwd) void st.createSession(cwd)
        else flash('未找到当前工作区')
      }
    },
    {
      name: 'plan',
      desc: '切换计划模式 开/关',
      kind: 'builtin',
      run: () => setMode((m) => (m === 'plan' ? 'default' : 'plan'))
    },
    {
      name: 'swarm',
      desc: '切换 swarm 模式 开/关',
      kind: 'builtin',
      run: () => setMode((m) => (m === 'swarm' ? 'default' : 'swarm'))
    },
    {
      name: 'goal',
      desc: '切换到目标模式',
      kind: 'builtin',
      run: () => setMode('goal')
    },
    {
      name: 'yolo',
      desc: '自动批准工具操作,Agent 仍可能提问',
      kind: 'builtin',
      run: () => setPermission('yolo')
    },
    {
      name: 'auto',
      desc: '完全自主,Agent 不再提问',
      kind: 'builtin',
      run: () => setPermission('auto')
    },
    {
      name: 'manual',
      desc: '逐条确认工具操作',
      kind: 'builtin',
      run: () => setPermission('manual')
    }
  ]

  // 仅在输入以 / 开头且还在输指令名(无空格/换行)时弹出
  const slashQuery = /^\/([^\s/]*)$/.exec(text)?.[1]?.toLowerCase() ?? null
  const slashItems = useMemo<SlashItem[]>(() => {
    if (slashQuery === null) return []
    const hit = (name: string, desc: string) =>
      !slashQuery ||
      name.toLowerCase().startsWith(slashQuery) ||
      desc.toLowerCase().includes(slashQuery)
    return [
      ...BUILTINS.filter((b) => hit(b.name, b.desc)),
      ...skills
        .filter((s) => hit(s.name, s.description ?? ''))
        .map((s): SlashItem => ({ name: s.name, desc: s.description ?? '', kind: 'skill' }))
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery, skills, mode])
  const slashOpen = slashQuery !== null && !slashDismissed && slashItems.length > 0

  // 查询词变化时重置高亮;高亮项保持可见
  useEffect(() => setSlashIdx(0), [slashQuery])
  useEffect(() => {
    slashListRef.current
      ?.querySelector(`[data-idx="${slashIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [slashIdx])

  const pickSlash = (item: SlashItem) => {
    if (item.kind === 'skill') {
      // 技能:/name 交由后端解析执行,填入并留空格方便继续输参数
      setText(`/${item.name} `)
      taRef.current?.focus()
      return
    }
    setText('')
    item.run?.()
  }

  // ---------- 附件:选择 / 粘贴 / 拖拽 ----------

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    let budget = MAX_FILES - attachments.length
    if (budget <= 0) {
      flash(`最多添加 ${MAX_FILES} 个附件`)
      return
    }
    for (const f of files) {
      if (budget <= 0) {
        flash(`最多添加 ${MAX_FILES} 个附件`)
        break
      }
      if (f.size > MAX_SIZE) {
        flash(`「${f.name}」超过 10MB,已跳过`)
        continue
      }
      budget--
      if (/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
        // 图片 → base64 内联
        try {
          const data = bufToB64(await f.arrayBuffer())
          setAttachments((cur) => [
            ...cur,
            { kind: 'image', id: uid(), name: f.name, mimeType: f.type, size: f.size, data }
          ])
        } catch {
          flash(`「${f.name}」读取失败`)
        }
      } else {
        // 其它文件 → 先上传,再附 file_id
        const id = uid()
        const mediaType = f.type || 'application/octet-stream'
        setAttachments((cur) => [
          ...cur,
          { kind: 'file', id, name: f.name, mimeType: mediaType, size: f.size, uploading: true }
        ])
        void (async () => {
          try {
            const buf = await f.arrayBuffer()
            const res = (await window.kimiApi.upload({
              bytes: buf,
              name: f.name,
              mediaType
            })) as { id?: string }
            const fid = res?.id
            if (!fid) throw new Error('upload: no id')
            setAttachments((cur) =>
              cur.map((a): Attachment =>
                a.id === id && a.kind === 'file' ? { ...a, uploading: false, fileId: fid } : a
              )
            )
          } catch {
            setAttachments((cur) =>
              cur.map((a): Attachment =>
                a.id === id && a.kind === 'file' ? { ...a, uploading: false, error: true } : a
              )
            )
          }
        })()
      }
    }
  }

  // 全窗口拖拽交接:App 层 drop 后通过 store 传入,走同一 addFiles 流程
  const droppedFiles = useUi((s) => s.droppedFiles)
  useEffect(() => {
    if (droppedFiles.length) {
      void addFiles(droppedFiles)
      useUi.getState().setDroppedFiles([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles])

  // ---------- 发送 ----------

  const uploading = attachments.some((a) => a.kind === 'file' && a.uploading)
  const canSend = !busy && !uploading && (!!text.trim() || attachments.length > 0)

  const doSend = () => {
    if (!canSend) return
    const ready = attachments.filter((a) => a.kind === 'image' || a.fileId)
    void sendPrompt({
      text,
      attachments: ready.map((a) =>
        a.kind === 'image'
          ? { type: 'image' as const, data: a.data, mimeType: a.mimeType }
          : { type: 'file' as const, fileId: a.fileId, name: a.name, mimeType: a.mimeType, size: a.size }
      ),
      model: model || undefined,
      profile: delegateProfile || undefined,
      permissionMode: permission,
      // 仅用户手动选择后传(关 = "off");未选择时不传,由服务端沿用会话/全局配置
      thinking: userThinking ?? undefined,
      planMode: mode === 'plan',
      swarmMode: mode === 'swarm',
      goalObjective: mode === 'goal' && goal.trim() ? goal.trim() : undefined
    })
    setText('')
    setAttachments([])
    setDelegateProfile(null)
  }

  // ---------- 渲染辅助 ----------

  const permLabel = PERMISSIONS.find((p) => p.value === permission)?.label ?? permission
  const activeMode = MODES.find((m) => m.value === mode) ?? MODES[0]

  const groupedModels = useMemo(() => {
    const map = new Map<string, ComposerModel[]>()
    for (const m of models) {
      const key = m.provider || '其它'
      const arr = map.get(key)
      if (arr) arr.push(m)
      else map.set(key, [m])
    }
    return Array.from(map.entries())
  }, [models])

  const togglePop = (name: PopName) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenPop((cur) => (cur === name ? null : name))
  }

  const toolBtn = (active: boolean) =>
    `flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] transition-colors ${
      active
        ? 'bg-primary-soft text-primary'
        : 'text-text-secondary hover:bg-surface-tertiary hover:text-text'
    }`

  const popOption = (selected: boolean) =>
    `flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-surface-secondary ${
      selected ? 'bg-primary-soft/60' : ''
    }`

  return (
    <div className="shrink-0 border-t border-border-light bg-surface px-6 py-3">
      <div className="mx-auto max-w-3xl">
        <StatusBar sessionId={sessionId} />

        {delegateProfile && (
          <div className="mb-2 flex">
            <span className="flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-[12px] text-primary">
              <Bot size={13} /> 委派:{delegateProfile}
              <button
                className="ml-0.5 rounded-full hover:bg-primary/10"
                onClick={() => setDelegateProfile(null)}
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}

        <div
          className={`rounded-2xl border bg-surface shadow-sm transition-colors focus-within:border-primary-border ${
            dragOver ? 'border-primary bg-primary-soft/40' : 'border-border'
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation() // 避免与 App 级全窗口拖拽重复处理
            setDragOver(false)
            void addFiles(Array.from(e.dataTransfer.files))
          }}
        >
          {/* 附件预览 */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((att) =>
                att.kind === 'image' ? (
                  <div key={att.id} className="relative">
                    <img
                      src={`data:${att.mimeType};base64,${att.data}`}
                      className="h-14 w-14 rounded-lg border border-border object-cover"
                      alt={att.name}
                      title={att.name}
                    />
                    <button
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-text p-0.5 text-white"
                      onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== att.id))}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className={`relative flex max-w-[220px] items-center gap-2 rounded-lg border px-2.5 py-2 ${
                      att.error
                        ? 'border-danger/40 bg-danger-soft'
                        : 'border-border bg-surface-secondary'
                    }`}
                    title={att.error ? '上传失败,发送时将忽略' : att.name}
                  >
                    {att.uploading ? (
                      <Loader2 size={15} className="shrink-0 animate-spin text-primary" />
                    ) : (
                      <FileIcon
                        size={15}
                        className={`shrink-0 ${att.error ? 'text-danger' : 'text-text-tertiary'}`}
                      />
                    )}
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-[12px] leading-4 ${
                          att.error ? 'text-danger' : 'text-text'
                        }`}
                      >
                        {att.name}
                      </span>
                      <span className="block text-[11px] text-text-tertiary">
                        {att.error ? '上传失败' : att.uploading ? '上传中…' : fmtSize(att.size)}
                      </span>
                    </span>
                    <button
                      className="ml-1 shrink-0 rounded-full p-0.5 text-text-tertiary hover:bg-surface-tertiary hover:text-text"
                      onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== att.id))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {/* 输入行:附件按钮 + textarea(选项已下移到工具行) */}
          <div className="relative flex items-end gap-1.5 px-3 pb-1 pt-2">
            {/* / 指令面板(kimi web 同款):内置指令 + 会话可用技能 */}
            {slashOpen && (
              <div
                ref={slashListRef}
                className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg"
              >
                {slashItems.map((item, i) => {
                  const prev = slashItems[i - 1]
                  const showGroup = i === 0 || prev.kind !== item.kind
                  return (
                    <div key={`${item.kind}:${item.name}`}>
                      {showGroup && (
                        <p className="px-2.5 pb-0.5 pt-1 text-[11px] text-text-tertiary">
                          {item.kind === 'builtin' ? '指令' : '技能'}
                        </p>
                      )}
                      <button
                        data-idx={i}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${
                          i === slashIdx ? 'bg-primary-soft' : 'hover:bg-surface-secondary'
                        }`}
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => pickSlash(item)}
                      >
                        <span className="shrink-0 font-mono text-[12.5px] font-medium text-primary">
                          /{item.name}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
                          {item.desc}
                        </span>
                        {item.kind === 'skill' && (
                          <span className="shrink-0 rounded bg-surface-tertiary px-1 py-px text-[10px] text-text-tertiary">
                            技能
                          </span>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <button
              className="mb-0.5 shrink-0 rounded-lg p-1.5 text-text-tertiary hover:bg-surface-tertiary hover:text-text"
              title="添加附件(图片 / 文件,最多 4 个,单个 ≤10MB)"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={17} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <textarea
              ref={taRef}
              rows={1}
              className="max-h-[180px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] outline-none placeholder:text-text-tertiary"
              placeholder={
                busy ? '任务进行中,发送将排队 / 可点击右侧停止' : '输入消息,Enter 发送,Shift+Enter 换行'
              }
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setSlashDismissed(false)
              }}
              onKeyDown={(e) => {
                // / 面板打开时优先消费导航键
                if (slashOpen) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSlashIdx((i) => (i + 1) % slashItems.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSlashIdx((i) => (i - 1 + slashItems.length) % slashItems.length)
                    return
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    pickSlash(slashItems[Math.min(slashIdx, slashItems.length - 1)])
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setSlashDismissed(true)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  // / 面板打开时 Enter = 选择高亮项,否则正常发送
                  if (slashOpen) pickSlash(slashItems[Math.min(slashIdx, slashItems.length - 1)])
                  else doSend()
                }
              }}
              onPaste={(e) => {
                const files = e.clipboardData?.files
                if (files && files.length > 0) {
                  e.preventDefault()
                  void addFiles(Array.from(files))
                }
              }}
            />
          </div>

          {/* 工具行:左侧 权限/模式/模型/思考强度,右侧 上下文环 + 发送/停止 */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
            {/* 权限模式 */}
            <div className="relative">
              <button className={toolBtn(openPop === 'permission')} title="权限模式" onClick={togglePop('permission')}>
                <ShieldCheck size={14} />
                <span className="max-w-[72px] truncate">{permLabel}</span>
                <ChevronDown size={12} className="opacity-60" />
              </button>
              {openPop === 'permission' && (
                <div
                  className="absolute bottom-full left-0 z-30 mb-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  {PERMISSIONS.map((p) => (
                    <button
                      key={p.value}
                      className={popOption(permission === p.value)}
                      onClick={() => {
                        setPermission(p.value)
                        setOpenPop(null)
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
                          {p.label}
                          {permission === p.value && <Check size={12} className="text-primary" />}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-4 text-text-tertiary">
                          {p.desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 模式 */}
            <div className="relative">
              <button
                className={toolBtn(openPop === 'mode' || mode !== 'default')}
                title="运行模式"
                onClick={togglePop('mode')}
              >
                <activeMode.icon size={14} />
                <span>{mode === 'default' ? '模式' : activeMode.label}</span>
                <ChevronDown size={12} className="opacity-60" />
              </button>
              {openPop === 'mode' && (
                <div
                  className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      className={popOption(mode === m.value)}
                      onClick={() => {
                        setMode(m.value)
                        setOpenPop(null)
                      }}
                    >
                      <m.icon
                        size={15}
                        className={`mt-0.5 shrink-0 ${
                          mode === m.value ? 'text-primary' : 'text-text-tertiary'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
                          {m.label}
                          {mode === m.value && <Check size={12} className="text-primary" />}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-4 text-text-tertiary">
                          {m.desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 模型选择 */}
            {models.length > 0 && (
              <div className="relative">
                <button
                  className={toolBtn(openPop === 'model')}
                  title="模型(对下一条消息生效)"
                  onClick={togglePop('model')}
                >
                  <Cpu size={14} />
                  <span className="max-w-[110px] truncate">
                    {selectedModel?.display_name || selectedModel?.model || '模型'}
                  </span>
                  <ChevronDown size={12} className="opacity-60" />
                </button>
                {openPop === 'model' && (
                  <div
                    className="absolute bottom-full left-0 z-30 mb-2 max-h-[320px] w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {groupedModels.map(([provider, list]) => (
                      <div key={provider}>
                        <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-text-tertiary">
                          {provider}
                        </p>
                        {list.map((m) => (
                          <button
                            key={m.model}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-secondary"
                            onClick={() => {
                              setModel(m.model)
                              setUserPicked(true)
                              setOpenPop(null)
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">
                              {m.display_name || m.model}
                            </span>
                            {m.max_context_size ? (
                              <span className="shrink-0 text-[11px] text-text-tertiary">
                                {fmtContext(m.max_context_size)}
                              </span>
                            ) : null}
                            {model === m.model && <Check size={13} className="shrink-0 text-primary" />}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 思考强度:模型有 thinking 能力时显示,回显当前生效档位 */}
            {pills.length > 0 && (
              <div className="flex items-center gap-1">
                <SlidersHorizontal size={13} className="mr-0.5 shrink-0 text-text-tertiary" />
                {pills.map((v) => (
                  <button
                    key={v}
                    className={`rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${
                      thinking === v
                        ? 'border-primary-border bg-primary-soft text-primary'
                        : 'border-transparent text-text-tertiary hover:bg-surface-tertiary'
                    }`}
                    onClick={() => setUserThinking(v)}
                    title={v === 'off' ? '关闭思考' : v === 'on' ? '开启思考' : `思考强度:${v}`}
                  >
                    {v === 'off' ? '关' : v === 'on' ? '开' : v}
                  </button>
                ))}
              </div>
            )}

            {/* 右侧:上下文用量环 + 发送/停止 */}
            <div className="ml-auto flex items-center gap-1.5">
              {/* 上下文用量环:hover 显示已用/总量/百分比 */}
              {typeof status.contextUsage === 'number' &&
                typeof status.contextTokens === 'number' &&
                typeof status.maxContextTokens === 'number' &&
                status.maxContextTokens > 0 && (
                  <ContextRing
                    used={status.contextTokens}
                    max={status.maxContextTokens}
                    pct={Math.min(1, Math.max(0, status.contextUsage))}
                  />
                )}

              {busy ? (
                <button
                  className="shrink-0 rounded-full bg-danger p-2 text-white hover:opacity-90"
                  title="停止"
                  onClick={() => void abort()}
                >
                  <Square size={15} />
                </button>
              ) : (
                <button
                  className="shrink-0 rounded-full bg-primary p-2 text-white hover:bg-primary-hover disabled:opacity-40"
                  disabled={!canSend}
                  title={uploading ? '附件上传中…' : '发送'}
                  onClick={doSend}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>

          {/* 目标模式:目标输入框 */}
          {mode === 'goal' && (
            <div className="px-3 pb-2">
              <input
                className="w-full rounded-lg border border-border bg-surface-secondary px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-text-tertiary focus:border-primary-border"
                placeholder="输入目标,例如:完成登录模块并通过全部测试"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
          )}
        </div>

        {attachNote && <p className="mt-1.5 text-center text-[11px] text-danger">{attachNote}</p>}
        <p className="mt-1.5 text-center text-[11px] text-text-tertiary">
          {status.model ? `${status.model} · ` : ''}
          {typeof status.contextUsage === 'number'
            ? `上下文 ${(status.contextUsage * 100).toFixed(0)}%`
            : ''}
        </p>
      </div>
    </div>
  )
}
