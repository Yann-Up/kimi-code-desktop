import { useEffect, useState } from 'react'
import { Terminal, Wand2 } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'

interface SkillEntry {
  name: string
  description?: string
  path: string
  scope: 'user' | 'project'
}

const BUILTIN_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: '/login', desc: '登录 Kimi 账户' },
  { cmd: '/logout', desc: '退出当前账户' },
  { cmd: '/model', desc: '查看或切换当前使用的模型' },
  { cmd: '/compact', desc: '压缩会话上下文,释放 Token 预算' },
  { cmd: '/undo', desc: '撤销上一次的代码修改' },
  { cmd: '/export', desc: '导出当前会话记录' },
  { cmd: '/mcp-config', desc: '查看或编辑 MCP 服务器配置' },
  { cmd: '/usage', desc: '查看 Token 用量与额度' },
  { cmd: '/status', desc: '查看会话与服务运行状态' },
  { cmd: '/help', desc: '查看帮助与全部可用命令' }
]

export function CommandsSettings() {
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.kimiApi
      .localSkills()
      .then((s) => {
        setSkills(Array.isArray(s) ? (s as SkillEntry[]) : [])
        setErr('')
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : '读取技能列表失败'))
  }, [])

  return (
    <Section title="命令" desc="在聊天输入框中以 / 开头的斜杠命令">
      <GroupLabel>内置命令</GroupLabel>
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

      <GroupLabel>技能命令</GroupLabel>
      {err && <p className="text-[12px] text-danger">{err}</p>}
      {skills && skills.length === 0 && !err && (
        <Empty text="暂无自定义技能,安装技能后可通过 /skill:<名称> 调用" />
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
