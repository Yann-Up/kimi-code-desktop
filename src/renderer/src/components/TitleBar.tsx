import { Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import logoUrl from '../assets/logo.png'

export function TitleBar() {
  const [cliVersion, setCliVersion] = useState<string>('')

  useEffect(() => {
    const off = window.kimiApi.onServerReady((info) => setCliVersion(info.cliVersion))
    window.kimiApi
      .appInfo()
      .then((i: { cliVersion: string | null }) => i.cliVersion && setCliVersion(i.cliVersion))
      .catch(() => {})
    return off
  }, [])

  return (
    <div
      data-tauri-drag-region
      className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border-light bg-surface pl-4"
    >
      <div className="flex items-center gap-2">
        <img src={logoUrl} alt="" className="h-5 w-5 rounded" draggable={false} />
        <span className="text-[13px] font-semibold">Kimi Code Desktop</span>
        {cliVersion && <span className="text-[11px] text-text-tertiary">CLI {cliVersion}</span>}
      </div>
      {/* Tauri 拖区在父级,这里阻止 mousedown 冒泡保证按钮可点 */}
      <div className="no-drag flex h-full" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="flex h-full w-11 items-center justify-center text-text-secondary hover:bg-surface-tertiary"
          onClick={() => window.kimiApi.windowControl('minimize')}
        >
          <Minus size={15} />
        </button>
        <button
          className="flex h-full w-11 items-center justify-center text-text-secondary hover:bg-surface-tertiary"
          onClick={() => window.kimiApi.windowControl('maximize')}
        >
          <Square size={13} />
        </button>
        <button
          className="flex h-full w-11 items-center justify-center text-text-secondary hover:bg-danger hover:text-white"
          onClick={() => window.kimiApi.windowControl('close')}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
