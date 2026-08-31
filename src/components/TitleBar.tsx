import { ArrowDownToLine, BarChart3, Loader2, MessageSquare, Minus, Moon, RadioTower, Settings, Square, Sun, X } from 'lucide-react'
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

  /** 点击更新按钮 = 手动检查:已有结果直接开弹窗;查到新版写 store(出红点)并开弹窗 */
  const clickUpdate = () => {
    if (updateVisible) {
      setUpdateOpen(true)
      return
    }
    if (updateChecking) return
    setUpdateChecking(true)
    setUpdateFeedback(null)
    window.kimiApi
      .appUpdateCheck()
      .then((r) => {
        if (r) {
          useUi.getState().setAppUpdate(r)
          setUpdateOpen(true)
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
  const toggleTheme = () => {
    const next = effective === 'dark' ? 'light' : 'dark'
    setTheme(next)
    pushThemeToFrames(next)
  }

  return (
    <div
      data-tauri-drag-region
      className={`drag-region flex h-12 shrink-0 items-center justify-between border-b border-border-light bg-surface ${
        // macOS 用 Overlay 标题栏(lib.rs):左上悬浮原生红黄绿交通灯,左侧留出 ~80px 避让
        IS_MAC ? 'pl-[80px]' : 'pl-4'
      }`}
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
          className={`${ICON_BTN} ${view === 'stats' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => toggleView('stats')}
        >
          <BarChart3 size={16} />
          <Tip text={t('titlebar.navStats')} />
        </button>
        <button
          className={`${ICON_BTN} ${view === 'settings' ? 'bg-surface-tertiary text-text' : ''}`}
          onClick={() => toggleView('settings')}
        >
          <Settings size={16} />
          <Tip text={t('titlebar.navSettings')} />
        </button>
        {/* 应用更新:常驻按钮,点击=检查更新;有新版本且未忽略时出红点并直接开「发现新版本」弹窗 */}
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

        {/* 窗口控制:仅 Windows 自绘;macOS 用原生交通灯(Overlay 样式),隐藏自绘按钮 */}
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
