/**
 * 终端窗格:xterm.js 封装(Workspace Grid 的单个窗格)。
 * - 组件恒挂载于 page 的绝对定位层(key=paneId 不变,交换/最大化只改 style),
 *   xterm 实例与滚动缓冲因此不随布局变化销毁;
 * - 不可见(后台/他人最大化/切视图)期间 write 照常入缓冲,恢复可见时 fit + refresh;
 * - 配色固定深色(readTermTheme):TUI 程序的颜色输出假设深色背景,不跟随壳主题。
 */
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { GripVertical, Loader2, Maximize2, Minimize2, RotateCw, SplitSquareHorizontal, SplitSquareVertical, SquareTerminal, TriangleAlert, X } from 'lucide-react'
import { useT } from '../../i18n'
import { useUi } from '../../stores/ui'
import type { PaneMeta } from './workspace'

/** 暗色 ANSI 调色板(参考 GitHub Dark) */
const ANSI_DARK = {
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
}

/**
 * 终端配色:固定深色,不跟随壳主题。
 * TUI 程序(kimi 及绝大多数 CLI)的颜色输出假设深色背景——跟随壳亮色会把
 * 程序指定的浅色文字洗到白底上不可读;终端模拟器惯例即浅色 IDE 下终端仍深底。
 * 色值与壳深色令牌对齐(--color-surface #121212 / --color-text 84% 白 / --color-primary #1a88ff),
 * 此处固定常量:它们是「终端配色」而非壳主题变量,壳主题切换不应改变终端。
 */
function readTermTheme(): ITheme {
  return {
    background: '#121212',
    foreground: 'rgba(255,255,255,0.84)',
    cursor: '#1a88ff',
    selectionBackground: '#1a88ff40',
    ...ANSI_DARK
  }
}

export type PaneStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

export interface TerminalPaneProps {
  pane: PaneMeta
  /** 槽位几何(page 计算;含 display 控制,不可见时 display:none) */
  style: CSSProperties
  /** 是否可见(不可见时惰性不启动进程;恢复可见时 fit + refresh) */
  visible: boolean
  /** 当前处于最大化态(标题栏按钮切换为还原) */
  maximized: boolean
  onClose: () => void
  onToggleMaximize: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: (e: DragEvent<HTMLDivElement>) => void
  /** 窗格级拆分(向右/向下;达上限的方向由 disable* 置灰) */
  onSplit: (dir: 'right' | 'down') => void
  disableSplitRight: boolean
  disableSplitDown: boolean
  /** 右键菜单( page 统一渲染) */
  onContextMenu: (paneId: string, x: number, y: number) => void
  /** 进程状态变化上报(后台窗格栏状态点用) */
  onStatusChange: (paneId: string, status: PaneStatus) => void
  /** 会话 id 上报(open 成功 = sid,退出/关闭 = null;指令参考抽屉的插入目标) */
  onSessionChange: (paneId: string, sessionId: string | null) => void
  /** 窗格被交互(mousedown):记为活动窗格(指令插入目标) */
  onActivate: (paneId: string) => void
}

const TITLE_BTN =
  'flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:bg-surface-tertiary hover:text-text'

export default function TerminalPane({
  pane,
  style,
  visible,
  maximized,
  onClose,
  onToggleMaximize,
  onDragStart,
  onDragEnd,
  onSplit,
  disableSplitRight,
  disableSplitDown,
  onContextMenu,
  onStatusChange,
  onSessionChange,
  onActivate
}: TerminalPaneProps) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const sessionRef = useRef<string | null>(null)
  const startedRef = useRef(false)
  /** 组件已卸载:start 的 await 在途时关窗,open 成功后立即 close 防 PTY 泄漏 */
  const disposedRef = useRef(false)
  const doFitRef = useRef<() => void>(() => {})
  /** 同步版 fit(启动前取真实 cols/rows 用;doFitRef 是 rAF 节流版) */
  const fitNowRef = useRef<() => void>(() => {})
  const [status, setStatus] = useState<PaneStatus>('idle')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const fontSize = useUi((s) => s.terminalFontSize)

  const start = async () => {
    const term = termRef.current
    if (!term) return
    setStatus('starting')
    setErrorMsg('')
    try {
      // 同步 fit 一次,保证 open 拿到真实 cols/rows(rAF 版本异步,读不到)
      fitNowRef.current()
      const sid = await window.kimiApi.terminalOpen(
        {
          ...(pane.cwd ? { cwd: pane.cwd } : {}),
          cols: term.cols || 80,
          rows: term.rows || 24
        },
        (bytes) => termRef.current?.write(bytes)
      )
      // open 在途时组件已卸载:立即归还会话,防 PTY 孤儿
      if (disposedRef.current) {
        void window.kimiApi.terminalClose(sid)
        return
      }
      sessionRef.current = sid
      onSessionChange(pane.id, sid)
      setStatus('running')
      termRef.current?.focus()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }
  const startRef = useRef(start)
  startRef.current = start
  /** 拆分回调最新引用(快捷键 effect 只挂一次) */
  const onSplitRef = useRef(onSplit)
  onSplitRef.current = onSplit

  // 初始化 xterm(一次;实例随组件存活,布局交换不重建)
  useEffect(() => {
    // StrictMode 双跑/重挂载时复位(否则 cleanup 置 true 后,start 的 open 返回会被误判为已卸载)
    disposedRef.current = false
    const host = hostRef.current
    if (!host) return
    const term = new XTerm({
      fontSize: useUi.getState().terminalFontSize,
      // 等宽字体栈(主题无关固定值;壳内嵌字体非等宽,不适合终端)
      fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
      cursorBlink: true,
      scrollback: 5000,
      theme: readTermTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // 链接点击一律转系统浏览器(仅 http/https;安全红线同聊天外链)
    term.loadAddon(
      new WebLinksAddon((_e, uri) => {
        if (/^https?:\/\//i.test(uri)) void window.kimiApi.openExternal(uri)
      })
    )
    term.open(host)
    termRef.current = term

    const encoder = new TextEncoder()
    const d1 = term.onData((data) => {
      const sid = sessionRef.current
      if (sid) void window.kimiApi.terminalWrite(sid, encoder.encode(data))
    })
    const d2 = term.onResize(({ cols, rows }) => {
      const sid = sessionRef.current
      if (sid) void window.kimiApi.terminalResize(sid, cols, rows)
    })

    // 拆分快捷键:Ctrl+Shift+D 向右拆分 / Ctrl+Shift+S 向下拆分(拦截不发 PTY)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        if (e.code === 'KeyD') {
          onSplitRef.current('right')
          return false
        }
        if (e.code === 'KeyS') {
          onSplitRef.current('down')
          return false
        }
      }
      return true
    })

    // 尺寸跟随(槽位几何/窗口变化):同步版供启动前调用,RO 走 rAF 节流;
    // 容器不可见(offset 0)时跳过(display:none 下 fit 会算出非法尺寸)
    fitNowRef.current = () => {
      const el = hostRef.current
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return
      try {
        fit.fit()
      } catch {
        /* 尺寸异常时静默 */
      }
    }
    let raf = 0
    doFitRef.current = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        fitNowRef.current()
      })
    }
    const ro = new ResizeObserver(() => doFitRef.current())
    ro.observe(host)

    return () => {
      disposedRef.current = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      d1.dispose()
      d2.dispose()
      const sid = sessionRef.current
      if (sid) void window.kimiApi.terminalClose(sid)
      sessionRef.current = null
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 进程退出事件(广播,各 pane 按 sessionId 自过滤)
  useEffect(
    () =>
      window.kimiApi.onTerminalExit((info) => {
        if (info.sessionId && info.sessionId === sessionRef.current) {
          sessionRef.current = null
          onSessionChange(pane.id, null)
          setExitCode(info.code)
          setStatus('exited')
        }
      }),
    []
  )

  // 惰性启动:首次可见时才开 PTY(重启应用后可见窗格经此自动 respawn,后台窗格首次可见才启动)
  useEffect(() => {
    if (visible && !startedRef.current) {
      startedRef.current = true
      void startRef.current()
    }
  }, [visible])

  // 恢复可见:重算尺寸并强制重绘(隐藏期间 write 已入缓冲)
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        doFitRef.current()
        const term = termRef.current
        term?.refresh(0, term.rows - 1)
      })
    }
  }, [visible])

  // 字号跟随(设置页)
  useEffect(() => {
    const term = termRef.current
    if (term && term.options.fontSize !== fontSize) {
      term.options.fontSize = fontSize
      doFitRef.current()
    }
  }, [fontSize])

  // 进程状态变化上报(后台栏状态点)
  useEffect(() => {
    onStatusChange(pane.id, status)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const restart = () => {
    termRef.current?.reset()
    void startRef.current()
  }

  return (
    <div
      className="group absolute flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface"
      style={style}
      onMouseDown={() => onActivate(pane.id)}
    >
      {/* 标题栏:DnD source(整栏可拖);右键菜单只在这里(终端内容区的右键还给 xterm/TUI) */}
      <div
        className="flex h-7 shrink-0 cursor-grab items-center gap-1 border-b border-border bg-surface-secondary px-1.5 active:cursor-grabbing"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(pane.id, e.clientX, e.clientY)
        }}
      >
        <GripVertical size={13} className="shrink-0 text-text-tertiary" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
          {pane.title}
        </span>
        {/* 拆分按钮:hover 浮现,降视觉噪音;快捷键 Ctrl+Shift+D/S */}
        <button
          className={`${TITLE_BTN} opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed`}
          onClick={() => onSplit('right')}
          disabled={disableSplitRight}
          title={t('terminal.splitRight')}
        >
          <SplitSquareVertical size={12} />
        </button>
        <button
          className={`${TITLE_BTN} opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed`}
          onClick={() => onSplit('down')}
          disabled={disableSplitDown}
          title={t('terminal.splitDown')}
        >
          <SplitSquareHorizontal size={12} />
        </button>
        <button
          className={TITLE_BTN}
          onClick={onToggleMaximize}
          title={maximized ? t('terminal.restore') : t('terminal.maximize')}
        >
          {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
        <button className={TITLE_BTN} onClick={onClose} title={t('terminal.close')}>
          <X size={12} />
        </button>
      </div>
      {/* xterm 容器 + 状态覆盖层(不透明底,遮住终端残留) */}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" />
        {status === 'starting' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-surface">
            <Loader2 size={18} className="animate-spin text-text-tertiary" />
            <p className="mt-2 text-[12px] text-text-tertiary">{t('terminal.starting')}</p>
          </div>
        )}
        {status === 'exited' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-surface">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-tertiary text-text-tertiary">
              <SquareTerminal size={18} />
            </div>
            <p className="text-[13px] font-medium">{t('terminal.exited')}</p>
            <p className="mt-1 text-[11px] text-text-tertiary">
              {exitCode !== null
                ? t('terminal.exitedCode', { code: exitCode })
                : (pane.cwd ?? '')}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] text-white hover:opacity-90"
                onClick={restart}
              >
                <RotateCw size={12} />
                {t('terminal.restart')}
              </button>
              <button
                className="rounded-md border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-tertiary"
                onClick={onClose}
              >
                {t('terminal.close')}
              </button>
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-surface px-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-tertiary text-danger">
              <TriangleAlert size={18} />
            </div>
            <p className="text-[13px] font-medium">{t('terminal.errorTitle')}</p>
            <p
              className="mt-1 max-w-full truncate text-[11px] text-text-tertiary"
              title={errorMsg}
            >
              {errorMsg}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] text-white hover:opacity-90"
                onClick={restart}
              >
                <RotateCw size={12} />
                {t('terminal.retry')}
              </button>
              <button
                className="rounded-md border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-tertiary"
                onClick={onClose}
              >
                {t('terminal.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
