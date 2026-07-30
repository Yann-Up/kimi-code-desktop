import { useEffect } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import { QuotaStrip } from '../components/chat/QuotaStrip'
import { EmptyStateHome } from '../components/home/EmptyStateHome'
import { ChatPage } from './ChatPage'
import { SettingsPage } from './SettingsPage'
import { useSessions } from '../stores/sessions'
import { useUi } from '../stores/ui'

export function HomePage() {
  const activeSessionId = useSessions((s) => s.activeSessionId)
  const { view, sidebarCollapsed, toggleSidebar } = useUi()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('kimi:new-task'))
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  return (
    <div className="relative flex min-h-0 flex-1">
      {sidebarCollapsed && (
        <button
          className="absolute left-2 top-2 z-40 rounded-lg border border-border bg-surface p-1.5 text-text-tertiary shadow-sm hover:bg-surface-tertiary hover:text-text-secondary"
          title="展开侧栏 (Ctrl+B)"
          onClick={toggleSidebar}
        >
          <PanelLeftOpen size={16} />
        </button>
      )}
      {!sidebarCollapsed && <Sidebar onOpenSettings={() => useUi.getState().openSettings()} />}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {/* 额度条只置顶右侧内容区,左侧会话/文件列表通高不受影响 */}
        <QuotaStrip />
        {view === 'settings' ? (
          <SettingsPage />
        ) : activeSessionId ? (
          <ChatPage sessionId={activeSessionId} key={activeSessionId} />
        ) : (
          <EmptyStateHome />
        )}
      </div>
    </div>
  )
}
