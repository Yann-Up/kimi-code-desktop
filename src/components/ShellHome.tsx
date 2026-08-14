/**
 * ShellHome: 服务就绪后的主壳布局。
 * 顶部导航行:对话 / 统计 / 设置 三个 tab + 右侧额度条(QuotaStrip)。
 * 对话 = 官方 web UI iframe(webUiUrl 取 src,server:ready 带新 token 时重建);
 * Git 功能由官方 UI 自带(会话内"改动"面板),壳不再重复实现。
 */
import { useEffect, useState } from 'react'
import { Gauge, MessageSquare, Settings2 } from 'lucide-react'
import { QuotaStrip } from './QuotaStrip'
import { SettingsPage } from '../pages/SettingsPage'
import { UsageSettings } from '../pages/settings/UsageSettings'
import { useUi } from '../stores/ui'

/** 对话 tab:官方 web UI iframe */
function WebFrame(props: { onBackToStart: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // server 代次:server:ready 带新 token(服务重启)时 +1,重建 iframe 避免旧 token 失效
  const [gen, setGen] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    // 就绪事件与 server_info 落盘之间存在时序窗口,失败做有限重试再放弃
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
      if (!cancelled) setError(lastErr)
    })()
    return () => {
      cancelled = true
    }
  }, [gen])

  useEffect(
    () =>
      window.kimiApi.onServerReady((info) => {
        if (info.token) {
          setSrc(null)
          setGen((g) => g + 1)
        }
      }),
    []
  )

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-text-secondary">Kimi Code 服务未运行,无法加载对话界面</p>
        <p className="text-[11px] text-text-tertiary">{error}</p>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
            onClick={() => {
              setError(null)
              setGen((g) => g + 1)
            }}
          >
            重试
          </button>
          <button
            className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
            onClick={props.onBackToStart}
          >
            返回启动页
          </button>
        </div>
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex flex-1 items-center justify-center">
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

export function ShellHome(props: { onBackToStart: () => void }) {
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

      {/* tab 内容:对话 iframe 常驻挂载(切 tab 只隐藏),避免重载官方 UI 丢失会话状态 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 flex-col ${view === 'chat' ? 'flex' : 'hidden'}`}>
          <WebFrame onBackToStart={props.onBackToStart} />
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
