/**
 * platform/tauri: Tauri 壳下的 window.kimiApi 实现(契约见 ./kimi-api)。
 * 由 main.tsx 在渲染层启动时安装。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { KimiApi, ServerReadyInfo, TurnEndedInfo } from './kimi-api'

type Unsubscribe = () => void

/** listen() 是异步的,包成同步返回的取消函数 */
function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const pending: Promise<UnlistenFn> = listen<T>(channel, (e) => cb(e.payload))
  return () => {
    void pending.then((un) => un())
  }
}

/** query 值统一转字符串,跳过 undefined/null/空串 */
function sanitizeQuery(
  query?: Record<string, string | number | boolean | undefined>
): Record<string, string> | undefined {
  if (!query) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v)
  }
  return Object.keys(out).length ? out : undefined
}

const api: KimiApi = {
  // app
  appInfo: () => invoke('app_info'),
  windowControl: async (action) => {
    const win = getCurrentWindow()
    if (action === 'minimize') await win.minimize()
    else if (action === 'close') await win.close()
    else if (await win.isMaximized()) await win.unmaximize()
    else await win.maximize()
  },
  cliUpgrade: () => invoke('cli_upgrade'),
  openLogs: () => invoke('app_open_logs'),
  kimiHomeGet: () => invoke('get_kimi_home'),
  kimiHomeSet: (path) => invoke('set_kimi_home', { path }),
  kimiCliGet: () => invoke('get_cli_bin'),
  kimiCliSet: (path) => invoke('set_cli_bin', { path }),
  remoteBinSet: (path) => invoke('set_remote_bin', { path }),
  cliNpmUpgrade: () => invoke('cli_npm_upgrade'),
  cliCheckUpdate: () => invoke('cli_check_update'),
  connectionTargetGet: () => invoke('get_connection_target'),
  connectionTargetSet: (cfg, password) => invoke('set_connection_target', { cfg, password }),
  connectionTargetTest: (cfg, password) => invoke('test_connection_target', { cfg, password }),
  setupStateGet: () => invoke('get_setup_state'),
  setupStateReset: () => invoke('reset_setup'),
  startBackend: () => invoke('start_backend'),
  stopBackend: () => invoke('stop_backend'),
  onServerStopped: (cb) => on('server:stopped', cb),
  onServerExited: (cb) => on('server:exited', (p: { detail: string }) => cb(p?.detail ?? '')),
  onCliInstalling: (cb) => on('cli:installing', cb),
  onCliUpdateAvailable: (cb) => on('cli:update-available', cb),
  onCliUpgraded: (cb) => on('cli:upgraded', cb),
  onServerReady: (cb) => on<ServerReadyInfo>('server:ready', cb),
  onServerError: (cb) => on('server:error', cb),
  onCloseRequested: (cb) => on('app:close-requested', cb),
  confirmClose: () => invoke('confirm_close'),

  // web ui
  webUiUrl: () => invoke<string>('web_ui_url'),
  onTurnEnded: (cb) => on<TurnEndedInfo>('session:turn-ended', cb),

  // rest
  rest: (opts) =>
    invoke('rest_request', {
      method: opts.method,
      path: opts.path,
      body: opts.body,
      query: sanitizeQuery(opts.query)
    }),

  // local
  localSkills: () => invoke('local_skills'),
  localAgents: () => invoke('local_agents'),
  localCron: () => invoke('local_cron'),
  localMcpRead: () => invoke('local_mcp_read'),
  localMcpWrite: (data) => invoke('local_mcp_write', { data }),
  cliConfigRead: () => invoke<string | null>('local_cli_config_read'),
  cliConfigWrite: (content) => invoke<string>('local_cli_config_write', { content }),
  localUsageDaily: (days) => invoke('local_usage_daily', { days }),
  localUsageToday: () => invoke('local_usage_today'),
  localDrives: () => invoke('local_drives')
}

/** 安装到 window.kimiApi */
export function install(): void {
  window.kimiApi = api
}
