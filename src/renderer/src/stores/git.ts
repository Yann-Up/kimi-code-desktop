import { create } from 'zustand'

/** Git/代码预览 面板 UI 状态:开关 + 刷新信号 */
interface GitUiState {
  /** 'none' | 'git' | 'code' */
  panel: 'none' | 'git' | 'code'
  refreshTick: number
  toggle: (p: 'git' | 'code') => void
  close: () => void
  /** 触发面板重新拉取(turn.ended 等时机调用) */
  bump: () => void
}

export const useGitUi = create<GitUiState>((set) => ({
  panel: 'none',
  refreshTick: 0,
  toggle: (p) => set((s) => ({ panel: s.panel === p ? 'none' : p })),
  close: () => set({ panel: 'none' }),
  bump: () => set((s) => ({ refreshTick: s.refreshTick + 1 }))
}))
