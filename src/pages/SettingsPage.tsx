import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Command,
  Database,
  Settings2,
  Wand2
} from 'lucide-react'
import { useUi } from '../stores/ui'
import { GeneralSettings } from './settings/GeneralSettings'
import { SubagentsSettings } from './settings/SubagentsSettings'
import { SkillsSettings } from './settings/SkillsSettings'
import { McpSettings } from './settings/McpSettings'
import { CronSettings } from './settings/CronSettings'
import { CommandsSettings } from './settings/CommandsSettings'

// 模型/供应商/OAuth/权限/主题等设置交给官方 web UI;这里只保留官方 UI 没有的壳设置页
// (使用统计已提升为顶部导航 tab,不在此处)
const SECTIONS: { id: string; label: string; icon: typeof Settings2 }[] = [
  { id: 'general', label: '常规', icon: Settings2 },
  { id: 'mcp', label: 'MCP', icon: Database },
  { id: 'skills', label: '技能', icon: Wand2 },
  { id: 'subagents', label: '子智能体', icon: Bot },
  { id: 'cron', label: '定时', icon: CalendarClock },
  { id: 'commands', label: '命令', icon: Command }
]

export function SettingsPage() {
  const { settingsSection, setSettingsSection, closeSettings } = useUi()

  const content = (() => {
    switch (settingsSection) {
      case 'general':
        return <GeneralSettings />
      case 'mcp':
        return <McpSettings />
      case 'skills':
        return <SkillsSettings />
      case 'subagents':
        return <SubagentsSettings />
      case 'cron':
        return <CronSettings />
      case 'commands':
        return <CommandsSettings />
      default:
        return <GeneralSettings />
    }
  })()

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[200px] shrink-0 flex-col border-r border-border-light bg-surface-secondary">
        <button
          className="flex items-center gap-2 px-4 py-3 text-[13px] text-text-secondary hover:bg-surface-tertiary"
          onClick={closeSettings}
        >
          <ArrowLeft size={14} /> 返回对话
        </button>
        <div className="mt-1 flex-1 overflow-y-auto px-2 pb-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const active = settingsSection === s.id
            return (
              <button
                key={s.id}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${
                  active
                    ? 'bg-primary-soft font-medium text-primary'
                    : 'text-text-secondary hover:bg-surface-tertiary'
                }`}
                onClick={() => setSettingsSection(s.id)}
              >
                <Icon size={14} /> {s.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto bg-surface">{content}</div>
    </div>
  )
}
