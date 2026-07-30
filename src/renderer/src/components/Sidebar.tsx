import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import { groupSessions, useSessions } from '../stores/sessions'
import { useUi } from '../stores/ui'
import { rest, type SessionItem } from '../api'
import { FolderPickerDialog } from './FolderPickerDialog'

/** 相对时间(kimi web 同款紧凑格式):刚刚 / 5m / 2h / 3d / 12-30 */
function relTime(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const dt = new Date(t)
  return `${dt.getMonth() + 1}-${dt.getDate()}`
}

function SessionRow(props: { session: SessionItem; archived?: boolean }) {
  const { session: s, archived } = props
  const { activeSessionId, setActive, archiveSession, restoreSession, renameSession } = useSessions()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const active = activeSessionId === s.id

  useEffect(() => {
    if (renaming) nameRef.current?.select()
  }, [renaming])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const commitRename = () => {
    const v = nameRef.current?.value.trim()
    setRenaming(false)
    if (v && v !== s.title) void renameSession(s.id, v)
  }

  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 ${
        active ? 'bg-primary-soft text-primary' : 'text-text-secondary hover:bg-surface-secondary'
      }`}
      onClick={() => setActive(s.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {renaming ? (
        <input
          ref={nameRef}
          defaultValue={s.title}
          className="min-w-0 flex-1 rounded border border-primary-border bg-white px-1 py-0.5 text-[13px] outline-none"
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px]">{s.title || '未命名会话'}</span>
      )}
      {s.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />}
      <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
        {relTime(s.updated_at)}
      </span>
      {menu && (
        <div
          className="fixed z-50 w-36 rounded-lg border border-border bg-surface py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-secondary"
            onClick={() => {
              setMenu(null)
              setRenaming(true)
            }}
          >
            <Pencil size={13} /> 重命名
          </button>
          {archived ? (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-secondary"
              onClick={() => {
                setMenu(null)
                void restoreSession(s.id)
              }}
            >
              <RotateCcw size={13} /> 恢复
            </button>
          ) : (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-secondary"
              onClick={() => {
                setMenu(null)
                void archiveSession(s.id)
              }}
            >
              <Archive size={13} /> 归档
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** 工作区分组头:hover 显示 新建对话 / 更多(重命名、移除) */
function GroupHeader(props: {
  groupKey: string
  name: string
  root: string
  count: number
  isCollapsed: boolean
  isRealWorkspace: boolean
  onToggle: () => void
  onNewSession: (root: string) => void
}) {
  const { refresh } = useSessions()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const commitRename = async () => {
    const v = nameRef.current?.value.trim()
    setRenaming(false)
    if (!v || v === props.name) return
    await rest(`/api/v1/workspaces/${props.groupKey}`, {
      method: 'PATCH',
      body: { name: v }
    }).catch(() => {})
    await refresh()
  }

  const unregister = async () => {
    setConfirmDelete(false)
    await rest(`/api/v1/workspaces/${props.groupKey}`, { method: 'DELETE' }).catch(() => {})
    await refresh()
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5">
        <Folder size={14} className="shrink-0 text-primary" />
        <input
          ref={nameRef}
          defaultValue={props.name}
          autoFocus
          className="min-w-0 flex-1 rounded border border-primary-border bg-white px-1.5 py-0.5 text-[13px] outline-none"
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="group relative flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-tertiary"
      onClick={props.onToggle}
      role="button"
    >
      {props.isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      <Folder size={14} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1 cursor-default truncate text-[13px] font-medium">
        {props.name}
      </span>
      <span className="shrink-0 rounded-full bg-surface-tertiary px-1.5 py-px text-[11px] tabular-nums text-text-tertiary group-hover:hidden">
        {props.count}
      </span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <button
          className="rounded p-0.5 text-text-tertiary hover:bg-primary-soft hover:text-primary"
          title="在此工作区新建对话"
          onClick={(e) => {
            e.stopPropagation()
            props.onNewSession(props.root)
          }}
        >
          <Plus size={14} />
        </button>
        {props.isRealWorkspace && (
          <button
            className="rounded p-0.5 text-text-tertiary hover:bg-primary-soft hover:text-primary"
            title="更多"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </span>
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-1 top-full z-50 w-40 rounded-lg border border-border bg-surface py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-secondary"
            onClick={() => {
              setMenuOpen(false)
              props.onNewSession(props.root)
            }}
          >
            <MessageSquarePlus size={13} /> 新建对话
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-secondary"
            onClick={() => {
              setMenuOpen(false)
              setRenaming(true)
            }}
          >
            <Pencil size={13} /> 重命名工作区
          </button>
          {confirmDelete ? (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-danger hover:bg-danger-soft"
              onClick={() => void unregister()}
            >
              <Trash2 size={13} /> 确认移除(会话保留)
            </button>
          ) : (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-danger hover:bg-danger-soft"
              onClick={() => {
                setConfirmDelete(true)
                setTimeout(() => setConfirmDelete(false), 3000)
              }}
            >
              <Trash2 size={13} /> 移除工作区
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function Sidebar(props: { onOpenSettings: () => void }) {
  const {
    workspaces,
    sessions,
    archived,
    showArchived,
    toggleArchived,
    refresh,
    search,
    setSearch,
    createSession
  } = useSessions()
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerRoot, setPickerRoot] = useState<string | undefined>(undefined)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const open = () => setPickerOpen(true)
    window.addEventListener('kimi:new-task', open)
    return () => window.removeEventListener('kimi:new-task', open)
  }, [])

  useEffect(() => {
    const off = window.kimiApi.onSessionEvent((evt) => {
      const e = evt as { type?: string }
      if (e.type === 'event.session.created' || e.type === 'session.meta.updated') void refresh()
    })
    return off
  }, [refresh])

  const groups = useMemo(
    () => groupSessions(sessions, workspaces, search),
    [sessions, workspaces, search]
  )

  const openPicker = (root?: string) => {
    setPickerRoot(root)
    setPickerOpen(true)
  }

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border-light bg-surface-secondary">
      <div className="p-3 pb-2">
        <div className="flex items-center gap-1.5">
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
            onClick={() => openPicker(undefined)}
          >
            <FolderPlus size={14} /> 新建项目
          </button>
          <button
            className="rounded-lg p-2 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary"
            title="收起侧栏"
            onClick={toggleSidebar}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
        <div className="relative mt-2.5">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-7 text-[13px] outline-none focus:border-primary-border"
            placeholder="搜索会话 (Ctrl+N 新建项目)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
              onClick={() => setSearch('')}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!showArchived ? (
          groups.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-text-tertiary">
              暂无会话,点击"新建项目"开始
            </p>
          ) : (
            groups.map((g) => {
              // 默认折叠:用户点开后显式记录展开状态
              const isCollapsed = collapsed[g.key] ?? true
              return (
                <div key={g.key} className="mb-1">
                  <GroupHeader
                    groupKey={g.key}
                    name={g.name}
                    root={g.root}
                    count={g.items.length}
                    isCollapsed={isCollapsed}
                    isRealWorkspace={g.key.startsWith('wd_')}
                    onToggle={() => setCollapsed((c) => ({ ...c, [g.key]: !(c[g.key] ?? true) }))}
                    onNewSession={(root) => void createSession(root)}
                  />
                  {!isCollapsed && (
                    <div className="ml-[26px]">
                      {g.items.map((s) => (
                        <SessionRow key={s.id} session={s} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )
        ) : (
          <div>
            {archived.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-text-tertiary">没有归档会话</p>
            )}
            {archived.map((s) => (
              <SessionRow key={s.id} session={s} archived />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border-light p-2">
        <button
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${
            showArchived ? 'bg-primary-soft text-primary' : 'text-text-secondary hover:bg-surface-tertiary'
          }`}
          onClick={toggleArchived}
        >
          <Archive size={14} /> 归档历史
        </button>
        <button
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-tertiary"
          onClick={props.onOpenSettings}
        >
          <Settings size={14} /> 设置
        </button>
      </div>

      {pickerOpen && (
        <FolderPickerDialog
          initialPath={pickerRoot}
          onClose={() => setPickerOpen(false)}
          onSelect={(path) => {
            setPickerOpen(false)
            void createSession(path)
          }}
        />
      )}
    </div>
  )
}
