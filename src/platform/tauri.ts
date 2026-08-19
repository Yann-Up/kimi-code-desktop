/**
 * platform/tauri: Tauri 壳下的 window.kimiApi 实现(契约见 ./kimi-api)。
 * 由 main.tsx 在渲染层启动时安装。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type {
  ApiCallsResult,
  AppUpdateInfo,
  AppUpdateProgress,
  ChannelsState,
  KimiApi,
  PetConfig,
  PetInfo,
  PetMeta,
  PetState,
  ServerErrorInfo,
  ServerReadyInfo,
  SkinConfig,
  TurnEndedInfo,
  WebServerOptions
} from './kimi-api'

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
  appInfo: (channel) => invoke('app_info', { channel }),
  windowControl: async (action) => {
    const win = getCurrentWindow()
    // 最小化=普通任务栏最小化;进托盘由关窗确认框的"进入托盘"(hide_main_to_tray)承担
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
  cliUpdateSkip: (version) => invoke('cli_update_skip', { version }),
  cliCheckUpdate: () => invoke('cli_check_update'),
  appUpdateCheck: () => invoke<AppUpdateInfo | null>('app_update_check'),
  appUpdateInstall: () => invoke<void>('app_update_install'),
  onAppUpdateProgress: (cb) => on<AppUpdateProgress>('app:update-progress', cb),
  onAppUpdateAvailable: (cb) => on<AppUpdateInfo>('app:update-available', cb),
  connectionTargetGet: () => invoke('get_connection_target'),
  connectionTargetSet: (cfg, password) => invoke('set_connection_target', { cfg, password }),
  connectionTargetTest: (cfg, password) => invoke('test_connection_target', { cfg, password }),
  setupStateGet: () => invoke('get_setup_state'),
  setupStateReset: () => invoke('reset_setup'),
  getChannels: () => invoke<ChannelsState>('get_channels'),
  setActiveChannel: (id) => invoke('set_active_channel', { id }),
  addChannel: (cfg, label, password) => invoke('add_channel', { cfg, label, password }),
  removeChannel: (id) => invoke('remove_channel', { id }),
  startBackend: (channel) => invoke('start_backend', { channel }),
  stopBackend: (channel) => invoke('stop_backend', { channel }),
  onServerStopped: (cb) => on('server:stopped', cb),
  onServerExited: (cb) => on('server:exited', cb),
  onCliInstalling: (cb) => on('cli:installing', cb),
  onCliUpdateAvailable: (cb) => on('cli:update-available', cb),
  onCliUpgraded: (cb) => on('cli:upgraded', cb),
  onServerReady: (cb) => on<ServerReadyInfo>('server:ready', cb),
  onServerError: (cb) => on<ServerErrorInfo>('server:error', cb),
  onCloseRequested: (cb) => on<boolean>('app:close-requested', (p) => cb(!!p)),
  confirmClose: () => invoke('confirm_close'),
  hideToTray: () => invoke('hide_main_to_tray'),
  openExternal: (url) => invoke<void>('open_external', { url }),

  // web ui
  webUiUrl: (channel) => invoke<string>('web_ui_url', { channel }),
  onTurnEnded: (cb) => on<TurnEndedInfo>('session:turn-ended', cb),

  // rest
  rest: (opts, channel) =>
    invoke('rest_request', {
      method: opts.method,
      path: opts.path,
      body: opts.body,
      query: sanitizeQuery(opts.query),
      channel
    }),

  // local
  localSkills: (channel) => invoke('local_skills', { channel }),
  localAgents: (channel) => invoke('local_agents', { channel }),
  localMcpRead: (channel) => invoke('local_mcp_read', { channel }),
  localMcpWrite: (data, channel) => invoke('local_mcp_write', { data, channel }),
  cliConfigRead: (channel) => invoke<string | null>('local_cli_config_read', { channel }),
  cliConfigWrite: (content, channel) =>
    invoke<string>('local_cli_config_write', { content, channel }),
  cliConfigMerge: (patch, channel) =>
    invoke<string>('local_cli_config_merge', { patch, channel }),
  cliConfigParsed: (channel) =>
    invoke<Record<string, unknown> | null>('local_cli_config_parsed', { channel }),
  localUsageDaily: (days, channel) => invoke('local_usage_daily', { days, channel }),
  localUsageToday: (channel) => invoke('local_usage_today', { channel }),
  localApiCalls: (page, pageSize, channel) =>
    invoke<ApiCallsResult>('local_api_calls', { page, pageSize, channel }),
  experimentalGet: () => invoke<Record<string, boolean>>('experimental_get'),
  experimentalSet: (flags) => invoke('experimental_set', { flags }),
  webServerGet: () => invoke<WebServerOptions>('web_server_get'),
  webServerSet: (opts) => invoke<WebServerOptions>('web_server_set', { port: opts.port }),
  localDrives: () => invoke('local_drives'),

  // pet
  petConfigGet: () => invoke<PetConfig>('pet_config_get'),
  petSetEnabled: (enabled) => invoke('pet_set_enabled', { enabled }),
  onPetState: (cb) => on<PetState>('pet:state', cb),
  onPetTool: (cb) => on<{ kind: string }>('pet:tool', (p) => cb(p.kind)),
  onPetConfigChanged: (cb) => on<PetConfig>('pet:config-changed', cb),
  petList: () => invoke<PetInfo[]>('pet_list'),
  petActiveGet: () => invoke<PetMeta>('pet_active_get'),
  petSetActive: (slug) => invoke('pet_set_active', { slug }),

  // skin
  skinConfigGet: () => invoke<SkinConfig>('skin_config_get'),
  skinSetEnabled: (enabled) => invoke('skin_set_enabled', { enabled }),
  skinSetActive: (slug) => invoke('skin_set_active', { slug }),
  skinCustomList: () => invoke<string[]>('skin_custom_list'),
  skinDirOpen: () => invoke('skin_dir_open'),
  skinSetOpacity: (opacity) => invoke('skin_set_opacity', { opacity }),
  skinSetInChat: (enabled) => invoke('skin_set_in_chat', { enabled }),
  onSkinConfigChanged: (cb) => on<SkinConfig>('skin:config-changed', cb)
}

/** 安装到 window.kimiApi */
export function install(): void {
  window.kimiApi = api
}
