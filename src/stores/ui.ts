import { create } from 'zustand'
import type {
  AppUpdateInfo,
  AppUpdateProgress,
  ChannelInfo,
  ConnectionTargetConfig
} from '../platform/kimi-api'

/** 壳内视图:顶部导航的三个 tab(对话 / 统计 / 设置) */
export type ShellView = 'chat' | 'stats' | 'settings'

/** 壳主题:跟随官方 web UI(chatPrefsBridge 上报);持久化 localStorage kimi.theme。
 *  system=跟随系统(与官方三态对齐;经 matchMedia 解析成实际明暗落地 data-theme) */
export type ShellTheme = 'light' | 'dark' | 'system'
/** 壳语言:跟随官方 web UI(kimi-locale);持久化 localStorage kimi.locale */
export type ShellLocale = 'zh' | 'en'

/** 解析实际明暗:system 经 matchMedia;解析失败回退 light */
export function resolveTheme(theme: ShellTheme): 'light' | 'dark' {
  if (theme === 'system') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  }
  return theme
}

/** data-theme 应用:亮态不设属性(默认令牌),暗态置 dark(theme.css 按属性覆盖) */
function applyThemeAttr(theme: ShellTheme) {
  if (resolveTheme(theme) === 'dark') document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
}

function loadTheme(): ShellTheme {
  const raw = localStorage.getItem('kimi.theme')
  return raw === 'dark' || raw === 'system' ? raw : 'light'
}

function loadLocale(): ShellLocale {
  return localStorage.getItem('kimi.locale') === 'en' ? 'en' : 'zh'
}

/** 向导打开模式:switch = 切换激活通道目标(原行为);add = 添加通道(仅追加不切换) */
export type OnboardingMode = 'switch' | 'add'

interface UiState {
  view: ShellView
  settingsSection: string
  /** 当前激活通道的连接目标(App 挂载与切换通道时由 channels 派生;非 local 时隐藏读本机的功能入口) */
  connectionTarget: ConnectionTargetConfig['target']
  /** 全部通道列表(含 local);只有本机通道时 length===1,顶部切换器不显示 */
  channels: ChannelInfo[]
  /** 当前激活通道 id(默认 "local") */
  activeChannel: string
  /** 重进入向导的覆盖层开关(设置页"重新运行初始向导"/占位页目标选择触发) */
  onboardingOpen: boolean
  /** 向导模式:add 时完成走 add_channel 而非切换目标 */
  onboardingMode: OnboardingMode
  /** 打开向导时预选的目标(占位页点 WSL/SSH 时带入),null=从选择步骤开始 */
  onboardingTarget: ConnectionTargetConfig['target'] | null
  /** 桌宠悬浮菜单(M5 P3)请求主窗对话 iframe 跳转的会话 id;WebFrame 消费后清空 */
  pendingSessionFocus: string | null
  /** 额度条自动刷新间隔(秒,0=关闭;持久化 localStorage,默认 60) */
  quotaRefreshSecs: number
  /** 设置页字体缩放(百分比,100=标准;持久化 localStorage,经 CSS zoom 生效) */
  settingsZoom: number
  /** 壳主题(chatPrefsBridge 随官方 UI 上报写入;持久化 kimi.theme) */
  theme: ShellTheme
  /** 壳语言(chatPrefsBridge 随官方 UI 上报写入;持久化 kimi.locale) */
  locale: ShellLocale
  /** 对话 iframe 桥接健康(chatPrefsBridge 自检上报;null=未收到/服务未启动) */
  bridgeHealth: { ok: boolean; reason?: string; detail?: string } | null
  /** 应用自身更新信息(启动静默自检/设置页手动检查写入;null=无更新或未检查) */
  appUpdate: AppUpdateInfo | null
  /** 应用更新下载中标记(全局:设置页切走再回来不丢失,也用于禁用重复触发) */
  appInstalling: boolean
  /** 应用更新下载进度(app:update-progress 事件写入,ShellHome 常驻监听) */
  appProgress: AppUpdateProgress | null
  /** 「忽略此版本」的应用版本号(持久化 kimi.appUpdateIgnored;该版本不再在标题栏出红点) */
  appUpdateIgnored: string | null
  /** 切换顶部导航 tab */
  setView: (v: ShellView) => void
  openSettings: (section?: string) => void
  closeSettings: () => void
  setSettingsSection: (s: string) => void
  setQuotaRefreshSecs: (secs: number) => void
  setSettingsZoom: (pct: number) => void
  setTheme: (t: ShellTheme) => void
  setLocale: (l: ShellLocale) => void
  setBridgeHealth: (h: UiState['bridgeHealth']) => void
  setAppUpdate: (info: AppUpdateInfo | null) => void
  setAppInstalling: (v: boolean) => void
  setAppProgress: (p: AppUpdateProgress | null) => void
  ignoreAppUpdate: (version: string) => void
  setConnectionTarget: (t: ConnectionTargetConfig['target']) => void
  /** 填充通道列表与激活通道;connectionTarget 随之派生 */
  setChannels: (channels: ChannelInfo[], active: string) => void
  /** 切换激活通道:调 set_active_channel 命令并更新 store(失败保持原状) */
  setActiveChannel: (id: string) => Promise<void>
  /** 更新某通道运行状态(server:ready/stopped/exited 事件驱动) */
  setChannelRunning: (id: string, running: boolean) => void
  openOnboarding: (t?: ConnectionTargetConfig['target'], mode?: OnboardingMode) => void
  closeOnboarding: () => void
  setPendingSessionFocus: (id: string | null) => void
}

export const useUi = create<UiState>((set) => ({
  view: 'chat',
  settingsSection: 'general',
  connectionTarget: 'local',
  channels: [],
  activeChannel: 'local',
  onboardingOpen: false,
  onboardingMode: 'switch',
  onboardingTarget: null,
  pendingSessionFocus: null,
  appUpdate: null,
  appInstalling: false,
  appProgress: null,
  appUpdateIgnored: localStorage.getItem('kimi.appUpdateIgnored'),
  quotaRefreshSecs: (() => {
    const raw = localStorage.getItem('kimi.quotaRefreshSecs')
    if (raw === null) return 60 // 未设置过:默认 60s
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 && n <= 3600 ? n : 60
  })(),
  setView: (v) => set({ view: v }),
  openSettings: (section) =>
    set((s) => ({ view: 'settings', settingsSection: section ?? s.settingsSection })),
  closeSettings: () => set({ view: 'chat' }),
  setSettingsSection: (s2) => set({ settingsSection: s2 }),
  setQuotaRefreshSecs: (secs) => {
    localStorage.setItem('kimi.quotaRefreshSecs', String(secs))
    set({ quotaRefreshSecs: secs })
  },
  settingsZoom: (() => {
    const raw = localStorage.getItem('kimi.settingsZoom')
    if (raw === null) return 100
    const n = Number(raw)
    return Number.isFinite(n) && n >= 75 && n <= 200 ? n : 100
  })(),
  setSettingsZoom: (pct) => {
    localStorage.setItem('kimi.settingsZoom', String(pct))
    set({ settingsZoom: pct })
  },
  theme: loadTheme(),
  locale: loadLocale(),
  setTheme: (t) => {
    localStorage.setItem('kimi.theme', t)
    applyThemeAttr(t)
    set({ theme: t })
  },
  setLocale: (l) => {
    localStorage.setItem('kimi.locale', l)
    set({ locale: l })
  },
  bridgeHealth: null,
  setBridgeHealth: (h) => set({ bridgeHealth: h }),
  setAppUpdate: (info) => set({ appUpdate: info }),
  setAppInstalling: (v) => set({ appInstalling: v }),
  setAppProgress: (p) => set({ appProgress: p }),
  ignoreAppUpdate: (version) => {
    localStorage.setItem('kimi.appUpdateIgnored', version)
    set({ appUpdateIgnored: version })
  },
  setConnectionTarget: (t) => set({ connectionTarget: t }),
  setChannels: (channels, active) =>
    set((s) => ({
      channels,
      activeChannel: active,
      connectionTarget:
        channels.find((c) => c.id === active)?.target ?? s.connectionTarget ?? 'local'
    })),
  setActiveChannel: async (id) => {
    try {
      await window.kimiApi.setActiveChannel(id)
      set((s) => ({
        activeChannel: id,
        connectionTarget: s.channels.find((c) => c.id === id)?.target ?? 'local'
      }))
    } catch {
      /* 失败保持原状,不切换 */
    }
  },
  setChannelRunning: (id, running) =>
    set((s) => ({
      channels: s.channels.map((c) => (c.id === id ? { ...c, running } : c))
    })),
  openOnboarding: (t, mode) =>
    set({ onboardingOpen: true, onboardingTarget: t ?? null, onboardingMode: mode ?? 'switch' }),
  closeOnboarding: () => set({ onboardingOpen: false, onboardingTarget: null }),
  setPendingSessionFocus: (id) => set({ pendingSessionFocus: id })
}))

// 启动即按持久化值落地 data-theme(三种窗口共用本 store,同源共享 localStorage)
applyThemeAttr(useUi.getState().theme)

// system 态下跟随系统明暗切换(监听一次,仅当当前偏好为 system 时重落地)
try {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onSysChange = () => {
    if (useUi.getState().theme === 'system') applyThemeAttr('system')
  }
  if (mq.addEventListener) mq.addEventListener('change', onSysChange)
} catch {
  /* 静默 */
}

// 跨窗同步:桌宠/菜单窗与主窗同源,storage 事件只在「其他窗口」触发——
// 主窗 chatPrefsBridge 写入后,桌宠窗经这里跟随主题/语言
window.addEventListener('storage', (e) => {
  if (e.key === 'kimi.theme') {
    const t = loadTheme()
    applyThemeAttr(t)
    useUi.setState({ theme: t })
  } else if (e.key === 'kimi.locale') {
    useUi.setState({ locale: loadLocale() })
  }
})
