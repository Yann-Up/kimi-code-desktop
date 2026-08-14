import { useEffect, useState } from 'react'
import { Check, Wand2 } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'
import { useActiveSessionId } from '../../hooks/useActiveSessionId'
import { rest } from '@/api'

interface LocalSkill {
  name: string
  description?: string
  path: string
  scope: string
}

type Raw = Record<string, unknown>

/** 容错地把接口返回规范为对象数组(支持裸数组或 items/skills 包裹)。 */
function asList(v: unknown): Raw[] {
  if (Array.isArray(v)) return v as Raw[]
  if (v && typeof v === 'object') {
    const o = v as Raw
    for (const key of ['items', 'skills', 'sessions']) {
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

/** 路径摘要:只保留最后两级目录。 */
function pathSummary(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
  return parts.length <= 2 ? p : '…/' + parts.slice(-2).join('/')
}

type ActivateState = 'busy' | 'done' | 'error'

export function SkillsSettings() {
  // 会话由官方 web UI(iframe)管理,壳侧轮询服务端会话列表取当前活跃会话
  const activeSessionId = useActiveSessionId()

  const [local, setLocal] = useState<LocalSkill[]>([])
  const [localError, setLocalError] = useState('')
  const [sessionSkills, setSessionSkills] = useState<Raw[]>([])
  const [sessionError, setSessionError] = useState('')
  const [activate, setActivate] = useState<Record<string, ActivateState>>({})

  useEffect(() => {
    window.kimiApi
      .localSkills()
      .then((v) => setLocal(Array.isArray(v) ? (v as LocalSkill[]) : []))
      .catch((e) => setLocalError(errMsg(e, '加载用户级技能失败')))
  }, [])

  useEffect(() => {
    if (!activeSessionId) {
      setSessionSkills([])
      setSessionError('')
      return
    }
    rest<unknown>(`/api/v1/sessions/${activeSessionId}/skills`)
      .then((v) => {
        setSessionSkills(asList(v))
        setSessionError('')
      })
      .catch((e) => setSessionError(errMsg(e, '加载会话技能失败')))
  }, [activeSessionId])

  const activateSkill = async (name: string) => {
    if (!activeSessionId || !name) return
    setActivate((m) => {
      const next: Record<string, ActivateState> = { ...m }
      next[name] = 'busy'
      return next
    })
    try {
      await rest(`/api/v1/sessions/${activeSessionId}/skills/${encodeURIComponent(name)}:activate`, {
        method: 'POST'
      })
      setActivate((m) => {
        const next: Record<string, ActivateState> = { ...m }
        next[name] = 'done'
        return next
      })
      // toast 式提示:2 秒后自动消失
      setTimeout(() => {
        setActivate((m) => {
          if (m[name] !== 'done') return m
          const next = { ...m }
          delete next[name]
          return next
        })
      }, 2000)
    } catch {
      setActivate((m) => {
        const next: Record<string, ActivateState> = { ...m }
        next[name] = 'error'
        return next
      })
    }
  }

  return (
    <Section title="技能" desc="管理用户级技能,并在当前会话中激活工作区技能">
      <GroupLabel>用户级技能</GroupLabel>
      {localError ? (
        <p className="text-[12px] text-danger">{localError}</p>
      ) : local.length === 0 ? (
        <Empty text="未发现用户级技能(~/.kimi-code/skills)" />
      ) : (
        local.map((s) => (
          <Card key={s.path}>
            <div className="flex items-center gap-2">
              <Wand2 size={14} className="shrink-0 text-primary" />
              <span className="truncate text-[13.5px] font-medium">{s.name}</span>
            </div>
            {s.description && (
              <p className="mt-1 line-clamp-2 text-[12px] text-text-tertiary">{s.description}</p>
            )}
            <p className="mt-1.5 truncate font-mono text-[11px] text-text-tertiary" title={s.path}>
              {pathSummary(s.path)}
            </p>
          </Card>
        ))
      )}

      <GroupLabel>当前工作区技能</GroupLabel>
      {!activeSessionId ? (
        <Empty text="暂无活跃会话,打开一个会话后即可查看其工作区技能" />
      ) : sessionError ? (
        <p className="text-[12px] text-danger">{sessionError}</p>
      ) : sessionSkills.length === 0 ? (
        <Empty text="当前会话没有可用的工作区技能" />
      ) : (
        sessionSkills.map((s, i) => {
          const name = str(s.name) || str(s.id) || `skill-${i}`
          const desc = str(s.description)
          const st = activate[name]
          return (
            <Card key={`${name}-${i}`} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Wand2 size={14} className="shrink-0 text-primary" />
                  <span className="truncate text-[13.5px] font-medium">{name}</span>
                </div>
                {desc && <p className="mt-1 line-clamp-2 text-[12px] text-text-tertiary">{desc}</p>}
                {st === 'error' && <p className="mt-1 text-[12px] text-danger">激活失败,请重试</p>}
              </div>
              {st === 'done' ? (
                <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-success">
                  <Check size={12} /> 已激活
                </span>
              ) : (
                <button
                  className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-text-secondary hover:border-primary-border hover:text-primary disabled:opacity-50"
                  disabled={st === 'busy'}
                  onClick={() => void activateSkill(name)}
                >
                  {st === 'busy' ? '激活中…' : '在此会话激活'}
                </button>
              )}
            </Card>
          )
        })
      )}
    </Section>
  )
}
