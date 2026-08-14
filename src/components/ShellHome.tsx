/**
 * ShellHome: 主壳布局。
 * 顶部导航行:对话 / 统计 / 设置 三个 tab + 右侧额度条(QuotaStrip)。
 * 对话 = 官方 web UI iframe;服务未启动时先显示占位页(含连接目标选择),启动成功后替换为 iframe。
 * Git 功能由官方 UI 自带(会话内"改动"面板),壳不再重复实现。
 */
import { useEffect, useState } from 'react'
import { Gauge, MessageSquare, Monitor, Server, Settings2, Terminal } from 'lucide-react'
import { QuotaStrip } from './QuotaStrip'
import { SettingsPage } from '../pages/SettingsPage'
import { UsageSettings } from '../pages/settings/UsageSettings'
import { useUi } from '../stores/ui'
import type { ConnectionTargetConfig, ConnectionTargetInfo } from '../platform/kimi-api'
import logoUrl from '../assets/logo.png'

/** 对话区状态:checking=探测服务中 off=未启动(占位页) starting=启动中 on=已加载 iframe error=加载失败 */
type FrameState = 'checking' | 'off' | 'starting' | 'on' | 'error'

type Target = ConnectionTargetConfig['target']

const TARGETS: { id: Target; label: string; icon: typeof Monitor }[] = [
  { id: 'local', label: '本机', icon: Monitor },
  { id: 'wsl', label: 'WSL', icon: Terminal },
  { id: 'ssh', label: 'SSH', icon: Server }
]

/** 对话 tab:官方 web UI iframe / 未启动占位页 */
function WebFrame() {
  const [state, setState] = useState<FrameState>('checking')
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  // server 代次:server:ready 带新 token(服务重启)时 +1,重建 iframe 避免旧 token 失效
  const [gen, setGen] = useState(0)
  // 连接目标(占位页内嵌选择;wsl/ssh 未配置过时点选进向导补全)
  const [connInfo, setConnInfo] = useState<ConnectionTargetInfo | null>(null)
  const [switchingTarget, setSwitchingTarget] = useState(false)
  // 本机缺 CLI 时的安装确认(避免未经同意下载安装)
  const [installConfirm, setInstallConfirm] = useState(false)
  const connTarget = useUi((s) => s.connectionTarget)

  // 挂载时探测:服务已在跑则直接加载 iframe,否则进占位页
  useEffect(() => {
    window.kimiApi
      .appInfo()
      .then((info: { cliVersion: string | null }) => {
        setState(info.cliVersion ? 'on' : 'off')
      })
      .catch(() => setState('off'))
  }, [])

  // 连接目标信息:挂载拉一次,目标变化(向导完成/设置页切换)后重拉
  useEffect(() => {
    window.kimiApi
      .connectionTargetGet()
      .then((t) => setConnInfo(t))
      .catch(() => {})
  }, [connTarget])

  // state=on 后取 iframe src;就绪事件与 server_info 落盘之间存在时序窗口,失败做有限重试
  useEffect(() => {
    if (state !== 'on' || src) return
    let cancelled = false
    setError(null)
    ;(async () => {
      let lastErr = 'unknown'
      for (let i = 0; i < 10 && !cancelled; i++) {
        try {
          const url = await window.kimiApi.webUiUrl()
          if (!cancelled) setSrc(url)
          return
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      if (!cancelled) {
        setError(lastErr)
        setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state, src, gen])

  useEffect(() => {
    const offs = [
      // 服务就绪(含重启带新 token):重建 iframe
      window.kimiApi.onServerReady((info) => {
        if (info.token) {
          setInstalling(false)
          setSrc(null)
          setState('on')
          setGen((g) => g + 1)
        }
      }),
      // 手动停止:回占位页
      window.kimiApi.onServerStopped(() => {
        setSrc(null)
        setInstalling(false)
        setState('off')
      }),
      // 意外退出:回占位页并提示原因
      window.kimiApi.onServerExited((detail) => {
        setSrc(null)
        setInstalling(false)
        setError(`后端服务意外退出:${detail}`)
        setState('off')
      }),
      window.kimiApi.onCliInstalling(() => setInstalling(true))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  /** 占位页切换目标:wsl/ssh 无已保存配置时进向导补全;否则直接保存切换(服务未运行,只写配置) */
  const pickTarget = async (t: Target) => {
    if (!connInfo || switchingTarget || t === connInfo.config.target) return
    const cfg = connInfo.config
    const configured = t === 'local' || (t === 'wsl' ? cfg.wslDistro != null : !!cfg.sshHost)
    if (!configured) {
      useUi.getState().openOnboarding(t)
      return
    }
    setSwitchingTarget(true)
    setError(null)
    try {
      // 带上已保存的 wsl/ssh 字段,避免切换本机时清掉远端配置
      await window.kimiApi.connectionTargetSet({ ...cfg, target: t })
      useUi.getState().setConnectionTarget(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSwitchingTarget(false)
    }
  }

  const doStart = () => {
    setError(null)
    setState('starting')
    window.kimiApi.startBackend().catch((e) => {
      setError(e instanceof Error ? e.message : String(e))
      setState('off')
    })
  }

  /** 启动入口:本机目标且未检测到 CLI 时先弹安装确认,不静默下载 */
  const startService = async () => {
    if ((connInfo?.config.target ?? 'local') === 'local') {
      try {
        const c = (await window.kimiApi.kimiCliGet()) as { version?: string | null }
        if (!c?.version) {
          setInstallConfirm(true)
          return
        }
      } catch {
        // 探测失败也照常尝试启动,由 bootstrap 报错
      }
    }
    doStart()
  }

  /* 占位页:服务未启动 / 启动失败(带原因) */
  if (state === 'off') {
    const currentTarget = connInfo?.config.target ?? 'local'
    return (
      <div className="flex flex-1 items-center justify-center bg-surface-secondary">
        <div className="flex flex-col items-center">
          <img src={logoUrl} alt="Kimi Code" className="h-14 w-14 rounded-2xl shadow-sm" />
          <p className="mt-5 text-[15px] font-semibold">Kimi Code 服务未启动</p>
          <p className="mt-1.5 max-w-[320px] text-center text-[12.5px] leading-relaxed text-text-tertiary">
            启动后此处将加载官方 Web UI 对话界面;统计、设置等本地页面现在即可使用
          </p>

          {/* 连接目标选择:启动前必须显式确认,避免默认本机探测/安装与用户意图不符 */}
          <div className="mt-5 flex items-center gap-2">
            <span className="text-[12px] text-text-tertiary">服务运行位置</span>
            <div className="flex gap-1">
              {TARGETS.map((t) => {
                const Icon = t.icon
                const active = currentTarget === t.id
                return (
                  <button
                    key={t.id}
                    disabled={switchingTarget}
                    className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                      active
                        ? 'border-primary bg-primary-soft font-medium text-primary'
                        : 'border-border text-text-secondary hover:bg-surface-tertiary'
                    } disabled:opacity-50`}
                    onClick={() => void pickTarget(t.id)}
                  >
                    <Icon size={12} /> {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <p className="mt-3 max-w-[360px] rounded-lg bg-danger-soft px-3 py-2 text-center text-[12px] text-danger">
              {error}
            </p>
          )}
          <button
            className="mt-5 rounded-lg bg-primary px-6 py-2 text-[14px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={switchingTarget}
            onClick={() => void startService()}
          >
            启动 Kimi Code 服务
          </button>
        </div>

        {/* 本机缺 CLI 的安装确认:明确告知将下载什么、用什么方式 */}
        {installConfirm && (
          <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/30">
            <div className="w-[400px] rounded-xl bg-surface p-5 shadow-2xl">
              <p className="text-[15px] font-semibold">安装 Kimi Code CLI</p>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                本机未检测到 Kimi Code CLI。将使用官方安装脚本下载并安装最新版:
              </p>
              <p className="mt-2 rounded-lg bg-surface-tertiary px-3 py-2 font-mono text-[11.5px] text-text-secondary">
                irm https://code.kimi.com/kimi-code/install.ps1 | iex
              </p>
              <p className="mt-2 text-[12px] text-text-tertiary">
                首次安装需要几分钟,请保持网络畅通;安装完成后服务会自动启动
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
                  onClick={() => setInstallConfirm(false)}
                >
                  取消
                </button>
                <button
                  className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
                  onClick={() => {
                    setInstallConfirm(false)
                    doStart()
                  }}
                >
                  安装并启动
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* 启动中(含首次自动安装 CLI) */
  if (state === 'starting' || state === 'checking') {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface-secondary">
        <div className="flex flex-col items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-4 text-sm text-text-secondary">
            {installing
              ? '未检测到 Kimi Code CLI,正在自动下载安装最新版…'
              : '正在启动 Kimi Code 服务…'}
          </p>
          {installing && (
            <p className="mt-2 text-xs text-text-tertiary">首次安装需要几分钟,请保持网络畅通</p>
          )}
        </div>
      </div>
    )
  }

  /* iframe src 重试 10 次仍失败 */
  if (state === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-secondary">
        <p className="text-sm text-text-secondary">无法加载对话界面</p>
        <p className="text-[11px] text-text-tertiary">{error}</p>
        <button
          className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
          onClick={() => {
            setError(null)
            setState('on')
            setGen((g) => g + 1)
          }}
        >
          重试
        </button>
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface-secondary">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <iframe
      key={gen}
      src={src}
      title="Kimi Code"
      className="min-h-0 w-full flex-1 border-0 bg-white"
    />
  )
}

export function ShellHome() {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)

  const TABS: { id: 'chat' | 'stats' | 'settings'; label: string; icon: typeof MessageSquare }[] = [
    { id: 'chat', label: '对话', icon: MessageSquare },
    { id: 'stats', label: '统计', icon: Gauge },
    { id: 'settings', label: '设置', icon: Settings2 }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部导航行:tab(左)+ 额度条(右) */}
      <div className="flex shrink-0 items-stretch border-b border-border-light bg-surface">
        <div className="flex items-center gap-1 px-4">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = view === t.id
            return (
              <button
                key={t.id}
                className={`flex h-12 items-center gap-1.5 px-3 text-[13px] transition-colors ${
                  active
                    ? 'border-b-2 border-primary font-medium text-primary'
                    : 'text-text-secondary hover:text-text'
                }`}
                onClick={() => setView(t.id)}
              >
                <Icon size={14} /> {t.label}
              </button>
            )
          })}
        </div>
        <div className="ml-auto min-w-0">
          <QuotaStrip />
        </div>
      </div>

      {/* tab 内容:对话区常驻挂载(切 tab 只隐藏),避免重载官方 UI 丢失会话状态 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 flex-col ${view === 'chat' ? 'flex' : 'hidden'}`}>
          <WebFrame />
        </div>
        {view === 'stats' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <UsageSettings />
          </div>
        )}
        {view === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}
