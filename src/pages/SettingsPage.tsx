import {
  Bot,
  Brain,
  CalendarClock,
  Command,
  Cpu,
  Database,
  FileCode2,
  Globe,
  Network,
  Repeat,
  Settings2,
  SlidersHorizontal,
  User2,
  Wand2
} from 'lucide-react'
import { useUi } from '../stores/ui'
import { GeneralSettings } from './settings/GeneralSettings'
import { ChannelsSettings } from './settings/ChannelsSettings'
import { CliGeneralSettings } from './settings/CliGeneralSettings'
import { CliModelsSettings } from './settings/CliModelsSettings'
import { CliThinkingSettings } from './settings/CliThinkingSettings'
import { CliLoopSettings } from './settings/CliLoopSettings'
import { CliServicesSettings } from './settings/CliServicesSettings'
import { CliIdentitySettings } from './settings/CliIdentitySettings'
import { CliAdvancedSettings } from './settings/CliAdvancedSettings'
import { SubagentsSettings } from './settings/SubagentsSettings'
import { SkillsSettings } from './settings/SkillsSettings'
import { McpSettings } from './settings/McpSettings'
import { CronSettings } from './settings/CronSettings'
import { CommandsSettings } from './settings/CommandsSettings'

// 模型/供应商/OAuth/权限/主题等设置交给官方 web UI;这里只保留官方 UI 没有的壳设置页
// (使用统计已提升为顶部导航 tab,不在此处)
// 侧栏按「桌面 / CLI 配置 / 资源」三组展示;settingsSection 仍是扁平字符串,分组只是渲染层
type SectionDef = { id: string; label: string; icon: typeof Settings2 }

const GROUPS: { label: string; items: SectionDef[] }[] = [
  {
    label: '桌面',
    items: [
      { id: 'general', label: '常规', icon: Settings2 },
      { id: 'channels', label: '通道', icon: Network }
    ]
  },
  {
    label: 'CLI 配置',
    items: [
      { id: 'cli-general', label: '通用行为', icon: SlidersHorizontal },
      { id: 'cli-models', label: '模型与供应商', icon: Cpu },
      { id: 'cli-thinking', label: '思考', icon: Brain },
      { id: 'cli-loop', label: '循环与后台', icon: Repeat },
      { id: 'cli-services', label: '服务与图像', icon: Globe },
      { id: 'cli-identity', label: '身份', icon: User2 },
      { id: 'cli-advanced', label: '高级', icon: FileCode2 }
    ]
  },
  {
    label: '资源',
    items: [
      { id: 'mcp', label: 'MCP', icon: Database },
      { id: 'skills', label: '技能', icon: Wand2 },
      { id: 'subagents', label: '子智能体', icon: Bot },
      { id: 'cron', label: '定时', icon: CalendarClock },
      { id: 'commands', label: '命令', icon: Command }
    ]
  }
]

export function SettingsPage() {
  const { settingsSection, setSettingsSection } = useUi()
  const settingsZoom = useUi((s) => s.settingsZoom)

  const content = (() => {
    switch (settingsSection) {
      case 'general':
        return <GeneralSettings />
      case 'channels':
        return <ChannelsSettings />
      case 'cli-general':
        return <CliGeneralSettings />
      case 'cli-models':
        return <CliModelsSettings />
      case 'cli-thinking':
        return <CliThinkingSettings />
      case 'cli-loop':
        return <CliLoopSettings />
      case 'cli-services':
        return <CliServicesSettings />
      case 'cli-identity':
        return <CliIdentitySettings />
      case 'cli-advanced':
        return <CliAdvancedSettings />
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
    // zoom 整体缩放设置页(组件均为固定 px 字号,继承式 font-size 不生效);仅作用本页
    <div className="flex min-h-0 flex-1" style={{ zoom: settingsZoom / 100 }}>
      <div className="flex w-[200px] shrink-0 flex-col border-r border-border-light bg-surface-secondary">
        <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="px-3 pb-1 pt-3 text-[11px] font-medium text-text-tertiary">{g.label}</div>
              {g.items.map((s) => {
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
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto bg-surface">{content}</div>
    </div>
  )
}
