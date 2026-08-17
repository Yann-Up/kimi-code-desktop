import { useEffect, useState } from 'react'
import { Bot, X } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'

interface AgentProfile {
  name: string
  description?: string
  tools?: string[]
  path?: string
  builtin?: boolean
  /** 来源目录:"user" = 数据目录/agents,"agents" = ~/.agents/agents;内置项无此字段 */
  scope?: string
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

/** 来源徽标:内置 / ~/.agents / 数据目录(卡片与详情弹层共用) */
function ScopeBadge({ profile }: { profile: AgentProfile }) {
  if (profile.builtin) {
    return (
      <span className="shrink-0 rounded-full border border-primary-border bg-primary-soft px-1.5 py-px text-[11px] text-primary">
        内置
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-full border border-border bg-surface-tertiary px-1.5 py-px text-[11px] text-text-tertiary">
      {profile.scope === 'agents' ? '~/.agents' : '数据目录'}
    </span>
  )
}

/** 子智能体设置:只读展示全局(用户级)profile;项目级与会话内的委派由官方 UI 管理 */
export function SubagentsSettings() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profilesError, setProfilesError] = useState('')
  const [kimiHome, setKimiHome] = useState('')
  const [detail, setDetail] = useState<AgentProfile | null>(null)

  useEffect(() => {
    window.kimiApi
      .localAgents()
      .then((v) => setProfiles(Array.isArray(v) ? (v as AgentProfile[]) : []))
      .catch((e) => setProfilesError(errMsg(e, '加载子智能体列表失败')))
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setKimiHome(String((h as { home?: string })?.home ?? '')))
      .catch(() => {})
  }, [])

  const desc = kimiHome
    ? `全局(用户级)子智能体 profile,对当前目标的所有项目生效,来自两个目录:\n${kimiHome}/agents(数据目录/agents)\n~/.agents/agents\n项目级子智能体不在此管理;点击卡片查看完整信息,新会话生效`
    : '全局(用户级)子智能体 profile:数据目录/agents 与 ~/.agents/agents 对所有项目生效;项目级不在此管理'

  return (
    <Section title="子智能体" desc={desc}>
      <GroupLabel>用户级 Profile</GroupLabel>
      {profilesError ? (
        <p className="text-[12px] text-danger">{profilesError}</p>
      ) : profiles.length === 0 ? (
        <Empty text="未发现子智能体 profile(数据目录/agents 与 ~/.agents/agents)" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((p) => (
            <button key={p.name} className="text-left" onClick={() => setDetail(p)}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <div className="flex items-center gap-2">
                  <Bot size={14} className="shrink-0 text-primary" />
                  <span className="truncate text-[13.5px] font-medium">{p.name}</span>
                  <ScopeBadge profile={p} />
                </div>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-[12px] text-text-tertiary">{p.description}</p>
                )}
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Profile 详情弹层:点击卡片展示完整信息 */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setDetail(null)}
        >
          <div
            className="flex max-h-[70vh] w-[520px] flex-col rounded-xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
              <div className="flex min-w-0 items-center gap-2">
                <Bot size={15} className="shrink-0 text-primary" />
                <span className="truncate text-[15px] font-semibold">{detail.name}</span>
                <ScopeBadge profile={detail} />
              </div>
              <button
                className="rounded p-1 text-text-tertiary hover:bg-surface-tertiary"
                onClick={() => setDetail(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <p className="text-[12px] font-medium text-text-tertiary">描述</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-secondary">
                {detail.description || '(无描述)'}
              </p>
              {detail.tools && detail.tools.length > 0 && (
                <>
                  <p className="mt-4 text-[12px] font-medium text-text-tertiary">可用工具</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {detail.tools.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-border bg-surface-secondary px-1.5 py-px font-mono text-[11px] text-text-secondary"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {detail.path && (
                <>
                  <p className="mt-4 text-[12px] font-medium text-text-tertiary">路径</p>
                  <p className="mt-1 break-all font-mono text-[12px] text-text-secondary">
                    {detail.path}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}
