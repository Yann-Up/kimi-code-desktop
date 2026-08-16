import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Folder, HardDrive, X } from 'lucide-react'
import { rest } from '../api'
import { useUi } from '../stores/ui'

interface BrowseResult {
  path: string
  parent?: string | null
  entries: { name: string; path: string; is_dir: boolean }[]
}

export function FolderPickerDialog(props: {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
  /** 复用场景的文案定制(默认是"新建任务选工作目录"语义) */
  title?: string
  subtitle?: string
  confirmLabel?: string
}) {
  const [current, setCurrent] = useState<BrowseResult | null>(null)
  const [drives, setDrives] = useState<string[] | null>(null)
  // 平台是否有盘符概念:Windows 有;Linux/macOS(含 WSL 本机)没有,退化为普通目录浏览
  const [drivesAvailable, setDrivesAvailable] = useState<boolean | null>(null)
  const [pathText, setPathText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 非本机连接目标:目录浏览面向远端文件系统,不出现盘符页
  const isLocal = useUi((s) => s.connectionTarget === 'local')

  const browse = async (path?: string) => {
    setLoading(true)
    setError(null)
    setDrives(null)
    try {
      const data = await rest<BrowseResult>('/api/v1/fs:browse', {
        query: path ? { path } : {}
      })
      setCurrent(data)
      setPathText(data.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const showDrives = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = (await window.kimiApi.localDrives()) as string[]
      if (Array.isArray(list) && list.length) {
        setDrivesAvailable(true)
        setDrives(list)
        setCurrent(null)
        setPathText('')
        setLoading(false)
      } else {
        // 无盘符平台(Linux/macOS/WSL 本机):直接进入目录浏览(服务端默认目录,通常是 home)
        setDrivesAvailable(false)
        await browse()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    }
  }

  useEffect(() => {
    // 本机:默认落在"此电脑"(盘符选择);远端:无参 browse 直达服务端默认目录(通常是远端 home)
    if (props.initialPath) void browse(props.initialPath)
    else if (isLocal) void showDrives()
    else void browse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirs = (current?.entries ?? []).filter((e) => e.is_dir)
  const atDriveRoot = !!current && !current.parent

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={props.onClose}
    >
      <div
        className="flex h-[480px] w-[560px] flex-col rounded-xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
          <div>
            <span className="text-[15px] font-semibold">{props.title ?? '选择工作文件夹'}</span>
            <span className="ml-2 text-xs text-text-tertiary">
              {props.subtitle ?? '新任务将在此文件夹中进行'}
            </span>
          </div>
          <button
            className="rounded p-1 text-text-tertiary hover:bg-surface-tertiary"
            onClick={props.onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-border-light px-5 py-2">
          <input
            ref={inputRef}
            className="w-full bg-transparent text-[13px] text-text-secondary outline-none placeholder:text-text-tertiary"
            placeholder={drives ? '此电脑(选择盘符,或输入路径回车)' : '输入路径回车'}
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathText.trim()) void browse(pathText.trim())
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {!drives && current?.parent && (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-secondary"
              onClick={() => void browse(current.parent!)}
            >
              <ArrowUp size={14} /> 上一级
            </button>
          )}
          {!drives && isLocal && atDriveRoot && drivesAvailable && (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-secondary"
              onClick={() => void showDrives()}
            >
              <ArrowUp size={14} /> 此电脑(选择盘符)
            </button>
          )}
          {loading && <p className="px-3 py-2 text-xs text-text-tertiary">加载中…</p>}
          {error && <p className="px-3 py-2 text-xs text-danger">{error}</p>}
          {!loading &&
            !drives &&
            dirs.map((e) => (
              <button
                key={e.path}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-primary-soft"
                onClick={() => void browse(e.path)}
              >
                <Folder size={15} className="shrink-0 text-primary" />
                <span className="truncate">{e.name}</span>
              </button>
            ))}
          {!loading &&
            drives?.map((d) => (
              <button
                key={d}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-primary-soft"
                onClick={() => void browse(d)}
              >
                <HardDrive size={15} className="shrink-0 text-primary" />
                <span>{d}</span>
              </button>
            ))}
          {!loading && !drives && !dirs.length && !error && (
            <p className="px-3 py-6 text-center text-xs text-text-tertiary">此文件夹没有子文件夹</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-light px-5 py-3">
          <span className="max-w-[360px] truncate text-xs text-text-tertiary">
            {drives ? '此电脑' : current?.path}
          </span>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={!current}
            onClick={() => current && props.onSelect(current.path)}
          >
            {props.confirmLabel ?? '在此文件夹开始'}
          </button>
        </div>
      </div>
    </div>
  )
}
