import { useEffect, useState } from 'react'
import { Wand2, X } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'

interface LocalSkill {
  name: string
  description?: string
  path: string
  /** 来源目录:"user" = 数据目录/skills,"agents" = ~/.agents/skills */
  scope: string
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

/** 路径摘要:只保留最后两级目录。 */
function pathSummary(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
  return parts.length <= 2 ? p : '…/' + parts.slice(-2).join('/')
}

/** 技能来源徽标(卡片与详情弹层共用) */
function ScopeBadge({ scope }: { scope: string }) {
  return scope === 'agents' ? (
    <span className="shrink-0 rounded-full border border-border bg-fill px-1.5 py-px text-[11px] text-text-tertiary">
      ~/.agents
    </span>
  ) : (
    <span className="shrink-0 rounded-full border border-border bg-fill px-1.5 py-px text-[11px] text-text-tertiary">
      数据目录
    </span>
  )
}

/** 技能设置:只展示全局(用户级)技能;项目级/工作区技能在会话语境下由官方 UI 管理 */
export function SkillsSettings() {
  const [local, setLocal] = useState<LocalSkill[]>([])
  const [localError, setLocalError] = useState('')
  const [kimiHome, setKimiHome] = useState('')
  const [selected, setSelected] = useState<LocalSkill | null>(null)

  useEffect(() => {
    window.kimiApi
      .localSkills()
      .then((v) => setLocal(Array.isArray(v) ? (v as LocalSkill[]) : []))
      .catch((e) => setLocalError(errMsg(e, '加载用户级技能失败')))
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setKimiHome(String((h as { home?: string })?.home ?? '')))
      .catch(() => {})
  }, [])

  const desc = kimiHome
    ? `全局(用户级)技能,对当前目标的所有项目生效,来自两个目录:\n${kimiHome}/skills(数据目录/skills)\n~/.agents/skills\n项目级技能不在此管理,在会话中由官方 UI 加载;技能在下次会话生效`
    : '全局(用户级)技能:数据目录/skills 与 ~/.agents/skills 对所有项目生效;项目级技能在会话中由官方 UI 管理'

  return (
    <Section title="技能" desc={desc}>
      <GroupLabel>用户级技能</GroupLabel>
      {localError ? (
        <p className="text-[12px] text-danger">{localError}</p>
      ) : local.length === 0 ? (
        <Empty text="未发现用户级技能(数据目录/skills 与 ~/.agents/skills)" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {local.map((s) => (
            <button key={s.path} className="text-left" onClick={() => setSelected(s)}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <div className="flex items-center gap-2">
                  <Wand2 size={14} className="shrink-0 text-primary" />
                  <span className="truncate text-[13px] font-[475]">{s.name}</span>
                  <ScopeBadge scope={s.scope} />
                </div>
                {s.description && (
                  <p className="mt-1 line-clamp-2 text-[12px] text-text-tertiary">{s.description}</p>
                )}
                <p
                  className="mt-1.5 truncate font-mono text-[11px] text-text-tertiary"
                  title={s.path}
                >
                  {pathSummary(s.path)}
                </p>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* 技能详情弹层:点击卡片展示完整信息 */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setSelected(null)}
        >
          <div
            className="flex max-h-[70vh] w-[520px] flex-col rounded-xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
              <div className="flex min-w-0 items-center gap-2">
                <Wand2 size={15} className="shrink-0 text-primary" />
                <span className="truncate text-[15px] font-semibold">{selected.name}</span>
                <ScopeBadge scope={selected.scope} />
              </div>
              <button
                className="rounded p-1 text-text-tertiary hover:bg-fill hover:text-text"
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <p className="text-[12px] font-medium text-text-tertiary">描述</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-secondary">
                {selected.description || '(无描述)'}
              </p>
              <p className="mt-4 text-[12px] font-medium text-text-tertiary">路径</p>
              <p className="mt-1 break-all font-mono text-[12px] text-text-secondary">
                {selected.path}
              </p>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}
