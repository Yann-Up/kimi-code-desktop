/**
 * ShellHome: 主壳布局。
 * 顶部导航行:通道切换器(多通道时显示)+ 对话 / 统计 / 设置 三个 tab + 右侧额度条(QuotaStrip)。
 * 对话 = 官方 web UI iframe,按通道维护 iframe 常驻挂载(切通道只 hidden 切换,不丢会话);
 * 服务未启动时显示占位页(跟随激活通道,含启动按钮),启动成功后替换为 iframe。
 * Git 功能由官方 UI 自带(会话内"改动"面板),壳不再重复实现。
 */
import { useEffect, useRef, useState } from 'react'
import {
  Gauge,
  MessageSquare,
  RadioTower,
  Settings2,
  TriangleAlert
} from 'lucide-react'
import { QuotaStrip } from './QuotaStrip'
import { SettingsPage } from '../pages/SettingsPage'
import { StatsPage } from '../pages/stats/StatsPage'
import { useUi } from '../stores/ui'
import logoUrl from '../assets/logo.png'

/** 对话区状态:checking=探测服务中 off=未启动(占位页) starting=启动中 on=已加载 iframe error=加载失败 */
type FrameState = 'checking' | 'off' | 'starting' | 'on' | 'error'

/** 对话 tab:官方 web UI iframe / 未启动占位页(每通道一份,切通道只 hidden 切换) */
function WebFrame() {
  const channels = useUi((s) => s.channels)
  const activeChannel = useUi((s) => s.activeChannel)
  // 按通道维护:状态 / iframe src / 错误文案;所有已启动通道的 iframe 常驻挂载
  const [states, setStates] = useState<Record<string, FrameState>>({})
  const [srcs, setSrcs] = useState<Record<string, string | undefined>>({})
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  // 服务端下发 frame-ancestors/X-Frame-Options → iframe 会被浏览器拦截,改显示引导页
  const [frameBlocked, setFrameBlocked] = useState<Record<string, boolean>>({})
  const [installing, setInstalling] = useState(false)
  // 本机缺 CLI 时的安装确认(避免未经同意下载安装;仅 local 通道生效)
  const [installConfirm, setInstallConfirm] = useState(false)
  // 每通道 src 拉取在途标记(避免 effect 重跑时并发重复拉取)
  const fetching = useRef<Set<string>>(new Set())

  // 通道集合就绪后:为尚无状态的通道初始化(运行中 → on,其余 → off)
  useEffect(() => {
    setStates((prev) => {
      let next = prev
      for (const c of channels) {
        if (c.id in prev) continue
        next = next === prev ? { ...prev } : next
        next[c.id] = c.running ? 'on' : 'off'
      }
      return next
    })
  }, [channels])

  // 服务事件:按事件里的 channel 只更新对应通道的 iframe(就绪只重建该通道,其余不受影响)
  useEffect(() => {
    const offs = [
      // 服务就绪(含重启带新 token):该通道进 on 并清 src,由 src 拉取 effect 重建 iframe
      window.kimiApi.onServerReady((info) => {
        setInstalling(false)
        setStates((s) => ({ ...s, [info.channel]: 'on' }))
        setSrcs((s) => ({ ...s, [info.channel]: undefined }))
        setErrors((e) => ({ ...e, [info.channel]: undefined }))
        setFrameBlocked((m) => ({ ...m, [info.channel]: info.frameBlocked ?? false }))
      }),
      // 手动停止:该通道回占位页
      window.kimiApi.onServerStopped((info) => {
        setSrcs((s) => ({ ...s, [info.channel]: undefined }))
        setInstalling(false)
        setStates((s) => ({ ...s, [info.channel]: 'off' }))
        setErrors((e) => ({ ...e, [info.channel]: undefined }))
        setFrameBlocked((m) => ({ ...m, [info.channel]: false }))
      }),
      // 意外退出:该通道回占位页并提示原因
      window.kimiApi.onServerExited((info) => {
        setSrcs((s) => ({ ...s, [info.channel]: undefined }))
        setInstalling(false)
        setStates((s) => ({ ...s, [info.channel]: 'off' }))
        setErrors((e) => ({ ...e, [info.channel]: `后端服务意外退出:${info.detail}` }))
        setFrameBlocked((m) => ({ ...m, [info.channel]: false }))
      }),
      window.kimiApi.onCliInstalling(() => setInstalling(true))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // 每个 on 态且未取到 src 的通道拉取 webUiUrl(带重试);就绪事件与 server_info 落盘
  // 之间存在时序窗口,失败做有限重试
  useEffect(() => {
    void (async () => {
      for (const [ch, st] of Object.entries(states) as [string, FrameState][]) {
        if (st !== 'on' || srcs[ch] || fetching.current.has(ch)) continue
        fetching.current.add(ch)
        let lastErr = 'unknown'
        let ok = false
        for (let i = 0; i < 10; i++) {
          try {
            const url = await window.kimiApi.webUiUrl(ch)
            setSrcs((s) => ({ ...s, [ch]: url }))
            ok = true
            break
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e)
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
        fetching.current.delete(ch)
        if (!ok) {
          setStates((s) => ({ ...s, [ch]: 'error' }))
          setErrors((e) => ({ ...e, [ch]: lastErr }))
        }
      }
    })()
  }, [states, srcs])

  /** 启动指定通道:本机通道缺 CLI 时先弹安装确认,不静默下载 */
  const startChannel = (ch: string) => {
    setErrors((e) => ({ ...e, [ch]: undefined }))
    if (ch === 'local') {
      void window.kimiApi
        .kimiCliGet()
        .then((c: { version?: string | null }) => {
          if (!c?.version) {
            setInstallConfirm(true)
            return
          }
          doStart(ch)
        })
        .catch(() => doStart(ch))
      return
    }
    doStart(ch)
  }

  const doStart = (ch: string) => {
    setStates((s) => ({ ...s, [ch]: 'starting' }))
    window.kimiApi.startBackend(ch).catch((e) => {
      setErrors((err) => ({ ...err, [ch]: e instanceof Error ? e.message : String(e) }))
      setStates((s) => ({ ...s, [ch]: 'off' }))
    })
  }

  /** 重试拉取 src(加载失败态入口) */
  const retryLoad = (ch: string) => {
    setErrors((e) => ({ ...e, [ch]: undefined }))
    setStates((s) => ({ ...s, [ch]: 'on' }))
  }

  /* 占位页:该通道服务未启动(跟随激活通道显示) */
  const renderPlaceholder = (ch: string) => {
    const error = errors[ch]
    return (
      <div className="flex flex-1 items-center justify-center bg-surface-secondary">
        <div className="flex flex-col items-center">
          <img src={logoUrl} alt="Kimi Code" className="h-14 w-14 rounded-2xl shadow-sm" />
          <p className="mt-5 text-[15px] font-semibold">Kimi Code 服务未启动</p>
          <p className="mt-1.5 max-w-[320px] text-center text-[12.5px] leading-relaxed text-text-tertiary">
            启动后此处将加载官方 Web UI 对话界面;统计、设置等本地页面现在即可使用
          </p>

          {error && (
            <p className="mt-3 max-w-[360px] rounded-lg bg-danger-soft px-3 py-2 text-center text-[12px] text-danger">
              {error}
            </p>
          )}
          <button
            className="mt-5 rounded-lg bg-primary px-6 py-2 text-[14px] font-medium text-white hover:bg-primary-hover"
            onClick={() => startChannel(ch)}
          >
            启动 Kimi Code 服务
          </button>
        </div>
      </div>
    )
  }

  /* 启动中(含首次自动安装 CLI) */
  const renderStarting = () => (
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

  /** 渲染单通道内容(占位 / 启动中 / 错误 / iframe),只有激活通道可见 */
  const renderChannel = (ch: string, st: FrameState) => {
    if (st === 'off') return renderPlaceholder(ch)
    if (st === 'starting' || st === 'checking') return renderStarting()
    if (st === 'error') {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-secondary">
          <p className="text-sm text-text-secondary">无法加载对话界面</p>
          <p className="text-[11px] text-text-tertiary">{errors[ch]}</p>
          <button
            className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
            onClick={() => retryLoad(ch)}
          >
            重试
          </button>
        </div>
      )
    }
    const src = srcs[ch]
    if (!src) {
      return (
        <div className="flex flex-1 items-center justify-center bg-surface-secondary">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )
    }
    // 服务端禁止 iframe 嵌入(官方下发 frame-ancestors):空白 iframe 无提示,改显示引导
    if (frameBlocked[ch]) {
      return (
        <div className="flex flex-1 items-center justify-center bg-surface-secondary">
          <div className="flex max-w-[420px] flex-col items-center px-6">
            <TriangleAlert size={32} className="text-warning" />
            <p className="mt-4 text-[15px] font-semibold">官方服务端禁止了 iframe 嵌入</p>
            <p className="mt-2 text-center text-[12.5px] leading-relaxed text-text-tertiary">
              检测到响应头 CSP frame-ancestors,当前版本的官方服务端不允许被嵌入,
              对话界面无法在壳内显示。可改用系统浏览器访问,或留意官方更新说明。
            </p>
            <button
              className="mt-5 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
              onClick={() => void window.kimiApi.openExternal(src)}
            >
              在系统浏览器打开
            </button>
          </div>
        </div>
      )
    }
    return (
      <iframe
        key={src}
        src={src}
        title="Kimi Code"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    )
  }

  // 通道列表尚未就绪(get_channels 在途/失败):按本机兜底渲染,不阻塞启动
  const effectiveChannels = channels.length
    ? channels
    : [{ id: 'local', label: '本机', target: 'local' as const, running: false }]

  return (
    <div className="relative min-h-0 flex-1">
      {/* 每通道一层:全部常驻挂载,切通道只 hidden 切换(iframe 不重载,会话不丢) */}
      {effectiveChannels.map((c) => {
        const st = states[c.id] ?? 'checking'
        const active = c.id === activeChannel
        return (
          <div
            key={c.id}
            className={`absolute inset-0 flex min-h-0 flex-col ${active ? '' : 'hidden'}`}
          >
            {renderChannel(c.id, st)}
          </div>
        )
      })}

      {/* 本机缺 CLI 的安装确认:明确告知将下载什么、用什么方式(仅 local 通道) */}
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
                  doStart('local')
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

export function ShellHome() {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const channels = useUi((s) => s.channels)
  const activeChannel = useUi((s) => s.activeChannel)
  const setActiveChannel = useUi((s) => s.setActiveChannel)
  // 应用自身更新:启动静默自检发现新版时在「设置」tab 上加红点角标;
  // 结果写入全局 store,设置页任何时候打开都能直接看到
  const appUpdateAvailable = useUi((s) => s.appUpdate !== null)
  useEffect(() => window.kimiApi.onAppUpdateAvailable((info) => useUi.getState().setAppUpdate(info)), [])

  const TABS: { id: 'chat' | 'stats' | 'settings'; label: string; icon: typeof MessageSquare }[] = [
    { id: 'chat', label: '对话', icon: MessageSquare },
    { id: 'stats', label: '统计', icon: Gauge },
    { id: 'settings', label: '设置', icon: Settings2 }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部导航行:通道切换器(多通道时显示)+ tab(左)+ 额度条(右) */}
      <div className="flex shrink-0 items-stretch border-b border-border-light bg-surface">
        <div className="flex items-center gap-1 px-4">
          {/* 通道切换器:channels.length > 1 才显示;只切全局 activeChannel,不启停服务 */}
          {channels.length > 1 && (
            <div className="mr-2 flex items-center gap-1.5 border-r border-border-light pr-3">
              <RadioTower size={14} className="shrink-0 text-text-tertiary" />
              <select
                className="max-w-[180px] cursor-pointer bg-transparent text-[13px] text-text-secondary outline-none"
                title="切换连接通道"
                value={activeChannel}
                onChange={(e) => void setActiveChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.running ? '' : ' (未启动)'}
                  </option>
                ))}
              </select>
            </div>
          )}
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
                {t.id === 'settings' && appUpdateAvailable && (
                  <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-danger" title="发现新版本,前往 设置 → 常规 更新" />
                )}
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
            <StatsPage />
          </div>
        )}
        {view === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}
