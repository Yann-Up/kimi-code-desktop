/**
 * EmptyStateHome: 空会话主页(A 环境指挥台 + B 快捷发射台 + C 迷你用量)。
 * - A:三张环境卡(本机/WSL/SSH),当前目标高亮显示版本,点击进设置连接区块
 * - B:大输入框回车即在最近目录建会话(草稿注入 Composer);下方最近项目卡片直达最新会话
 * - C:底部今日 token 迷你分时图 + 连续活跃/轮次(数据来自 local_usage_*,随连接目标走)
 */
import { useEffect, useMemo, useState } from 'react'
import { CornerDownLeft, FolderGit2, Monitor, Server, Terminal } from 'lucide-react'
import { useSessions, groupSessions } from '../../stores/sessions'
import { useUi } from '../../stores/ui'
import type { ConnectionTargetInfo } from '../../platform/kimi-api'

/** 发射台 placeholder 轮播技巧 */
const TIPS = [
  '输入任务,回车即在最近目录开工…',
  'Ctrl+N 新建任务,Ctrl+B 收起侧栏',
  '/goal 让 Kimi 自主推进长任务',
  '设置里可切换 本机 / WSL / SSH 运行目标',
  '拖拽文件到窗口任意位置即可添加附件'
]

/** updated_at → "N 分钟前 / N 小时前 / N 天前" */
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

interface TodayUsage {
  buckets?: { slot: number; input: number; output: number; cacheRead: number; cacheCreation: number }[]
  totalInput?: number
  totalOutput?: number
  totalTurns?: number
}

interface DailyUsage {
  streak?: number
  activeDays?: number
  sessions?: number
}

/** C:今日 48 槽迷你分时图 + streak(纯 div 条形,无依赖) */
function MiniUsage() {
  const [today, setToday] = useState<TodayUsage | null>(null)
  const [daily, setDaily] = useState<DailyUsage | null>(null)

  useEffect(() => {
    window.kimiApi.localUsageToday().then((d) => setToday(d as TodayUsage)).catch(() => {})
    window.kimiApi.localUsageDaily(30).then((d) => setDaily(d as DailyUsage)).catch(() => {})
  }, [])

  const bars = today?.buckets ?? []
  const totals = bars.map((b) => (b.input ?? 0) + (b.output ?? 0) + (b.cacheRead ?? 0) + (b.cacheCreation ?? 0))
  const max = Math.max(0, ...totals)
  const todayTotal = (today?.totalInput ?? 0) + (today?.totalOutput ?? 0)

  // 无数据(新装/远端无会话)整行隐藏
  if (!today || (todayTotal === 0 && max === 0 && !daily?.streak)) return null

  return (
    <div className="flex items-center justify-center gap-4 text-[12px] text-text-tertiary">
      {max > 0 && (
        <div className="flex h-7 items-end gap-[2px]" title={`今日 ${todayTotal.toLocaleString()} tokens(输入+输出)`}>
          {totals.map((t, i) => (
            <span
              key={i}
              className={`w-[3px] rounded-sm ${t > 0 ? 'bg-primary/70' : 'bg-surface-tertiary'}`}
              style={{ height: t > 0 ? `${Math.max(2, (t / max) * 26)}px` : '2px' }}
            />
          ))}
        </div>
      )}
      <span>
        今日 {todayTotal.toLocaleString()} tokens · {today?.totalTurns ?? 0} 轮
      </span>
      {(daily?.streak ?? 0) > 0 && <span>连续活跃 {daily!.streak} 天</span>}
    </div>
  )
}

export function EmptyStateHome() {
  const sessions = useSessions((s) => s.sessions)
  const workspaces = useSessions((s) => s.workspaces)
  const [conn, setConn] = useState<ConnectionTargetInfo | null>(null)
  const [cliVersion, setCliVersion] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [tipIdx, setTipIdx] = useState(0)
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    window.kimiApi.connectionTargetGet().then(setConn).catch(() => {})
    window.kimiApi
      .appInfo()
      .then((i: { cliVersion: string | null }) => setCliVersion(i.cliVersion))
      .catch(() => {})
    const timer = window.setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 4000)
    return () => window.clearInterval(timer)
  }, [])

  // 最近项目:复用侧栏分组逻辑,取前 3 组(sessions 已按新近排序)
  const projects = useMemo(
    () => groupSessions(sessions, workspaces, '').slice(0, 3),
    [sessions, workspaces]
  )

  const currentTarget = conn?.config.target ?? 'local'

  /** 发射台:回车在最近目录建会话,草稿交给 Composer */
  const launch = async () => {
    const prompt = text.trim()
    if (!prompt || launching) return
    const cwd = sessions[0]?.metadata?.cwd || workspaces[0]?.root || ''
    if (!cwd) {
      // 还没有任何会话可推断目录:回退到目录选择器,草稿保留待消费
      useUi.getState().setDraftPrompt(prompt)
      window.dispatchEvent(new CustomEvent('kimi:new-task'))
      return
    }
    setLaunching(true)
    try {
      useUi.getState().setDraftPrompt(prompt)
      await useSessions.getState().createSession(cwd)
    } finally {
      setLaunching(false)
    }
  }

  const envCards = [
    { id: 'local' as const, icon: Monitor, name: '本机' },
    { id: 'wsl' as const, icon: Terminal, name: 'WSL' },
    { id: 'ssh' as const, icon: Server, name: 'SSH' }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-10">
      <div className="flex w-full max-w-2xl flex-1 flex-col">
        {/* 头部:品牌 + 当前连接 */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-text">Kimi Code Desktop</h1>
          <p className="mt-1.5 text-[13px] text-text-tertiary">
            {conn ? `${conn.describe} · 已就绪` : '从左侧选择会话,或点击"新建任务"开始'}
          </p>
        </div>

        {/* A:环境指挥台 */}
        <div className="grid grid-cols-3 gap-3">
          {envCards.map((c) => {
            const Icon = c.icon
            const active = currentTarget === c.id
            return (
              <button
                key={c.id}
                className={`rounded-xl border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary-soft'
                    : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-tertiary'
                }`}
                title={active ? '当前连接目标(点击管理)' : '点击切换 / 配置该目标'}
                onClick={() => useUi.getState().openSettings('general')}
              >
                <div className="flex items-center justify-between">
                  <Icon size={17} className={active ? 'text-primary' : 'text-text-tertiary'} />
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-success' : 'bg-border'}`}
                  />
                </div>
                <p className={`mt-2 text-[13px] font-medium ${active ? 'text-primary' : ''}`}>
                  {c.name}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-text-tertiary">
                  {active
                    ? `${conn?.describe ?? ''}${cliVersion ? ` · v${cliVersion}` : ''}`
                    : '点击切换 / 配置'}
                </p>
              </button>
            )
          })}
        </div>

        {/* B:发射台 */}
        <div className="mt-6">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm focus-within:border-primary/60">
            <input
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-text-tertiary"
              placeholder={TIPS[tipIdx]}
              value={text}
              disabled={launching}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void launch()
              }}
            />
            <button
              className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-40"
              disabled={!text.trim() || launching}
              onClick={() => void launch()}
            >
              <CornerDownLeft size={13} /> 开工
            </button>
          </div>

          {/* 最近项目 */}
          {projects.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[12px] font-medium text-text-tertiary">最近项目</p>
              <div className="grid grid-cols-3 gap-3">
                {projects.map((g) => {
                  const latest = g.items[0]
                  return (
                    <button
                      key={g.key}
                      className="rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-tertiary"
                      title={g.root}
                      onClick={() => latest && useSessions.getState().setActive(latest.id)}
                    >
                      <div className="flex items-center gap-1.5">
                        <FolderGit2 size={13} className="shrink-0 text-text-tertiary" />
                        <span className="truncate text-[13px] font-medium">{g.name}</span>
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-text-tertiary">
                        {g.items.length} 个会话{latest ? ` · ${relTime(latest.updated_at)}` : ''}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* C:迷你用量(底部) */}
        <div className="mt-auto pt-8">
          <MiniUsage />
        </div>
      </div>
    </div>
  )
}
