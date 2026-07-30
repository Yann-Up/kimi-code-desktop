/**
 * 代码预览面板:右侧 ~480px 编辑器式面板,对齐 Kimi Web 右侧代码视图——
 * 把单文件 unified diff 按行渲染:旧/新两列行号、删除红底/新增绿底、
 * @@ hunk 头蓝底,等宽字体可横向滚动,底部展示 +X/-Y 统计。
 *
 * 数据来自主进程 IPC(window.kimiApi.gitStatus / gitDiff),
 * 在面板挂载、cwd / props.file 变化以及 useGitUi.refreshTick 变化时自动重新拉取。
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileCode2, X } from 'lucide-react'
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

const EMPTY_STATUS: StatusData = { isRepo: false, changes: [], additions: 0, deletions: 0 }

/** 选中文件的键:暂存标记 + 路径(与 GitPanel 一致) */
const keyOf = (c: FileChange): string => `${c.staged ? 's' : 'u'}:${c.path}`

/** diff 文件头/元信息行(解析时跳过) */
const HEADER_RE =
  /^(diff --git|index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename |copy |Binary)/
/** @@ -a,b +c,d @@(b/d 可省略) */
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

type LineKind = 'ctx' | 'add' | 'del' | 'hunk' | 'meta'

interface DiffLine {
  kind: LineKind
  oldNo?: number
  newNo?: number
  /** 行首标记:+ / - / 空格(上下文) */
  sign: string
  text: string
}

interface ParsedDiff {
  lines: DiffLine[]
  additions: number
  deletions: number
  isNewFile: boolean
}

/** 解析 unified diff:跳过文件头,按 @@ 起点跟踪旧/新行号 */
function parseDiff(diff: string): ParsedDiff {
  const raw = diff.split('\n')
  if (raw[raw.length - 1] === '') raw.pop()
  const lines: DiffLine[] = []
  let additions = 0
  let deletions = 0
  let isNewFile = false
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const line of raw) {
    if (!inHunk) {
      if (line.startsWith('new file')) isNewFile = true
      if (HEADER_RE.test(line)) continue
    }
    const hunk = HUNK_RE.exec(line)
    if (hunk) {
      oldNo = parseInt(hunk[1], 10)
      newNo = parseInt(hunk[2], 10)
      inHunk = true
      lines.push({ kind: 'hunk', sign: '', text: line })
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) {
      lines.push({ kind: 'add', newNo: newNo++, sign: '+', text: line.slice(1) })
      additions++
    } else if (line.startsWith('-')) {
      lines.push({ kind: 'del', oldNo: oldNo++, sign: '-', text: line.slice(1) })
      deletions++
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" 等元信息
      lines.push({ kind: 'meta', sign: '', text: line })
    } else {
      lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, sign: ' ', text: line.slice(1) })
    }
  }
  return { lines, additions, deletions, isNewFile }
}

/** 行底色:删除红 / 新增绿 / hunk 蓝 / 上下文白 */
const ROW_CLS: Record<LineKind, string> = {
  ctx: 'bg-surface text-text',
  add: 'bg-success-soft text-success',
  del: 'bg-danger-soft text-danger',
  hunk: 'bg-primary-soft text-primary',
  meta: 'bg-surface text-text-tertiary'
}

/** 行号槽配色:跟随行类型淡化 */
const GUTTER_CLS: Record<LineKind, string> = {
  ctx: 'text-text-tertiary',
  add: 'text-success/60',
  del: 'text-danger/60',
  hunk: 'text-primary/50',
  meta: 'text-text-tertiary'
}

function Center(props: { text: string; sub?: string }): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-xs text-text-tertiary">{props.text}</p>
      {props.sub && <p className="text-[11px] text-text-tertiary/70">{props.sub}</p>}
    </div>
  )
}

export function CodePreviewPanel(props: {
  cwd: string
  file?: string
  onClose?: () => void
}): JSX.Element {
  const { cwd, file, onClose } = props
  const refreshTick = useGitUi((s) => s.refreshTick)

  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  /** 当前选中文件键(s:/u: + path) */
  const [selected, setSelected] = useState<string | null>(null)
  /** 选中文件的 diff;null 表示加载中 */
  const [diff, setDiff] = useState<string | null>(null)

  // 拉取 status 并校正选中文件:props.file 优先 > 保持当前 > 暂存优先 > 首个
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.kimiApi
      .gitStatus(cwd)
      .then((st) => {
        if (cancelled) return
        const data =
          st && typeof (st as StatusData).isRepo === 'boolean' ? (st as StatusData) : EMPTY_STATUS
        setStatus(data)
        setLoading(false)
        setSelected((prev) => {
          if (data.changes.length === 0) return null
          if (file) {
            const hit =
              data.changes.find((c) => c.path === file && c.staged) ??
              data.changes.find((c) => c.path === file)
            if (hit) return keyOf(hit)
          }
          if (prev && data.changes.some((c) => keyOf(c) === prev)) return prev
          return keyOf(data.changes.find((c) => c.staged) ?? data.changes[0])
        })
      })
      .catch(() => {
        if (cancelled) return
        setStatus(EMPTY_STATUS)
        setLoading(false)
        setSelected(null)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, file, refreshTick])

  // 拉取选中文件的 diff
  useEffect(() => {
    if (!selected) {
      setDiff(null)
      return
    }
    let cancelled = false
    setDiff(null)
    const staged = selected[0] === 's'
    const path = selected.slice(2)
    window.kimiApi
      .gitDiff(cwd, path, staged)
      .then((d) => {
        if (!cancelled) setDiff(typeof d === 'string' ? d : '')
      })
      .catch(() => {
        if (!cancelled) setDiff('')
      })
    return () => {
      cancelled = true
    }
  }, [cwd, selected])

  const parsed = useMemo(() => (diff ? parseDiff(diff) : null), [diff])
  const current = status?.changes.find((c) => keyOf(c) === selected) ?? null
  /** 下拉选项:暂存优先,其余按路径排序 */
  const options = useMemo(
    () =>
      [...(status?.changes ?? [])].sort((a, b) =>
        a.staged === b.staged ? a.path.localeCompare(b.path) : a.staged ? -1 : 1
      ),
    [status]
  )

  return (
    <aside className="flex h-full w-[480px] shrink-0 flex-col border-l border-border-light bg-surface">
      {/* 顶部:文件名 + 文件切换 + 关闭 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-light px-3 py-2">
        <FileCode2 size={14} className="shrink-0 text-primary" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs font-medium"
          title={current?.path ?? file}
        >
          {current?.path ?? file ?? '(未选择文件)'}
        </span>
        {options.length > 0 && (
          <div className="relative shrink-0">
            <select
              className="h-6 max-w-[170px] appearance-none truncate rounded-md border border-border bg-surface pl-2 pr-6 text-[11px] text-text-secondary outline-none transition-colors hover:border-primary-border focus:border-primary-border"
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              title="切换文件"
            >
              {options.map((c) => (
                <option key={keyOf(c)} value={keyOf(c)}>
                  {c.path}
                  {c.staged ? '(暂存)' : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
          </div>
        )}
        {onClose && (
          <button
            className="shrink-0 rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-secondary"
            title="关闭预览"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 主体:编辑器式 diff 渲染 */}
      {!status || loading ? (
        <Center text="正在读取 git 信息…" />
      ) : !status.isRepo ? (
        <Center text="当前文件夹不是 git 仓库" />
      ) : !current ? (
        <Center text="没有改动的文件" />
      ) : diff === null ? (
        <Center text="加载 diff 中…" />
      ) : diff === '' ? (
        <Center text="新文件,全文为新增" sub="该文件暂无 diff 内容(未跟踪文件需先暂存)" />
      ) : parsed === null || parsed.lines.length === 0 ? (
        <Center text="该文件没有可显示的 diff" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* inline-block 让行底色横向铺满滚动区域 */}
          <div className="inline-block min-w-full align-top">
            {parsed.isNewFile && (
              <div className="whitespace-pre bg-primary-soft px-3 font-mono text-xs leading-[20px] text-primary">
                新文件,全文为新增
              </div>
            )}
            {parsed.lines.map((l, i) => (
              <div
                key={i}
                className={`flex w-full whitespace-pre font-mono text-xs leading-[20px] ${ROW_CLS[l.kind]}`}
              >
                <span
                  className={`w-10 shrink-0 select-none border-r border-border-light px-2 text-right text-[10px] ${GUTTER_CLS[l.kind]}`}
                >
                  {l.oldNo ?? ''}
                </span>
                <span
                  className={`w-10 shrink-0 select-none border-r border-border-light px-2 text-right text-[10px] ${GUTTER_CLS[l.kind]}`}
                >
                  {l.newNo ?? ''}
                </span>
                <span className="w-5 shrink-0 select-none text-center opacity-70">{l.sign}</span>
                <span className="pr-3">{l.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部:增删统计 */}
      {parsed && parsed.lines.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border-light px-3 py-2">
          <span className="font-mono text-[11px] font-semibold text-success">
            +{parsed.additions}
          </span>
          <span className="font-mono text-[11px] font-semibold text-danger">
            -{parsed.deletions}
          </span>
          <span className="text-[11px] text-text-tertiary">行变更</span>
          {current && (
            <span className="ml-auto rounded bg-surface-tertiary px-1.5 text-[10px] leading-4 text-text-secondary">
              {current.status}
              {current.staged ? ' · 暂存' : ''}
            </span>
          )}
        </div>
      )}
    </aside>
  )
}
