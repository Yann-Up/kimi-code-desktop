import { useEffect, useState } from 'react'
import { Bot, X } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'
import { useT } from '../../i18n'

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
  const t = useT()
  if (profile.builtin) {
    return (
      <span className="shrink-0 rounded-full border border-primary-border bg-primary-soft px-1.5 py-px text-[11px] text-primary">
        {t('settings.subagents.builtin')}
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-full border border-border bg-fill px-1.5 py-px text-[11px] text-text-tertiary">
      {profile.scope === 'agents' ? '~/.agents' : t('settings.subagents.scopeDataDir')}
    </span>
  )
}

/** 子智能体设置:只读展示全局(用户级)profile;项目级与会话内的委派由官方 UI 管理 */
export function SubagentsSettings() {
  const t = useT()
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profilesError, setProfilesError] = useState('')
  const [kimiHome, setKimiHome] = useState('')
  const [detail, setDetail] = useState<AgentProfile | null>(null)

  useEffect(() => {
    window.kimiApi
      .localAgents()
      .then((v) => setProfiles(Array.isArray(v) ? (v as AgentProfile[]) : []))
      .catch((e) => setProfilesError(errMsg(e, t('settings.subagents.loadFailed'))))
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setKimiHome(String((h as { home?: string })?.home ?? '')))
      .catch(() => {})
  }, [])

  const desc = kimiHome
    ? t('settings.subagents.desc', { home: kimiHome })
    : t('settings.subagents.descNoHome')

  return (
    <Section title={t('settings.subagents')} desc={desc}>
      <GroupLabel>{t('settings.subagents.userLevel')}</GroupLabel>
      {profilesError ? (
        <p className="text-[12px] text-danger">{profilesError}</p>
      ) : profiles.length === 0 ? (
        <Empty text={t('settings.subagents.empty')} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((p) => (
            <button key={p.name} className="text-left" onClick={() => setDetail(p)}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <div className="flex items-center gap-2">
                  <Bot size={14} className="shrink-0 text-primary" />
                  <span className="truncate text-[13px] font-[475]">{p.name}</span>
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
                className="rounded p-1 text-text-tertiary hover:bg-fill hover:text-text"
                onClick={() => setDetail(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <p className="text-[12px] font-medium text-text-tertiary">
                {t('settings.subagents.detailDesc')}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-secondary">
                {detail.description || t('settings.subagents.noDesc')}
              </p>
              {detail.tools && detail.tools.length > 0 && (
                <>
                  <p className="mt-4 text-[12px] font-medium text-text-tertiary">
                    {t('settings.subagents.tools')}
                  </p>
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
                  <p className="mt-4 text-[12px] font-medium text-text-tertiary">
                    {t('settings.subagents.detailPath')}
                  </p>
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
