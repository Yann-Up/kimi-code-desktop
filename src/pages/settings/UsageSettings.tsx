import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Coins, Cpu, Flame, Layers, MessagesSquare } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'

interface DailyUsage {
  date: string // YYYY-MM-DD
  models: Record<string, number>
  total: number
}

interface UsageDailyReport {
  days: DailyUsage[]
  modelTotals: Record<string, number>
  activeDays: number
  streak: number
  turns: number
  sessions: number
}

type RangeDays = 7 | 30

const HEATMAP_WEEKS = 52
const HEATMAP_DAYS = HEATMAP_WEEKS * 7
/** 堆叠/donut 调色板:蓝/绿/橙/紫/青/灰(其他) */
const MODEL_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#64748b']
/** 热力图 5 档:灰(无)→浅蓝→深蓝 */
const HEAT_COLORS = ['#f1f5f9', '#dbeafe', '#93c5fd', '#3b82f6', '#1e40af']

/** tokens 人性化:亿 / 万 / 原值 */
function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}万`
  return Math.round(n).toLocaleString('zh-CN')
}

function fmtCount(n: number): string {
  return Math.round(n || 0).toLocaleString('zh-CN')
}

/** 模型短名:取 / 后部分 */
function shortModel(m: string): string {
  return m.split('/').pop() || m
}

function toKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function todayZero(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** YYYY-MM-DD → M/D */
function fmtMD(key: string): string {
  const parts = key.split('-').map(Number)
  return `${parts[1]}/${parts[2]}`
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

/** GitHub 风格活跃热力图:每列一周(周日起),每格一天 */
function Heatmap({ days }: { days: DailyUsage[] }) {
  const { weeks, monthLabels } = useMemo(() => {
    const totals = new Map(days.map((d) => [d.date, d.total]))
    const today = todayZero()
    const start = todayZero()
    // 回退到(15 周前的那天)所在的周日
    start.setDate(start.getDate() - (HEATMAP_WEEKS - 1) * 7 - start.getDay())
    const weeks: { key: string; total: number; future: boolean; month: number }[][] = []
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const col: { key: string; total: number; future: boolean; month: number }[] = []
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(start)
        d.setDate(start.getDate() + w * 7 + dow)
        const key = toKey(d)
        col.push({
          key,
          total: totals.get(key) ?? 0,
          future: d.getTime() > today.getTime(),
          month: d.getMonth()
        })
      }
      weeks.push(col)
    }
    const monthLabels = weeks.map((col, w) =>
      w === 0 || col[0].month !== weeks[w - 1][0].month ? `${col[0].month + 1}月` : ''
    )
    return { weeks, monthLabels }
  }, [days])

  const max = useMemo(() => days.reduce((a, d) => Math.max(a, d.total), 0), [days])

  const level = (total: number): number => {
    if (total <= 0 || max <= 0) return 0
    const r = total / max
    return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4
  }

  return (
    <div
      className="grid w-full"
      style={{ gridTemplateColumns: `1.4rem repeat(${HEATMAP_WEEKS}, 1fr)`, gap: 2 }}
    >
      <div />
      {monthLabels.map((m, i) => (
        <div
          key={i}
          className="min-w-0 whitespace-nowrap text-[10px] leading-[13px] text-text-tertiary"
        >
          {m}
        </div>
      ))}
      {weeks[0].map((_, dow) => (
        <Fragment key={dow}>
          <div className="flex items-center justify-end pr-1 text-[10px] leading-none text-text-tertiary">
            {dow === 1 ? '一' : dow === 3 ? '三' : dow === 5 ? '五' : ''}
          </div>
          {weeks.map((col, w) => {
            const c = col[dow]
            return (
              <div
                key={w}
                title={`${c.key} · ${c.total > 0 ? `${fmtTokens(c.total)} tokens` : '无记录'}`}
                className="aspect-square w-full min-w-0 rounded-[3px] transition-transform hover:scale-125"
                style={{
                  background: HEAT_COLORS[level(c.total)],
                  visibility: c.future ? 'hidden' : 'visible'
                }}
              />
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}

interface StackPart {
  name: string
  color: string
  v: number
}

interface StackDay {
  date: string
  total: number
  parts: StackPart[]
}

/** 按天堆叠柱状图:每模型一色,X 轴稀疏标签 */
function TrendChart({
  days,
  models
}: {
  days: StackDay[]
  models: { name: string; color: string }[]
}) {
  const maxDay = Math.max(1, ...days.map((d) => d.total))
  const step = days.length > 14 ? 5 : days.length > 8 ? 2 : 1
  return (
    <div>
      <div className="relative h-40">
        {[0, 25, 50, 75, 100].map((p) => (
          <div
            key={p}
            className="absolute inset-x-0 border-t border-dashed border-border-light"
            style={{ top: `${p}%` }}
          />
        ))}
        <div className="absolute inset-0 flex items-end gap-1">
          {days.map((d) => {
            const topIdx = d.parts.findIndex((p) => p.v > 0)
            const tip = [
              d.date,
              ...d.parts.filter((p) => p.v > 0).map((p) => `${shortModel(p.name)} ${fmtTokens(p.v)}`),
              `合计 ${fmtTokens(d.total)}`
            ].join('\n')
            return (
              <div
                key={d.date}
                className="group flex h-full flex-1 justify-center rounded-t-md transition-colors hover:bg-surface-secondary/70"
                title={tip}
              >
                <div className="flex h-full w-full max-w-7 flex-col justify-end gap-px">
                  {d.total === 0 ? (
                    <div className="h-[2px] w-full rounded-sm bg-surface-tertiary" />
                  ) : (
                    d.parts.map((p, i) =>
                      p.v > 0 ? (
                        <div
                          key={i}
                          className="w-full transition-opacity group-hover:opacity-75"
                          style={{
                            height: `${(p.v / maxDay) * 100}%`,
                            background: p.color,
                            borderRadius: i === topIdx ? '3px 3px 0 0' : undefined
                          }}
                        />
                      ) : null
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-1">
        {days.map((d, i) => (
          <div
            key={d.date}
            className="flex-1 text-center text-[10px] tabular-nums text-text-tertiary"
          >
            {i % step === 0 || i === days.length - 1 ? fmtMD(d.date) : ''}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {models.map((m) => (
          <span key={m.name} className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
            {shortModel(m.name)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 模型用量环形图 + 明细行,hover 联动高亮 */
function Donut({
  rows,
  total
}: {
  rows: { name: string; value: number; color: string }[]
  total: number
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const R = 62
  const C = 2 * Math.PI * R
  const gap = rows.length > 1 ? 2.5 : 0
  let acc = 0
  return (
    <div className="flex items-center gap-6">
      <div className="relative aspect-square w-1/3 min-w-40 max-w-60 shrink-0">
        <svg viewBox="0 0 160 160" className="h-full w-full">
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--color-surface-tertiary)" strokeWidth="16" />
          {rows.map((r) => {
            const len = total > 0 ? (r.value / total) * C : 0
            const off = acc
            acc += len
            if (len <= 0) return null
            const dash = Math.max(len - gap, 0.5)
            return (
              <circle
                key={r.name}
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={r.color}
                strokeWidth={hovered === r.name ? 20 : 16}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-(off + gap / 2)}
                transform="rotate(-90 80 80)"
                opacity={hovered && hovered !== r.name ? 0.35 : 1}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHovered(r.name)}
                onMouseLeave={() => setHovered(null)}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums">{fmtTokens(total)}</span>
          <span className="text-[11px] text-text-tertiary">tokens 总计</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        {rows.map((r) => (
          <div
            key={r.name}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
              hovered === r.name ? 'bg-surface-secondary' : ''
            }`}
            onMouseEnter={() => setHovered(r.name)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} />
            <span className="min-w-0 flex-1 truncate text-[13px]" title={r.name}>
              {shortModel(r.name)}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-text-secondary">
              {fmtTokens(r.value)}
            </span>
            <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-text-tertiary">
              {total > 0 ? ((r.value / total) * 100).toFixed(1) : '0.0'}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface UsageTodayReport {
  buckets: {
    slot: number
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
    turns: number
  }[]
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheCreation: number
  totalTurns: number
}

/** 实时趋势系列(对齐 ccswitch:输入/输出/缓存命中/缓存创建) */
const LIVE_SERIES = [
  { key: 'input', totalKey: 'totalInput', label: '输入', color: '#2563eb' },
  { key: 'output', totalKey: 'totalOutput', label: '输出', color: '#16a34a' },
  { key: 'cacheRead', totalKey: 'totalCacheRead', label: '缓存命中', color: '#7c3aed' },
  { key: 'cacheCreation', totalKey: 'totalCacheCreation', label: '缓存创建', color: '#ea580c' }
] as const

type SeriesKey = (typeof LIVE_SERIES)[number]['key']

/** 槽位 → "H:00/H:30" */
function fmtSlot(slot: number): string {
  return `${slot >> 1}:${slot % 2 ? '30' : '00'}`
}

/** 坐标轴刻度:1k / 1.5M 风格 */
function fmtAxis(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`
  return `${Math.round(v)}`
}

/** Y 轴上限取整:1/2/5 × 10^n */
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return f * p
}

/**
 * 今日实时趋势(ccswitch 风格多系列折线图)。
 * 响应式:ResizeObserver 量出容器实际像素宽后按真实坐标渲染 SVG,
 * 跟随窗口任意拉伸,不用 preserveAspectRatio(避免非等比变形)。
 */
function LiveTrend() {
  const [data, setData] = useState<UsageTodayReport | null>(null)
  const [err, setErr] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [width, setWidth] = useState(0)
  // 注意:图表容器仅在 data 就绪后才挂载,不能用 [] 依赖的 effect 取 ref,
  // 必须用 callback ref,在元素真正出现时建立 ResizeObserver。
  const roRef = useRef<ResizeObserver | null>(null)
  const wrapRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  useEffect(() => () => roRef.current?.disconnect(), [])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      // 页面在后台时跳过轮询(不产生无意义的全量扫描);恢复可见时由 onVisible 立即补一次
      if (document.hidden) return
      window.kimiApi
        .localUsageToday()
        .then((r) => {
          if (cancelled) return
          setData(r as UsageTodayReport)
          setErr('')
          setUpdatedAt(new Date())
        })
        .catch((e: unknown) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : '读取失败')
        })
    }
    load()
    const timer = window.setInterval(load, 15_000)
    const onVisible = () => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const H = 220
  const PL = 46
  const PR = 14
  const PT = 12
  const PB = 26

  const now = new Date()
  const curSlot = ((now.getHours() * 60 + now.getMinutes()) / 30) | 0
  const buckets = data?.buckets ?? []
  const visible = buckets.filter((b) => b.slot <= curSlot)

  const rawMax = Math.max(
    0,
    ...visible.flatMap((b) => LIVE_SERIES.map((s) => b[s.key as SeriesKey]))
  )
  const yMax = niceCeil(rawMax || 1)

  const x = (slot: number) => PL + (slot / 47) * (width - PL - PR)
  const y = (v: number) => PT + (1 - v / yMax) * (H - PT - PB)

  const paths = LIVE_SERIES.map((s) => {
    const pts = visible.filter((b) => (b[s.key as SeriesKey] as number) >= 0)
    if (!pts.length) return { ...s, d: '' }
    let d = `M ${x(pts[0].slot)} ${y(pts[0][s.key as SeriesKey])}`
    for (const b of pts.slice(1)) d += ` L ${x(b.slot)} ${y(b[s.key as SeriesKey])}`
    return { ...s, d }
  })

  const hoverBucket = hover !== null ? buckets[hover] : null
  const totalTokens = data
    ? data.totalInput + data.totalOutput + data.totalCacheRead + data.totalCacheCreation
    : 0
  const hitRate =
    data && data.totalCacheRead + data.totalInput > 0
      ? ((data.totalCacheRead / (data.totalCacheRead + data.totalInput)) * 100).toFixed(1)
      : null

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const slot = Math.round(((e.clientX - rect.left - PL) / (width - PL - PR)) * 47)
    setHover(Math.max(0, Math.min(curSlot, slot)))
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <span className="text-[13px] font-medium">今日实时趋势</span>
        </div>
        <div className="flex items-baseline gap-3 text-[12px] text-text-tertiary">
          {data && (
            <span>
              合计 <span className="font-semibold tabular-nums text-text">{fmtTokens(totalTokens)}</span> tokens
              · <span className="tabular-nums">{fmtCount(data.totalTurns)}</span> 条消息
              {hitRate !== null && (
                <>
                  {' '}· 缓存命中率 <span className="tabular-nums text-success">{hitRate}%</span>
                </>
              )}
            </span>
          )}
          {updatedAt && (
            <span className="tabular-nums">
              {updatedAt.toLocaleTimeString('zh-CN', { hour12: false })} 更新
            </span>
          )}
        </div>
      </div>

      {err ? (
        <p className="text-[12px] text-danger">{err}</p>
      ) : !data ? (
        <Empty text="加载中…" />
      ) : (
        <>
          <div ref={wrapRef} className="relative">
            {width > 0 && (
              <svg
                width={width}
                height={H}
                className="block cursor-crosshair"
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
              >
                {/* Y 轴网格与刻度 */}
                {[0, 1, 2, 3, 4].map((i) => {
                  const v = (yMax / 4) * i
                  const yy = y(v)
                  return (
                    <g key={i}>
                      <line
                        x1={PL}
                        x2={width - PR}
                        y1={yy}
                        y2={yy}
                        stroke="var(--color-border-light)"
                        strokeDasharray={i === 0 ? undefined : '3 4'}
                      />
                      <text
                        x={PL - 6}
                        y={yy + 3}
                        textAnchor="end"
                        className="fill-text-tertiary"
                        fontSize={10}
                      >
                        {fmtAxis(v)}
                      </text>
                    </g>
                  )
                })}
                {/* X 轴刻度(每 3 小时) */}
                {Array.from({ length: 48 }, (_, s) =>
                  s % 6 === 0 && s <= 47 ? (
                    <text
                      key={s}
                      x={x(s)}
                      y={H - 8}
                      textAnchor={s === 0 ? 'start' : s >= 42 ? 'end' : 'middle'}
                      className="fill-text-tertiary"
                      fontSize={10}
                    >
                      {`${s >> 1}:00`}
                    </text>
                  ) : null
                )}
                {/* 系列折线 */}
                {paths.map((p) =>
                  p.d ? (
                    <path
                      key={p.key}
                      d={p.d}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={hover !== null ? 0.9 : 1}
                    />
                  ) : null
                )}
                {/* hover 引导线与命中点 */}
                {hover !== null && hoverBucket && (
                  <g>
                    <line
                      x1={x(hover)}
                      x2={x(hover)}
                      y1={PT}
                      y2={H - PB}
                      stroke="var(--color-border)"
                    />
                    {LIVE_SERIES.map((s) => (
                      <circle
                        key={s.key}
                        cx={x(hover)}
                        cy={y(hoverBucket[s.key as SeriesKey])}
                        r={3}
                        fill={s.color}
                        stroke="#fff"
                        strokeWidth={1.5}
                      />
                    ))}
                  </g>
                )}
              </svg>
            )}
            {/* hover 明细浮层 */}
            {hover !== null && hoverBucket && width > 0 && (
              <div
                className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg"
                style={{
                  left:
                    x(hover) > width * 0.68
                      ? Math.max(0, x(hover) - 170)
                      : Math.min(width - 160, x(hover) + 12)
                }}
              >
                <p className="mb-1 text-[11px] font-medium text-text-secondary">
                  {fmtSlot(hover)} · {hoverBucket.turns} 条消息
                </p>
                {LIVE_SERIES.map((s) => (
                  <div key={s.key} className="flex items-center gap-1.5 text-[11px]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-text-tertiary">{s.label}</span>
                    <span className="ml-auto tabular-nums text-text-secondary">
                      {fmtTokens(hoverBucket[s.key as SeriesKey])}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* 图例 */}
          <div className="mt-2 flex items-center justify-center gap-x-5">
            {LIVE_SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
                {data && (
                  <span className="tabular-nums text-text-tertiary">
                    {fmtTokens(data[s.totalKey])}
                  </span>
                )}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

export function UsageSettings() {
  const [range, setRange] = useState<RangeDays>(30)
  // 364 天全量(仅请求一次):热力图 + 统计卡中可从 days 推导的字段(tokens/models/activeDays/streak)
  const [data, setData] = useState<UsageDailyReport | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [heatErr, setHeatErr] = useState('')
  // turns/sessions 无法从 days 切片推导:按范围保留原请求(命中 Rust 缓存,开销可忽略)
  const [rangeUsage, setRangeUsage] = useState<
    Pick<UsageDailyReport, 'turns' | 'sessions'> | null
  >(null)

  // 全量数据一次拉取:热力图 + 统计卡推导共用,不随 range 切换重扫
  useEffect(() => {
    window.kimiApi
      .localUsageDaily(HEATMAP_DAYS)
      .then((r) => setData(r as UsageDailyReport))
      .catch((e: unknown) => setHeatErr(e instanceof Error ? e.message : '读取热力图数据失败'))
  }, [])

  // 仅 turns/sessions 需要按范围单独取
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.kimiApi
      .localUsageDaily(range)
      .then((r) => {
        if (cancelled) return
        setRangeUsage(r as UsageDailyReport)
        setErr('')
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : '读取使用数据失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range])

  /** 当前 range 窗口内的活跃日(从 364 天 days 按日期切片,窗口口径与后端 since 计算一致) */
  const rangeDays = useMemo(() => {
    const start = todayZero()
    start.setDate(start.getDate() - (range - 1))
    const startKey = toKey(start)
    return (data?.days ?? []).filter((d) => d.date >= startKey)
  }, [data, range])

  /** 连续活跃天数:从今天(或昨天)往回数,与后端 streak 口径一致 */
  const streak = useMemo(() => {
    const active = new Set(rangeDays.map((d) => d.date))
    const cursor = todayZero()
    if (!active.has(toKey(cursor))) cursor.setDate(cursor.getDate() - 1)
    let n = 0
    while (active.has(toKey(cursor))) {
      n += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return n
  }, [rangeDays])

  /** 当前 range 的模型汇总(由 rangeDays 的逐日 models 累加,等价后端 model_totals) */
  const modelEntries = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of rangeDays) {
      for (const [k, v] of Object.entries(d.models)) m[k] = (m[k] ?? 0) + v
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [rangeDays])
  const totalTokens = useMemo(() => modelEntries.reduce((a, [, v]) => a + v, 0), [modelEntries])

  /** 图表模型:Top5 + 其他,按用量降序 */
  const chartModels = useMemo(() => {
    const top = modelEntries.slice(0, 5)
    const rest = modelEntries.slice(5).reduce((a, [, v]) => a + v, 0)
    const list = top.map(([name, value], i) => ({ name, value, color: MODEL_COLORS[i] }))
    if (rest > 0) list.push({ name: '其他', value: rest, color: MODEL_COLORS[5] })
    return list
  }, [modelEntries])

  /** 按天补零的堆叠序列(后端只返回活跃日) */
  const stackedDays = useMemo<StackDay[]>(() => {
    const map = new Map(rangeDays.map((d) => [d.date, d]))
    const topNames = new Set(chartModels.map((m) => m.name).filter((n) => n !== '其他'))
    const out: StackDay[] = []
    const cur = todayZero()
    cur.setDate(cur.getDate() - (range - 1))
    for (let i = 0; i < range; i++) {
      const key = toKey(cur)
      const day = map.get(key)
      const parts: StackPart[] = chartModels.map((m) => {
        if (!day) return { name: m.name, color: m.color, v: 0 }
        if (m.name === '其他') {
          const v = Object.entries(day.models).reduce(
            (a, [name, val]) => (topNames.has(name) ? a : a + val),
            0
          )
          return { name: m.name, color: m.color, v }
        }
        return { name: m.name, color: m.color, v: day.models[m.name] ?? 0 }
      })
      out.push({ date: key, total: day?.total ?? 0, parts })
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }, [rangeDays, range, chartModels])

  const topModel = modelEntries[0]
  const hasRangeData = totalTokens > 0

  const stats: { icon: typeof Coins; label: string; value: string; sub?: string; color?: string }[] = [
    {
      icon: Coins,
      label: 'Token 用量',
      value: data ? fmtTokens(totalTokens) : '—',
      sub: `最近 ${range} 天合计`,
      color: '#2563eb'
    },
    {
      icon: Layers,
      label: '会话数量',
      value: rangeUsage ? fmtCount(rangeUsage.sessions) : '—',
      sub: `最近 ${range} 天`,
      color: '#16a34a'
    },
    {
      icon: MessagesSquare,
      label: '消息数量',
      value: rangeUsage ? fmtCount(rangeUsage.turns) : '—',
      sub: `最近 ${range} 天`,
      color: '#ea580c'
    },
    {
      icon: CalendarDays,
      label: '活跃天数',
      value: data ? fmtCount(rangeDays.length) : '—',
      sub: `/ ${range} 天`,
      color: '#7c3aed'
    },
    {
      icon: Flame,
      label: '当前连续天数',
      value: data ? fmtCount(streak) : '—',
      sub: data && streak > 0 ? '连续保持中' : '今天还未活跃',
      color: '#e11d48'
    },
    {
      icon: Cpu,
      label: '最常用模型',
      value: topModel ? shortModel(topModel[0]) : '—',
      sub:
        topModel && totalTokens > 0
          ? `占比 ${((topModel[1] / totalTokens) * 100).toFixed(1)}%`
          : undefined,
      color: '#0891b2'
    }
  ]

  return (
    <Section title="使用统计" desc="Token 用量、费用和额度概览">
      <div className="flex items-center justify-between gap-3">
        {err ? <p className="text-[12px] text-danger">{err}</p> : <span />}
        <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface-tertiary p-0.5">
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              disabled={loading}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
                range === r
                  ? 'bg-surface font-medium text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text'
              }`}
            >
              最近 {r} 天
            </button>
          ))}
        </div>
      </div>

      <div className={`transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}>
        <LiveTrend />

        <GroupLabel>概览</GroupLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>

        <GroupLabel>活跃热力图</GroupLabel>
        {heatErr ? (
          <p className="text-[12px] text-danger">{heatErr}</p>
        ) : data === null ? (
          <Empty text="加载中…" />
        ) : data.days.length === 0 ? (
          <Empty text="暂无使用记录" />
        ) : (
          <Card>
            <Heatmap days={data.days} />
            <div className="mt-3 flex items-center justify-end gap-1 text-[11px] text-text-tertiary">
              较少
              {HEAT_COLORS.map((c) => (
                <span key={c} className="h-[11px] w-[11px] rounded-[2px]" style={{ background: c }} />
              ))}
              较多
            </div>
          </Card>
        )}

        <GroupLabel>按天 Token 趋势</GroupLabel>
        {!hasRangeData ? (
          <Empty text="暂无使用记录" />
        ) : (
          <Card>
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-[12px] text-text-tertiary">按模型堆叠</p>
              <p className="text-[12px] tabular-nums text-text-tertiary">
                峰值 {fmtTokens(Math.max(...stackedDays.map((d) => d.total)))} / 天
              </p>
            </div>
            <TrendChart days={stackedDays} models={chartModels} />
          </Card>
        )}

        <GroupLabel>模型用量</GroupLabel>
        {!hasRangeData ? (
          <Empty text="暂无使用记录" />
        ) : (
          <Card>
            <Donut rows={chartModels} total={totalTokens} />
          </Card>
        )}
      </div>
    </Section>
  )
}
