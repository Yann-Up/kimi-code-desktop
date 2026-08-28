import {
  Bot,
  Brain,
  Command,
  Cpu,
  Database,
  FileCode2,
  FlaskConical,
  Globe,
  Network,
  PawPrint,
  Repeat,
  Settings2,
  SlidersHorizontal,
  User2,
  Wand2
} from 'lucide-react'
import { useUi } from '../stores/ui'
import { useT } from '../i18n'
import { GeneralSettings } from './settings/GeneralSettings'
import { ChannelsSettings } from './settings/ChannelsSettings'
import { DesktopExperimentalSettings } from './settings/DesktopExperimentalSettings'
import { CliGeneralSettings } from './settings/CliGeneralSettings'
import { CliModelsSettings } from './settings/CliModelsSettings'
import { CliThinkingSettings } from './settings/CliThinkingSettings'
import { CliLoopSettings } from './settings/CliLoopSettings'
import { CliServicesSettings } from './settings/CliServicesSettings'
import { CliIdentitySettings } from './settings/CliIdentitySettings'
import { CliAdvancedSettings } from './settings/CliAdvancedSettings'
import { CliExperimentalSettings } from './settings/CliExperimentalSettings'
import { SubagentsSettings } from './settings/SubagentsSettings'
import { SkillsSettings } from './settings/SkillsSettings'
import { McpSettings } from './settings/McpSettings'
import { CommandsSettings } from './settings/CommandsSettings'

// 模型/供应商/OAuth/权限/主题等设置交给官方 web UI;这里只保留官方 UI 没有的壳设置页
// (使用统计已提升为顶部导航 tab,不在此处)
// 侧栏按「桌面 / CLI 配置 / 资源」三组展示;settingsSection 仍是扁平字符串,分组只是渲染层
type SectionDef = { id: string; label: string; icon: typeof Settings2 }

// 文案走 i18n,需在组件内构建以随语言切换重渲染
function useGroups(t: ReturnType<typeof useT>): { label: string; items: SectionDef[] }[] {
  return [
    {
      label: t('settings.groupDesktop'),
      items: [
        { id: 'general', label: t('settings.general'), icon: Settings2 },
        { id: 'channels', label: t('settings.channels'), icon: Network },
        { id: 'desktop-experimental', label: t('settings.experimental'), icon: PawPrint }
      ]
    },
    {
      label: t('settings.groupCliConfig'),
      items: [
        { id: 'cli-general', label: t('settings.cliGeneral'), icon: SlidersHorizontal },
        { id: 'cli-models', label: t('settings.cliModels'), icon: Cpu },
        { id: 'cli-thinking', label: t('settings.cliThinking'), icon: Brain },
        { id: 'cli-loop', label: t('settings.cliLoop'), icon: Repeat },
        { id: 'cli-services', label: t('settings.cliServices'), icon: Globe },
        { id: 'cli-identity', label: t('settings.cliIdentity'), icon: User2 },
        { id: 'cli-experimental', label: t('settings.experimental'), icon: FlaskConical },
        { id: 'cli-advanced', label: t('settings.cliAdvanced'), icon: FileCode2 }
      ]
    },
    {
      label: t('settings.groupResources'),
      items: [
        { id: 'mcp', label: t('settings.mcp'), icon: Database },
        { id: 'skills', label: t('settings.skills'), icon: Wand2 },
        { id: 'subagents', label: t('settings.subagents'), icon: Bot },
        { id: 'commands', label: t('settings.commands'), icon: Command }
      ]
    }
  ]
}

export function SettingsPage() {
  const t = useT()
  const { settingsSection, setSettingsSection } = useUi()
  const settingsZoom = useUi((s) => s.settingsZoom)
  const groups = useGroups(t)

  const content = (() => {
    switch (settingsSection) {
      case 'general':
        return <GeneralSettings />
      case 'channels':
        return <ChannelsSettings />
      case 'desktop-experimental':
        return <DesktopExperimentalSettings />
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
      case 'cli-experimental':
        return <CliExperimentalSettings />
      case 'cli-advanced':
        return <CliAdvancedSettings />
      case 'mcp':
        return <McpSettings />
      case 'skills':
        return <SkillsSettings />
      case 'subagents':
        return <SubagentsSettings />
      case 'commands':
        return <CommandsSettings />
      default:
        return <GeneralSettings />
    }
  })()

  return (
    // zoom 整体缩放设置页(组件均为固定 px 字号,继承式 font-size 不生效);仅作用本页
    // relative:压在 SkinStandee(z-0 立绘)之上;内容区不设底色,卡片不透处透出立绘
    <div className="relative flex min-h-0 flex-1" style={{ zoom: settingsZoom / 100 }}>
      <div className="flex w-[200px] shrink-0 flex-col border-r border-border-light bg-surface-secondary">
        {/* 侧栏标题(对齐官方设置弹窗左上「设置」) */}
        <div className="px-4 pb-1 pt-5 text-[18px] font-semibold">{t('settings.title')}</div>
        <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 pb-1 pt-3 text-[11px] font-medium text-text-tertiary">{g.label}</div>
              {g.items.map((s) => {
                const Icon = s.icon
                const active = settingsSection === s.id
                return (
                  <button
                    key={s.id}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-[525] transition-colors ${
                      active
                        ? 'bg-surface-tertiary text-text'
                        : 'text-text-secondary hover:bg-surface-tertiary hover:text-text'
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
      <div className="min-w-0 flex-1 overflow-y-auto">{content}</div>
    </div>
  )
}
