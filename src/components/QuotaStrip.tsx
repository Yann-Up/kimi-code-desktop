/**
 * QuotaStrip: 主壳顶部导航行右侧的额度条 + 停止服务入口。
 * 数据:GET /api/v1/oauth/usage(kind=ok 时 summary/limits 各窗口额度);
 * 窗口驱动渲染(5 小时/1 周/月度,服务端返回什么显示什么)。
 * 每 N 秒轮询(设置页可配)+ 轮次结束(session:turn-ended)自动刷新。
 * 服务未运行时不显示"停止服务"按钮,并清空额度显示。
 */
import { useEffect, useState } from 'react'
import { OctagonX } from 'lucide-react'
import { rest } from '../api'
import { useUi } from '../stores/ui'

interface QuotaWindow {
  window?: { duration?: number; unit?: string }
  used?: number
  limit?: number
  reset_at?: string
}

/** booster 钱包(有总额度/月度消费上限的账号才有,无则为 null) */
interface BoosterWallet {
  balance_cents?: number
  total_cents?: number
  monthly_charge_limit_enabled?: boolean
  monthly_charge_limit_cents?: number
  monthly_used_cents?: number
  currency?: string
}

interface QuotaData {
  kind?: string
  summary?: QuotaWindow
  limits?: QuotaWindow[]
  extra_usage?: BoosterWallet | null
}

/** 分 → "12.34 USD" */
function fmtMoney(cents: number | undefined, currency: string): string {
  if (typeof cents !== 'number') return '—'
  return `${(cents / 100).toFixed(2)} ${currency}`
}

const UNIT_ZH: Record<string, string> = {
  hour: '小时',
  day: '天',
  week: '周',
  month: '月'
}

/** {duration:5,unit:"hour"} → "5 小时";{duration:1,unit:"week"} → "1 周" */
function windowLabel(w: QuotaWindow): string {
  const d = w.window?.duration ?? 0
  const u = w.window?.unit ?? ''
  const unit = UNIT_ZH[u] ?? u
  return d > 0 ? `${d} ${unit}` : '额度'
}

/** 窗口排序:小时 < 天 < 周 < 月 < 其它 */
function windowRank(w: QuotaWindow): number {
  const order: Record<string, number> = { hour: 0, day: 1, week: 2, month: 3 }
  return order[w.window?.unit ?? ''] ?? 4
}

/** reset_at → "3 小时后重置" / "2 天后重置" */
function resetHint(resetAt: string | undefined): string {
  if (!resetAt) return ''
  const ms = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return '即将重置'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(1, m)} 分钟后重置`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时后重置`
  return `${Math.floor(h / 24)} 天后重置`
}

/** 用量占比 → 颜色档位 */
function meterColor(pct: number): string {
  if (pct >= 85) return 'var(--color-danger)'
  if (pct >= 60) return 'var(--color-warning)'
  return 'var(--color-primary)'
}

function QuotaMeter({ w }: { w: QuotaWindow }) {
  const used = typeof w.used === 'number' ? w.used : 0
  const limit = typeof w.limit === 'number' && w.limit > 0 ? w.limit : 0
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const hint = resetHint(w.reset_at)
  const color = limit > 0 ? meterColor(pct) : 'var(--color-text)'
  return (
    <div
      className="flex w-44 shrink-0 flex-col justify-center gap-1.5"
      title={`${windowLabel(w)}额度:已用 ${used}${limit ? ` / ${limit}` : ''}${hint ? `,${hint}` : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="shrink-0 text-[12.5px] font-medium text-text-secondary">
          {windowLabel(w)}
        </span>
        <span className="shrink-0 text-[13.5px] font-semibold tabular-nums" style={{ color }}>
          {limit === 100 ? `${used}%` : limit > 0 ? `${used}/${limit}` : `${used}`}
          {hint && (
            <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">{hint}</span>
          )}
        </span>
      </div>
      {limit > 0 && (
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
          <span
            className="block h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </span>
      )}
    </div>
  )
}

export function QuotaStrip() {
  const [windows, setWindows] = useState<QuotaWindow[]>([])
  const [wallet, setWallet] = useState<BoosterWallet | null>(null)
  // 停止服务确认:停止会杀掉 iframe 内官方 UI 的所有进行中会话,统一弹确认
  const [confirming, setConfirming] = useState(false)
  // 停止服务进行中(stop_backend 要等 kimi web 优雅退出,需要数秒,期间给进度反馈)
  const [stopping, setStopping] = useState(false)
  // 服务运行状态:未运行时不显示"停止服务"按钮(与对话页占位图状态互斥)
  const [svcRunning, setSvcRunning] = useState(false)
  // 自动刷新间隔(秒,0=关闭;设置页可配,轮次结束仍会立即刷新)
  const refreshSecs = useUi((s) => s.quotaRefreshSecs)
  // 额度条跟随激活通道:切换通道后重新探测并监听该通道事件
  const activeChannel = useUi((s) => s.activeChannel)

  useEffect(() => {
    window.kimiApi
      .appInfo(activeChannel)
      .then((i: { cliVersion: string | null }) => setSvcRunning(i.cliVersion !== null))
      .catch(() => {})
    const offs = [
      window.kimiApi.onServerReady((info) => {
        if (info.channel !== activeChannel) return
        setSvcRunning(true)
      }),
      window.kimiApi.onServerStopped((info) => {
        if (info.channel !== activeChannel) return
        setSvcRunning(false)
        setWindows([])
        setWallet(null)
      }),
      window.kimiApi.onServerExited((info) => {
        if (info.channel !== activeChannel) return
        setSvcRunning(false)
        setWindows([])
        setWallet(null)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [activeChannel])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      rest<QuotaData>('/api/v1/oauth/usage')
        .then((d) => {
          if (cancelled || !d || d.kind !== 'ok') return
          const list = [d.summary, ...(Array.isArray(d.limits) ? d.limits : [])]
            .filter((w): w is QuotaWindow => !!w && typeof w === 'object')
            .sort((a, b) => windowRank(a) - windowRank(b))
          setWindows(list)
          setWallet(d.extra_usage ?? null)
        })
        .catch(() => {})
    }
    load()
    // refreshSecs=0 时不挂定时器(仅 turn.ended 触发刷新)
    const timer = refreshSecs > 0 ? window.setInterval(load, refreshSecs * 1000) : null
    // 轮次结束(替代旧版 busy 驱动刷新)
    const offTurn = window.kimiApi.onTurnEnded(() => load())
    return () => {
      cancelled = true
      if (timer !== null) window.clearInterval(timer)
      offTurn()
    }
  }, [refreshSecs, activeChannel])

  const currency = wallet?.currency ?? 'USD'
  const monthlyPct =
    wallet?.monthly_charge_limit_enabled && (wallet.monthly_charge_limit_cents ?? 0) > 0
      ? Math.min(100, ((wallet.monthly_used_cents ?? 0) / wallet.monthly_charge_limit_cents!) * 100)
      : null

  return (
    <div className="flex min-h-12 shrink-0 items-center justify-between gap-4 px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-6">
        {windows.map((w, i) => (
          <QuotaMeter key={i} w={w} />
        ))}
        {/* booster 钱包:余额 + 月度消费上限(账号有才显示) */}
        {wallet && typeof wallet.balance_cents === 'number' && (
          <div
            className="flex shrink-0 flex-col justify-center"
            title={`booster 钱包余额(总额 ${fmtMoney(wallet.total_cents, currency)})`}
          >
            <span className="text-[12.5px] font-medium text-text-secondary">钱包</span>
            <span className="text-[13.5px] font-semibold tabular-nums text-text">
              {fmtMoney(wallet.balance_cents, currency)}
            </span>
          </div>
        )}
        {monthlyPct !== null && wallet && (
          <div
            className="flex w-44 shrink-0 flex-col justify-center gap-1.5"
            title={`月度消费上限:已用 ${fmtMoney(wallet.monthly_used_cents, currency)} / ${fmtMoney(wallet.monthly_charge_limit_cents, currency)}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="shrink-0 text-[12.5px] font-medium text-text-secondary">月度</span>
              <span
                className="shrink-0 text-[13.5px] font-semibold tabular-nums"
                style={{ color: meterColor(monthlyPct) }}
              >
                {monthlyPct.toFixed(0)}%
              </span>
            </div>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
              <span
                className="block h-full rounded-full transition-all duration-500"
                style={{ width: `${monthlyPct}%`, background: meterColor(monthlyPct) }}
              />
            </span>
          </div>
        )}
      </div>
      {svcRunning && (
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-text-tertiary hover:bg-danger-soft hover:text-danger"
          title="停止 Kimi CLI 服务"
          onClick={() => setConfirming(true)}
        >
          <OctagonX size={14} /> 停止服务
        </button>
      )}

      {/* 停止服务确认:停服务会杀掉所有进行中的会话,统一弹确认 */}
      {confirming && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/30">
          <div className="w-[380px] rounded-xl bg-surface p-5 shadow-2xl">
            <p className="text-[15px] font-semibold">停止 Kimi Code 服务?</p>
            <p className="mt-2 text-[13px] text-text-secondary">
              停止服务将中断所有进行中的会话,对话页不可用;之后可随时在设置 → 常规重新启动。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
                disabled={stopping}
                onClick={() => setConfirming(false)}
              >
                取消
              </button>
              <button
                className="flex items-center gap-2 rounded-lg bg-danger px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-70"
                disabled={stopping}
                onClick={() => {
                  setStopping(true)
                  // stop_backend resolve 即服务端已停妥(server:stopped 随后更新各页面)
                  void window.kimiApi
                    .stopBackend(activeChannel)
                    .catch(() => {})
                    .finally(() => {
                      setStopping(false)
                      setConfirming(false)
                    })
                }}
              >
                {stopping && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-white" />
                )}
                {stopping ? '正在停止…' : '停止服务'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
