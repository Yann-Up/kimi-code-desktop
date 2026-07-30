import { create } from 'zustand'
import type { ConnectionTargetConfig } from '../platform/kimi-api'

interface UiState {
  view: 'chat' | 'settings' | 'home'
  settingsSection: string
  sidebarCollapsed: boolean
  /** 连接目标(App 启动时由 connectionTargetGet 填充;非 local 时隐藏读本机的功能入口) */
  connectionTarget: ConnectionTargetConfig['target']
  /** 重进入向导的覆盖层开关(设置页"重新运行初始向导"触发) */
  onboardingOpen: boolean
  /** 全窗口拖拽待交接的文件(由 Composer 消费) */
  droppedFiles: File[]
  /** 空屏发射台的待发送草稿(由 Composer 挂载时消费一次) */
  draftPrompt: string | null
  /** 额度条自动刷新间隔(秒,0=关闭;持久化 localStorage,默认 60) */
  quotaRefreshSecs: number
  openSettings: (section?: string) => void
  closeSettings: () => void
  setSettingsSection: (s: string) => void
  /** 返回首页(统计仪表盘,服务保持运行) */
  openHome: () => void
  toggleSidebar: () => void
  setDroppedFiles: (files: File[]) => void
  setDraftPrompt: (p: string | null) => void
  setQuotaRefreshSecs: (secs: number) => void
  setConnectionTarget: (t: ConnectionTargetConfig['target']) => void
  openOnboarding: () => void
  closeOnboarding: () => void
}

export const useUi = create<UiState>((set) => ({
  view: 'chat',
  settingsSection: 'general',
  sidebarCollapsed: false,
  connectionTarget: 'local',
  onboardingOpen: false,
  droppedFiles: [],
  draftPrompt: null,
  quotaRefreshSecs: (() => {
    const raw = localStorage.getItem('kimi.quotaRefreshSecs')
    if (raw === null) return 60 // 未设置过:默认 60s
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 && n <= 3600 ? n : 60
  })(),
  openSettings: (section) =>
    set((s) => ({ view: 'settings', settingsSection: section ?? s.settingsSection })),
  closeSettings: () => set({ view: 'chat' }),
  setSettingsSection: (s2) => set({ settingsSection: s2 }),
  openHome: () => set({ view: 'home' }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setDroppedFiles: (files) => set({ droppedFiles: files }),
  setDraftPrompt: (p) => set({ draftPrompt: p }),
  setQuotaRefreshSecs: (secs) => {
    localStorage.setItem('kimi.quotaRefreshSecs', String(secs))
    set({ quotaRefreshSecs: secs })
  },
  setConnectionTarget: (t) => set({ connectionTarget: t }),
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false })
}))
