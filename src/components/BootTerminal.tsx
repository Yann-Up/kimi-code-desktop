/**
 * BootTerminal: kimi web 启动中的占位终端。
 * 以打字机效果展示实际执行的启动命令(server:launch 下发的 line + 注入 env),
 * 服务就绪(ready)后快进收尾,动画完成经 onFinish 通知父组件切入官方 Web UI。
 * RC 收养等无 launch 广播的场景不阻塞:ready 即完成。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ServerLaunchInfo } from '../platform/kimi-api'
import { useT } from '../i18n'

interface BootTerminalProps {
  /** 实际执行命令(server:launch);undefined=尚未收到(准备中/RC 收养无新进程) */
  launch?: ServerLaunchInfo
  /** CLI 自动安装中(优先于命令展示) */
  installing: boolean
  /** server:ready 已到(服务可切入) */
  ready: boolean
  /** 注释行展示的通道名 */
  channelLabel: string
  /** 动画收尾且 ready 后回调(内部保证只调一次),父组件据此切 iframe */
  onFinish: () => void
}

/** 打字分段:注释/env 行暗色,命令行正常色 */
interface Segment {
  text: string
  cls: string
}

export function BootTerminal({ launch, installing, ready, channelLabel, onFinish }: BootTerminalProps) {
  const t = useT()

  const segments: Segment[] = useMemo(() => {
    if (!launch) return []
    const segs: Segment[] = [
      { text: `# ${t('shell.starting.comment', { channel: channelLabel })}\n`, cls: 'text-text-tertiary' }
    ]
    for (const [k, v] of launch.env) {
      segs.push({ text: `${k}=${v}\n`, cls: 'text-text-tertiary' })
    }
    segs.push({ text: `$ ${launch.line}`, cls: 'text-text' })
    return segs
  }, [launch, channelLabel, t])
  const totalLen = useMemo(() => segments.reduce((n, s) => n + s.text.length, 0), [segments])

  const [typed, setTyped] = useState(0)
  // 新一轮启动(launch 对象更换)从头打起
  useEffect(() => setTyped(0), [launch])

  // 打字:ready 前匀速(全程 ~1.2s 封顶);ready 后快进收尾(~400ms,正常启动下
  // launch 广播早于 ready 数秒,不会走到快进——仅收养/秒回等快路径兜底)
  useEffect(() => {
    if (totalLen === 0) return
    const per = ready ? 40 : Math.min(40, Math.max(8, 1200 / totalLen))
    const timer = setInterval(() => {
      setTyped((n) => {
        if (n >= totalLen) {
          clearInterval(timer)
          return n
        }
        const step = ready ? Math.max(1, Math.ceil((totalLen - n) / 10)) : 1
        return Math.min(n + step, totalLen)
      })
    }, per)
    return () => clearInterval(timer)
  }, [totalLen, ready])

  // 完成判定:ready 且打字结束(无 launch=收养/展示构造失败,ready 即完成)
  const doneRef = useRef(false)
  const onFinishRef = useRef(onFinish)
  useEffect(() => {
    onFinishRef.current = onFinish
  })
  useEffect(() => {
    if (!ready || doneRef.current) return
    if (totalLen === 0 || typed >= totalLen) {
      doneRef.current = true
      onFinishRef.current()
    }
  }, [ready, totalLen, typed])

  // 按已打字数切片渲染各分段
  let remaining = typed
  const rendered = segments.map((s, i) => {
    const n = Math.min(s.text.length, Math.max(0, remaining))
    remaining -= n
    return (
      <span key={i} className={s.cls}>
        {s.text.slice(0, n)}
      </span>
    )
  })
  const typingDone = totalLen > 0 && typed >= totalLen

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-[560px] rounded-xl bg-surface-tertiary px-5 py-4 font-mono text-[12.5px] leading-relaxed shadow-sm">
        {installing ? (
          <>
            <div className="flex items-center gap-2 text-text">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {t('shell.starting.installingCli')}
            </div>
            <p className="mt-2 text-[11px] text-text-tertiary">{t('shell.starting.installHint')}</p>
          </>
        ) : launch ? (
          <>
            <div className="whitespace-pre-wrap break-all">
              {rendered}
              <span className="inline-block h-[13px] w-[7px] translate-y-[2px] animate-pulse bg-primary" />
            </div>
            {typingDone && (
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[11.5px] text-text-tertiary">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {t('shell.starting.waiting')}
              </div>
            )}
          </>
        ) : (
          <div>
            <span className="text-text">$ </span>
            <span className="text-text-tertiary">{t('shell.starting.preparing')}</span>
            <span className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] animate-pulse bg-primary" />
          </div>
        )}
      </div>
    </div>
  )
}
