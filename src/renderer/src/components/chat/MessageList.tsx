import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bot, Brain, ChevronDown, ChevronRight, CircleDashed, CheckCircle2, XCircle, AlertCircle, Info, X, FileVideo, FileAudio, File as FileIcon, History, Loader2 } from 'lucide-react'
import type { ChatItem, UserImage, UserFile } from '../../stores/stream'
import { useStream } from '../../stores/stream'
import { useUi } from '../../stores/ui'
import { Markdown } from '../Markdown'
import { ToolGroup } from './ToolCallCard'

/** 图片灯箱:点击消息图片全屏查看,点击遮罩 / Esc 关闭 */
function ImageLightbox({ url, name, onClose }: { url: string; name?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-8"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20"
        title="关闭 (Esc)"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <img
        src={url}
        alt={name ?? 'image'}
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {name && (
        <span className="absolute bottom-4 max-w-[80%] truncate text-[12px] text-white/80">
          {name}
        </span>
      )}
    </div>
  )
}

/** 服务端文件图片:经 IPC 拉字节转 blob 显示 */
function FileImage({
  fileId,
  name,
  onPreview
}: {
  fileId: string
  name?: string
  onPreview?: (url: string, name?: string) => void
}) {
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
  return (
    <img
      src={url}
      alt={name ?? fileId}
      className="max-h-40 cursor-zoom-in rounded-lg"
      onClick={() => onPreview?.(url, name)}
    />
  )
}

function UserImages({ images }: { images: UserImage[] }) {
  const [preview, setPreview] = useState<{ url: string; name?: string } | null>(null)
  if (!images.length) return null
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {images.map((img, i) =>
        img.dataUrl ? (
          <img
            key={i}
            src={img.dataUrl}
            alt={img.name ?? 'image'}
            className="max-h-40 cursor-zoom-in rounded-lg"
            onClick={() => setPreview({ url: img.dataUrl!, name: img.name })}
          />
        ) : img.fileId ? (
          <FileImage
            key={i}
            fileId={img.fileId}
            name={img.name}
            onPreview={(url, name) => setPreview({ url, name })}
          />
        ) : null
      )}
      {preview && (
        <ImageLightbox url={preview.url} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}

/** 媒体灯箱:视频/音频附件全屏播放,遮罩 / Esc 关闭 */
function MediaLightbox({
  url,
  mime,
  name,
  onClose
}: {
  url: string
  mime: string
  name: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-8"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20"
        title="关闭 (Esc)"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      {mime.startsWith('video/') ? (
        <video
          src={url}
          controls
          autoPlay
          className="max-h-full max-w-full rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="rounded-xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
          <p className="mb-3 max-w-[60vw] truncate text-[13px] text-text">{name}</p>
          <audio src={url} controls autoPlay className="w-[420px] max-w-full" />
        </div>
      )}
    </div>
  )
}

function fmtSize(n?: number): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 文件附件卡片:视频/音频可点击播放(经 fileId 拉字节),其余仅展示信息 */
function UserFiles({ files }: { files: UserFile[] }) {
  const [media, setMedia] = useState<{ url: string; mime: string; name: string } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const close = () => {
    if (media) URL.revokeObjectURL(media.url)
    setMedia(null)
  }

  const open = async (f: UserFile, key: string) => {
    if (!f.fileId || !/^(video|audio)\//.test(f.mime ?? '')) return
    setLoadingId(key)
    try {
      const buf = await window.kimiApi.getFile(f.fileId)
      setMedia({
        url: URL.createObjectURL(new Blob([buf], { type: f.mime })),
        mime: f.mime!,
        name: f.name
      })
    } catch {
      /* 拉取失败仅不预览 */
    } finally {
      setLoadingId(null)
    }
  }

  if (!files.length) return null
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {files.map((f, i) => {
        const playable = !!f.fileId && /^(video|audio)\//.test(f.mime ?? '')
        const Icon = f.mime?.startsWith('video/')
          ? FileVideo
          : f.mime?.startsWith('audio/')
            ? FileAudio
            : FileIcon
        const key = f.fileId ?? String(i)
        const size = fmtSize(f.size)
        return (
          <button
            key={key}
            className={`flex max-w-full items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1.5 text-left text-[12px] ${
              playable ? 'cursor-pointer hover:bg-white/25' : 'cursor-default'
            }`}
            title={playable ? '点击播放' : f.name}
            onClick={() => void open(f, key)}
          >
            <Icon size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{f.name}</span>
            {loadingId === key ? (
              <span className="shrink-0 opacity-70">加载中…</span>
            ) : size ? (
              <span className="shrink-0 opacity-70">{size}</span>
            ) : null}
          </button>
        )
      })}
      {media && <MediaLightbox url={media.url} mime={media.mime} name={media.name} onClose={close} />}
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
  const streaming = !!item.streaming
  const [open, setOpen] = useState(streaming)
  const userToggled = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  /* 非用户干预时跟随流式状态:思考中展开,结束自动收起 */
  useEffect(() => {
    if (!userToggled.current) setOpen(streaming)
  }, [streaming])

  /* 展开时重置贴底标记 */
  const stickRef = useRef(true)
  useEffect(() => {
    if (open) stickRef.current = true
  }, [open])

  /* 流式期间内层容器跟随滚到底:最新思考文字始终可见;
     用户上翻超过 40px 后脱开(与外层列表的贴底逻辑一致),回滚到底部附近重新跟随 */
  useEffect(() => {
    if (!streaming || !open || !stickRef.current) return
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [item.text, streaming, open])

  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-tertiary"
        onClick={() => {
          userToggled.current = true
          setOpen(!open)
        }}
      >
        <Brain size={13} className={streaming ? 'animate-pulse text-primary' : ''} />
        <span className={streaming ? 'animate-pulse text-primary' : ''}>
          {streaming ? '思考中…' : '思考过程'}
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="max-h-80 overflow-y-auto border-t border-border-light px-3 py-2 text-[12.5px] text-text-secondary"
          onScroll={(e) => {
            const el = e.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
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
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const [stick, setStick] = useState(true)
  /* 右侧消息大纲:当前定位到的用户消息 id */
  const [activeMid, setActiveMid] = useState('')
  /* 历史分页:snapshot 只带最近 100 条,滚到顶部向前翻页 */
  const hasMore = useStream((s) => s.hasMore)
  const loadingEarlier = useStream((s) => s.loadingEarlier)
  const loadEarlier = useStream((s) => s.loadEarlier)
  /* prepend 前的 scrollHeight,用于保持视口位置 */
  const prependHeightRef = useRef<number | null>(null)

  const startLoadEarlier = () => {
    const el = containerRef.current
    if (el) prependHeightRef.current = el.scrollHeight
    // 未实际发起( guard 拒绝/请求失败/会话已切换)时清掉记录的高度,
    // 否则旧高度差会在下一次任意 items 变化时被误套用,视口猛跳
    void loadEarlier().then((started) => {
      if (!started) prependHeightRef.current = null
    })
  }

  /* 贴底自动滚动:只滚消息容器自身(scrollIntoView 会连祖先一起滚导致整页跳动),
     并用 rAF 合并一帧内的多次 delta,避免每个流式片段都硬跳一次 */
  useEffect(() => {
    if (!stick) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = containerRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [items, stick])

  /* 向前翻页 prepend 后:scrollTop 补上新增高度,视口内容不跳动 */
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el && prependHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
    }
  }, [items])

  const blocks = groupItems(items)
  const userMsgs = items.filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user')

  const jumpTo = (id: string) => {
    containerRef.current
      ?.querySelector(`#${CSS.escape(`msg_${id}`)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    /* 滚动接近顶部:自动向前翻一页 */
    if (el.scrollTop < 60 && hasMore && !loadingEarlier) startLoadEarlier()
    /* 大纲定位:最后一个顶部越过视口上沿(留 80px 余量)的用户消息 */
    let cur = ''
    el.querySelectorAll('[id^="msg_"]').forEach((n) => {
      if ((n as HTMLElement).offsetTop <= el.scrollTop + 80) {
        cur = (n as HTMLElement).id.slice(4)
      }
    })
    setActiveMid(cur)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className="h-full select-text overflow-y-auto px-6 pb-10 pt-4"
        onScroll={onScroll}
      >
        <div className="mx-auto max-w-3xl space-y-3">
          {/* 历史分页入口:自动触发之外的 manual 兜底 */}
          {hasMore && (
            <div className="flex justify-center pb-1">
              <button
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11.5px] text-text-tertiary hover:bg-surface-secondary disabled:opacity-60"
                disabled={loadingEarlier}
                onClick={startLoadEarlier}
              >
                {loadingEarlier ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <History size={12} />
                )}
                {loadingEarlier ? '加载中…' : '加载更早消息'}
              </button>
            </div>
          )}
          {blocks.map((b) => {
            if (Array.isArray(b)) return <ToolGroup key={`tg_${b[0].id}`} items={b} />
            switch (b.kind) {
              case 'user':
                return (
                  <div key={b.id} id={`msg_${b.id}`} className="flex scroll-mt-3 justify-end">
                    <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-white">
                      {b.images && <UserImages images={b.images} />}
                      {b.files && <UserFiles files={b.files} />}
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
                    <AlertCircle size={13} className="shrink-0" />
                    <span className="min-w-0 flex-1">{b.text}</span>
                    {b.action === 'login' && (
                      <button
                        className="shrink-0 rounded-md bg-danger px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
                        onClick={() => useUi.getState().openSettings('models')}
                      >
                        去登录
                      </button>
                    )}
                  </div>
                )
              default:
                return null
            }
          })}
        </div>
      </div>

      {/* 右侧消息大纲(kimi web 同款):列出用户消息,点击跳转,随滚动高亮当前位置 */}
      {userMsgs.length > 1 && (
        <div className="absolute right-2 top-1/2 flex max-h-[70%] w-44 -translate-y-1/2 flex-col gap-0.5 overflow-y-auto py-1">
          {userMsgs.map((m, idx) => {
            const active = activeMid ? activeMid === m.id : idx === 0
            return (
              <button
                key={m.id}
                title={m.text}
                onClick={() => jumpTo(m.id)}
                className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] leading-4 ${
                  active ? 'text-primary' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <span
                  className={`h-3.5 w-0.5 shrink-0 rounded-full ${
                    active ? 'bg-primary' : 'bg-border'
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{m.text.trim() || '[附件]'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
