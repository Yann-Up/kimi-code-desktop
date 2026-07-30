/**
 * Git 面板:右侧 ~300px 面板,上半区展示工作区改动(分支、增删统计、
 * 文件列表,点击文件展开单文件 diff),下半区展示可折叠的提交历史。
 *
 * 数据来自主进程 IPC(window.kimiApi.gitStatus / gitLog / gitDiff),
 * 在面板挂载、cwd 变化以及 useGitUi.refreshTick 变化时自动重新拉取。
 */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, GitBranch, History, RefreshCw } from 'lucide-react'
import { useGitUi } from '../../stores/git'

interface FileChange {
  path: string
  status: string // M/A/D/R/?/U 等
  staged: boolean
}

interface StatusData {
  isRepo: boolean
  branch?: string
  changes: FileChange[]
  additions: number
  deletions: number
}

interface CommitData {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string // 'YYYY-MM-DD HH:mm'
}

const EMPTY_STATUS: StatusData = { isRepo: false, changes: [], additions: 0, deletions: 0 }

/** 状态徽标配色:M 黄 / A 绿 / D 红 / ? 蓝,其余灰 */
function statusBadge(status: string): string {
  switch (status) {
    case 'M':
      return 'bg-warning-soft text-warning'
    case 'A':
      return 'bg-success-soft text-success'
    case 'D':
      return 'bg-danger-soft text-danger'
    case '?':
      return 'bg-primary-soft text-primary'
    default:
      return 'bg-surface-tertiary text-text-secondary'
  }
}

/** 相对时间(兼容主进程 'YYYY-MM-DD HH:mm' 格式) */
function timeAgo(date: string): string {
  const t = new Date(date.replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return date
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return date.slice(0, 10)
}

/** 简易 unified diff 着色:头部元信息灰、`@@` 蓝、`+` 绿底、`-` 红底 */
function DiffView(props: { diff: string }) {
  const lines = props.diff.split('\n')
  return (
    <div className="overflow-x-auto border-t border-border-light bg-surface-secondary py-1">
      {lines.map((line, i) => {
        let cls = 'text-text-secondary'
        if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename|Binary)/.test(line))
          cls = 'text-text-tertiary'
        else if (line.startsWith('@@')) cls = 'bg-primary-soft text-primary'
        else if (line.startsWith('+')) cls = 'bg-success-soft text-success'
        else if (line.startsWith('-')) cls = 'bg-danger-soft text-danger'
        return (
          <div key={i} className={`whitespace-pre px-2 font-mono text-[11px] leading-[18px] ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

export function GitPanel(props: { cwd: string }): JSX.Element {
  const { cwd } = props
  const refreshTick = useGitUi((s) => s.refreshTick)
  const bump = useGitUi((s) => s.bump)

  const [status, setStatus] = useState<StatusData | null>(null)
  const [commits, setCommits] = useState<CommitData[]>([])
  const [loading, setLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  /** 当前展开的文件(键为 staged:path),同一时刻只展开一个 */
  const [expanded, setExpanded] = useState<string | null>(null)
  /** 按文件缓存的 diff,随每次状态刷新清空 */
  const [diffs, setDiffs] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setExpanded(null)
    setDiffs({})
    Promise.all([window.kimiApi.gitStatus(cwd), window.kimiApi.gitLog(cwd, 20)])
      .then(([st, log]) => {
        if (cancelled) return
        setStatus(st && typeof st.isRepo === 'boolean' ? (st as StatusData) : EMPTY_STATUS)
        setCommits(Array.isArray(log) ? (log as CommitData[]) : [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setStatus(EMPTY_STATUS)
        setCommits([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, refreshTick])

  const toggleFile = (c: FileChange) => {
    const k = `${c.staged ? 's' : 'u'}:${c.path}`
    if (expanded === k) {
      setExpanded(null)
      return
    }
    setExpanded(k)
    if (diffs[k] === undefined) {
      void window.kimiApi.gitDiff(cwd, c.path, c.staged).then((d) => {
        setDiffs((m) => ({ ...m, [k]: typeof d === 'string' ? d : '' }))
      })
    }
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-border-light bg-surface">
      {/* 头部:标题 + 手动刷新 */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-light px-3 py-2.5">
        <span className="text-[13px] font-semibold">Git</span>
        <button
          className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-secondary"
          title="刷新"
          onClick={() => bump()}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {!status || !status.isRepo ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-xs leading-relaxed text-text-tertiary">
            {loading ? '正在读取 git 信息…' : '当前文件夹不是 git 仓库'}
          </p>
        </div>
      ) : (
        <>
          {/* 上半区:工作区改动 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2">
              <GitBranch size={13} className="shrink-0 text-text-tertiary" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={status.branch}>
                {status.branch || '(无分支)'}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-success">+{status.additions}</span>
              <span className="shrink-0 font-mono text-[11px] text-danger">-{status.deletions}</span>
            </div>
            <div className="shrink-0 px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-tertiary">
              工作区改动{status.changes.length > 0 ? ` (${status.changes.length})` : ''}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {status.changes.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-text-tertiary">
                  工作区干净,没有待提交的改动
                </p>
              ) : (
                status.changes.map((c) => {
                  const k = `${c.staged ? 's' : 'u'}:${c.path}`
                  const isOpen = expanded === k
                  return (
                    <div key={k} className="mb-0.5 overflow-hidden rounded-lg">
                      <button
                        className={`flex w-full items-center gap-1.5 px-1.5 py-1 text-left transition-colors ${
                          isOpen ? 'bg-primary-soft' : 'hover:bg-surface-secondary'
                        }`}
                        onClick={() => toggleFile(c)}
                        title={c.path}
                      >
                        {isOpen ? (
                          <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
                        ) : (
                          <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
                        )}
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${statusBadge(c.status)}`}
                        >
                          {c.status}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                          {c.path}
                        </span>
                        {c.staged && (
                          <span className="shrink-0 rounded bg-primary-soft px-1 text-[10px] leading-4 text-primary">
                            暂存
                          </span>
                        )}
                      </button>
                      {isOpen &&
                        (diffs[k] === undefined ? (
                          <div className="border-t border-border-light bg-surface-secondary px-2 py-2 text-[11px] text-text-tertiary">
                            加载 diff 中…
                          </div>
                        ) : diffs[k] === '' ? (
                          <div className="border-t border-border-light bg-surface-secondary px-2 py-2 text-[11px] text-text-tertiary">
                            该文件没有可显示的 diff
                          </div>
                        ) : (
                          <DiffView diff={diffs[k]} />
                        ))}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 下半区:提交历史(可折叠) */}
          <div className="flex max-h-[45%] shrink-0 flex-col border-t border-border-light">
            <button
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-surface-secondary"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              {historyOpen ? (
                <ChevronDown size={13} className="shrink-0 text-text-tertiary" />
              ) : (
                <ChevronRight size={13} className="shrink-0 text-text-tertiary" />
              )}
              <History size={13} className="shrink-0 text-text-tertiary" />
              <span className="text-[11px] font-medium text-text-tertiary">提交历史</span>
              {commits.length > 0 && (
                <span className="ml-auto text-[11px] text-text-tertiary">{commits.length}</span>
              )}
            </button>
            {historyOpen && (
              <div className="min-h-0 overflow-y-auto px-1.5 pb-2">
                {commits.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-text-tertiary">暂无提交记录</p>
                ) : (
                  commits.map((c) => (
                    <div
                      key={c.hash}
                      className="rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface-secondary"
                      title={`${c.hash}\n${c.subject}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 rounded bg-primary-soft px-1 font-mono text-[10px] leading-4 text-primary">
                          {c.shortHash}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs">{c.subject}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-text-tertiary">
                        {c.author} · {timeAgo(c.date)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
