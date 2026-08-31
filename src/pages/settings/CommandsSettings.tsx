import { useEffect, useState } from 'react'
import { Terminal, Wand2 } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'
import { useT } from '../../i18n'

interface SkillEntry {
  name: string
  description?: string
  path: string
  scope: 'user' | 'project'
}

export function CommandsSettings() {
  const t = useT()
  // 内置命令描述需随语言切换,由模块级常量移入组件内
  const BUILTIN_COMMANDS: { cmd: string; desc: string }[] = [
    { cmd: '/login', desc: t('settings.commands.cmdLogin') },
    { cmd: '/logout', desc: t('settings.commands.cmdLogout') },
    { cmd: '/model', desc: t('settings.commands.cmdModel') },
    { cmd: '/compact', desc: t('settings.commands.cmdCompact') },
    { cmd: '/undo', desc: t('settings.commands.cmdUndo') },
    { cmd: '/export', desc: t('settings.commands.cmdExport') },
    { cmd: '/mcp-config', desc: t('settings.commands.cmdMcpConfig') },
    { cmd: '/usage', desc: t('settings.commands.cmdUsage') },
    { cmd: '/status', desc: t('settings.commands.cmdStatus') },
    { cmd: '/help', desc: t('settings.commands.cmdHelp') }
  ]
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.kimiApi
      .localSkills()
      .then((s) => {
        setSkills(Array.isArray(s) ? (s as SkillEntry[]) : [])
        setErr('')
      })
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : t('settings.commands.loadFailed'))
      )
  }, [])

  return (
    <Section title={t('settings.commands')} desc={t('settings.commands.desc')}>
      <GroupLabel>{t('settings.commands.builtinGroup')}</GroupLabel>
      <Card>
        <div className="divide-y divide-border-light">
          {BUILTIN_COMMANDS.map((c) => (
            <div key={c.cmd} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
              <span className="inline-flex w-32 shrink-0 items-center gap-1.5 font-mono text-[12.5px] font-medium text-primary">
                <Terminal size={12} className="text-text-tertiary" />
                {c.cmd}
              </span>
              <span className="text-[13px] text-text-secondary">{c.desc}</span>
            </div>
          ))}
        </div>
      </Card>

      <GroupLabel>{t('settings.commands.skillGroup')}</GroupLabel>
      {err && <p className="text-[12px] text-danger">{err}</p>}
      {skills && skills.length === 0 && !err && (
        <Empty text={t('settings.commands.emptySkills')} />
      )}
      {skills && skills.length > 0 && (
        <Card>
          <div className="divide-y divide-border-light">
            {skills.map((s) => (
              <div key={s.path} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
                <span className="inline-flex w-44 shrink-0 items-center gap-1.5 font-mono text-[12.5px] font-medium text-primary">
                  <Wand2 size={12} className="text-text-tertiary" />
                  <span className="truncate" title={`/skill:${s.name}`}>
                    /skill:{s.name}
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
                  {s.description || s.name}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Section>
  )
}
