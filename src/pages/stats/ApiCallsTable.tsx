import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Coins, Cpu, Gauge, RefreshCw, Timer, Zap } from 'lucide-react'
import { Section, Card, Empty } from '../../components/settings/common'
import type { ApiCallItem, ApiCallsResult } from '../../platform/kimi-api'

/** tokens 人性化:亿 / 万 / 原值(与 UsageSettings 口径一致) */
function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}万`
  return Math.round(n).toLocaleString('zh-CN')
}

function fmtCount(n: number): string {
  return Math.round(n || 0).toLocaleString('zh-CN')
}

/** 毫秒人性化:<1s 显示 ms,否则秒(1 位小数) */
function fmtMs(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}`
  return `${(ms / 1000).toFixed(1)}s`
}

/** TPS 人性化:1 位小数 */
function fmtTps(v?: number): string {
  if (v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(1)
}

/** 毫秒时间戳 → MM-DD HH:mm:ss */
function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 模型短名:取 / 后部分 */
function shortModel(m: string): string {
  return m.split('/').pop() || m
}

/** workspace 目录名 wd_<name>_<hash> → name(会话列展示用) */
function shortWorkspace(w: string): string {
  const m = /^wd_(.+)_[0-9a-f]{12}$/.exec(w)
  return m ? m[1] : w
}

/** 单次调用的输出 TPS:不含首 token 时间 / 含首 token 时间 */
function rowTps(r: ApiCallItem): { excl?: number; incl?: number } {
  const excl =
    r.streamMs && r.streamMs > 0 && r.output > 0 ? r.output / (r.streamMs / 1000) : undefined
  const incl =
    r.ttftMs !== undefined && r.streamMs !== undefined && r.ttftMs + r.streamMs > 0 && r.output > 0
      ? r.output / ((r.ttftMs + r.streamMs) / 1000)
      : undefined
  return { excl, incl }
}

function StatCard(props: { icon: typeof Coins; label: string; value: string; sub?: string; color?: string }) {
  const { icon: Icon, label, value, sub, color = '#2563eb' } = props
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 transition-all hover:border-primary-border hover:shadow-sm">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}1a`, color }}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-text-tertiary">{label}</p>
        <p className="mt-0.5 truncate text-xl font-semibold leading-tight tabular-nums" title={value}>
          {value}
        </p>
        {sub && <p className="mt-0.5 truncate text-[11.5px] text-text-tertiary">{sub}</p>}
      </div>
    </div>
  )
}

const PAGE_SIZES = [20, 50, 100] as const

/** API 调用明细:逐次 LLM 调用(step.end 口径)的 tokens / TTFT / TPS,按时间倒序分页 */
export function ApiCallsTable() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(20)
  const [data, setData] = useState<ApiCallsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback((p: number, ps: number) => {
    setLoading(true)
    window.kimiApi
      .localApiCalls(p, ps)
      .then((r) => {
        setData(r)
        setErr('')
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : '读取 API 调用数据失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(page, pageSize)
  }, [page, pageSize, load])

  // 一轮对话结束后自动刷新当前页(额度条同款事件)
  useEffect(() => {
    return window.kimiApi.onTurnEnded(() => load(page, pageSize))
  }, [load, page, pageSize])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const summary = data?.summary

  const cards: { icon: typeof Coins; label: string; value: string; sub?: string; color?: string }[] = [
    {
      icon: Zap,
      label: 'API 调用次数',
      value: summary ? fmtCount(summary.totalCalls) : '—',
      sub: '全部会话合计',
      color: '#2563eb'
    },
    {
      icon: Coins,
      label: '输出 Tokens',
      value: summary ? fmtTokens(summary.totalOutput) : '—',
      sub: '全部会话合计',
      color: '#16a34a'
    },
    {
      icon: Timer,
      label: '平均 TTFT',
      value: summary ? fmtMs(summary.avgTtftMs) : '—',
      sub: '首 token 延迟',
      color: '#ea580c'
    },
    {
      icon: Gauge,
      label: '平均输出 TPS',
      value: summary ? fmtTps(summary.avgTpsExclFirst) : '—',
      sub: '不含首 token 时间',
      color: '#7c3aed'
    },
    {
      icon: Cpu,
      label: '平均输出 TPS',
      value: summary ? fmtTps(summary.avgTpsInclFirst) : '—',
      sub: '含首 token 时间',
      color: '#0891b2'
    }
  ]

  return (
    <Section title="API 调用" desc="逐次 LLM 调用的 tokens、TTFT 与输出速度(step.end 口径,含主代理与子代理)">
      <div className="flex items-center justify-between gap-3">
        {err ? <p className="text-[12px] text-danger">{err}</p> : <span />}
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:border-primary-border hover:text-primary disabled:opacity-50"
          disabled={loading}
          onClick={() => load(page, pageSize)}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className={`transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <StatCard key={c.label + (c.sub ?? '')} {...c} />
          ))}
        </div>

        <div className="mt-3" />

        {data && data.items.length === 0 && !err ? (
          <Empty text="暂无 API 调用记录" />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-secondary text-left text-text-tertiary">
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">时间</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">模型</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">会话</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">输入</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">缓存命中</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">缓存创建</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">输出</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">TTFT</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
                    TPS(不含首token)
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
                    TPS(含首token)
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r, i) => {
                  const tps = rowTps(r)
                  return (
                    <tr
                      key={`${r.sessionId}-${r.agentId}-${r.time}-${i}`}
                      className="border-b border-border-light last:border-0 hover:bg-surface-secondary"
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-text-secondary">
                        {fmtTime(r.time)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2" title={r.model}>
                        {shortModel(r.model)}
                      </td>
                      <td
                        className="max-w-[160px] truncate px-3 py-2 text-text-secondary"
                        title={`${r.workspace} / ${r.sessionId} / ${r.agentId}`}
                      >
                        {shortWorkspace(r.workspace)}
                        {r.agentId !== 'main' && (
                          <span className="ml-1 rounded bg-surface-tertiary px-1 text-[10.5px] text-text-tertiary">
                            {r.agentId}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtTokens(r.inputOther)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtTokens(r.inputCacheRead)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtTokens(r.inputCacheCreation)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtTokens(r.output)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtMs(r.ttftMs)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtTps(tps.excl)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtTps(tps.incl)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* 分页栏 */}
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
              <p className="text-[12px] tabular-nums text-text-tertiary">
                共 {fmtCount(data?.total ?? 0)} 条 · 第 {data?.page ?? page} / {totalPages} 页
              </p>
              <div className="flex items-center gap-2">
                <select
                  className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-text-secondary outline-none"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} 条/页
                    </option>
                  ))}
                </select>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary transition-colors hover:border-primary-border hover:text-primary disabled:opacity-40"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  title="上一页"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary transition-colors hover:border-primary-border hover:text-primary disabled:opacity-40"
                  disabled={loading || page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  title="下一页"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Section>
  )
}
