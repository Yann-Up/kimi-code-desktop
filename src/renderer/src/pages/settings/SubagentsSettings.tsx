import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Bot, Check } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'
import { useUi } from '../../stores/ui'
import { useSessions } from '../../stores/sessions'
import { rest } from '@/api'

/** 委派 store:记录用户选中的子智能体 profile,供 Composer 后续消费。 */
interface DelegateState {
  profile: string | null
  setProfile: (p: string | null) => void
}

export const useDelegate = create<DelegateState>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile })
}))

interface AgentProfile {
  name: string
  description?: string
  tools?: string[]
  path?: string
  builtin?: boolean
}

type Raw = Record<string, unknown>

/** 容错地把接口返回规范为对象数组(支持裸数组或 items/children/sessions 包裹)。 */
function asList(v: unknown): Raw[] {
  if (Array.isArray(v)) return v as Raw[]
  if (v && typeof v === 'object') {
    const o = v as Raw
    for (const key of ['items', 'children', 'sessions', 'subagents']) {
      if (Array.isArray(o[key])) return o[key] as Raw[]
    }
  }
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function fmtTime(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

function statusKind(status: string): 'running' | 'completed' | 'failed' {
  const s = status.toLowerCase()
  if (['failed', 'error', 'errored', 'crashed'].includes(s)) return 'failed'
  if (
    ['completed', 'done', 'finished', 'succeeded', 'success', 'stopped', 'cancelled', 'canceled'].includes(s)
  )
    return 'completed'
  return 'running'
}

/** 状态徽标:运行中=蓝色脉冲、completed=绿、failed=红。 */
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

export function SubagentsSettings() {
  const closeSettings = useUi((s) => s.closeSettings)
  const activeSessionId = useSessions((s) => s.activeSessionId)
  const selected = useDelegate((s) => s.profile)
  const setProfile = useDelegate((s) => s.setProfile)

  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profilesError, setProfilesError] = useState('')
  const [children, setChildren] = useState<Raw[]>([])
  const [childrenError, setChildrenError] = useState('')

  useEffect(() => {
    window.kimiApi
      .localAgents()
      .then((v) => setProfiles(Array.isArray(v) ? (v as AgentProfile[]) : []))
      .catch((e) => setProfilesError(errMsg(e, '加载子智能体列表失败')))
  }, [])

  // 当前会话的子代理:每 5 秒轮询一次
  useEffect(() => {
    if (!activeSessionId) {
      setChildren([])
      setChildrenError('')
      return
    }
    let cancelled = false
    const load = () => {
      rest<unknown>(`/api/v1/sessions/${activeSessionId}/children`)
        .then((v) => {
          if (cancelled) return
          setChildren(asList(v))
          setChildrenError('')
        })
        .catch((e) => {
          if (!cancelled) setChildrenError(errMsg(e, '加载子代理列表失败'))
        })
    }
    setChildren([])
    setChildrenError('')
    load()
    const timer = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeSessionId])

  const delegate = (name: string) => {
    setProfile(name)
    closeSettings()
  }

  return (
    <Section title="子智能体" desc="选择可委派的子智能体 profile,并查看当前会话中运行的子代理">
      <GroupLabel>可委派 Profile</GroupLabel>
      {profilesError ? (
        <p className="text-[12px] text-danger">{profilesError}</p>
      ) : profiles.length === 0 ? (
        <Empty text="未发现可用的子智能体 profile" />
      ) : (
        profiles.map((p) => (
          <Card key={p.name} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Bot size={14} className="shrink-0 text-primary" />
                <span className="truncate text-[13.5px] font-medium">{p.name}</span>
                {p.builtin && (
                  <span className="shrink-0 rounded-full border border-primary-border bg-primary-soft px-1.5 py-px text-[11px] text-primary">
                    内置
                  </span>
                )}
              </div>
              {p.description && (
                <p className="mt-1 line-clamp-2 text-[12px] text-text-tertiary">{p.description}</p>
              )}
            </div>
            <button
              className={`flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium ${
                selected === p.name
                  ? 'border-primary-border bg-primary-soft text-primary'
                  : 'border-border bg-surface text-text-secondary hover:border-primary-border hover:text-primary'
              }`}
              onClick={() => delegate(p.name)}
            >
              {selected === p.name ? (
                <>
                  <Check size={12} /> 已选择
                </>
              ) : (
                '委派'
              )}
            </button>
          </Card>
        ))
      )}

      <GroupLabel>当前会话运行中的子代理</GroupLabel>
      {!activeSessionId ? (
        <Empty text="暂无活跃会话,打开一个会话后即可查看其子代理" />
      ) : childrenError ? (
        <p className="text-[12px] text-danger">{childrenError}</p>
      ) : children.length === 0 ? (
        <Empty text="当前会话没有运行中的子代理" />
      ) : (
        children.map((c, i) => {
          const id = str(c.id) || str(c.session_id) || `child-${i}`
          const kind = str(c.subagent_type) || str(c.kind) || str(c.type) || 'subagent'
          const desc = str(c.description) || str(c.title)
          const status = str(c.status) || str(c.state)
          const time = fmtTime(c.created_at)
          return (
            <Card key={`${id}-${i}`} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded border border-border bg-surface-secondary px-1.5 py-px font-mono text-[11px] text-text-secondary">
                    {kind}
                  </span>
                  {desc && <span className="truncate text-[13px]">{desc}</span>}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">
                  {id}
                  {time ? ` · ${time}` : ''}
                </p>
              </div>
              <StatusBadge status={status} />
            </Card>
          )
        })
      )}
    </Section>
  )
}
