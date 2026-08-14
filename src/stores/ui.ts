import { create } from 'zustand'
import type { ChannelInfo, ConnectionTargetConfig } from '../platform/kimi-api'

/** 壳内视图:顶部导航的三个 tab(对话 / 统计 / 设置) */
export type ShellView = 'chat' | 'stats' | 'settings'

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
  /** 额度条自动刷新间隔(秒,0=关闭;持久化 localStorage,默认 60) */
  quotaRefreshSecs: number
  /** 切换顶部导航 tab */
  setView: (v: ShellView) => void
  openSettings: (section?: string) => void
  closeSettings: () => void
  setSettingsSection: (s: string) => void
  setQuotaRefreshSecs: (secs: number) => void
  setConnectionTarget: (t: ConnectionTargetConfig['target']) => void
  /** 填充通道列表与激活通道;connectionTarget 随之派生 */
  setChannels: (channels: ChannelInfo[], active: string) => void
  /** 切换激活通道:调 set_active_channel 命令并更新 store(失败保持原状) */
  setActiveChannel: (id: string) => Promise<void>
  /** 更新某通道运行状态(server:ready/stopped/exited 事件驱动) */
  setChannelRunning: (id: string, running: boolean) => void
  openOnboarding: (t?: ConnectionTargetConfig['target'], mode?: OnboardingMode) => void
  closeOnboarding: () => void
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
  closeOnboarding: () => set({ onboardingOpen: false, onboardingTarget: null })
}))
