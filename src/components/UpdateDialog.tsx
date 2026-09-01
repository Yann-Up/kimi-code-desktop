import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppUpdateInfo } from '../platform/kimi-api'
import { useUi } from '../stores/ui'
import { useT } from '../i18n'

/** GitHub Releases 下载页(「打开下载页」按钮,经 openExternal 转系统浏览器) */
const RELEASES_URL = 'https://github.com/Yann-Up/kimi-code-desktop/releases/latest'

/**
 * 「发现新版本」弹窗:标题栏更新按钮点开。
 * 版本说明(Release notes 原文,GitHub markdown 按纯文本展示);下载/安装与进度复用全局
 * store(appInstalling/appProgress,ShellHome 常驻监听),切视图不丢状态。
 */
export function UpdateDialog(props: { info: AppUpdateInfo; onClose: () => void }) {
  const t = useT()
  const installing = useUi((s) => s.appInstalling)
  const progress = useUi((s) => s.appProgress)
  const [current, setCurrent] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    window.kimiApi
      .appInfo()
      .then((i) => i.appVersion && setCurrent(i.appVersion))
      .catch(() => {})
  }, [])

  // Esc 取消(下载安装中除外,与 X 按钮禁用一致)
  useEffect(() => {
    if (installing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [installing]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 忽略此版本:持久化到 localStorage,该版本不再在标题栏出红点 */
  const ignore = () => {
    useUi.getState().ignoreAppUpdate(props.info.version)
    props.onClose()
  }

  /** 下载并安装:成功安装时进程被安装器接管重启;正常 resolve 意味着重新检查时更新已不存在 */
  const install = () => {
    const { setAppInstalling, setAppProgress } = useUi.getState()
    setErr('')
    setAppInstalling(true)
    setAppProgress(null)
    window.kimiApi
      .appUpdateInstall()
      .then(() => {
        setAppInstalling(false)
        setErr(t('update.noLongerAvailable'))
      })
      .catch((e) => {
        setAppInstalling(false)
        setErr(e instanceof Error ? e.message : String(e))
      })
  }

  const pct =
    progress && progress.total
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null
  const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/30"
      onClick={() => !installing && props.onClose()}
    >
      <div
        className="w-[480px] rounded-xl bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">{t('update.title')}</p>
          {/* 下载安装中禁止关闭:进程随时可能被安装器接管 */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text disabled:opacity-40"
            disabled={installing}
            onClick={props.onClose}
          >
            <X size={15} />
          </button>
        </div>
        <p className="mt-2 text-[13px] text-text-secondary">
          {current
            ? t('update.publishedLine', { version: props.info.version, current })
            : t('update.publishedLineNoCurrent', { version: props.info.version })}
        </p>
        {props.info.notes && (
          <div className="mt-3 max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-light p-3 text-[13px] leading-relaxed text-text">
            {props.info.notes.trim()}
          </div>
        )}

        {installing && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-fill">
              {/* 无进度数据(检查中/刚起下载)时走不确定态脉冲,不用固定宽度占位——
                  静态 40% 会在首个进度事件到达时跳回 2%,看着像"从中间回到 0" */}
              <div
                className={`h-full rounded-full bg-primary ${pct === null ? 'w-full animate-pulse' : 'transition-all'}`}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <p className="mt-1.5 text-[12px] tabular-nums text-text-tertiary">
              {progress
                ? pct !== null
                  ? t('update.downloadingPct', {
                      done: fmtMB(progress.downloaded),
                      total: fmtMB(progress.total!),
                      pct
                    })
                  : t('update.downloading', { done: fmtMB(progress.downloaded) })
                : t('update.preparing')}
            </p>
          </div>
        )}
        {err && <p className="mt-3 text-[12px] text-danger">{err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
            disabled={installing}
            onClick={props.onClose}
          >
            {t('update.cancel')}
          </button>
          <button
            className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
            disabled={installing}
            onClick={ignore}
          >
            {t('update.ignore')}
          </button>
          <button
            className="rounded-lg border border-border bg-elevated px-4 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
            disabled={installing}
            onClick={() => window.kimiApi.openExternal(RELEASES_URL).catch(() => {})}
          >
            {t('update.openDownloadPage')}
          </button>
          <button
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-70"
            disabled={installing}
            onClick={install}
          >
            {installing && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-white" />
            )}
            {installing ? t('update.installing') : t('update.downloadInstall')}
          </button>
        </div>
      </div>
    </div>
  )
}
