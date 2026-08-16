/**
 * kimi-api: 渲染层与桌面壳(Tauri)之间的 API 契约。
 * 由 platform/tauri.ts 实现并通过 install() 安装到 window.kimiApi,
 * 渲染层其余代码只依赖本文件的类型,不感知壳的实现细节。
 */

export interface RestRequestOptions {
  method?: string
  path: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
}

type Unsubscribe = () => void

/** 连接目标配置(与 Rust 侧 ConnectionConfig 对应,serde camelCase) */
export interface ConnectionTargetConfig {
  target: 'local' | 'wsl' | 'ssh'
  wslDistro?: string | null
  sshHost?: string | null
  /** SSH 用户名;优先级高于 sshHost 内嵌的 user@ */
  sshUser?: string | null
  sshPort?: number | null
  /** SSH 私钥路径(sshAuth = 'key' 时使用) */
  sshIdentity?: string | null
  /** SSH 认证方式:密码 / 私钥 */
  sshAuth?: 'password' | 'key' | null
  /** 自定义远端 CLI 绝对路径(仅 WSL/SSH 生效,null = 自动探测) */
  remoteBin?: string | null
}

/** 连接目标当前状态(配置 + 展示名 + 密码是否已存 keyring) */
export interface ConnectionTargetInfo {
  config: ConnectionTargetConfig
  describe: string
  hasPassword: boolean
}

/** set_connection_target 的返回:在 ConnectionTargetInfo 基础上带密码落盘结果 */
export interface ConnectionTargetSetResult extends ConnectionTargetInfo {
  /** keyring 保存失败时为 false(本次仅内存生效,重启后需重输) */
  passwordSaved: boolean
}

/** 首次启动引导状态(setupDone=false 时进入向导) */
export interface SetupState {
  setupDone: boolean
}

/** test_connection_target 的返回:目标上探测到的 CLI 版本与目标展示名 */
export interface ConnectionTestResult {
  version: string
  describe: string
}

/** 连接通道:多通道并存时每条 WSL/SSH 连接各占一条("local" 恒在,不可删) */
export interface ChannelInfo {
  id: string
  label: string
  /** 该通道连接目标类型(本机 / WSL / SSH),用于类型徽标 */
  target: ConnectionTargetConfig['target']
  /** 该通道后端服务是否运行中 */
  running: boolean
}

/** get_channels 返回:通道列表 + 当前激活通道 */
export interface ChannelsState {
  channels: ChannelInfo[]
  active: string
}

/** server:ready 事件载荷:cliVersion/port/meta 之外新增 token(拼 iframe src 用)与 channel */
export interface ServerReadyInfo {
  channel: string
  cliVersion: string
  port: number
  meta: unknown
  token: string
}

/** server:stopped 事件载荷 */
export interface ServerStoppedInfo {
  channel: string
}

/** server:exited 事件载荷 */
export interface ServerExitedInfo {
  channel: string
  detail: string
}

/** server:error 事件载荷 */
export interface ServerErrorInfo {
  channel: string
  error: string
}

/** session:turn-ended 事件载荷 */
export interface TurnEndedInfo {
  session_id: string
}

export interface KimiApi {
  // app
  /** 应用与指定通道(缺省=激活通道)服务信息;channel 省略时后端按激活通道解析 */
  appInfo(channel?: string): Promise<any>
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  cliUpgrade(): Promise<any>
  openLogs(): Promise<any>
  kimiHomeGet(): Promise<any>
  kimiHomeSet(path: string | null): Promise<any>
  kimiCliGet(): Promise<any>
  kimiCliSet(path: string | null): Promise<any>
  /** 指定/清除远端 CLI 路径(仅 WSL/SSH 激活通道;null 恢复自动探测) */
  remoteBinSet(path: string | null): Promise<any>
  cliNpmUpgrade(): Promise<any>
  /** 手动检查 CLI 更新:返回当前/最新版本与是否有更新;网络失败时 reject */
  cliCheckUpdate(): Promise<{ current: string | null; latest: string; hasUpdate: boolean }>
  connectionTargetGet(): Promise<ConnectionTargetInfo>
  connectionTargetSet(
    cfg: ConnectionTargetConfig,
    password?: string
  ): Promise<ConnectionTargetSetResult>
  /** 测试连接目标连通性(不持久化);失败 reject 错误文案 */
  connectionTargetTest(cfg: ConnectionTargetConfig, password?: string): Promise<ConnectionTestResult>
  /** 首次启动引导状态 */
  setupStateGet(): Promise<SetupState>
  /** 复位向导标记(重新运行初始向导入口) */
  setupStateReset(): Promise<void>
  /** 通道列表 + 当前激活通道(顶部切换器 / 设置→通道页用) */
  getChannels(): Promise<ChannelsState>
  /** 切换激活通道:只写配置,不启停任何服务 */
  setActiveChannel(id: string): Promise<void>
  /** 添加通道:只追加不切换激活;id 由后端按目标自动生成,label 省略时按目标展示名 */
  addChannel(cfg: ConnectionTargetConfig, label?: string, password?: string): Promise<ChannelInfo>
  /** 删除通道:服务在跑先停;删除激活通道时 active 回落 "local";local 不可删 */
  removeChannel(id: string): Promise<void>
  /** 启动指定通道(缺省=激活通道)后端 */
  startBackend(channel?: string): Promise<any>
  /** 停止指定通道(缺省=激活通道)后端 */
  stopBackend(channel?: string): Promise<any>
  onServerStopped(cb: (info: ServerStoppedInfo) => void): Unsubscribe
  /** kimi web 意外退出(非用户主动停止)时触发,前端应提示并允许重新启动 */
  onServerExited(cb: (info: ServerExitedInfo) => void): Unsubscribe
  onCliInstalling(cb: () => void): Unsubscribe
  onCliUpdateAvailable(cb: (info: { current: string; latest: string }) => void): Unsubscribe
  onCliUpgraded(cb: (info: { version: string | null; restartOk: boolean }) => void): Unsubscribe
  onServerReady(cb: (info: ServerReadyInfo) => void): Unsubscribe
  onServerError(cb: (info: ServerErrorInfo) => void): Unsubscribe
  /** 后端运行中用户请求关窗(标题栏/Alt+F4 等)时触发,前端应弹退出确认框 */
  onCloseRequested(cb: () => void): Unsubscribe
  /** 确认退出:真正关闭应用(后端会被优雅关停) */
  confirmClose(): Promise<any>

  // web ui(官方 web 界面 iframe 内嵌)
  /** 官方 web UI 地址(http://127.0.0.1:<port>/#token=<token>);指定通道(缺省=激活)未运行时 reject */
  webUiUrl(channel?: string): Promise<string>
  /** 会话轮次结束(turn.ended)通知,供额度条等自动刷新 */
  onTurnEnded(cb: (info: TurnEndedInfo) => void): Unsubscribe

  // rest
  /** 指定通道(缺省=激活通道)的 REST 代理 */
  rest(opts: RestRequestOptions, channel?: string): Promise<any>

  // local
  localSkills(channel?: string): Promise<any>
  localAgents(channel?: string): Promise<any>
  localCron(channel?: string): Promise<any>
  localMcpRead(channel?: string): Promise<any>
  localMcpWrite(data: Record<string, unknown>, channel?: string): Promise<any>
  /** 读 <kimi_home>/config.toml 原文(经目标通道,本机/WSL/SSH 通用);文件不存在返回 null */
  cliConfigRead(channel?: string): Promise<string | null>
  /** 写 <kimi_home>/config.toml 原文(自动备份 .kimi-desktop-bak,原子写);返回备份路径 */
  cliConfigWrite(content: string, channel?: string): Promise<string>
  /** 合并写 config.toml:JSON patch 深合并进现有文件(保留注释,自动备份);不依赖服务运行,用于 REST 不支持的段(如 identity) */
  cliConfigMerge(patch: Record<string, unknown>, channel?: string): Promise<string>
  /** 读 config.toml 并解析为 JSON(键为 snake_case 原样);文件不存在返回 null;不依赖服务运行 */
  cliConfigParsed(channel?: string): Promise<Record<string, unknown> | null>
  localUsageDaily(days: number, channel?: string): Promise<any>
  localUsageToday(channel?: string): Promise<any>
  localDrives(): Promise<any>
}

declare global {
  interface Window {
    kimiApi: KimiApi
  }
}
