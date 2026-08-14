import { create } from 'zustand'
import type { ConnectionTargetConfig } from '../platform/kimi-api'

/** 壳内视图:顶部导航的三个 tab(对话 / 统计 / 设置) */
export type ShellView = 'chat' | 'stats' | 'settings'

interface UiState {
  view: ShellView
  settingsSection: string
  /** 连接目标(App 启动时由 connectionTargetGet 填充;非 local 时隐藏读本机的功能入口) */
  connectionTarget: ConnectionTargetConfig['target']
  /** 重进入向导的覆盖层开关(设置页"重新运行初始向导"触发) */
  onboardingOpen: boolean
  /** 额度条自动刷新间隔(秒,0=关闭;持久化 localStorage,默认 60) */
  quotaRefreshSecs: number
  /** 切换顶部导航 tab */
  setView: (v: ShellView) => void
  openSettings: (section?: string) => void
  closeSettings: () => void
  setSettingsSection: (s: string) => void
  setQuotaRefreshSecs: (secs: number) => void
  setConnectionTarget: (t: ConnectionTargetConfig['target']) => void
  openOnboarding: () => void
  closeOnboarding: () => void
}

export const useUi = create<UiState>((set) => ({
  view: 'chat',
  settingsSection: 'general',
  connectionTarget: 'local',
  onboardingOpen: false,
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
  setConnectionTarget: (t) => set({ connectionTarget: t }),
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false })
}))
