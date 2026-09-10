/**
 * 远程协作(Remote Control):把本机 Web UI 经官方中继暴露到公网链接,
 * 手机/其他电脑扫码或开链接即可远程操作本机 agent。
 * 开关持久化在 desktop-config.json(remote_control 字段);激活通道服务运行中切换时后端自动重启生效。
 */
import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, Section } from '../../components/settings/common'
import { ToggleField } from './cliForm'
import { useT } from '../../i18n'

/** Remote Control 访问链接面板:开关打开时展示。
 *  开启后服务自动重启、CLI 向官方中继注册需几秒:未拿到链接时每 3s 轮询,最多 10 次 */
function RemoteControlLink() {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const st = await window.kimiApi.remoteControlStatus()
      setUrl(st?.url ?? null)
      return Boolean(st?.url)
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async (n: number) => {
      const ok = await load()
      if (!cancelled && !ok && n < 10) setTimeout(() => void tick(n + 1), 3000)
    }
    void tick(0)
    return () => {
      cancelled = true
    }
  }, [load])

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  if (!url) {
    return <p className="mt-1.5 text-[11.5px] text-text-tertiary">{t('settings.rc.waiting')}</p>
  }
  return (
    <div className="mt-1.5">
      <div className="flex items-start gap-3">
        {/* 白底衬底保证扫码对比度(深色皮肤/立绘透出时仍需可读) */}
        <div className="shrink-0 rounded-lg border border-border bg-white p-1.5">
          <QRCodeSVG value={url} size={120} />
        </div>
        <div className="min-w-0">
          <p className="break-all font-mono text-[12px] text-primary">{url}</p>
          <div className="mt-1 flex items-center gap-2">
            <button
              className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-text transition-colors hover:bg-surface"
              onClick={() => void copy()}
            >
              {copied ? t('settings.rc.copied') : t('settings.rc.copy')}
            </button>
            <button
              className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-text transition-colors hover:bg-surface"
              onClick={() => void load()}
            >
              {t('settings.rc.refresh')}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-text-tertiary">{t('settings.rc.note')}</p>
    </div>
  )
}

export function RemoteControlSettings() {
  const t = useT()
  const [rc, setRc] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.kimiApi
      .remoteControlGet()
      .then(setRc)
      .catch(() => setRc(false))
  }, [])

  const toggle = async (v: boolean) => {
    if (rc === null || saving) return
    const prev = rc
    setRc(v)
    setSaving(true)
    setMsg(null)
    // 兜底超时:服务重启最坏约 60s(stop 5s + token 12s + 健康检查 45s),再留余量;
    // 无此兜底时 invoke 一旦异常挂起,saving 永远卡住、开关"点不动"(CliExperimentalSettings 实测复现过)
    try {
      await Promise.race([
        window.kimiApi.remoteControlSet(v),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('save timeout')), 75_000)
        )
      ])
      setMsg({ ok: true, text: t('settings.rc.savedOk') })
    } catch (e) {
      if (e instanceof Error && e.message === 'save timeout') {
        // 超时:后端可能已落盘并仍在重启,以服务端状态为准重新同步,不回滚
        window.kimiApi
          .remoteControlGet()
          .then(setRc)
          .catch(() => setRc(prev))
        setMsg({ ok: false, text: t('settings.rc.saveTimeout') })
      } else {
        setRc(prev) // 失败回滚
        setMsg({
          ok: false,
          text: t('settings.rc.saveFailed', { error: e instanceof Error ? e.message : String(e) })
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title={t('settings.rc.title')} desc={t('settings.rc.desc')}>
      <Card>
        <ToggleField
          label={t('settings.rc.toggle.label')}
          desc={t('settings.rc.toggle.desc')}
          checked={rc ?? false}
          disabled={saving || rc === null}
          onChange={(v) => void toggle(v)}
        />
        {rc && <RemoteControlLink />}
        {saving && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-tertiary">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {t('settings.rc.saving')}
          </p>
        )}
        {msg && (
          <p className={`mt-2 text-[12px] ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>
        )}
      </Card>
    </Section>
  )
}
