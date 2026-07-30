import {
  ArrowLeft,
  Code2,
  Command,
  Database,
  Gauge,
  Puzzle,
  Rocket,
  Settings2,
  Sparkles,
  Wand2
} from 'lucide-react'
import { useUi } from '../stores/ui'
import { GeneralSettings } from './settings/GeneralSettings'
import { CodePreviewSettings } from './settings/CodePreviewSettings'
import { ModelsSettings } from './settings/ModelsSettings'
import { SubagentsSettings } from './settings/SubagentsSettings'
import { PluginsSettings } from './settings/PluginsSettings'
import { SkillsSettings } from './settings/SkillsSettings'
import { McpSettings } from './settings/McpSettings'
import { MemorySettings } from './settings/MemorySettings'
import { CronSettings } from './settings/CronSettings'
import { CommandsSettings } from './settings/CommandsSettings'
import { IndexSettings } from './settings/IndexSettings'
import { UsageSettings } from './settings/UsageSettings'
import { GuideSettings } from './settings/GuideSettings'

const SECTIONS: { id: string; label: string; icon: typeof Settings2 }[] = [
  { id: 'general', label: '常规', icon: Settings2 },
  { id: 'code-preview', label: '代码预览', icon: Code2 },
  { id: 'models', label: '模型设置', icon: Sparkles },
  // 子智能体/记忆/定时任务/索引库:CLI 0.29.2 无服务端接口,暂时隐藏
  { id: 'plugins', label: '插件管理', icon: Puzzle },
  { id: 'skills', label: '技能', icon: Wand2 },
  { id: 'mcp', label: 'MCP', icon: Database },
  // 记忆/定时任务/索引库:CLI 0.29.2 无服务端接口,暂时隐藏
  { id: 'commands', label: '命令', icon: Command },
  { id: 'usage', label: '使用统计', icon: Gauge },
  { id: 'guide', label: '引导', icon: Rocket }
]

export function SettingsPage() {
  const { settingsSection, setSettingsSection, closeSettings } = useUi()

  const content = (() => {
    switch (settingsSection) {
      case 'general':
        return <GeneralSettings />
      case 'code-preview':
        return <CodePreviewSettings />
      case 'models':
        return <ModelsSettings />
      case 'subagents':
        return <SubagentsSettings />
      case 'plugins':
        return <PluginsSettings />
      case 'skills':
        return <SkillsSettings />
      case 'mcp':
        return <McpSettings />
      case 'memory':
        return <MemorySettings />
      case 'cron':
        return <CronSettings />
      case 'commands':
        return <CommandsSettings />
      case 'index':
        return <IndexSettings />
      case 'usage':
        return <UsageSettings />
      case 'guide':
        return <GuideSettings />
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
          <ArrowLeft size={14} /> 返回工作区
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
