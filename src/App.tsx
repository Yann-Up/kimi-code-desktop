import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { ShellHome } from './components/ShellHome'
import { OnboardingPage } from './pages/OnboardingPage'
import { useUi } from './stores/ui'
import { useT, t as tStatic } from './i18n'

export default function App() {
  const t = useT()
  // 后端服务阶段:starting=启动中 ready=主页面 error=启动失败
  // (首次启动不再强制全屏向导;连接目标在对话页占位图上选择,或从设置页重进向导)
  const [phase, setPhase] = useState<'starting' | 'ready' | 'error'>('starting')
  const [serverError, setServerError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string; source: string; bin: string } | null>(null)
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
        setServerError(tStatic('app.serverExited', { detail: info.detail }))
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
      // 桌宠悬浮菜单快捷入口(M5 P3):切 view;带 sessionId 时由 WebFrame 消费
      // pendingSessionFocus 拼 /sessions/<id> 的 iframe src 跳转该会话
      window.kimiApi.onAppNavigate((req) => {
        if (req.view) useUi.getState().setView(req.view)
        if (req.sessionId) useUi.getState().setPendingSessionFocus(req.sessionId)
      }),
      window.kimiApi.onCliUpgraded((info) => {
        setUpgrading(false)
        setUpdateInfo(null)
        // restartOk=服务已重启使新版本生效;version=null=升级后版本探测失败(更新本身已执行)
        setUpgradeMsg(
          info.restartOk
            ? info.version
              ? tStatic('app.upgrade.doneRestarted', { version: info.version })
              : tStatic('app.upgrade.doneUnconfirmed')
            : info.version
              ? tStatic('app.upgrade.done', { version: info.version })
              : tStatic('app.upgrade.doneNoVersion')
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

  // 关窗确认框打开期间:Esc 取消(与点遮罩/取消按钮一致)
  useEffect(() => {
    if (closeConfirm === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCloseConfirm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeConfirm])

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
            <p className="mb-2 text-base font-semibold text-danger">{t('app.error.title')}</p>
            <p className="text-sm text-text-secondary">{serverError}</p>
            <p className="mt-3 text-xs text-text-tertiary">
              {t('app.error.hint')}
            </p>
            <div className="mt-4 flex justify-center">
              <button
                className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
                onClick={startBackend}
              >
                {t('app.error.retry')}
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
              {installing ? t('app.starting.installingCli') : t('app.starting.starting')}
            </p>
            {installing && (
              <p className="mt-2 text-xs text-text-tertiary">{t('app.starting.installHint')}</p>
            )}
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30">
          <div className="w-[380px] rounded-xl bg-surface p-5 shadow-2xl">
            <p className="text-[15px] font-semibold">{t('app.update.title')}</p>
            <p className="mt-2 text-[13px] text-text-secondary">
              {t('app.update.versions', { current: updateInfo.current, latest: updateInfo.latest })}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              {updateInfo.source === 'home' ? t('app.update.viaHome') : t('app.update.viaNpm')}
            </p>
            <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary" title={updateInfo.bin}>
              {t('app.update.target', { bin: updateInfo.bin })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover"
                onClick={() => {
                  window.kimiApi.cliUpdateSkip(updateInfo.latest).catch(() => {})
                  setUpdateInfo(null)
                }}
              >
                {t('app.update.skip')}
              </button>
              <button
                className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover"
                onClick={() => setUpdateInfo(null)}
              >
                {t('app.update.later')}
              </button>
              <button
                className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                disabled={upgrading}
                onClick={() => {
                  const failHint =
                    updateInfo.source === 'home'
                      ? t('app.update.failHome')
                      : t('app.update.failNpm')
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
                {upgrading ? t('app.update.updating') : t('app.update.now')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 升级结果 toast:固定深色气泡,亮暗主题下均保证与白字的对比度 */}
      {upgradeMsg && (
        <div className="fixed left-1/2 top-16 z-[81] -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-[13px] text-white shadow-lg">
          {upgradeMsg}
        </div>
      )}

      {/* 关窗确认:点 X(标题栏/Alt+F4/任务栏关闭)时由 Rust 侧拦截触发。
          "进入托盘"=不关闭进程仅隐藏窗口;"退出程序"=真正退出(优雅关停后端);
          取消:点遮罩 / Esc / 取消按钮 */}
      {closeConfirm !== null && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/30"
          onClick={() => setCloseConfirm(null)}
        >
          <div
            className="w-[380px] rounded-xl bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[15px] font-semibold">{t('app.close.title')}</p>
            <p className="mt-2 text-[13px] text-text-secondary">
              {closeConfirm ? t('app.close.descRunning') : t('app.close.descIdle')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover"
                onClick={() => setCloseConfirm(null)}
              >
                {t('app.close.cancel')}
              </button>
              <button
                className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover"
                onClick={() => {
                  setCloseConfirm(null)
                  window.kimiApi.hideToTray().catch(() => {})
                }}
              >
                {t('app.close.toTray')}
              </button>
              <button
                className="rounded-lg bg-danger px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                onClick={() => window.kimiApi.confirmClose().catch(() => {})}
              >
                {t('app.close.exit')}
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
