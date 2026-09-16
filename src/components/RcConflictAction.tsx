/**
 * RC 冲突定向操作按钮:结束占住 Remote Control 单例的旧实例,成功后回调重启服务。
 * App 启动失败页与 ShellHome 占位页共用;结束失败(非 kimi 进程/SSH 远端等)就地展示原因
 */
import { useState } from 'react'
import { useT } from '../i18n'
import type { RcConflictInfo } from './rcConflict'

export function RcConflictAction({
  conflict,
  channel,
  onRestart
}: {
  conflict: RcConflictInfo
  /** 错误归属通道:杀锁按该通道解析连接目标(缺省=杀时激活通道,可能已切换) */
  channel?: string
  onRestart: () => void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="flex flex-col items-center">
      <button
        className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setErr('')
          window.kimiApi
            .rcKillHolder(conflict.pid, channel)
            .then(() => onRestart())
            .catch((e) => {
              setBusy(false)
              setErr(e instanceof Error ? e.message : String(e))
            })
        }}
      >
        {busy ? t('rc.conflict.killing') : t('rc.conflict.killRetry', { pid: conflict.pid })}
      </button>
      {err && <p className="mt-2 max-w-[360px] text-center text-[12px] text-danger">{err}</p>}
    </div>
  )
}
