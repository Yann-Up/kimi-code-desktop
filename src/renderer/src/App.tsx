import { useEffect, useRef, useState } from 'react'
import { Settings2, UploadCloud } from 'lucide-react'
import { TitleBar } from './components/TitleBar'
import { QuotaStrip } from './components/chat/QuotaStrip'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { UsageSettings } from './pages/settings/UsageSettings'
import { useUi } from './stores/ui'
import { useSessions } from './stores/sessions'

export default function App() {
  // 后端服务阶段:onboarding=首次启动向导(未配置过连接目标) idle=未启动(手动启动页)
  // starting=启动中 ready=已连接 error=启动失败 offline=不启动服务,仅查看本地数据/设置
  const [phase, setPhase] = useState<
    'onboarding' | 'idle' | 'starting' | 'ready' | 'error' | 'offline'
  >('idle')
  const [serverError, setServerError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [cliDesc, setCliDesc] = useState<{ bin: string; version: string | null } | null>(null)
  const [homeDesc, setHomeDesc] = useState<string>('')
  // 连接目标展示名("本机" / "WSL (Ubuntu)" / "user@host"),入口页信息行前缀用
  const [connDescribe, setConnDescribe] = useState('')
  const [autoStart, setAutoStart] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string } | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [noSessionHint, setNoSessionHint] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const dragDepth = useRef(0)
  const view = useUi((s) => s.view)
  const onboardingOpen = useUi((s) => s.onboardingOpen)
  // 服务已连接(入口页按钮变为"进入 Kimi Code")
  const started = phase === 'ready'

  useEffect(() => {
    const offs = [
      window.kimiApi.onServerReady(() => {
        setPhase('ready')
        setInstalling(false)
        setServerError(null)
      }),
      window.kimiApi.onServerError((msg) => {
        setServerError(msg)
        setPhase('error')
      }),
      window.kimiApi.onServerStopped(() => setPhase('idle')),
      window.kimiApi.onServerExited((detail) => {
        setServerError(`后端服务意外退出:${detail}`)
        setPhase('error')
      }),
      window.kimiApi.onCliInstalling(() => {
        setInstalling(true)
        setPhase('starting')
      }),
      window.kimiApi.onCliUpdateAvailable((info) => setUpdateInfo(info)),
      window.kimiApi.onCloseRequested(() => setCloseConfirm(true)),
      window.kimiApi.onCliUpgraded((info) => {
        setUpgrading(false)
        setUpdateInfo(null)
        setUpgradeMsg(
          info.restartOk
            ? `已更新到 ${info.version},服务已自动重启`
            : '更新完成,但服务重启失败,请手动重启应用'
        )
        setTimeout(() => setUpgradeMsg(''), 5000)
      })
    ]
    // 兼容热重载/auto_start 已就绪的情况:服务已在运行则直接进入主界面(跳过向导);
    // 服务未运行且从未完成过初始配置(setupDone=false)时进入首次启动向导
    window.kimiApi
      .appInfo()
      .then((info: { cliVersion: string | null }) => {
        if (info.cliVersion) {
          setPhase('ready')
          return
        }
        window.kimiApi
          .setupStateGet()
          .then((s) => {
            if (!s.setupDone) setPhase('onboarding')
          })
          .catch(() => {})
      })
      .catch(() => {})
    // 手动启动页展示用:CLI 与数据目录信息(本地探测,不需要服务)
    window.kimiApi
      .kimiCliGet()
      .then((c) => setCliDesc(c as { bin: string; version: string | null }))
      .catch(() => {})
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setHomeDesc((h as { home: string }).home))
      .catch(() => {})
    window.kimiApi
      .getAutoStart()
      .then((v) => setAutoStart(!!v))
      .catch(() => {})
    // 连接目标:填充全局 store(FolderPickerDialog / GeneralSettings 等按目标调整行为)
    window.kimiApi
      .connectionTargetGet()
      .then((t) => {
        useUi.getState().setConnectionTarget(t.config.target)
        setConnDescribe(t.describe)
      })
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

  const toggleAutoStart = (v: boolean) => {
    setAutoStart(v)
    window.kimiApi.setAutoStart(v).catch(() => {})
  }

  // 全窗口拖拽上传:任何角落松开都交给当前会话的 Composer
  useEffect(() => {
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current++
      setDragActive(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragActive(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length) return
      const hasSession = !!useSessions.getState().activeSessionId
      if (!hasSession) {
        setNoSessionHint(true)
        setTimeout(() => setNoSessionHint(false), 2000)
        return
      }
      useUi.getState().setDroppedFiles(files)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {/* 额度条:入口页(无侧栏)全宽置顶;工作区内由 HomePage 在右侧内容区渲染 */}
      {started && view === 'home' && <QuotaStrip />}
      {phase === 'onboarding' ? (
        /* 首次启动向导:选择连接目标并测试连通,完成后进入启动流程 */
        <OnboardingPage onDone={startBackend} />
      ) : phase === 'error' ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md rounded-xl border border-danger-soft bg-danger-soft p-6 text-center">
            <p className="mb-2 text-base font-semibold text-danger">无法启动 Kimi Code 服务</p>
            <p className="text-sm text-text-secondary">{serverError}</p>
            <p className="mt-3 text-xs text-text-tertiary">
              请确认已安装 Kimi Code CLI(kimi --version 可用)
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
                onClick={() => setPhase('idle')}
              >
                返回
              </button>
              <button
                className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
                onClick={startBackend}
              >
                重试
              </button>
            </div>
          </div>
        </div>
      ) : phase === 'ready' && view !== 'home' ? (
        <HomePage />
      ) : phase === 'starting' ? (
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
      ) : phase === 'offline' ? (
        /* offline:不启动服务,仅查看本地数据(local:* 接口直读磁盘,不依赖 kimi web) */
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border-light bg-surface-secondary px-4 py-2">
            <span className="text-[12px] text-text-tertiary">
              本地数据模式:服务未启动,使用统计/技能/MCP 等本地页面可正常查看
            </span>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-border px-3 py-1 text-[12px] text-text-secondary hover:bg-surface-tertiary"
                onClick={() => setPhase('idle')}
              >
                返回启动页
              </button>
              <button
                className="rounded-lg bg-primary px-3 py-1 text-[12px] font-medium text-white hover:bg-primary-hover"
                onClick={startBackend}
              >
                启动服务
              </button>
            </div>
          </div>
          <SettingsPage />
        </div>
      ) : (
        /* 入口页(idle 未启动 / ready 时用户主动返回首页):
           使用统计仪表盘(local 数据,与服务状态无关)+ 右上角启动/进入入口 */
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border-light bg-surface px-5 py-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">Kimi Code Desktop</p>
              <p className="mt-0.5 truncate text-[12px] text-text-tertiary">
                {/* 非本机目标先标出连接位置,避免远端/本机路径混淆 */}
                {connDescribe && connDescribe !== '本机' ? `${connDescribe} · ` : ''}
                {cliDesc
                  ? `CLI v${cliDesc.version ?? '?'} · ${cliDesc.bin}`
                  : 'CLI 未检测到'}
                {homeDesc ? ` · 数据目录 ${homeDesc}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-border p-2 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary"
                  title={started ? '设置' : '设置(本地数据模式)'}
                  onClick={() => {
                    useUi.getState().openSettings('general')
                    // 服务未启动时进入本地数据模式;已连接则走工作区设置页
                    if (!started) setPhase('offline')
                  }}
                >
                  <Settings2 size={15} />
                </button>
                <button
                  className="rounded-lg bg-primary px-5 py-2 text-[14px] font-medium text-white hover:bg-primary-hover"
                  onClick={started ? () => useUi.getState().closeSettings() : startBackend}
                >
                  {started ? '进入 Kimi Code Desktop' : '启动 Kimi Code Desktop'}
                </button>
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-tertiary">
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-primary"
                  checked={autoStart}
                  onChange={(e) => toggleAutoStart(e.target.checked)}
                />
                启动应用时自动连接
              </label>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* 使用统计仪表盘(连接目标工厂化后三种目标均可用) */}
            <UsageSettings />
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
              更新通过 `kimi upgrade` 完成,更新后服务会自动重启
            </p>
            <div className="mt-4 flex justify-end gap-2">
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
                  setUpgrading(true)
                  window.kimiApi.cliUpgrade().catch(() => {
                    setUpgrading(false)
                    setUpdateInfo(null)
                    setUpgradeMsg('更新失败,请稍后在终端手动运行 kimi upgrade')
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

      {/* 退出确认:后端运行中关窗(标题栏/Alt+F4)时由 Rust 侧拦截触发 */}
      {closeConfirm && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/30">
          <div className="w-[380px] rounded-xl bg-surface p-5 shadow-2xl">
            <p className="text-[15px] font-semibold">退出 Kimi Code Desktop?</p>
            <p className="mt-2 text-[13px] text-text-secondary">
              Kimi Code 服务正在运行中,退出将停止服务并中断所有进行中的会话。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
                onClick={() => setCloseConfirm(false)}
              >
                取消
              </button>
              <button
                className="rounded-lg bg-danger px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                onClick={() => window.kimiApi.confirmClose().catch(() => {})}
              >
                退出
              </button>
            </div>
          </div>
        </div>
      )}

      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-primary/10">
          <div className="flex h-[70%] w-[70%] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-white/70">
            <UploadCloud size={48} className="text-primary" />
            <p className="mt-3 text-[15px] font-medium text-primary">松开鼠标,将文件添加为附件</p>
          </div>
        </div>
      )}
      {noSessionHint && (
        <div className="fixed left-1/2 top-16 z-[91] -translate-x-1/2 rounded-lg bg-text px-4 py-2 text-[13px] text-white shadow-lg">
          请先打开或新建一个会话
        </div>
      )}

      {/* 重进入向导覆盖层(设置页"重新运行初始向导"触发,可取消);
          完成后整页重载(与设置页手动切换连接目标一致):
          此时后端已随 set_connection_target 重启完毕,重载后挂载逻辑检测到服务在跑直接 ready,
          同时让设置页等组件重新拉取最新连接信息 */}
      {onboardingOpen && phase !== 'onboarding' && (
        <div className="fixed inset-0 z-[95] flex flex-col bg-surface">
          <OnboardingPage
            onDone={() => {
              useUi.getState().closeOnboarding()
              window.location.reload()
            }}
            onCancel={() => useUi.getState().closeOnboarding()}
          />
        </div>
      )}
    </div>
  )
}
