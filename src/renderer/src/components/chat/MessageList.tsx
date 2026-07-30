import { useEffect, useRef, useState } from 'react'
import { Bot, Brain, ChevronDown, ChevronRight, CircleDashed, CheckCircle2, XCircle, AlertCircle, Info } from 'lucide-react'
import type { ChatItem, UserImage } from '../../stores/stream'
import { Markdown } from '../Markdown'
import { ToolGroup } from './ToolCallCard'

/** 服务端文件图片:经 IPC 拉字节转 blob 显示 */
function FileImage({ fileId, name }: { fileId: string; name?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let revoke: string | null = null
    window.kimiApi
      .getFile(fileId)
      .then((buf: ArrayBuffer) => {
        const url = URL.createObjectURL(new Blob([buf]))
        // 组件已卸载:立即回收 blob URL,不再 setState
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        revoke = url
        setUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [fileId])
  if (!url) {
    return <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-white/20 text-[10px]">…</span>
  }
  return <img src={url} alt={name ?? fileId} className="max-h-40 rounded-lg" />
}

function UserImages({ images }: { images: UserImage[] }) {
  if (!images.length) return null
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {images.map((img, i) =>
        img.dataUrl ? (
          <img key={i} src={img.dataUrl} alt={img.name ?? 'image'} className="max-h-40 rounded-lg" />
        ) : img.fileId ? (
          <FileImage key={i} fileId={img.fileId} name={img.name} />
        ) : null
      )}
    </div>
  )
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** 把 item 流按"连续 tool"分组成渲染块 */
function groupItems(items: ChatItem[]): (ChatItem | ToolItem[])[] {
  const out: (ChatItem | ToolItem[])[] = []
  let buf: ToolItem[] = []
  const flush = () => {
    if (buf.length) {
      out.push(buf)
      buf = []
    }
  }
  for (const it of items) {
    if (it.kind === 'tool') buf.push(it)
    else {
      flush()
      out.push(it)
    }
  }
  flush()
  return out
}

function ThinkingBlock({ item }: { item: Extract<ChatItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-tertiary"
        onClick={() => setOpen(!open)}
      >
        <Brain size={13} />
        <span>思考过程{item.streaming ? '…' : ''}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-border-light px-3 py-2 text-[12.5px] text-text-secondary">
          <Markdown text={item.text} />
        </div>
      )}
    </div>
  )
}

function SubagentCard({ item }: { item: Extract<ChatItem, { kind: 'subagent' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-primary-border bg-primary-soft/50">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <Bot size={14} className="text-primary" />
        <span className="text-[12.5px] font-medium text-primary">子代理 · {item.name}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
          {item.description}
        </span>
        {item.status === 'running' ? (
          <CircleDashed size={14} className="animate-spin text-primary" />
        ) : item.status === 'completed' ? (
          <CheckCircle2 size={14} className="text-success" />
        ) : (
          <XCircle size={14} className="text-danger" />
        )}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && item.summary && (
        <div className="border-t border-primary-border/50 px-3 py-2 text-[12.5px] text-text-secondary">
          <Markdown text={item.summary} />
        </div>
      )}
    </div>
  )
}

export function MessageList({ items }: { items: ChatItem[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  useEffect(() => {
    if (stick) bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
  }, [items, stick])

  const blocks = groupItems(items)

  return (
    <div
      ref={containerRef}
      className="flex-1 select-text overflow-y-auto px-6 py-4"
      onScroll={(e) => {
        const el = e.currentTarget
        setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
      }}
    >
      <div className="mx-auto max-w-3xl space-y-3">
        {blocks.map((b, i) => {
          if (Array.isArray(b)) return <ToolGroup key={`tg${i}`} items={b} />
          switch (b.kind) {
            case 'user':
              return (
                <div key={b.id} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-white">
                    {b.images && <UserImages images={b.images} />}
                    {b.text.length > 2000 ? b.text.slice(0, 2000) + '…' : b.text}
                  </div>
                </div>
              )
            case 'assistant':
              return (
                <div key={b.id} className="text-[13.5px] text-text">
                  <Markdown text={b.text} />
                  {b.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary" />}
                </div>
              )
            case 'thinking':
              return <ThinkingBlock key={b.id} item={b} />
            case 'subagent':
              return <SubagentCard key={b.id} item={b} />
            case 'notice':
              return (
                <div key={b.id} className="flex items-center gap-1.5 text-[12px] text-text-tertiary">
                  <Info size={12} /> {b.text}
                </div>
              )
            case 'error':
              return (
                <div key={b.id} className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                  <AlertCircle size={13} /> {b.text}
                </div>
              )
            default:
              return null
          }
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
