import { BarChart3, Minus, Moon, RadioTower, Settings, Square, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import logoUrl from '../assets/logo.png'
import { useUi, type ShellView } from '../stores/ui'
import { QuotaStrip } from './QuotaStrip'
import { pushThemeToFrames } from './chatPrefsBridge'
import { Select } from './ui/Select'

/** 标题栏图标按钮统一式样(对齐官方幽灵按钮:透明底 + hover 中性灰) */
const ICON_BTN =
  'no-drag group relative flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text'

/** 图标按钮 tooltip:官方同款纯黑实心胶囊白字,hover 延迟 400ms 淡入、移出即隐(替代原生 title) */
function Tip({ text, align = 'center' }: { text: string; align?: 'center' | 'right' }) {
  return (
    <span
      className={`pointer-events-none absolute top-full z-[600] mt-1 whitespace-nowrap rounded-md bg-[#1f1f1f] px-2 py-1 text-[11px] font-normal text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-hover:delay-[400ms] ${
        align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
      }`}
    >
      {text}
    </span>
  )
}

export function TitleBar() {
  const [cliVersion, setCliVersion] = useState<string>('')
  const activeChannel = useUi((s) => s.activeChannel)
  const channels = useUi((s) => s.channels)
  const setActiveChannel = useUi((s) => s.setActiveChannel)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)

  useEffect(() => {
    // CLI 版本跟随激活通道:切换通道后重探
    const off = window.kimiApi.onServerReady((info) => {
      if (info.channel === activeChannel) setCliVersion(info.cliVersion)
    })
    window.kimiApi
      .appInfo(activeChannel)
      .then((i: { cliVersion: string | null }) => i.cliVersion && setCliVersion(i.cliVersion))
      .catch(() => {})
    return off
  }, [activeChannel])

  /** 图标导航:统计/设置 toggle,再点一次回对话 */
  const toggleView = (v: ShellView) => setView(view === v ? 'chat' : v)

  /** 主题切换:翻转壳主题(持久化 + data-theme)并反推所有对话 iframe(官方无刷新跟随;
   *  已知行为:会把官方的 system 态写成显式 light/dark) */
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    pushThemeToFrames(next)
  }

  return (
    <div
      data-tauri-drag-region
      className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border-light bg-surface pl-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <img src={logoUrl} alt="" className="h-5 w-5 rounded" draggable={false} />
        <span className="text-[13px] font-semibold">Kimi Code Desktop</span>
        {cliVersion && <span className="text-[11px] text-text-tertiary">CLI {cliVersion}</span>}
        {/* 通道切换器:多通道时显示(原顶部导航行迁入,紧凑化);只切全局 activeChannel,不启停服务 */}
        {channels.length > 1 && (
          <span className="no-drag ml-1 flex items-center gap-1">
            <RadioTower size={12} className="shrink-0 text-text-tertiary" />
            <Select
              size="sm"
              className="h-7 w-[130px] px-2 text-[11.5px]"
              title="切换连接通道"
              value={activeChannel}
              options={channels.map((c) => ({
                value: c.id,
                label: c.label + (c.running ? '' : ' (未启动)')
              }))}
              onChange={(v) => void setActiveChannel(v)}
            />
          </span>
        )}
      </div>
      {/* Tauri 拖区在父级,这里阻止 mousedown 冒泡保证按钮可点 */}
      <div className="flex h-full items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
        {/* 操作图标:铺平额度条 / 统计 / 设置 / 主题切换(版本升级在 设置→常规,不占标题栏) */}
        <div className="mr-3 flex h-full items-center">
          <QuotaStrip />
        </div>
        <button
          className={`${ICON_BTN} ${view === 'stats' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => toggleView('stats')}
        >
          <BarChart3 size={16} />
          <Tip text="用量统计" />
        </button>
        <button
          className={`${ICON_BTN} ${view === 'settings' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => toggleView('settings')}
        >
          <Settings size={16} />
          <Tip text="设置" />
        </button>
        <button className={ICON_BTN} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <Tip text={theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'} />
        </button>

        <span className="mx-2 h-4 w-px shrink-0 bg-border" />

        {/* 窗口控制 */}
        <button
          className="no-drag group relative flex h-full w-11 items-center justify-center text-text-secondary hover:bg-surface-tertiary hover:text-text"
          onClick={() => window.kimiApi.windowControl('minimize')}
        >
          <Minus size={15} />
          <Tip text="最小化" align="right" />
        </button>
        <button
          className="no-drag group relative flex h-full w-11 items-center justify-center text-text-secondary hover:bg-surface-tertiary hover:text-text"
          onClick={() => window.kimiApi.windowControl('maximize')}
        >
          <Square size={13} />
          <Tip text="最大化 / 还原" align="right" />
        </button>
        <button
          className="no-drag group relative flex h-full w-11 items-center justify-center text-text-secondary hover:bg-danger hover:text-white"
          onClick={() => window.kimiApi.windowControl('close')}
        >
          <X size={16} />
          <Tip text="关闭" align="right" />
        </button>
      </div>
    </div>
  )
}
