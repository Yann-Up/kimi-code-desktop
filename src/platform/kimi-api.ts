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

/** kimi web 启动参数(与 Rust 侧 WebOptions 对应;改动后运行中的服务会自动重启) */
export interface WebServerOptions {
  /** 首选端口(默认 58666;被占时顺延) */
  port: number
}

/** server:ready 事件载荷:cliVersion/port/meta 之外新增 token(拼 iframe src 用)与 channel */
export interface ServerReadyInfo {
  channel: string
  cliVersion: string
  port: number
  meta: unknown
  token: string
  /** 服务端下发了 frame-ancestors/X-Frame-Options(--host 0.0.0.0 会触发),iframe 将被浏览器拦截 */
  frameBlocked?: boolean
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

/** 应用自身更新信息(app_update_check 返回 / app:update-available 事件载荷) */
export interface AppUpdateInfo {
  version: string
  notes: string | null
}

/** 应用更新下载进度(app:update-progress 事件载荷;total 未知时为 null) */
export interface AppUpdateProgress {
  downloaded: number
  total: number | null
}

/** 桌宠配置(实验性功能;设计见 docs/desktop-pet-design.md) */
export interface PetConfig {
  enabled: boolean
  /** 当前激活宠物 slug(缺省 "kimi" 即内置) */
  slug: string
  /** 点击穿透:开启后悬浮窗忽略所有鼠标事件(只能到设置页关闭) */
  clickThrough: boolean
}

/** 界面皮肤配置(实验性):开启后主页/统计/设置页右侧显示内置立绘(SkinStandee) */
export interface SkinConfig {
  enabled: boolean
  /** 当前皮肤 slug(null = 回退注册表第一个;注册表见 components/skins.ts) */
  slug: string | null
  /** 卡片不透明度百分比(30-100,缺省 82;越低立绘透出越明显) */
  opacity: number
  /** 对话页内透出立绘(实验性,缺省关):经注入脚本显示在官方 web UI iframe 内右下 */
  inChat: boolean
}

/** 桌宠状态(pet:state 事件载荷;M2 起由 Rust 侧状态机驱动)。
 * running-left/running-right 仅前端拖拽时本地使用,Rust 不 emit */
export type PetState =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'jumping'
  | 'failed'
  | 'review'
  | 'running-left'
  | 'running-right'

/** 单个状态的动画参数(与 Rust 侧 PetAnim 对应,serde camelCase) */
export interface PetAnim {
  /** 精灵图内所在行(从 0 起) */
  row: number
  /** 该行帧数 */
  frames: number
  /** 播放帧率 */
  fps: number
  /** 是否循环播放(false 播完停末帧) */
  loop: boolean
}

/** 宠物完整元信息(与 Rust 侧 PetMeta 对应;states 以 idle/running/waiting/jumping/failed 为 key) */
export interface PetMeta {
  /** 唯一标识(内置为 "kimi",外部为目录名) */
  slug: string
  /** 展示名 */
  name: string
  /** 来源:builtin(内置)/ custom(应用数据目录 pets,导入落这里)/ kimi-code(~/.kimi-code/pets)/ petdex(~/.petdex/pets) */
  source: string
  /** 单帧宽度(px) */
  frameW: number
  /** 单帧高度(px) */
  frameH: number
  /** 各状态动画参数(key 为 PetState) */
  states: Record<string, PetAnim>
}

/** 宠物列表项(pet_list 返回;内置排第一) */
export interface PetInfo {
  slug: string
  name: string
  /** 来源:builtin / custom / kimi-code / petdex */
  source: string
}

/** 单次 API 调用明细(step.end 口径,serde camelCase;ttftMs/streamMs 缺字段时省略) */
export interface ApiCallItem {
  time: number // 毫秒时间戳
  model: string
  sessionId: string
  agentId: string
  workspace: string
  inputOther: number
  inputCacheRead: number
  inputCacheCreation: number
  output: number
  ttftMs?: number
  streamMs?: number
  finishReason?: string
}

/** API 调用全量汇总(不分页;平均 TTFT/TPS 只统计有耗时字段的调用) */
export interface ApiCallsSummary {
  totalCalls: number
  totalOutput: number
  avgTtftMs?: number
  /** 平均输出 TPS(不含首 token 时间) */
  avgTpsExclFirst?: number
  /** 平均输出 TPS(含首 token 时间) */
  avgTpsInclFirst?: number
}

/** local_api_calls 分页返回 */
export interface ApiCallsResult {
  total: number
  page: number
  pageSize: number
  items: ApiCallItem[]
  summary: ApiCallsSummary
}

export interface KimiApi {
  // app
  /** 应用与指定通道(缺省=激活通道)服务信息;channel 省略时后端按激活通道解析 */
  appInfo(channel?: string): Promise<any>
  /** 窗口控制:minimize 为最小化到托盘(任务栏不留按钮,托盘恢复) */
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  cliUpgrade(): Promise<any>
  openLogs(): Promise<any>
  kimiHomeGet(): Promise<any>
  kimiHomeSet(path: string | null): Promise<any>
  kimiCliGet(): Promise<any>
  kimiCliSet(path: string | null): Promise<any>
  /** 指定/清除远端 CLI 路径(仅 WSL/SSH 激活通道;null 恢复自动探测) */
  remoteBinSet(path: string | null): Promise<any>
  /** 更新弹窗"跳过此版本":持久化,启动查更新时该版本不再提示 */
  cliUpdateSkip(version: string): Promise<void>
  /** 手动检查 CLI 更新:返回当前/最新版本与是否有更新;网络失败时 reject */
  cliCheckUpdate(): Promise<{ current: string | null; latest: string; hasUpdate: boolean }>
  /** 手动检查应用自身更新(GitHub Releases);无更新返回 null,检查失败 reject */
  appUpdateCheck(): Promise<AppUpdateInfo | null>
  /** 下载并安装应用更新:进度经 onAppUpdateProgress 推送,完成后自动重启应用 */
  appUpdateInstall(): Promise<void>
  /** 应用更新下载进度(app:update-progress;total 未知时为 null) */
  onAppUpdateProgress(cb: (p: AppUpdateProgress) => void): Unsubscribe
  /** 启动静默自检发现新版本(app:update-available),供前端角标提示 */
  onAppUpdateAvailable(cb: (info: AppUpdateInfo) => void): Unsubscribe
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
  /** source: CLI 安装来源(home=官方脚本,其余按 npm 处理),用于区分升级通道 */
  onCliUpdateAvailable(cb: (info: { current: string; latest: string; source: string }) => void): Unsubscribe
  onCliUpgraded(cb: (info: { version: string | null; restartOk: boolean }) => void): Unsubscribe
  onServerReady(cb: (info: ServerReadyInfo) => void): Unsubscribe
  onServerError(cb: (info: ServerErrorInfo) => void): Unsubscribe
  /** 用户请求关窗(标题栏 X/Alt+F4 等)时触发,前端应弹"是否关闭进程"确认框;参数=是否有后端在跑 */
  onCloseRequested(cb: (backendRunning: boolean) => void): Unsubscribe
  /** 系统浏览器打开 http/https 链接(iframe 被 frame-ancestors 拦截时的降级入口) */
  openExternal(url: string): Promise<void>
  /** 确认退出:真正关闭应用(后端会被优雅关停) */
  confirmClose(): Promise<any>
  /** 关窗确认框选"进入托盘":隐藏主窗口,仅托盘驻留(托盘图标/菜单可唤回) */
  hideToTray(): Promise<any>

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
  /** API 调用明细分页(step.end 口径,按时间倒序,page 从 1 开始) */
  localApiCalls(page: number, pageSize: number, channel?: string): Promise<ApiCallsResult>
  /** 实验性功能开关(env 名 → 开关;返回有效值含默认:二级模型默认开) */
  experimentalGet(): Promise<Record<string, boolean>>
  /** 保存实验性开关;激活通道后端运行中会自动重启使环境变量生效 */
  experimentalSet(flags: Record<string, boolean>): Promise<void>
  /** 读 kimi web 启动参数(端口 / 局域网开放 / allowed-host) */
  webServerGet(): Promise<WebServerOptions>
  /** 保存 kimi web 启动参数;激活通道后端运行中会自动重启生效 */
  webServerSet(opts: WebServerOptions): Promise<WebServerOptions>
  localDrives(): Promise<any>

  // pet(桌宠,实验性)
  /** 桌宠配置(enabled 缺省关) */
  petConfigGet(): Promise<PetConfig>
  /** 开关桌宠悬浮窗:持久化并即时创建/销毁 */
  petSetEnabled(enabled: boolean): Promise<void>
  /** 点击穿透开关(缺省关):开启后悬浮窗忽略所有鼠标事件,只能到设置页关闭 */
  petSetClickThrough(enabled: boolean): Promise<void>
  /** 桌宠状态变化(pet:state;仅桌宠窗口使用,M2 接入驱动) */
  onPetState(cb: (state: PetState) => void): Unsubscribe
  /** 工具调用脉冲(pet:tool,载荷 {kind};M4 起驱动差异化动作与气泡文案,同类 1s 节流) */
  onPetTool(cb: (kind: string) => void): Unsubscribe
  /** 桌宠配置变化(pet:config-changed;切换开关/宠物后同步其他页面) */
  onPetConfigChanged(cb: (cfg: PetConfig) => void): Unsubscribe
  /** 宠物列表(内置排第一,外部宠物按目录扫描去重,custom > kimi-code > petdex) */
  petList(): Promise<PetInfo[]>
  /** 导入宠物包:zip 文件名 + 内容字节,解压校验到应用数据目录 pets/<slug>,返回新宠物信息 */
  petImportZip(name: string, bytes: number[]): Promise<PetInfo>
  /** 当前激活宠物完整元信息(未设置或找不到时回退内置) */
  petActiveGet(): Promise<PetMeta>
  /** 切换激活宠物:校验 slug 存在后持久化并发 pet:config-changed */
  petSetActive(slug: string): Promise<void>

  // skin(界面皮肤,实验性)
  /** 皮肤配置(enabled 缺省关) */
  skinConfigGet(): Promise<SkinConfig>
  /** 开关皮肤立绘:持久化并发 skin:config-changed */
  skinSetEnabled(enabled: boolean): Promise<void>
  /** 切换皮肤:持久化 slug 并发 skin:config-changed(未知 slug 前端回退注册表第一个) */
  skinSetActive(slug: string): Promise<void>
  /** 用户自选皮肤 slug 列表(扫描 <config_dir>/skins/) */
  skinCustomList(): Promise<string[]>
  /** 打开用户皮肤目录(不存在先建好) */
  skinDirOpen(): Promise<void>
  /** 调整卡片不透明度(30-100):持久化并发 skin:config-changed,拖动滑块时连续调用 */
  skinSetOpacity(opacity: number): Promise<void>
  /** 开关对话页内立绘透出:持久化并发 skin:config-changed(iframe 内显隐由注入脚本完成) */
  skinSetInChat(enabled: boolean): Promise<void>
  /** 皮肤配置变化(skin:config-changed;切换开关/皮肤后同步立绘显隐与形象) */
  onSkinConfigChanged(cb: (cfg: SkinConfig) => void): Unsubscribe
}

declare global {
  interface Window {
    kimiApi: KimiApi
  }
}
