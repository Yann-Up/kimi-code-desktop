import { ArrowDownToLine, BarChart3, Expand, Loader2, MessageSquare, Minus, Moon, RadioTower, Settings, Square, Sun, Terminal as TerminalIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import logoUrl from '../assets/logo.png'
import { useUi, resolveTheme, type ShellView } from '../stores/ui'
import { IS_MAC } from '../platform/os'
import { QuotaStrip } from './QuotaStrip'
import { UpdateDialog } from './UpdateDialog'
import { pushThemeToFrames } from './chatPrefsBridge'
import { Select } from './ui/Select'
import { useT } from '../i18n'

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
  const t = useT()
  const [cliVersion, setCliVersion] = useState<string>('')
  const activeChannel = useUi((s) => s.activeChannel)
  const channels = useUi((s) => s.channels)
  const setActiveChannel = useUi((s) => s.setActiveChannel)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  // 应用更新:启动静默自检/设置页检查写入 store;有新版本且未被忽略时标题栏按钮出红点
  const appUpdate = useUi((s) => s.appUpdate)
  const appUpdateIgnored = useUi((s) => s.appUpdateIgnored)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  // 手动检查的瞬时反馈(已是最新/检查失败),2.5s 自动消失
  const [updateFeedback, setUpdateFeedback] = useState<string | null>(null)
  const updateVisible = appUpdate !== null && appUpdate.version !== appUpdateIgnored

  // 挂载时静默检查一次(store 为空才查;release 由 Rust 启动自检兜底,dev 下这是唯一自动检查途径)
  useEffect(() => {
    if (useUi.getState().appUpdate) return
    window.kimiApi
      .appUpdateCheck()
      .then((r) => r && useUi.getState().setAppUpdate(r))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!updateFeedback) return
    const timer = setTimeout(() => setUpdateFeedback(null), 2500)
    return () => clearTimeout(timer)
  }, [updateFeedback])

  /** 点击更新按钮 = 每次都重新拉取最新结果(不读 store 缓存,否则发新版后仍显示旧版);
   *  查到新版写 store(出红点)并开弹窗;命中的版本被用户忽略过则提示已忽略,无更新提示已是最新 */
  const clickUpdate = () => {
    if (updateChecking) return
    setUpdateChecking(true)
    setUpdateFeedback(null)
    window.kimiApi
      .appUpdateCheck()
      .then((r) => {
        if (r) {
          useUi.getState().setAppUpdate(r)
          if (r.version !== useUi.getState().appUpdateIgnored) setUpdateOpen(true)
          else setUpdateFeedback(t('titlebar.updateIgnored', { version: r.version }))
        } else {
          setUpdateFeedback(t('titlebar.upToDate'))
        }
      })
      .catch((e) => setUpdateFeedback(e instanceof Error ? e.message : String(e)))
      .finally(() => setUpdateChecking(false))
  }

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

  /** 主题切换:按当前实际明暗翻转成显式 light/dark(持久化 + data-theme)并反推所有对话
   *  iframe(官方无刷新跟随;system 态下点按 = 钉到当前系统明暗的反态) */
  const effective = resolveTheme(theme)
  // macOS 自绘交通灯失焦置灰(原生标志性行为:窗口切后台三灯变灰)
  const [winFocused, setWinFocused] = useState(true)
  useEffect(() => {
    if (!IS_MAC) return
    return window.kimiApi.onWindowFocusChanged(setWinFocused)
  }, [])
  // 失焦灰:亮暗主题不同色(对齐原生;主题无关固定色,非令牌)
  const lightUnfocused = effective === 'dark' ? 'bg-[#55565a]' : 'bg-[#d6d6d6]'
  const toggleTheme = () => {
    const next = effective === 'dark' ? 'light' : 'dark'
    setTheme(next)
    pushThemeToFrames(next)
  }

  return (
    <div
      data-tauri-drag-region
      className={`drag-region flex h-12 shrink-0 items-center justify-between border-b border-border-light bg-surface ${
        // macOS 自绘交通灯在栏内左侧(decorations=false,lib.rs),12px 左边距对齐原生灯位
        IS_MAC ? 'pl-3' : 'pl-4'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* macOS 自绘交通灯:关闭/最小化/全屏(绿灯对齐原生=进出全屏,非最大化)。
            三色固定、不随主题变(原生灯暗色下同样三色);glyph 灯组 hover 同显(对齐原生) */}
        {IS_MAC && (
          <div className="no-drag group/lights mr-1 flex shrink-0 items-center gap-2">
            <button
              className={`flex h-3 w-3 items-center justify-center rounded-full transition-colors ${winFocused ? 'bg-[#ff5f57]' : lightUnfocused}`}
              onClick={() => window.kimiApi.windowControl('close')}
            >
              <X size={8} strokeWidth={2.5} className="text-black/60 opacity-0 transition-opacity group-hover/lights:opacity-100" />
            </button>
            <button
              className={`flex h-3 w-3 items-center justify-center rounded-full transition-colors ${winFocused ? 'bg-[#febc2e]' : lightUnfocused}`}
              onClick={() => window.kimiApi.windowControl('minimize')}
            >
              <Minus size={8} strokeWidth={2.5} className="text-black/60 opacity-0 transition-opacity group-hover/lights:opacity-100" />
            </button>
            <button
              className={`flex h-3 w-3 items-center justify-center rounded-full transition-colors ${winFocused ? 'bg-[#28c840]' : lightUnfocused}`}
              onClick={() => window.kimiApi.windowControl('fullscreen')}
            >
              <Expand size={7} strokeWidth={2.5} className="text-black/60 opacity-0 transition-opacity group-hover/lights:opacity-100" />
            </button>
          </div>
        )}
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
              title={t('titlebar.switchChannel')}
              value={activeChannel}
              options={channels.map((c) => ({
                value: c.id,
                label: c.label + (c.running ? '' : t('titlebar.notRunningSuffix'))
              }))}
              onChange={(v) => void setActiveChannel(v)}
            />
          </span>
        )}
      </div>
      {/* Tauri 拖区在父级,这里阻止 mousedown 冒泡保证按钮可点 */}
      <div className="flex h-full items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
        {/* 操作图标:铺平额度条 / 对话 / 统计 / 设置 / 检查更新(常驻,有新版出红点) / 主题切换(版本升级同时保留在 设置→常规) */}
        <div className="mr-3 flex h-full items-center">
          <QuotaStrip />
        </div>
        <button
          className={`${ICON_BTN} ${view === 'chat' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => setView('chat')}
        >
          <MessageSquare size={16} />
          <Tip text={t('titlebar.navChat')} />
        </button>
        <button
          className={`${ICON_BTN} ${view === 'terminal' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => toggleView('terminal')}
        >
          <TerminalIcon size={16} />
          <Tip text={t('titlebar.navTerminal')} />
        </button>
        <button
          className={`${ICON_BTN} ${view === 'stats' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => toggleView('stats')}
        >
          <BarChart3 size={16} />
          <Tip text={t('titlebar.navStats')} />
        </button>
        {/* 应用更新:常驻按钮,点击=实时重新检查(不读缓存);有新版本且未忽略时出红点,查到新版直接开「发现新版本」弹窗 */}
        <button className={ICON_BTN} onClick={clickUpdate}>
          {updateChecking ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ArrowDownToLine size={16} />
          )}
          {updateVisible && !updateChecking && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />
          )}
          <Tip text={appUpdate ? t('titlebar.newVersionFound', { version: appUpdate.version }) : t('titlebar.checkUpdate')} />
          {/* 手动检查结果反馈:复用 Tip 的黑底胶囊样式,常显 2.5s */}
          {updateFeedback && (
            <span className="pointer-events-none absolute top-full z-[600] mt-1 whitespace-nowrap rounded-md bg-[#1f1f1f] px-2 py-1 text-[11px] font-normal text-white shadow-lg">
              {updateFeedback}
            </span>
          )}
        </button>
        <button className={ICON_BTN} onClick={toggleTheme}>
          {effective === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <Tip text={effective === 'dark' ? t('titlebar.themeToLight') : t('titlebar.themeToDark')} />
        </button>
        {/* 设置:图标导航最右(其后仅余 Windows 自绘窗口控制按钮) */}
        <button
          className={`${ICON_BTN} ${view === 'settings' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => toggleView('settings')}
        >
          <Settings size={16} />
          <Tip text={t('titlebar.navSettings')} />
        </button>

        {/* 窗口控制:仅 Windows 在右侧自绘(最小化/最大化/关闭);
            macOS 的自绘交通灯在栏内左侧,此处不再重复 */}
        {!IS_MAC && (
          <>
            <span className="mx-2 h-4 w-px shrink-0 bg-border" />
            <button
              className="no-drag group relative flex h-full w-11 items-center justify-center text-text-secondary hover:bg-surface-tertiary hover:text-text"
              onClick={() => window.kimiApi.windowControl('minimize')}
            >
              <Minus size={15} />
              <Tip text={t('titlebar.minimize')} align="right" />
            </button>
            <button
              className="no-drag group relative flex h-full w-11 items-center justify-center text-text-secondary hover:bg-surface-tertiary hover:text-text"
              onClick={() => window.kimiApi.windowControl('maximize')}
            >
              <Square size={13} />
              <Tip text={t('titlebar.maximizeRestore')} align="right" />
            </button>
            <button
              className="no-drag group relative flex h-full w-11 items-center justify-center text-text-secondary hover:bg-danger hover:text-white"
              onClick={() => window.kimiApi.windowControl('close')}
            >
              <X size={16} />
              <Tip text={t('titlebar.close')} align="right" />
            </button>
          </>
        )}
      </div>
      {updateOpen && appUpdate && (
        <UpdateDialog info={appUpdate} onClose={() => setUpdateOpen(false)} />
      )}
    </div>
  )
}
