/**
 * QuotaStrip: 标题栏铺平式用量直显(壳的特色:用户一眼看到当前用量,不藏进弹层)。
 * 数据:GET /api/v1/oauth/usage(kind=ok 时 summary/limits 各窗口额度);
 * 窗口驱动渲染(5 小时/1 周/月度,服务端返回什么显示什么)。
 * 每 N 秒轮询(设置页可配)+ 轮次结束(session:turn-ended)自动刷新。
 * 服务未运行时整条隐藏(对话页占位图会提示);停止服务按钮在条尾,带确认弹窗。
 */
import { useEffect, useState } from 'react'
import { OctagonX, Zap } from 'lucide-react'
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

/** 铺平式迷你额度计:一行「标签 + 占比(彩色) + 重置倒计时」+ 底部 3px 进度条 */
function QuotaMeter({ w }: { w: QuotaWindow }) {
  const used = typeof w.used === 'number' ? w.used : 0
  const limit = typeof w.limit === 'number' && w.limit > 0 ? w.limit : 0
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const hint = resetHint(w.reset_at)
  const color = limit > 0 ? meterColor(pct) : 'var(--color-text)'
  return (
    <div
      className="flex w-[104px] shrink-0 flex-col justify-center gap-1"
      title={`${windowLabel(w)}额度:已用 ${used}${limit ? ` / ${limit}` : ''}${hint ? `,${hint}` : ''}`}
    >
      <div className="flex items-baseline gap-1 whitespace-nowrap text-[11px]">
        <span className="shrink-0 text-text-tertiary">{windowLabel(w)}</span>
        <span className="shrink-0 text-[12.5px] font-semibold tabular-nums" style={{ color }}>
          {limit === 100 ? `${used}%` : limit > 0 ? `${used}/${limit}` : `${used}`}
        </span>
        {hint && <span className="truncate text-text-tertiary">{hint}</span>}
      </div>
      {limit > 0 && (
        <span className="h-[3px] w-full overflow-hidden rounded-full bg-surface-tertiary">
          <span
            className="block h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </span>
      )}
    </div>
  )
}

/** 最近一次 API 调用的实时指标(TTFT / 输出 tok/s,step.end 口径) */
interface LiveMetrics {
  model: string
  time: number
  ttftMs?: number
  tpsExcl?: number
  tpsIncl?: number
}

/** 实时指标块:单行胶囊,TTFT + 输出速度;悬浮显示模型与两种 TPS 口径。
 *  active=false(服务在跑但无活跃会话)时降透明度、输出速率归零 */
function LiveMetricsBlock({ m, active }: { m: LiveMetrics; active: boolean }) {
  const tip = active
    ? `${m.model} · ${new Date(m.time).toLocaleTimeString()}\n输出 TPS(不含首 token):${
        m.tpsExcl !== undefined ? m.tpsExcl.toFixed(1) : '—'
      } tok/s\n输出 TPS(含首 token):${m.tpsIncl !== undefined ? m.tpsIncl.toFixed(1) : '—'} tok/s`
    : `${m.model} · 当前无进行中会话`
  return (
    <div
      className={`flex shrink-0 items-center gap-2.5 rounded-lg bg-surface-secondary px-3 py-1.5 transition-opacity ${
        active ? '' : 'opacity-55'
      }`}
      title={tip}
    >
      <Zap size={12} className="shrink-0 text-primary" />
      <span className="flex items-baseline gap-1.5">
        <span className="text-[11px] text-text-tertiary">TTFT</span>
        <span className="text-[13px] font-semibold tabular-nums text-text">
          {m.ttftMs !== undefined ? `${(m.ttftMs / 1000).toFixed(2)} s` : '—'}
        </span>
      </span>
      <span className="h-3.5 w-px shrink-0 bg-border" />
      <span className="flex items-baseline gap-1.5">
        <span className="text-[11px] text-text-tertiary">输出</span>
        <span className="text-[13px] font-semibold tabular-nums text-text">
          {active ? (m.tpsExcl !== undefined ? `${m.tpsExcl.toFixed(1)} tok/s` : '—') : '0.0 tok/s'}
        </span>
      </span>
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
  // 最近一次 API 调用的 TTFT / 输出速度(wire.jsonl step.end 直读,3s 轮询 + 轮次结束即刷)
  const [live, setLive] = useState<LiveMetrics | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      window.kimiApi
        .localApiCalls(1, 1, activeChannel)
        .then((r) => {
          if (cancelled) return
          const it = r.items?.[0]
          if (!it) {
            setLive(null)
            return
          }
          const tpsExcl =
            it.streamMs && it.streamMs > 0 && it.output > 0
              ? it.output / (it.streamMs / 1000)
              : undefined
          const totalMs = (it.ttftMs ?? 0) + (it.streamMs ?? 0)
          const tpsIncl =
            it.ttftMs !== undefined && totalMs > 0 && it.output > 0
              ? it.output / (totalMs / 1000)
              : undefined
          setLive({ model: it.model, time: it.time, ttftMs: it.ttftMs, tpsExcl, tpsIncl })
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 3000)
    const offTurn = window.kimiApi.onTurnEnded(load)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      offTurn()
    }
  }, [activeChannel])

  // 指标胶囊:服务运行期间常驻;最近一次调用距今 ≤ 5 分钟视为有活跃会话(全亮),
  // 超过则降透明度、输出速率归零;服务未运行/从未有过调用时隐藏
  const liveActive = live !== null && Date.now() - live.time < 5 * 60_000

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
        setLive(null)
      }),
      window.kimiApi.onServerExited((info) => {
        if (info.channel !== activeChannel) return
        setSvcRunning(false)
        setWindows([])
        setWallet(null)
        setLive(null)
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
    <div className="relative flex h-full items-center gap-3">
      {/* 铺平直显:实时指标胶囊 + 各窗口迷你额度计 + 钱包 + 停止服务 */}
      {svcRunning && (
        <>
          {live && <LiveMetricsBlock m={live} active={liveActive} />}
          {windows.map((w, i) => (
            <QuotaMeter key={i} w={w} />
          ))}
          {/* booster 钱包:余额(账号有才显示,悬浮看总额) */}
          {wallet && typeof wallet.balance_cents === 'number' && (
            <span
              className="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-[11px] text-text-tertiary"
              title={`booster 钱包余额(总额 ${fmtMoney(wallet.total_cents, currency)})`}
            >
              钱包
              <span className="text-[12.5px] font-semibold tabular-nums text-text">
                {fmtMoney(wallet.balance_cents, currency)}
              </span>
            </span>
          )}
          {monthlyPct !== null && wallet && (
            <div
              className="flex w-[72px] shrink-0 flex-col justify-center gap-1"
              title={`月度消费上限:已用 ${fmtMoney(wallet.monthly_used_cents, currency)} / ${fmtMoney(wallet.monthly_charge_limit_cents, currency)}`}
            >
              <div className="flex items-baseline gap-1 whitespace-nowrap text-[11px]">
                <span className="text-text-tertiary">月度</span>
                <span
                  className="text-[12.5px] font-semibold tabular-nums"
                  style={{ color: meterColor(monthlyPct) }}
                >
                  {monthlyPct.toFixed(0)}%
                </span>
              </div>
              <span className="h-[3px] w-full overflow-hidden rounded-full bg-surface-tertiary">
                <span
                  className="block h-full rounded-full transition-all duration-500"
                  style={{ width: `${monthlyPct}%`, background: meterColor(monthlyPct) }}
                />
              </span>
            </div>
          )}
          <button
            className="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-danger-soft hover:text-danger"
            title="停止 Kimi Code 服务"
            onClick={() => setConfirming(true)}
          >
            <OctagonX size={15} />
          </button>
        </>
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
                className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
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
