/**
 * CLI 配置 · 实验性功能:官方 CLI 实验性特性的开关(默认关闭,经环境变量在启动 kimi web 时注入)。
 * 开关持久化在 desktop-config.json(experimental 字段);激活通道服务运行中切换时后端自动重启生效。
 */
import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, GroupLabel, Section } from '../../components/settings/common'
import { ToggleField } from './cliForm'
import { useT } from '../../i18n'

/** Remote Control 开关的 env 名(开关打开时在下方展示访问链接) */
const RC_ENV = 'KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL'

interface FeatureDef {
  /** 注入给 CLI 的环境变量名 */
  env: string
  /** i18n 键(messages/experimental.ts 的 settings.cliExp.f.*) */
  labelKey: string
  descKey: string
}

/** 官方实验性特性清单(与 CLI 0.39.0 FlagResolver 注册表一致;新增实验特性时在此追加。
 *  开关有效值以后端 experimental_get 返回为准:用户设置 > 桌面默认 > CLI 默认) */
const FEATURES: FeatureDef[] = [
  {
    env: 'KIMI_CODE_EXPERIMENTAL_FLAG',
    labelKey: 'settings.cliExp.f.master.label',
    descKey: 'settings.cliExp.f.master.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL',
    labelKey: 'settings.cliExp.f.secondaryModel.label',
    descKey: 'settings.cliExp.f.secondaryModel.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_TOOL_SELECT',
    labelKey: 'settings.cliExp.f.toolSelect.label',
    descKey: 'settings.cliExp.f.toolSelect.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_AUTO_SESSION_TITLE',
    labelKey: 'settings.cliExp.f.sessionTitle.label',
    descKey: 'settings.cliExp.f.sessionTitle.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER',
    labelKey: 'settings.cliExp.f.searchWorker.label',
    descKey: 'settings.cliExp.f.searchWorker.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_SUBAGENT_FORK',
    labelKey: 'settings.cliExp.f.subagentFork.label',
    descKey: 'settings.cliExp.f.subagentFork.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_TOWER',
    labelKey: 'settings.cliExp.f.tower.label',
    descKey: 'settings.cliExp.f.tower.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_WAIT_FOR',
    labelKey: 'settings.cliExp.f.waitFor.label',
    descKey: 'settings.cliExp.f.waitFor.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL',
    labelKey: 'settings.cliExp.f.minidbRead.label',
    descKey: 'settings.cliExp.f.minidbRead.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL',
    labelKey: 'settings.cliExp.f.remoteControl.label',
    descKey: 'settings.cliExp.f.remoteControl.desc'
  }
]

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
    return (
      <p className="mt-1.5 text-[11.5px] text-text-tertiary">{t('settings.cliExp.rcWaiting')}</p>
    )
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
              {copied ? t('settings.cliExp.rcCopied') : t('settings.cliExp.rcCopy')}
            </button>
            <button
              className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-text transition-colors hover:bg-surface"
              onClick={() => void load()}
            >
              {t('settings.cliExp.rcRefresh')}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-text-tertiary">{t('settings.cliExp.rcNote')}</p>
    </div>
  )
}

export function CliExperimentalSettings() {
  const t = useT()
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.kimiApi
      .experimentalGet()
      .then(setFlags)
      .catch(() => setFlags({}))
  }, [])

  const toggle = async (env: string, v: boolean) => {
    if (!flags || saving) return
    const prev = flags
    const next = { ...flags, [env]: v }
    setFlags(next)
    setSaving(true)
    setMsg(null)
    // 兜底超时:服务重启最坏约 60s(stop 5s + token 12s + 健康检查 45s),再留余量。
    // 无此兜底时 invoke 一旦异常挂起,saving 永远卡住、整页开关"点不动",
    // 只能切分区强制重挂载恢复(实测复现)
    let timedOut = false
    try {
      await Promise.race([
        window.kimiApi.experimentalSet(next),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            timedOut = true
            reject(new Error('experimentalSet timeout'))
          }, 75_000)
        )
      ])
      setMsg({ ok: true, text: t('settings.cliExp.savedOk') })
    } catch (e) {
      if (timedOut) {
        // 超时:后端可能已落盘并仍在重启,以服务端有效值为准重新同步,不回滚
        window.kimiApi
          .experimentalGet()
          .then(setFlags)
          .catch(() => setFlags(prev))
        setMsg({ ok: false, text: t('settings.cliExp.saveTimeout') })
      } else {
        setFlags(prev) // 失败回滚
        setMsg({
          ok: false,
          text: t('settings.cliExp.saveFailed', { error: e instanceof Error ? e.message : String(e) })
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title={t('settings.exp.title')} desc={t('settings.cliExp.desc')}>
      <GroupLabel>{t('settings.cliExp.groupToggles')}</GroupLabel>
      <Card>
        {flags === null ? (
          <p className="text-[12px] text-text-tertiary">{t('settings.cliExp.loading')}</p>
        ) : (
          <div className="divide-y divide-border-light">
            {FEATURES.map((f) => (
              <div key={f.env} className="py-2 first:pt-0 last:pb-0">
                <ToggleField
                  label={t(f.labelKey)}
                  desc={t(f.descKey)}
                  checked={flags[f.env] ?? false}
                  disabled={saving}
                  onChange={(v) => void toggle(f.env, v)}
                />
                <p className="mt-0.5 font-mono text-[11px] text-text-tertiary">{f.env}</p>
                {f.env === RC_ENV && (flags[f.env] ?? false) && <RemoteControlLink />}
              </div>
            ))}
          </div>
        )}
        {saving && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-tertiary">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {t('settings.cliExp.saving')}
          </p>
        )}
        {msg && (
          <p className={`mt-2 text-[12px] ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>
        )}
      </Card>

      <p className="mt-3 text-[11.5px] text-text-tertiary">{t('settings.cliExp.footnote')}</p>
    </Section>
  )
}
