import { useEffect, useRef, useState } from 'react'
import { Code2, GitBranch, List, X } from 'lucide-react'
import { useStream } from '../stores/stream'
import type { ChatItem } from '../stores/stream'
import { useSessions } from '../stores/sessions'
import { useGitUi } from '../stores/git'
import { MessageList } from '../components/chat/MessageList'
import { Composer } from '../components/chat/Composer'
import { ApprovalCard } from '../components/chat/ApprovalCard'
import { QuestionCard } from '../components/chat/QuestionCard'
import { GitPanel } from '../components/git/GitPanel'
import { CodePreviewPanel } from '../components/git/CodePreviewPanel'

/** 提问定位下拉:列出会话内全部用户提问,点击平滑滚动到对应消息并短暂高亮(kimi web 同款锚点) */
function PromptAnchor({ items }: { items: ChatItem[] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const prompts = items.filter((it): it is Extract<ChatItem, { kind: 'user' }> => it.kind === 'user')

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  /* 打开时列表滚到最新一条 */
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [open])

  if (!prompts.length) return null

  const jump = (id: string) => {
    setOpen(false)
    const el = document.getElementById(`msg_${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.style.transition = 'box-shadow .3s'
    el.style.boxShadow = '0 0 0 2px var(--color-primary)'
    window.setTimeout(() => {
      el.style.boxShadow = ''
    }, 1200)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary"
        title="提问定位"
        onClick={() => setOpen(!open)}
      >
        <List size={14} />
      </button>
      {open && (
        <div
          ref={listRef}
          className="absolute right-0 top-full z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
            <span className="text-[12px] font-medium text-text-tertiary">提问定位</span>
            <span className="text-[11px] tabular-nums text-text-tertiary">
              共 {prompts.length} 条
            </span>
          </div>
          {prompts.map((p, i) => {
            const first = p.text.trim().split('\n')[0]
            const label = first ? first.slice(0, 50) : '(附件)'
            return (
              <button
                key={p.id}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-primary-soft"
                onClick={() => jump(p.id)}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-surface-tertiary text-[11px] font-medium tabular-nums text-text-tertiary">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] leading-5 text-text">
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ChatPage({ sessionId }: { sessionId: string }) {
  const { items, status, approvals, questions, loading, error, load, handleEvent, handleResync } =
    useStream()
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId))
  const cwd = session?.metadata?.cwd ?? ''
  const { panel, toggle: togglePanel, close: closePanel, bump: gitBump } = useGitUi()
  const prevBusy = useRef(false)

  useEffect(() => {
    let disposed = false
    // 先快照后订阅:把快照水位(as_of_seq/epoch)带给服务端,回放从水位之后开始,
    // 避免快照内容与游标回放双写(切走再回来消息翻倍的根因)
    void (async () => {
      const cursor = await load(sessionId)
      if (!disposed) void window.kimiApi.wsSubscribe(sessionId, cursor ?? undefined)
    })()
    const offEvt = window.kimiApi.onSessionEvent((evt) => {
      const e = evt as Record<string, unknown>
      if (e.session_id === sessionId) handleEvent(e)
    })
    const offResync = window.kimiApi.onResync((info) => {
      if (info.session_id === sessionId) handleResync()
    })
    // 后端重启(CLI 升级等)后 WS 连接由 Rust 侧重建,server:ready 时重新订阅当前会话
    // 并静默重载快照,补齐断流期间错过的事件;同样按"先快照后订阅"绑定水位
    const offReady = window.kimiApi.onServerReady(() => {
      void (async () => {
        const cursor = await load(sessionId, { quiet: true })
        if (!disposed) void window.kimiApi.wsSubscribe(sessionId, cursor ?? undefined)
      })()
    })
    return () => {
      disposed = true
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

  // 兜底渲染:仅 WS 断连时,busy 状态下每 2s 静默重载快照。
  // WS 正常时的"安静"只是长工具在执行(业务静默),此时重载会与实时事件流互相覆盖,画面抖动
  const [wsOpen, setWsOpen] = useState(true)
  useEffect(() => window.kimiApi.onWsState((st) => setWsOpen(st === 'open')), [])
  useEffect(() => {
    if (!status.busy || wsOpen) return
    const timer = setInterval(() => {
      const s = useStream.getState()
      if (s.status.busy && !s.loading && Date.now() - s.lastEventAt > 2500) {
        void s.load(sessionId, { quiet: true })
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [status.busy, sessionId, wsOpen])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-danger">加载会话失败:{error}</p>
        <button
          className="rounded-lg border border-border px-3.5 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
          onClick={() => void load(sessionId)}
        >
          重试
        </button>
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
            {/* 提问定位:列出本会话所有用户提问,点击滚动锚定到对应消息 */}
            <PromptAnchor items={items} />
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
