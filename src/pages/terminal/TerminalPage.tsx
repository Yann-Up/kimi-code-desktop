/**
 * 终端工作区(Workspace Grid):1–6 可见槽位的网格排版 + 最多 12 窗格。
 * - 布局模型为固定网格槽位(矩形模板),所有窗格恒定渲染在同一绝对定位层
 *   (key=paneId,交换/最大化/模板切换只改 style),xterm 实例不因布局变化销毁;
 * - 拖拽交换:标题栏为 DnD source,drop 目标按指针坐标反算槽位(有主=交换,空槽=移入);
 * - 逐缝缩放:每条网格缝独立 pointer 拖拽,调整相邻两条 track 的 fr(此消彼长);
 * - 最大化:目标窗格满铺网格区,其余 display:none(不卸载);Esc/按钮还原;
 * - 布局持久化 localStorage(workspace.ts):结构持久、进程不持久。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { ChevronRight, Folder, Home, SquareTerminal, BookOpen } from 'lucide-react'
import { useT } from '../../i18n'
import { useUi } from '../../stores/ui'
import type { WorkspaceInfo } from '../../platform/kimi-api'
import TerminalPane, { type PaneStatus } from './TerminalPane'
import { CommandDrawer } from './CommandDrawer'
import {
  addPane,
  adjustSeam,
  backgroundPanes,
  GRID_PRESETS,
  loadWorkspace,
  MAX_PANES,
  movePaneToBackground,
  movePaneToSlot,
  removePane,
  saveWorkspace,
  setGrid,
  setMaximized,
  shrinkEmptyTracks,
  splitAt,
  type PaneMeta,
  type WorkspaceLayout
} from './workspace'

/** 槽位间距(px):pane 四边各留 GAP/2 */
const GAP = 6
const DND_MIME = 'text/x-kimi-pane-id'
/** 拖放落点方位:center=交换/移入;四向=在目标窗格该侧拆分 */
type DropZone = 'center' | 'left' | 'right' | 'up' | 'down'
/** 右键菜单项统一式样 */
const CTX_ITEM =
  'flex w-full items-center px-3 py-1.5 text-left text-[12px] text-text-secondary hover:bg-surface-tertiary hover:text-text disabled:cursor-not-allowed disabled:opacity-40'

/** 从路径取末段作窗格标题(兼容 \ 与 /) */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** 项目选择面板(空槽内嵌,简约密度:小头 + 单行项目卡 + 默认目录) */
function ProjectPicker({
  projects,
  onPick,
  onDefault
}: {
  projects: WorkspaceInfo[]
  onPick: (p: WorkspaceInfo) => void
  onDefault: () => void
}) {
  const t = useT()
  return (
    <div className="w-full max-w-[340px] px-4 py-4">
      <div className="mb-3 flex items-center justify-center gap-1.5 text-text-tertiary">
        <SquareTerminal size={14} />
        <span className="text-[12px] font-medium text-text-secondary">
          {t('terminal.pickWorkspace')}
        </span>
      </div>
      {projects.length > 0 && (
        <div className="flex flex-col gap-1">
          {projects.slice(0, 5).map((p) => (
            <button
              key={p.root}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:border-primary"
              title={p.root}
              onClick={() => onPick(p)}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                <Folder size={12} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px]">{p.name}</span>
              <ChevronRight
                size={12}
                className="shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
          ))}
        </div>
      )}
      <button
        className="mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text"
        onClick={onDefault}
      >
        <Home size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 text-[11px]">{t('terminal.projectDefault')}</span>
        <span className="shrink-0 text-[11px]">{t('terminal.defaultDirHint')}</span>
      </button>
    </div>
  )
}

export default function TerminalPage() {
  const t = useT()
  const [ws, setWs] = useState<WorkspaceLayout>(loadWorkspace)
  const wsRef = useRef(ws)
  wsRef.current = ws
  const [dragId, setDragId] = useState<string | null>(null)
  // 指令参考抽屉:首次使用默认展开(新手向),之后记忆 localStorage
  const [helpOpen, setHelpOpenState] = useState(
    () => localStorage.getItem('kimi.termHelpOpen') !== '0'
  )
  const setHelpOpen = (v: boolean) => {
    localStorage.setItem('kimi.termHelpOpen', v ? '1' : '0')
    setHelpOpenState(v)
  }
  // 活动窗格(最近交互)与各窗格的会话 id(指令插入目标;pane 经 onSessionChange 上报)
  const [activePaneId, setActivePaneId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, string | null>>({})
  const [statuses, setStatuses] = useState<Record<string, PaneStatus>>({})
  const gridRef = useRef<HTMLDivElement>(null)
  const defaultCwd = useUi((s) => s.terminalCwd)
  const view = useUi((s) => s.view)
  // 项目选择(CLI workspaces.json 注册表):新建窗格的 cwd;localStorage 记忆上次选择,
  // null = 从未选择(首次默认落到最近使用的项目),'' = 主动选了「默认目录」
  const [projects, setProjects] = useState<WorkspaceInfo[]>([])
  const [project, setProjectState] = useState<string | null>(() =>
    localStorage.getItem('kimi.terminalProject')
  )
  const setProject = (root: string) => {
    localStorage.setItem('kimi.terminalProject', root)
    setProjectState(root)
  }

  // 切到终端视图时刷新项目列表(直读 workspaces.json,不依赖服务运行);
  // loaded 门闩:未加载前 projects=[] 不得触发「被删回落」判定(会误清 localStorage 记忆)
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  useEffect(() => {
    if (view !== 'terminal') return
    window.kimiApi
      .localWorkspaces()
      .then((ws) => {
        setProjects(ws)
        setProjectsLoaded(true)
      })
      .catch(() => {
        setProjects([])
        setProjectsLoaded(true)
      })
  }, [view])

  // 首次使用(无记忆)时默认选中最近项目——开箱即进入工作区,不落用户主目录
  useEffect(() => {
    if (!projectsLoaded) return
    if (project === null && projects.length > 0) setProject(projects[0].root)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectsLoaded])

  // 选中项目已不在注册表(被删)时回落「默认目录」
  useEffect(() => {
    if (!projectsLoaded) return
    if (project && !projects.some((p) => p.root === project)) setProject('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectsLoaded])

  /** 布局变更统一入口:set + 持久化 */
  const commit = useCallback((next: WorkspaceLayout) => {
    wsRef.current = next
    setWs(next)
    saveWorkspace(next)
  }, [])

  const totalCol = ws.colFr.reduce((a, b) => a + b, 0)
  const totalRow = ws.rowFr.reduce((a, b) => a + b, 0)
  // 各列/行起点(0..1 累计)
  const colStarts: number[] = []
  const rowStarts: number[] = []
  {
    let acc = 0
    for (const f of ws.colFr) {
      colStarts.push(acc / totalCol)
      acc += f
    }
    acc = 0
    for (const f of ws.rowFr) {
      rowStarts.push(acc / totalRow)
      acc += f
    }
  }

  /** 槽位矩形(0..1 比例;行优先 index) */
  const slotRect = (i: number) => {
    const col = i % ws.cols
    const row = Math.floor(i / ws.cols)
    return {
      x: colStarts[col],
      y: rowStarts[row],
      w: ws.colFr[col] / totalCol,
      h: ws.rowFr[row] / totalRow
    }
  }

  const rectStyle = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({
    left: `calc(${(r.x * 100).toFixed(4)}% + ${GAP / 2}px)`,
    top: `calc(${(r.y * 100).toFixed(4)}% + ${GAP / 2}px)`,
    width: `calc(${(r.w * 100).toFixed(4)}% - ${GAP}px)`,
    height: `calc(${(r.h * 100).toFixed(4)}% - ${GAP}px)`
  })

  const slotStyle = (i: number) => rectStyle(slotRect(i))

  /** drop 预览几何:center=整槽;四向=目标槽对应半区 */
  const zoneStyle = (slot: number, zone: DropZone): CSSProperties => {
    const r = slotRect(slot)
    const part =
      zone === 'left'
        ? { ...r, w: r.w / 2 }
        : zone === 'right'
          ? { ...r, x: r.x + r.w / 2, w: r.w / 2 }
          : zone === 'up'
            ? { ...r, h: r.h / 2 }
            : zone === 'down'
              ? { ...r, y: r.y + r.h / 2, h: r.h / 2 }
              : r
    return rectStyle(part)
  }

  /** 指针坐标 → 槽位 index(网格外返回 null) */
  const slotAt = (clientX: number, clientY: number): number | null => {
    const el = gridRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const fx = (clientX - rect.left) / rect.width
    const fy = (clientY - rect.top) / rect.height
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null
    const cur = wsRef.current
    const tc = cur.colFr.reduce((a, b) => a + b, 0)
    const tr = cur.rowFr.reduce((a, b) => a + b, 0)
    let col = cur.cols - 1
    let acc = 0
    for (let i = 0; i < cur.cols; i++) {
      acc += cur.colFr[i] / tc
      if (fx <= acc) {
        col = i
        break
      }
    }
    let row = cur.rows - 1
    acc = 0
    for (let i = 0; i < cur.rows; i++) {
      acc += cur.rowFr[i] / tr
      if (fy <= acc) {
        row = i
        break
      }
    }
    return row * cur.cols + col
  }

  const createPane = useCallback(
    // override 提供时优先(启动页/选择层直选);否则:下拉选中项目 > 设置页默认目录。
    // slotIndex:空槽点击经选择层创建时落入被点的槽(addPane 默认落第一个空槽)
    (override?: { cwd: string; name?: string }, slotIndex?: number) => {
      const cur = wsRef.current
      const cwd = override ? override.cwd : project || defaultCwd.trim()
      const projName =
        override?.name ??
        (override ? undefined : project ? projects.find((p) => p.root === project)?.name : undefined)
      const title = cwd
        ? `kimi · ${projName ?? baseName(cwd)}`
        : t('terminal.defaultTitle', { n: cur.panes.length + 1 })
      const r = addPane(cur, title, cwd || undefined)
      if (r) {
        const next =
          slotIndex !== undefined ? movePaneToSlot(r.ws, r.paneId, slotIndex) : r.ws
        commit(next)
      }
    },
    [commit, defaultCwd, project, projects, t]
  )

  /** 指令插入目标:最近交互的活动窗格 > 第一个有会话的可见窗格;无则丢弃 */
  const insertCommand = useCallback(
    (text: string) => {
      const target =
        (activePaneId && sessions[activePaneId] ? activePaneId : null) ??
        wsRef.current.slots.find((id) => id && sessions[id]) ??
        null
      const sid = target ? sessions[target] : null
      if (!sid) return
      void window.kimiApi.terminalWrite(sid, new TextEncoder().encode(text))
    },
    [activePaneId, sessions]
  )

  const closePane = useCallback(
    (paneId: string) => {
      // 关闭后收缩全空行/列(拆分遗留的空位自动去掉;至少保留 1×1)
      commit(shrinkEmptyTracks(removePane(wsRef.current, paneId)))
      setStatuses((cur) => {
        const next = { ...cur }
        delete next[paneId]
        return next
      })
      setSessions((cur) => {
        const next = { ...cur }
        delete next[paneId]
        return next
      })
    },
    [commit]
  )

  /** 窗格级拆分(四向):新窗格继承被拆窗格的 title 与 cwd(同项目就地开新终端) */
  const splitPane = useCallback(
    (paneId: string, dir: 'left' | 'right' | 'up' | 'down') => {
      const cur = wsRef.current
      if (cur.panes.length >= MAX_PANES) return
      const src = cur.panes.find((p) => p.id === paneId)
      if (!src) return
      const pane: PaneMeta = {
        id: crypto.randomUUID(),
        title: src.title,
        ...(src.cwd ? { cwd: src.cwd } : {})
      }
      const next = splitAt(cur, paneId, dir, pane.id)
      if (!next) return
      commit({ ...next, panes: [...next.panes, pane] })
    },
    [commit]
  )

  // 拆分上限(网格 ≤3 列/行、总槽位 ≤6、窗格 ≤12)
  const canSplitRight =
    ws.cols < 3 && (ws.cols + 1) * ws.rows <= 6 && ws.panes.length < MAX_PANES
  const canSplitDown =
    ws.rows < 3 && ws.cols * (ws.rows + 1) <= 6 && ws.panes.length < MAX_PANES

  // 右键菜单(哪个窗格、锚点坐标;null 关闭)
  const [ctxMenu, setCtxMenu] = useState<{ paneId: string; x: number; y: number } | null>(null)
  const openCtxMenu = useCallback((paneId: string, x: number, y: number) => {
    setCtxMenu({ paneId, x, y })
  }, [])
  // 点任意处 / Esc 关闭
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const onStatusChange = useCallback((paneId: string, status: PaneStatus) => {
    setStatuses((cur) => (cur[paneId] === status ? cur : { ...cur, [paneId]: status }))
  }, [])

  // ---- 逐缝缩放:拖动缝调整相邻 track 的 fr ----
  const startSeamDrag = (e: ReactPointerEvent<HTMLDivElement>, isCol: boolean, seam: number) => {
    e.preventDefault()
    const el = gridRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const size = isCol ? rect.width : rect.height
    const startPos = isCol ? e.clientX : e.clientY
    const snapshot = isCol ? [...wsRef.current.colFr] : [...wsRef.current.rowFr]
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: globalThis.PointerEvent) => {
      const delta = ((isCol ? ev.clientX : ev.clientY) - startPos) / size
      const fr = adjustSeam(snapshot, seam, delta)
      const next = isCol ? { ...wsRef.current, colFr: fr } : { ...wsRef.current, rowFr: fr }
      // 拖动中只更新 state,不持久化
      wsRef.current = next
      setWs(next)
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      saveWorkspace(wsRef.current)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp, { once: true })
    // 触摸/触控笔场景 pointercancel 也要收尾(否则 move 监听泄漏、布局不落盘)
    target.addEventListener('pointercancel', onUp, { once: true })
  }

  // ---- DnD:拖到槽位中央=交换/移入;拖到目标窗格边缘(30%)=在该侧拆分 ----
  const [dropTarget, setDropTarget] = useState<{ slot: number; zone: DropZone } | null>(null)

  /** 指针坐标 → 槽位 + 方位(空槽/拖到自身恒为 center;有主槽按 30% 边缘带判定四向) */
  const slotZoneAt = (clientX: number, clientY: number): { slot: number; zone: DropZone } | null => {
    const slot = slotAt(clientX, clientY)
    if (slot === null) return null
    const cur = wsRef.current
    // 拖到自身上方:按中央处理(预览整槽,松手回原位——拖拽只重排,不新建进程)
    if (!cur.slots[slot] || cur.slots[slot] === dragId) return { slot, zone: 'center' }
    const el = gridRef.current
    if (!el) return { slot, zone: 'center' }
    const rect = el.getBoundingClientRect()
    const r = slotRect(slot)
    const lx = ((clientX - rect.left) / rect.width - r.x) / r.w
    const ly = ((clientY - rect.top) / rect.height - r.y) / r.h
    const EDGE = 0.3
    if (lx < EDGE) return { slot, zone: 'left' }
    if (lx > 1 - EDGE) return { slot, zone: 'right' }
    if (ly < EDGE) return { slot, zone: 'up' }
    if (ly > 1 - EDGE) return { slot, zone: 'down' }
    return { slot, zone: 'center' }
  }

  const onPaneDragStart = (paneId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(DND_MIME, paneId)
    e.dataTransfer.effectAllowed = 'move'
    // 拖拽幻影换成小标签(默认整窗快照像把窗格拖出应用)
    const title = wsRef.current.panes.find((p) => p.id === paneId)?.title ?? ''
    const ghost = document.createElement('div')
    ghost.className = 'rounded-md bg-primary px-2.5 py-1 text-[12px] text-white shadow-lg'
    ghost.textContent = title
    ghost.style.position = 'absolute'
    ghost.style.top = '-1000px'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    requestAnimationFrame(() => ghost.remove())
    setDragId(paneId)
  }
  const onPaneDragEnd = () => {
    setDragId(null)
    setDropTarget(null)
  }
  const onGridDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // 浅比较:落点未变时复用旧对象,避免每个 dragover 都触发整页重渲染
    setDropTarget((cur) => {
      const next = slotZoneAt(e.clientX, e.clientY)
      if (cur === next) return cur
      if (cur && next && cur.slot === next.slot && cur.zone === next.zone) return cur
      return next
    })
  }
  const onGridDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const paneId = e.dataTransfer.getData(DND_MIME) || dragId
    const target = slotZoneAt(e.clientX, e.clientY)
    if (paneId && target) {
      const cur = wsRef.current
      const targetPane = cur.slots[target.slot]
      if (target.zone === 'center' || !targetPane || targetPane === paneId) {
        // 中央/空槽/自身:交换、移入或回原位(不新建进程)
        commit(movePaneToSlot(cur, paneId, target.slot))
      } else {
        // 拖到他人边缘:腾空原槽后在目标侧插入(移动,不新建;超 6 槽上限则不动)
        const cleared = { ...cur, slots: cur.slots.map((s) => (s === paneId ? null : s)) }
        const next = splitAt(cleared, targetPane, target.zone, paneId)
        if (next) commit(next)
      }
    }
    setDragId(null)
    setDropTarget(null)
  }
  const onBgDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (dragId) e.preventDefault()
  }
  const onBgDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const paneId = e.dataTransfer.getData(DND_MIME) || dragId
    if (paneId) commit(movePaneToBackground(wsRef.current, paneId))
    setDragId(null)
    setDropTarget(null)
  }

  /** 后台条目点击:放第一个空槽(无空槽时需拖拽到目标槽) */
  const sendToFirstEmpty = (paneId: string) => {
    const idx = wsRef.current.slots.indexOf(null)
    if (idx >= 0) commit(movePaneToSlot(wsRef.current, paneId, idx))
  }

  // Esc 还原最大化(右键菜单开着时让菜单先消化;xterm 内的 Esc 是 TUI 高频键,冒泡上来不还原)
  useEffect(() => {
    if (!ws.maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || ctxMenu) return
      if ((e.target as HTMLElement | null)?.closest?.('.xterm')) return
      commit(setMaximized(wsRef.current, null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws.maximized, ctxMenu, commit])

  const bgPanes = backgroundPanes(ws)
  const limitReached = ws.panes.length >= MAX_PANES

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-secondary">
      <div className="flex min-h-0 flex-1">
        {/* 网格区(绝对定位层;无工具栏——新建经空槽面板,布局经右键菜单/拖拽) */}
        <div
          ref={gridRef}
          className="relative min-h-0 flex-1"
          onDragOver={onGridDragOver}
          onDrop={onGridDrop}
          onDragLeave={(e) => {
            // 进入子元素也会冒泡 dragleave:目标仍在网格内则忽略,防预览高亮闪烁
            if (e.relatedTarget && gridRef.current?.contains(e.relatedTarget as Node)) return
            setDropTarget(null)
          }}
        >
        {ws.panes.map((pane) => {
          const slotIdx = ws.slots.indexOf(pane.id)
          const isMax = ws.maximized === pane.id
          // visible 与壳视图联合门控:应用启动/切走时不 spawn、不唤醒,切回终端视图才 respawn
          const visible = view === 'terminal' && (ws.maximized ? isMax : slotIdx >= 0)
          const style: CSSProperties = isMax
            ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 10 }
            : slotIdx >= 0
              ? slotStyle(slotIdx)
              : { display: 'none' }
          if (!visible) style.display = 'none'
          return (
            <TerminalPane
              key={pane.id}
              pane={pane}
              style={style}
              visible={visible}
              maximized={isMax}
              onClose={() => closePane(pane.id)}
              onToggleMaximize={() =>
                commit(setMaximized(wsRef.current, isMax ? null : pane.id))
              }
              onDragStart={onPaneDragStart(pane.id)}
              onDragEnd={onPaneDragEnd}
              onSplit={(dir) => splitPane(pane.id, dir)}
              disableSplitRight={!canSplitRight}
              disableSplitDown={!canSplitDown}
              onContextMenu={openCtxMenu}
              onStatusChange={onStatusChange}
              onSessionChange={(_id, sid) =>
                setSessions((cur) => ({ ...cur, [pane.id]: sid }))
              }
              onActivate={() => setActivePaneId(pane.id)}
            />
          )
        })}

        {/* 空槽(含空工作区):槽内项目选择面板(compact 密度),点击在该槽启动;
            空工作区时全槽皆空,网格模板所见即所得 */}
        {!ws.maximized &&
          !limitReached &&
          ws.slots.map(
            (s, i) =>
              s === null && (
                <div
                  key={`empty-${i}`}
                  className="absolute overflow-y-auto rounded-lg border border-dashed border-border bg-surface/60"
                  style={slotStyle(i)}
                >
                  <div className="flex min-h-full items-center justify-center">
                    <ProjectPicker
                      projects={projects}
                      onPick={(p) => {
                        setProject(p.root)
                        createPane({ cwd: p.root, name: p.name }, i)
                      }}
                      onDefault={() => {
                        setProject('')
                        createPane({ cwd: defaultCwd.trim() }, i)
                      }}
                    />
                  </div>
                </div>
              )
          )}

        {/* drop 目标高亮:中央=整槽(交换),四向=半槽(该侧拆分预览) */}
        {dropTarget !== null && !ws.maximized && (
          <div
            className="pointer-events-none absolute rounded-lg border-2 border-primary bg-primary/10"
            style={zoneStyle(dropTarget.slot, dropTarget.zone)}
          />
        )}

        {/* 缝 handle(列缝/行缝;空工作区无窗格时不渲染) */}
        {!ws.maximized &&
          ws.panes.length > 0 &&
          Array.from({ length: ws.cols - 1 }, (_, i) => {
            const x = colStarts[i] + ws.colFr[i] / totalCol
            return (
              <div
                key={`cs-${i}`}
                className="group absolute top-0 bottom-0 z-20 w-[7px] cursor-col-resize"
                style={{ left: `calc(${(x * 100).toFixed(4)}% - 3.5px)` }}
                onPointerDown={(e) => startSeamDrag(e, true, i)}
              >
                <div className="mx-auto h-full w-px bg-transparent group-hover:bg-primary group-active:bg-primary" />
              </div>
            )
          })}
        {!ws.maximized &&
          ws.panes.length > 0 &&
          Array.from({ length: ws.rows - 1 }, (_, i) => {
            const y = rowStarts[i] + ws.rowFr[i] / totalRow
            return (
              <div
                key={`rs-${i}`}
                className="group absolute right-0 left-0 z-20 h-[7px] cursor-row-resize"
                style={{ top: `calc(${(y * 100).toFixed(4)}% - 3.5px)` }}
                onPointerDown={(e) => startSeamDrag(e, false, i)}
              >
                <div className="my-auto w-full border-t border-transparent group-hover:border-primary group-active:border-primary" />
              </div>
            )
          })}
        </div>

        {/* 指令参考抽屉(推开式,收起时右缘把手) */}
        {helpOpen ? (
          <CommandDrawer onInsert={insertCommand} onClose={() => setHelpOpen(false)} />
        ) : (
          <button
            className="flex w-6 shrink-0 items-center justify-center border-l border-border text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-primary"
            onClick={() => setHelpOpen(true)}
            title={t('terminal.cheatsheet')}
          >
            <BookOpen size={13} />
          </button>
        )}
      </div>

      {/* 后台窗格栏 */}
      {bgPanes.length > 0 && (
        <div
          className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border px-2"
          onDragOver={onBgDragOver}
          onDrop={onBgDrop}
        >
          <span className="shrink-0 text-[11px] text-text-tertiary">
            {t('terminal.background')}
          </span>
          {bgPanes.map((p) => {
            const st = statuses[p.id]
            const dot =
              st === 'running'
                ? 'bg-success'
                : st === 'exited' || st === 'error'
                  ? 'bg-danger'
                  : 'bg-text-tertiary'
            return (
              <div
                key={p.id}
                className="flex shrink-0 cursor-grab items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-text-secondary hover:border-primary"
                draggable
                onDragStart={onPaneDragStart(p.id)}
                onDragEnd={onPaneDragEnd}
                onClick={() => sendToFirstEmpty(p.id)}
                title={p.title}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                <span className="max-w-[120px] truncate">{p.title}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* 窗格右键菜单:拆分/最大化/移入后台/布局/关闭 */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-elevated py-1 shadow-lg"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 160),
            top: Math.min(ctxMenu.y, window.innerHeight - 180)
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className={CTX_ITEM}
            disabled={!canSplitRight}
            onClick={() => {
              splitPane(ctxMenu.paneId, 'right')
              setCtxMenu(null)
            }}
          >
            {t('terminal.splitRight')}
          </button>
          <button
            className={CTX_ITEM}
            disabled={!canSplitDown}
            onClick={() => {
              splitPane(ctxMenu.paneId, 'down')
              setCtxMenu(null)
            }}
          >
            {t('terminal.splitDown')}
          </button>
          <div className="mx-2 my-1 border-t border-border" />
          <button
            className={CTX_ITEM}
            onClick={() => {
              commit(
                setMaximized(
                  wsRef.current,
                  wsRef.current.maximized === ctxMenu.paneId ? null : ctxMenu.paneId
                )
              )
              setCtxMenu(null)
            }}
          >
            {ws.maximized === ctxMenu.paneId
              ? t('terminal.restore')
              : t('terminal.maximize')}
          </button>
          <button
            className={CTX_ITEM}
            onClick={() => {
              commit(movePaneToBackground(wsRef.current, ctxMenu.paneId))
              setCtxMenu(null)
            }}
          >
            {t('terminal.moveBg')}
          </button>
          <button
            className={CTX_ITEM}
            onClick={() => {
              setHelpOpen(true)
              setCtxMenu(null)
            }}
          >
            {t('terminal.cheatsheet')}
          </button>
          <div className="mx-2 my-1 border-t border-border" />
          {/* 布局模板(整表重排;拆分产生的局部结构调整不受影响) */}
          <p className="px-3 pb-0.5 pt-1 text-[11px] text-text-tertiary">{t('terminal.layout')}</p>
          <div className="grid grid-cols-2 gap-0.5 px-2 pb-1">
            {GRID_PRESETS.map((p) => {
              const active = ws.cols === p.cols && ws.rows === p.rows
              return (
                <button
                  key={`${p.cols}x${p.rows}`}
                  className={`rounded px-2 py-1 text-[11px] ${
                    active
                      ? 'bg-surface-tertiary text-text'
                      : 'text-text-tertiary hover:bg-surface-tertiary hover:text-text'
                  }`}
                  onClick={() => {
                    commit(setGrid(wsRef.current, p.cols, p.rows))
                    setCtxMenu(null)
                  }}
                >
                  {p.cols}×{p.rows}
                </button>
              )
            })}
          </div>
          <div className="mx-2 my-1 border-t border-border" />
          <button
            className={CTX_ITEM}
            onClick={() => {
              closePane(ctxMenu.paneId)
              setCtxMenu(null)
            }}
          >
            {t('terminal.close')}
          </button>
        </div>
      )}
    </div>
  )
}
