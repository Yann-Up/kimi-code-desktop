import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { ShellHome } from './components/ShellHome'
import { OnboardingPage } from './pages/OnboardingPage'
import { useUi } from './stores/ui'

export default function App() {
  // 后端服务阶段:starting=启动中 ready=主页面 error=启动失败
  // (首次启动不再强制全屏向导;连接目标在对话页占位图上选择,或从设置页重进向导)
  const [phase, setPhase] = useState<'starting' | 'ready' | 'error'>('starting')
  const [serverError, setServerError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string; source: string } | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  // 关窗确认框:null=不显示;否则值为"是否有后端在跑"(决定警告文案)
  const [closeConfirm, setCloseConfirm] = useState<boolean | null>(null)
  const onboardingOpen = useUi((s) => s.onboardingOpen)

  useEffect(() => {
    const offs = [
      // 事件带 channel:只影响激活通道的前端阶段(phase);其余通道的运行状态由 setChannelRunning 维护
      window.kimiApi.onServerReady((info) => {
        useUi.getState().setChannelRunning(info.channel, true)
        if (info.channel !== useUi.getState().activeChannel) return
        setPhase('ready')
        setInstalling(false)
        setServerError(null)
      }),
      window.kimiApi.onServerError((info) => {
        if (info.channel !== useUi.getState().activeChannel) return
        setServerError(info.error)
        setPhase('error')
      }),
      // 手动停止服务(设置页)不离开主页面:对话 iframe 自行进入未运行态,统计/设置本地可读
      window.kimiApi.onServerExited((info) => {
        useUi.getState().setChannelRunning(info.channel, false)
        if (info.channel !== useUi.getState().activeChannel) return
        setServerError(`后端服务意外退出:${info.detail}`)
        setPhase('error')
      }),
      window.kimiApi.onServerStopped((info) => {
        useUi.getState().setChannelRunning(info.channel, false)
      }),
      window.kimiApi.onCliInstalling(() => {
        setInstalling(true)
        // 已在主页面(从对话页占位图触发安装)时保持 ready:翻相会卸载 ShellHome,
        // 销毁所有通道的常驻 iframe,丢失会话现场;安装进度由 WebFrame 按通道自行呈现
        setPhase((p) => (p === 'ready' ? p : 'starting'))
      }),
      window.kimiApi.onCliUpdateAvailable((info) => setUpdateInfo(info)),
      window.kimiApi.onCloseRequested((running) => setCloseConfirm(running)),
      window.kimiApi.onCliUpgraded((info) => {
        setUpgrading(false)
        setUpdateInfo(null)
        // restartOk=服务已重启使新版本生效;version=null=升级后版本探测失败(更新本身已执行)
        setUpgradeMsg(
          info.restartOk
            ? info.version
              ? `已更新到 ${info.version},服务已自动重启`
              : '更新已执行,但无法确认新版本,请重启应用确认'
            : info.version
              ? `已更新到 ${info.version};若服务在运行,重启后生效`
              : '更新已执行;若服务在运行,重启后生效'
        )
        setTimeout(() => setUpgradeMsg(''), 5000)
      })
    ]
    // 启动即进主页面:服务已在运行(热重载等)直接 ready;未运行也 ready,
    // 对话页显示占位图(启动按钮),由用户手动启动服务
    window.kimiApi
      .appInfo()
      .then(() => setPhase('ready'))
      .catch(() => setPhase('ready'))
    // 通道列表 + 激活通道:填充全局 store(顶部切换器 / 对话 iframe 按通道区分)
    window.kimiApi
      .getChannels()
      .then((r) => useUi.getState().setChannels(r.channels, r.active))
      .catch(() => {})
    // 连接目标:填充全局 store(FolderPickerDialog / GeneralSettings 等按目标调整行为)
    window.kimiApi
      .connectionTargetGet()
      .then((t) => useUi.getState().setConnectionTarget(t.config.target))
      .catch(() => {})
    return () => offs.forEach((off) => off())
  }, [])

  const startBackend = () => {
    setServerError(null)
    // 先探活:服务可能已由 set_connection_target 的重启流程拉起(其 server:ready
    // 事件会先于本次调用到达),此时 start_backend 是 no-op 且不再发事件,
    // 直接置 ready,否则 phase 会永远卡在 starting
    window.kimiApi
      .appInfo()
      .then((info: { cliVersion: string | null }) => {
        if (info.cliVersion) {
          setPhase('ready')
          return
        }
        setPhase('starting')
        window.kimiApi.startBackend().catch((e) => {
          setServerError(e instanceof Error ? e.message : String(e))
          setPhase('error')
        })
      })
      .catch(() => {
        setPhase('starting')
        window.kimiApi.startBackend().catch((e) => {
          setServerError(e instanceof Error ? e.message : String(e))
          setPhase('error')
        })
      })
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {phase === 'error' ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md rounded-xl border border-danger-soft bg-danger-soft p-6 text-center">
            <p className="mb-2 text-base font-semibold text-danger">无法启动 Kimi Code 服务</p>
            <p className="text-sm text-text-secondary">{serverError}</p>
            <p className="mt-3 text-xs text-text-tertiary">
              请确认已安装 Kimi Code CLI(kimi --version 可用)
            </p>
            <div className="mt-4 flex justify-center">
              <button
                className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
                onClick={startBackend}
              >
                重试
              </button>
            </div>
          </div>
        </div>
      ) : phase === 'ready' ? (
        <ShellHome />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-text-secondary">
              {installing
                ? '未检测到 Kimi Code CLI,正在自动下载安装最新版…'
                : '正在启动 Kimi Code 服务…'}
            </p>
            {installing && (
              <p className="mt-2 text-xs text-text-tertiary">首次安装需要几分钟,请保持网络畅通</p>
            )}
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30">
          <div className="w-[380px] rounded-xl bg-surface p-5 shadow-2xl">
            <p className="text-[15px] font-semibold">发现 Kimi Code CLI 新版本</p>
            <p className="mt-2 text-[13px] text-text-secondary">
              当前 {updateInfo.current} → 最新 {updateInfo.latest}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              {updateInfo.source === 'home'
                ? '更新通过 `kimi upgrade` 完成,更新后服务会自动重启'
                : '当前为 npm 安装,更新通过 `npm update -g @moonshot-ai/kimi-code` 完成,更新后服务会自动重启'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
                onClick={() => {
                  window.kimiApi.cliUpdateSkip(updateInfo.latest).catch(() => {})
                  setUpdateInfo(null)
                }}
              >
                跳过此版本
              </button>
              <button
                className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
                onClick={() => setUpdateInfo(null)}
              >
                稍后
              </button>
              <button
                className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                disabled={upgrading}
                onClick={() => {
                  const failHint =
                    updateInfo.source === 'home'
                      ? '更新失败,请稍后在终端手动运行 kimi upgrade'
                      : '更新失败,请稍后在终端手动运行 npm update -g @moonshot-ai/kimi-code'
                  setUpgrading(true)
                  window.kimiApi.cliUpgrade().catch((e) => {
                    setUpgrading(false)
                    setUpdateInfo(null)
                    // 后端会给出具体原因(自更新渠道未发布/版本未变化等),优先透传
                    setUpgradeMsg(typeof e === 'string' ? e : e instanceof Error ? e.message : failHint)
                    setTimeout(() => setUpgradeMsg(''), 5000)
                  })
                }}
              >
                {upgrading ? '正在更新…' : '立即更新'}
              </button>
            </div>
          </div>
        </div>
      )}
      {upgradeMsg && (
        <div className="fixed left-1/2 top-16 z-[81] -translate-x-1/2 rounded-lg bg-text px-4 py-2 text-[13px] text-white shadow-lg">
          {upgradeMsg}
        </div>
      )}

      {/* 关窗确认:点 X(标题栏/Alt+F4/任务栏关闭)时由 Rust 侧拦截触发。
          "进入托盘"=不关闭进程仅隐藏窗口;"退出程序"=真正退出(优雅关停后端) */}
      {closeConfirm !== null && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/30">
          <div className="w-[380px] rounded-xl bg-surface p-5 shadow-2xl">
            <p className="text-[15px] font-semibold">是否关闭 Kimi Code Desktop?</p>
            <p className="mt-2 text-[13px] text-text-secondary">
              {closeConfirm
                ? 'Kimi Code 服务正在运行中,退出将停止服务并中断所有进行中的会话;进入托盘则保持后台运行。'
                : '可以退出程序,或进入托盘保持后台驻留(托盘图标可随时唤回)。'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
                onClick={() => {
                  setCloseConfirm(null)
                  window.kimiApi.hideToTray().catch(() => {})
                }}
              >
                进入托盘
              </button>
              <button
                className="rounded-lg bg-danger px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                onClick={() => window.kimiApi.confirmClose().catch(() => {})}
              >
                退出程序
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 向导覆盖层(设置页"重新运行初始向导"、设置→通道页"添加通道"触发,可取消)。
          完成后关闭;switch 模式启动激活通道(set_connection_target 已保存目标;
          服务在跑时其内部已重启,startBackend 是 no-op);add 模式只追加,调用方刷新通道列表 */}
      {onboardingOpen && (
        <div className="fixed inset-0 z-[95] flex flex-col bg-surface">
          <OnboardingPage
            mode={useUi.getState().onboardingMode}
            initialTarget={useUi.getState().onboardingTarget}
            onDone={() => {
              useUi.getState().closeOnboarding()
              if (useUi.getState().onboardingMode === 'add') {
                // 添加通道完成:刷新通道列表(active 不变)
                window.kimiApi
                  .getChannels()
                  .then((r) => useUi.getState().setChannels(r.channels, r.active))
                  .catch(() => {})
              } else {
                startBackend()
              }
            }}
            onCancel={() => useUi.getState().closeOnboarding()}
          />
        </div>
      )}
    </div>
  )
}
