/**
 * 终端工作区(Workspace Grid)布局模型与持久化。
 * 固定网格槽位:矩形模板,槽位 = cols×rows ≤ 6;空槽渲染占位卡。
 * 窗格总数 ≤ 12,超出可见槽的进后台窗格栏(进程保活,xterm 常驻隐藏)。
 * 持久化 localStorage kimi.termWorkspace:布局结构持久,进程不持久
 * (重启后可见窗格自动 respawn TUI,后台窗格首次可见时才启动)。
 * 全部为纯函数,组件持有 WorkspaceLayout 状态,变更即 saveWorkspace。
 */

export interface PaneMeta {
  id: string
  title: string
  cwd?: string
}

export interface WorkspaceLayout {
  cols: number
  rows: number
  /** 列/行比例轨(逐缝缩放调整;长度 = cols/rows,按 fr 渲染) */
  colFr: number[]
  rowFr: number[]
  /** 槽位 → paneId(行优先,长度 cols*rows;空槽 null) */
  slots: (string | null)[]
  /** 最大化窗格 id(占满网格区;null = 无) */
  maximized: string | null
  /** 全部窗格(可见 + 后台;后台 = 不在 slots 中的) */
  panes: PaneMeta[]
}

/** 网格模板(矩形,槽位 ≤ 6) */
export interface GridPreset {
  cols: number
  rows: number
}

export const GRID_PRESETS: GridPreset[] = [
  { cols: 1, rows: 1 },
  { cols: 2, rows: 1 },
  { cols: 1, rows: 2 },
  { cols: 3, rows: 1 },
  { cols: 1, rows: 3 },
  { cols: 2, rows: 2 },
  { cols: 3, rows: 2 },
  { cols: 2, rows: 3 }
]

export const MAX_PANES = 12
const STORAGE_KEY = 'kimi.termWorkspace'
/** 逐缝缩放时单侧 track 的最小占比(相对缝两侧总和) */
const MIN_SEAM_SHARE = 0.1

export function emptyWorkspace(): WorkspaceLayout {
  return { cols: 1, rows: 1, colFr: [1], rowFr: [1], slots: [null], maximized: null, panes: [] }
}

export function loadWorkspace(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyWorkspace()
    return sanitize(JSON.parse(raw)) ?? emptyWorkspace()
  } catch {
    return emptyWorkspace()
  }
}

export function saveWorkspace(ws: WorkspaceLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws))
  } catch {
    /* 写失败静默(隐私模式等) */
  }
}

/** 结构校验与修复:任何字段不可信即回退 null(调用方换空布局) */
function sanitize(ws: unknown): WorkspaceLayout | null {
  if (!ws || typeof ws !== 'object') return null
  const w = ws as Record<string, unknown>
  const cols = w.cols
  const rows = w.rows
  if (!GRID_PRESETS.some((p) => p.cols === cols && p.rows === rows)) return null
  const n = (cols as number) * (rows as number)
  if (!Array.isArray(w.slots) || w.slots.length !== n) return null
  if (!Array.isArray(w.panes) || w.panes.length > MAX_PANES) return null
  const panes: PaneMeta[] = []
  for (const p of w.panes) {
    if (!p || typeof p !== 'object') return null
    const m = p as Record<string, unknown>
    if (typeof m.id !== 'string' || typeof m.title !== 'string') return null
    panes.push({ id: m.id, title: m.title, ...(typeof m.cwd === 'string' ? { cwd: m.cwd } : {}) })
  }
  const ids = new Set(panes.map((p) => p.id))
  if (ids.size !== panes.length) return null
  // slots 中悬空引用(窗格已不存在)按空槽修复;同一 paneId 重复引用(手改数据)也只留首个
  const seen = new Set<string>()
  const slots = w.slots.map((s) => {
    if (typeof s !== 'string' || !ids.has(s)) return null
    if (seen.has(s)) return null
    seen.add(s)
    return s
  })
  const maximized =
    typeof w.maximized === 'string' && slots.includes(w.maximized) ? w.maximized : null
  return {
    cols: cols as number,
    rows: rows as number,
    colFr: validFr(w.colFr, cols as number),
    rowFr: validFr(w.rowFr, rows as number),
    slots,
    maximized,
    panes
  }
}

function validFr(fr: unknown, len: number): number[] {
  if (
    Array.isArray(fr) &&
    fr.length === len &&
    fr.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
  ) {
    return fr as number[]
  }
  return Array(len).fill(1)
}

/** 后台窗格(不在任何槽位中的) */
export function backgroundPanes(ws: WorkspaceLayout): PaneMeta[] {
  return ws.panes.filter((p) => !ws.slots.includes(p.id))
}

/** 新建窗格:放第一个空槽,无空槽进后台;总数达上限返回 null */
export function addPane(
  ws: WorkspaceLayout,
  title: string,
  cwd?: string
): { ws: WorkspaceLayout; paneId: string } | null {
  if (ws.panes.length >= MAX_PANES) return null
  const pane: PaneMeta = { id: crypto.randomUUID(), title, ...(cwd ? { cwd } : {}) }
  const panes = [...ws.panes, pane]
  const emptyIdx = ws.slots.indexOf(null)
  const slots =
    emptyIdx >= 0 ? ws.slots.map((s, i) => (i === emptyIdx ? pane.id : s)) : ws.slots
  return { ws: { ...ws, panes, slots }, paneId: pane.id }
}

/** 移除窗格:槽位腾空、最大化清除(进程由调用方负责 terminalClose) */
export function removePane(ws: WorkspaceLayout, paneId: string): WorkspaceLayout {
  return {
    ...ws,
    panes: ws.panes.filter((p) => p.id !== paneId),
    slots: ws.slots.map((s) => (s === paneId ? null : s)),
    maximized: ws.maximized === paneId ? null : ws.maximized
  }
}

/** 切换网格模板:旧槽位窗格按序填入新槽,放不下的进后台;比例重置均分、最大化清除 */
export function setGrid(ws: WorkspaceLayout, cols: number, rows: number): WorkspaceLayout {
  const n = cols * rows
  const occupants = ws.slots.filter((s): s is string => s !== null)
  const slots: (string | null)[] = Array.from({ length: n }, (_, i) => occupants[i] ?? null)
  return {
    ...ws,
    cols,
    rows,
    slots,
    colFr: Array(cols).fill(1),
    rowFr: Array(rows).fill(1),
    maximized: null
  }
}

/**
 * 把窗格移入目标槽:目标槽有主则交换(原主去该窗格原位置;
 * 窗格原在后台时原主不占槽,自然进后台)
 */
export function movePaneToSlot(
  ws: WorkspaceLayout,
  paneId: string,
  target: number
): WorkspaceLayout {
  const from = ws.slots.indexOf(paneId)
  if (from === target) return ws
  const slots = [...ws.slots]
  const occupant = slots[target]
  slots[target] = paneId
  if (from >= 0) slots[from] = occupant
  return { ...ws, slots }
}

/** 移出网格进后台栏(最大化一并清除) */
export function movePaneToBackground(ws: WorkspaceLayout, paneId: string): WorkspaceLayout {
  return {
    ...ws,
    slots: ws.slots.map((s) => (s === paneId ? null : s)),
    maximized: ws.maximized === paneId ? null : ws.maximized
  }
}

export function setMaximized(ws: WorkspaceLayout, paneId: string | null): WorkspaceLayout {
  return { ...ws, maximized: paneId }
}

/**
 * 窗格级拆分(tmux/VSCode 语义):在被拆窗格右侧(dir='right')或下方(dir='down')
 * 插入新 track,被拆 track 的 fr 减半分给新 track;newPaneId 落入相邻新槽位,
 * 其余新槽为空。矩形网格约束:cols/rows 各 ≤3 且总槽位 ≤6,超限返回 null。
 */
export function splitAt(
  ws: WorkspaceLayout,
  paneId: string,
  dir: 'left' | 'right' | 'up' | 'down',
  newPaneId: string
): WorkspaceLayout | null {
  const idx = ws.slots.indexOf(paneId)
  if (idx < 0) return null
  const col = idx % ws.cols
  const row = Math.floor(idx / ws.cols)
  if (dir === 'right' || dir === 'left') {
    if (ws.cols >= 3 || (ws.cols + 1) * ws.rows > 6) return null
    const cols = ws.cols + 1
    const insertAt = dir === 'right' ? col + 1 : col
    const colFr = [...ws.colFr]
    colFr[col] /= 2
    colFr.splice(insertAt, 0, colFr[col])
    const slots: (string | null)[] = []
    for (let r = 0; r < ws.rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c < insertAt) slots.push(ws.slots[r * ws.cols + c])
        else if (c === insertAt) slots.push(r === row ? newPaneId : null)
        else slots.push(ws.slots[r * ws.cols + c - 1])
      }
    }
    return { ...ws, cols, colFr, slots }
  }
  if (ws.rows >= 3 || ws.cols * (ws.rows + 1) > 6) return null
  const rows = ws.rows + 1
  const insertAt = dir === 'down' ? row + 1 : row
  const rowFr = [...ws.rowFr]
  rowFr[row] /= 2
  rowFr.splice(insertAt, 0, rowFr[row])
  const slots: (string | null)[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < ws.cols; c++) {
      if (r < insertAt) slots.push(ws.slots[r * ws.cols + c])
      else if (r === insertAt) slots.push(c === col ? newPaneId : null)
      else slots.push(ws.slots[(r - 1) * ws.cols + c])
    }
  }
  return { ...ws, rows, rowFr, slots }
}

/**
 * 关闭窗格后收缩网格:移除全空的行/列(至少保留 1×1)。
 * 只在关闭(removePane)时调用——手动切模板产生的全空布局是用户主动选择,不动。
 */
export function shrinkEmptyTracks(ws: WorkspaceLayout): WorkspaceLayout {
  let { cols, rows, colFr, rowFr, slots } = ws
  // 全空列(从右往左删,保持索引稳定)
  for (let c = cols - 1; c >= 0 && cols > 1; c--) {
    const empty = Array.from({ length: rows }, (_, r) => slots[r * cols + c]).every(
      (s) => s === null
    )
    if (!empty) continue
    slots = slots.filter((_, i) => i % cols !== c)
    colFr = colFr.filter((_, i) => i !== c)
    cols--
  }
  // 全空行
  for (let r = rows - 1; r >= 0 && rows > 1; r--) {
    const empty = slots.slice(r * cols, r * cols + cols).every((s) => s === null)
    if (!empty) continue
    slots = slots.filter((_, i) => Math.floor(i / cols) !== r)
    rowFr = rowFr.filter((_, i) => i !== r)
    rows--
  }
  if (cols === ws.cols && rows === ws.rows) return ws
  return { ...ws, cols, rows, colFr, rowFr, slots }
}

/**
 * 逐缝缩放:调整 seam 与 seam+1 两条 track 的比例(此消彼长,总和不变,
 * 单侧不小于总和的 MIN_SEAM_SHARE)。
 * fr = 拖动开始时的 track 比例快照;delta = 指针位移占容器宽/高的比例(带正负)
 */
export function adjustSeam(fr: number[], seam: number, delta: number): number[] {
  const a = fr[seam]
  const b = fr[seam + 1]
  if (a === undefined || b === undefined) return fr
  const total = a + b
  const na = Math.min(Math.max(a + delta, total * MIN_SEAM_SHARE), total * (1 - MIN_SEAM_SHARE))
  const nb = total - na
  return fr.map((v, i) => (i === seam ? na : i === seam + 1 ? nb : v))
}
