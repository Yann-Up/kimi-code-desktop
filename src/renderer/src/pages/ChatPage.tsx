import { useEffect, useRef } from 'react'
import { Code2, GitBranch, X } from 'lucide-react'
import { useStream } from '../stores/stream'
import { useSessions } from '../stores/sessions'
import { useGitUi } from '../stores/git'
import { MessageList } from '../components/chat/MessageList'
import { Composer } from '../components/chat/Composer'
import { ApprovalCard } from '../components/chat/ApprovalCard'
import { QuestionCard } from '../components/chat/QuestionCard'
import { GitPanel } from '../components/git/GitPanel'
import { CodePreviewPanel } from '../components/git/CodePreviewPanel'

export function ChatPage({ sessionId }: { sessionId: string }) {
  const { items, status, approvals, questions, loading, error, load, handleEvent, handleResync } =
    useStream()
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId))
  const cwd = session?.metadata?.cwd ?? ''
  const { panel, toggle: togglePanel, close: closePanel, bump: gitBump } = useGitUi()
  const prevBusy = useRef(false)

  useEffect(() => {
    void load(sessionId)
    void window.kimiApi.wsSubscribe(sessionId)
    const offEvt = window.kimiApi.onSessionEvent((evt) => {
      const e = evt as Record<string, unknown>
      if (e.session_id === sessionId) handleEvent(e)
    })
    const offResync = window.kimiApi.onResync((info) => {
      if (info.session_id === sessionId) handleResync()
    })
    // 后端重启(CLI 升级等)后 WS 连接由 Rust 侧重建,server:ready 时重新订阅当前会话
    // 并静默重载快照,补齐断流期间错过的事件
    const offReady = window.kimiApi.onServerReady(() => {
      void window.kimiApi.wsSubscribe(sessionId)
      void load(sessionId, { quiet: true })
    })
    return () => {
      offEvt()
      offResync()
      offReady()
      void window.kimiApi.wsUnsubscribe(sessionId)
    }
  }, [sessionId, load, handleEvent, handleResync])

  // 轮次结束(busy true→false)后刷新 Git 面板
  useEffect(() => {
    if (prevBusy.current && !status.busy) gitBump()
    prevBusy.current = !!status.busy
  }, [status.busy, gitBump])

  // 兜底渲染:busy 状态下,若 WS 事件静默超过 2.5s,每 2s 静默重载快照(WS 断流也能出内容)
  useEffect(() => {
    if (!status.busy) return
    const timer = setInterval(() => {
      const s = useStream.getState()
      if (s.status.busy && !s.loading && Date.now() - s.lastEventAt > 2500) {
        void s.load(sessionId, { quiet: true })
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [status.busy, sessionId])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-danger">加载会话失败:{error}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-light px-4">
          <span className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
            {session?.title || '未命名会话'}
          </span>
          <div className="flex items-center gap-1">
            <button
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ${
                panel === 'code'
                  ? 'bg-primary-soft text-primary'
                  : 'text-text-secondary hover:bg-surface-tertiary'
              }`}
              onClick={() => togglePanel('code')}
            >
              <Code2 size={14} /> 代码
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ${
                panel === 'git'
                  ? 'bg-primary-soft text-primary'
                  : 'text-text-secondary hover:bg-surface-tertiary'
              }`}
              onClick={() => togglePanel('git')}
            >
              <GitBranch size={14} /> Git
            </button>
            {/* 关闭当前会话窗:仅离开视图(setActive null),执行中的任务在服务端继续,
                需要停止任务请用顶部的"中断并返回首页" */}
            <button
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary"
              title="关闭当前会话(执行中的任务不会被中断)"
              onClick={() => useSessions.getState().setActive(null)}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <MessageList items={items} />
        {(approvals.length > 0 || questions.length > 0) && (
          <div className="shrink-0 px-6 pb-2">
            <div className="mx-auto max-w-3xl space-y-2">
              {approvals.map((a) => (
                <ApprovalCard key={a.id} approval={a} />
              ))}
              {questions.map((q) => (
                <QuestionCard key={q.id} question={q} />
              ))}
            </div>
          </div>
        )}
        <Composer sessionId={sessionId} />
        {status.pendingInteraction === 'approval' && approvals.length === 0 && (
          <div className="bg-warning-soft px-6 py-1.5 text-center text-[12px] text-warning">
            有一个审批在等待中…
          </div>
        )}
      </div>
      {panel === 'git' && cwd && (
        <div className="w-[300px] shrink-0 border-l border-border-light">
          <GitPanel cwd={cwd} />
        </div>
      )}
      {panel === 'code' && cwd && (
        <div className="w-[480px] shrink-0 border-l border-border-light">
          <CodePreviewPanel cwd={cwd} onClose={closePanel} />
        </div>
      )}
    </div>
  )
}
