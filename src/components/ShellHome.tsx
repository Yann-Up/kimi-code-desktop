/**
 * ShellHome: 主壳布局。
 * 顶部导航行:通道切换器(多通道时显示)+ 对话 / 统计 / 设置 三个 tab + 右侧额度条(QuotaStrip)。
 * 对话 = 官方 web UI iframe,按通道维护 iframe 常驻挂载(切通道只 hidden 切换,不丢会话);
 * 服务未启动时显示占位页(跟随激活通道,含启动按钮),启动成功后替换为 iframe。
 * Git 功能由官方 UI 自带(会话内"改动"面板),壳不再重复实现。
 */
import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, TriangleAlert } from 'lucide-react'
import { SkinStandee } from './SkinStandee'
import { useChatSkinBridge } from './chatSkinBridge'
import { useChatPrefsBridge } from './chatPrefsBridge'
import { newBridgeNonce } from './bridgeGuard'
import { SettingsPage } from '../pages/SettingsPage'
import { StatsPage } from '../pages/stats/StatsPage'
import { useUi } from '../stores/ui'
import { IS_WINDOWS } from '../platform/os'
import { useT, t as tStatic } from '../i18n'
import logoUrl from '../assets/logo.png'

/** 对话区状态:checking=探测服务中 off=未启动(占位页) starting=启动中 on=已加载 iframe error=加载失败 */
type FrameState = 'checking' | 'off' | 'starting' | 'on' | 'error'

/** 对话 tab:官方 web UI iframe / 未启动占位页(每通道一份,切通道只 hidden 切换) */
function WebFrame() {
  const t = useT()
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
  // 每通道桥 nonce:经 iframe name 属性下发,注入脚本 window.name 回传,
  // 上行消息由 bridgeGuard 校验来源框架与 nonce 匹配
  const noncesRef = useRef(new Map<string, string>())
  const nonceFor = (ch: string) => {
    let n = noncesRef.current.get(ch)
    if (!n) {
      n = newBridgeNonce()
      noncesRef.current.set(ch, n)
    }
    return n
  }
  // 对话页内皮肤立绘桥接(实验性):与 iframe 注入脚本 postMessage 收发皮肤配置;
  // active 时右下角给会话级快捷显隐按钮(审阅面板被立绘遮挡时临时关闭,不落配置)
  const chatSkin = useChatSkinBridge()
  // 主题/语言同步:官方 web UI 的明暗与中英经注入脚本上报,壳自定义页面跟随
  useChatPrefsBridge()

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
        setErrors((e) => ({ ...e, [info.channel]: tStatic('shell.serverExited', { detail: info.detail }) }))
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

  // 桌宠悬浮菜单点会话行(M5 P3):官方 web UI(0.37.2 起)支持 /sessions/<id> 路径路由
  // (加载时解析 pathname 选中会话,并监听 popstate;已按官方内嵌前端产物核实),
  // 拼带会话路径的 src 触发 iframe 重载直达该会话。跨源无法 pushState 进 iframe,
  // 重载是唯一入口;末尾 query 仅用于强制刷新 src(同会话重复点也能再次生效)
  const pendingSessionFocus = useUi((s) => s.pendingSessionFocus)
  useEffect(() => {
    if (!pendingSessionFocus) return
    const ch = activeChannel
    if (states[ch] !== 'on') {
      useUi.getState().setPendingSessionFocus(null)
      return
    }
    void (async () => {
      try {
        const url = await window.kimiApi.webUiUrl(ch)
        const hashIdx = url.indexOf('#')
        const base = (hashIdx >= 0 ? url.slice(0, hashIdx) : url).replace(/\/$/, '')
        const hash = hashIdx >= 0 ? url.slice(hashIdx) : ''
        const src = `${base}/sessions/${encodeURIComponent(pendingSessionFocus)}?_=${Date.now()}${hash}`
        setSrcs((s) => ({ ...s, [ch]: src }))
      } catch {
        /* 服务未就绪:放弃本次跳转,主窗保持原样 */
      }
      useUi.getState().setPendingSessionFocus(null)
    })()
  }, [pendingSessionFocus])

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
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center">
          <img src={logoUrl} alt="Kimi Code" className="h-14 w-14 rounded-2xl shadow-sm" />
          <p className="mt-5 text-[15px] font-semibold">{t('shell.offline.title')}</p>
          <p className="mt-1.5 max-w-[320px] text-center text-[12.5px] leading-relaxed text-text-tertiary">
            {t('shell.offline.desc')}
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
            {t('shell.offline.start')}
          </button>
        </div>
      </div>
    )
  }

  /* 启动中(含首次自动安装 CLI) */
  const renderStarting = () => (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="mt-4 text-sm text-text-secondary">
          {installing ? t('shell.starting.installingCli') : t('shell.starting.starting')}
        </p>
        {installing && (
          <p className="mt-2 text-xs text-text-tertiary">{t('shell.starting.installHint')}</p>
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-text-secondary">{t('shell.frameError.title')}</p>
          <p className="text-[11px] text-text-tertiary">{errors[ch]}</p>
          <button
            className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover"
            onClick={() => retryLoad(ch)}
          >
            {t('shell.frameError.retry')}
          </button>
        </div>
      )
    }
    const src = srcs[ch]
    if (!src) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )
    }
    // 服务端禁止 iframe 嵌入(官方下发 frame-ancestors):空白 iframe 无提示,改显示引导
    if (frameBlocked[ch]) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex max-w-[420px] flex-col items-center px-6">
            <TriangleAlert size={32} className="text-warning" />
            <p className="mt-4 text-[15px] font-semibold">{t('shell.frameBlocked.title')}</p>
            <p className="mt-2 text-center text-[12.5px] leading-relaxed text-text-tertiary">
              {t('shell.frameBlocked.desc')}
            </p>
            <button
              className="mt-5 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
              onClick={() => void window.kimiApi.openExternal(src)}
            >
              {t('shell.frameBlocked.openExternal')}
            </button>
          </div>
        </div>
      )
    }
    return (
      <iframe
        key={src}
        src={src}
        name={nonceFor(ch)}
        title="Kimi Code"
        className="min-h-0 w-full flex-1 border-0 bg-surface"
      />
    )
  }

  // 通道列表尚未就绪(get_channels 在途/失败):按本机兜底渲染,不阻塞启动
  const effectiveChannels = channels.length
    ? channels
    : [{ id: 'local', label: t('shell.channelLocal'), target: 'local' as const, running: false }]

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

      {/* 会话立绘快捷显隐:立绘会盖住右侧审阅面板,给会话级开关(不落配置,重启恢复) */}
      {chatSkin.active && (
        <button
          className="absolute bottom-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface/90 text-text-tertiary shadow-sm backdrop-blur transition-colors hover:text-text"
          title={chatSkin.hidden ? t('shell.skin.show') : t('shell.skin.hideSession')}
          onClick={chatSkin.toggleHidden}
        >
          {chatSkin.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}

      {/* 本机缺 CLI 的安装确认:明确告知将下载什么、用什么方式(仅 local 通道) */}
      {installConfirm && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/30">
          <div className="w-[400px] rounded-xl bg-surface p-5 shadow-2xl">
            <p className="text-[15px] font-semibold">{t('shell.installCli.title')}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              {t('shell.installCli.desc')}
            </p>
            <p className="mt-2 rounded-lg bg-surface-tertiary px-3 py-2 font-mono text-[11.5px] text-text-secondary">
              {IS_WINDOWS
                ? 'irm https://code.kimi.com/kimi-code/install.ps1 | iex'
                : 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash'}
            </p>
            <p className="mt-2 text-[12px] text-text-tertiary">
              {t('shell.installCli.hint')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover"
                onClick={() => setInstallConfirm(false)}
              >
                {t('shell.installCli.cancel')}
              </button>
              <button
                className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
                onClick={() => {
                  setInstallConfirm(false)
                  doStart('local')
                }}
              >
                {t('shell.installCli.confirm')}
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
  // 应用自身更新:启动静默自检发现新版时标题栏升级图标加红点角标;
  // 结果写入全局 store,设置页任何时候打开都能直接看到
  useEffect(() => window.kimiApi.onAppUpdateAvailable((info) => useUi.getState().setAppUpdate(info)), [])
  // 下载进度监听挂在常驻的 ShellHome 上:设置页切换 tab 会卸载,挂页面上会丢进度
  useEffect(() => window.kimiApi.onAppUpdateProgress((p) => useUi.getState().setAppProgress(p)), [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 导航已收进标题栏图标(TitleBar);对话区常驻挂载(切视图只隐藏),
          避免重载官方 UI 丢失会话状态;SkinStandee 垫底(z-0),各视图内容 relative 在其上 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <SkinStandee />
        <div className={`min-h-0 flex-1 flex-col ${view === 'chat' ? 'flex' : 'hidden'}`}>
          <WebFrame />
        </div>
        {view === 'stats' && (
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <StatsPage />
          </div>
        )}
        {view === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}
