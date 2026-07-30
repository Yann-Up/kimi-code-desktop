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

export interface KimiApi {
  // app
  appInfo(): Promise<any>
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  notify(title: string, body: string): Promise<any>
  isFocused(): Promise<boolean>
  cliUpgrade(): Promise<any>
  openLogs(): Promise<any>
  /** 在系统默认浏览器打开外部链接(webview 内禁止直接导航) */
  openExternal(target: string): Promise<void>
  kimiHomeGet(): Promise<any>
  kimiHomeSet(path: string | null): Promise<any>
  kimiCliGet(): Promise<any>
  kimiCliSet(path: string | null): Promise<any>
  /** 指定/清除远端 CLI 路径(仅 WSL/SSH 目标;null 恢复自动探测) */
  remoteBinSet(path: string | null): Promise<any>
  cliNpmUpgrade(): Promise<any>
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
  startBackend(): Promise<any>
  stopBackend(): Promise<any>
  getAutoStart(): Promise<any>
  setAutoStart(enabled: boolean): Promise<any>
  onServerStopped(cb: () => void): Unsubscribe
  /** kimi web 意外退出(非用户主动停止)时触发,前端应提示并允许重新启动 */
  onServerExited(cb: (detail: string) => void): Unsubscribe
  onCliInstalling(cb: () => void): Unsubscribe
  onCliUpdateAvailable(cb: (info: { current: string; latest: string }) => void): Unsubscribe
  onCliUpgraded(cb: (info: { version: string | null; restartOk: boolean }) => void): Unsubscribe
  onServerReady(cb: (info: { cliVersion: string; port: number; meta: unknown }) => void): Unsubscribe
  onServerError(cb: (msg: string) => void): Unsubscribe
  /** 后端运行中用户请求关窗(标题栏/Alt+F4 等)时触发,前端应弹退出确认框 */
  onCloseRequested(cb: () => void): Unsubscribe
  /** 确认退出:真正关闭应用(后端会被优雅关停) */
  confirmClose(): Promise<any>

  // rest
  rest(opts: RestRequestOptions): Promise<any>
  upload(args: { bytes: ArrayBuffer; name: string; mediaType: string }): Promise<any>
  getFile(fileId: string): Promise<ArrayBuffer>
  /** 从自定义提供商端点拉取模型列表(GET {baseUrl}/models,OpenAI 风格) */
  fetchProviderModels(args: {
    baseUrl: string
    apiKey?: string
    headers?: Record<string, string>
  }): Promise<string[]>

  // ws
  wsSubscribe(sessionId: string): Promise<any>
  wsUnsubscribe(sessionId: string): Promise<any>
  onSessionEvent(cb: (evt: unknown) => void): Unsubscribe
  onResync(cb: (info: { session_id: string; reason: string }) => void): Unsubscribe
  onWsState(cb: (state: 'connecting' | 'open' | 'closed') => void): Unsubscribe

  // git
  gitStatus(cwd: string): Promise<any>
  gitLog(cwd: string, limit?: number): Promise<any>
  gitDiff(cwd: string, path: string, staged: boolean): Promise<any>

  // local
  localPlugins(): Promise<any>
  localSkills(): Promise<any>
  localAgents(): Promise<any>
  localCron(): Promise<any>
  localUsage(): Promise<any>
  localMcpRead(): Promise<any>
  localMcpWrite(data: Record<string, unknown>): Promise<any>
  localUsageDaily(days: number): Promise<any>
  localUsageToday(): Promise<any>
  localDrives(): Promise<any>
}

declare global {
  interface Window {
    kimiApi: KimiApi
  }
}
