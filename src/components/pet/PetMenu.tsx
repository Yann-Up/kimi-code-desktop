/**
 * PetMenu: 桌宠悬浮菜单的渲染入口(?window=pet-menu,M5 P3)。
 * 380x460 透明浮层窗:搜索框 + 钉选分组 + 会话列表(REST 拉取,10s 轮询,
 * 窗口 hide 时经 document.hidden 暂停)+ 底部快捷行(主窗/统计/设置)。
 * 失焦收起在 Rust 侧(pet.rs on_window_event);Esc 与卡片外点击走 petMenuHide。
 * M6 视觉归一:菜单 = 宠物的大气泡——锚角色视觉头顶(pet.rs menu_position
 * 按激活宠物 frame 高换算)、卡片底部带指向宠物的小尾巴、入场从尾巴尖
 * 150ms 生长(visibilitychange 驱动,hide 后重show会重播)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Gauge, MessageSquare, Pin, PinOff, Search, Settings2 } from 'lucide-react'
import { rest, type SessionItem } from '../../api'
import { useT } from '../../i18n'

type TFn = ReturnType<typeof useT>

/** 轮询间隔(窗口 hide 期间 document.hidden 为 true,跳过请求) */
const POLL_MS = 10_000

/** cwd basename(尾部分隔符容忍;空串返回空) */
function cwdBasename(cwd?: string): string {
  if (!cwd) return ''
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/** 相对时间(本地时区日历;updated_at 为 ISO 字符串;文案 i18n,故接收 t) */
function relativeTime(t: TFn, iso: string): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diff = Math.max(0, Date.now() - ts)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return t('pet.time.justNow')
  if (min < 60) return t('pet.time.minutesAgo', { n: min })
  const hours = Math.floor(min / 60)
  if (hours < 24) return t('pet.time.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('pet.time.daysAgo', { n: days })
  return new Date(ts).toLocaleDateString()
}

export function PetMenu() {
  const t = useT()
  // null=尚未拉取过(加载中);拉取失败(后端未运行)时 backendDown=true
  const [sessions, setSessions] = useState<SessionItem[] | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const [pins, setPins] = useState<string[]>([])
  const [query, setQuery] = useState('')

  const hide = useCallback(() => {
    window.kimiApi.petMenuHide().catch(() => {})
  }, [])

  // 透明背景:theme.css 给 html/body/#root 都上了底色,浮层窗口必须全部穿透
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  // M6 生长动效:菜单 = 宠物的大气泡,从尾巴尖(transform-origin 底部中央)长出。
  // 组件常驻(hide 不 close),靠 visibilitychange 在每次重新可见时重播;
  // 双 rAF 保证初始样式先绘制一帧再过渡,关闭不做动画(hide 立即不可见)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    const play = () => {
      setEntered(false)
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => setEntered(true))
      })
    }
    play()
    const onVis = () => {
      if (!document.hidden) play()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hide])

  // 会话列表:打开即拉 + 轮询;窗口 hide 时(document.hidden)暂停,重新可见时立即补拉
  const load = useCallback(() => {
    rest<{ items: SessionItem[] } | SessionItem[]>('/api/v1/sessions')
      .then((d) => {
        setSessions(Array.isArray(d) ? d : (d?.items ?? []))
        setBackendDown(false)
      })
      .catch(() => setBackendDown(true))
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(() => {
      if (!document.hidden) load()
    }, POLL_MS)
    const onVis = () => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  // 钉选列表(持久化在 desktop-config.json 的 menu_pinned_sessions)
  useEffect(() => {
    window.kimiApi
      .petMenuPinsGet()
      .then(setPins)
      .catch(() => {})
  }, [])

  const togglePin = useCallback((id: string) => {
    window.kimiApi
      .petMenuPinToggle(id)
      .then(setPins)
      .catch(() => {})
  }, [])

  /** 点会话行:恢复主窗并跳转该会话。官方 web UI(0.37.2 起)支持
   * /sessions/<id> 路径路由(已按内嵌前端产物核实),经 app:navigate 让主窗
   * 拼带路径的 iframe src 重载直达;若官方路由未来变更,本函数是唯一接入点 */
  const focusSession = useCallback(
    (id: string) => {
      window.kimiApi.petMenuNavigate({ view: 'chat', sessionId: id }).catch(() => {})
      hide()
    },
    [hide]
  )

  /** 底部快捷行:统计/设置 = 唤回主窗并切 view */
  const openView = useCallback(
    (view: 'stats' | 'settings') => {
      window.kimiApi.petMenuNavigate({ view }).catch(() => {})
      hide()
    },
    [hide]
  )

  const openMain = useCallback(() => {
    window.kimiApi.petRestoreMain().catch(() => {})
    hide()
  }, [hide])

  // 过滤(title / cwd 包含匹配,大小写不敏感)+ 按 updated_at 倒序 + 钉选置顶分组
  const { pinnedList, recentList } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (sessions ?? [])
      .filter((s) => {
        if (!q) return true
        const cwd = s.metadata?.cwd ?? ''
        return s.title.toLowerCase().includes(q) || cwd.toLowerCase().includes(q)
      })
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    const pinSet = new Set(pins)
    return {
      pinnedList: list.filter((s) => pinSet.has(s.id)),
      recentList: list.filter((s) => !pinSet.has(s.id))
    }
  }, [sessions, pins, query])

  const renderRow = (s: SessionItem, pinned: boolean) => {
    const cwd = cwdBasename(s.metadata?.cwd)
    // 状态色点:busy=蓝 / 待交互=黄 / 其他=灰
    const dot = s.busy
      ? 'bg-primary'
      : s.pending_interaction
        ? 'bg-warning'
        : 'bg-text-tertiary'
    return (
      <div
        key={s.id}
        className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-primary-soft"
        onClick={() => focusSession(s.id)}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-text">
            {s.title || cwd || t('pet.menu.unnamed')}
          </span>
          <span className="block truncate text-[11px] text-text-tertiary">
            {cwd ? `${cwd} · ` : ''}
            {relativeTime(t, s.updated_at)}
          </span>
        </span>
        <button
          className={`shrink-0 rounded p-1 transition-colors ${
            pinned
              ? 'text-primary'
              : 'text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-primary'
          }`}
          title={pinned ? t('pet.menu.unpin') : t('pet.menu.pin')}
          onClick={(e) => {
            e.stopPropagation()
            togglePin(s.id)
          }}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
      </div>
    )
  }

  return (
    // 卡片外的透明区域点击 = 关闭菜单;入场动效(从尾巴尖长出)作用于整层。
    // justify-end 底对齐:窗口固定 460 高、菜单位置按窗口底边贴宠物头顶算,
    // 卡片高度随内容伸缩(后端未运行等空态很短),顶对齐会让空态卡片悬浮半空
    <div
      className={`flex h-full w-full origin-bottom flex-col justify-end p-1.5 transition-all duration-150 ease-out ${
        entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-90 opacity-0'
      }`}
      onClick={hide}
    >
      {/* 卡片+尾巴的 wrapper:阴影与宠物对话气泡对齐(气泡用 Tailwind `shadow`,
          即 0 1px 3px rgba(0,0,0,.1));box-shadow 只认矩形会让三角断成两截,
          故用等强度的 drop-shadow 跟随整体轮廓 */}
      <div className="flex max-h-full min-h-0 flex-col drop-shadow-[0_1px_3px_rgba(0,0,0,0.10)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {/* max-h 在上层 wrapper;卡片内容超出时收缩(内部列表滚动),给下方尾巴留 9px */}
        <div
          className="flex max-h-[calc(100%-9px)] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
          onClick={(e) => e.stopPropagation()}
        >
        {/* 搜索框 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border-light px-3 py-2">
          <Search size={14} className="shrink-0 text-text-tertiary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('pet.menu.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-tertiary"
          />
        </div>

        {/* 会话区(滚动) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {backendDown ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <p className="text-[13px] font-medium text-text-secondary">{t('pet.menu.backendDown')}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-text-tertiary">
                {t('pet.menu.backendDownHint')}
              </p>
            </div>
          ) : sessions === null ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : pinnedList.length + recentList.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12.5px] text-text-tertiary">
              {query ? t('pet.menu.noMatch') : t('pet.menu.empty')}
            </div>
          ) : (
            <>
              {pinnedList.length > 0 && (
                <>
                  <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-text-tertiary">
                    {t('pet.menu.pinned')}
                  </p>
                  {pinnedList.map((s) => renderRow(s, true))}
                  {recentList.length > 0 && (
                    <p className="px-2 pb-0.5 pt-2 text-[11px] font-medium text-text-tertiary">
                      {t('pet.menu.recent')}
                    </p>
                  )}
                </>
              )}
              {recentList.map((s) => renderRow(s, false))}
            </>
          )}
        </div>

        {/* 底部快捷行 */}
        <div className="flex shrink-0 items-stretch border-t border-border-light">
          <button
            className="flex flex-1 items-center justify-center gap-1.5 py-2 text-[12.5px] text-text-secondary hover:bg-surface-tertiary hover:text-text"
            onClick={openMain}
          >
            <MessageSquare size={13} /> {t('pet.menu.mainWindow')}
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-1.5 border-l border-border-light py-2 text-[12.5px] text-text-secondary hover:bg-surface-tertiary hover:text-text"
            onClick={() => openView('stats')}
          >
            <Gauge size={13} /> {t('pet.menu.stats')}
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-1.5 border-l border-border-light py-2 text-[12.5px] text-text-secondary hover:bg-surface-tertiary hover:text-text"
            onClick={() => openView('settings')}
          >
            <Settings2 size={13} /> {t('pet.menu.settings')}
          </button>
        </div>
      </div>

        {/* 尾巴(M6 修正):CSS 边框三角,整体挂在卡片下方(-mt-px 仅 1px 叠进卡片
            底边框盖住接缝),不再侵入卡片内容——原旋转正方形方案菱形对角线 ~17px,
            尖角探进卡片 8.5px 会遮住快捷行按钮。固定在卡片底部中央:菜单位置已对
            宠物尽力居中,屏幕 clamp 偏移通常很小,接受近似对齐 */}
        <div className="flex shrink-0 justify-center">
          <div className="-mt-px h-0 w-0 border-x-[8px] border-t-[9px] border-x-transparent border-t-surface" />
        </div>
      </div>
    </div>
  )
}
