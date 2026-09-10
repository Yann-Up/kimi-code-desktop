/**
 * CLI 配置 · 实验性功能:官方 CLI 实验性特性与运行时开关(经环境变量在启动 kimi web 时注入)。
 * 开关持久化在 desktop-config.json(experimental 字段);激活通道服务运行中切换时后端自动重启生效。
 * Remote Control 已提升为常驻功能,见独立的「远程协作」设置页(RemoteControlSettings)。
 */
import { useEffect, useState } from 'react'
import { Card, GroupLabel, Section } from '../../components/settings/common'
import { ToggleField } from './cliForm'
import { useT } from '../../i18n'

interface FeatureDef {
  /** 注入给 CLI 的环境变量名 */
  env: string
  /** i18n 键(messages/experimental.ts 的 settings.cliExp.f.*) */
  labelKey: string
  descKey: string
}

/** 官方特性清单(实验项与 CLI 0.42.0 FlagResolver 注册表一致,新增实验特性时在此追加;
 *  另含 0.42 起常驻化的运行时开关 search worker / minidb 读模型。
 *  开关有效值以后端 experimental_get 返回为准:用户设置 > CLI 默认) */
const FEATURES: FeatureDef[] = [
  {
    env: 'KIMI_CODE_EXPERIMENTAL_FLAG',
    labelKey: 'settings.cliExp.f.master.label',
    descKey: 'settings.cliExp.f.master.desc'
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
    env: 'KIMI_CODE_EXPERIMENTAL_NOTIFY_USER',
    labelKey: 'settings.cliExp.f.notifyUser.label',
    descKey: 'settings.cliExp.f.notifyUser.desc'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_WAIT_FOR',
    labelKey: 'settings.cliExp.f.waitFor.label',
    descKey: 'settings.cliExp.f.waitFor.desc'
  },
  {
    env: 'KIMI_CODE_SEARCH_WORKER',
    labelKey: 'settings.cliExp.f.searchWorker.label',
    descKey: 'settings.cliExp.f.searchWorker.desc'
  },
  {
    env: 'KIMI_CODE_PERSISTENCE_MINIDB_READMODEL',
    labelKey: 'settings.cliExp.f.minidbRead.label',
    descKey: 'settings.cliExp.f.minidbRead.desc'
  }
]

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

  // 兜底超时:服务重启最坏约 60s(stop 5s + token 12s + 健康检查 45s),再留余量。
  // 无此兜底时 invoke 一旦异常挂起,saving 永远卡住、整页开关"点不动",
  // 只能切分区强制重挂载恢复(实测复现)
  const withTimeout = <T,>(p: Promise<T>) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('save timeout')), 75_000)
      )
    ])

  const toggle = async (env: string, v: boolean) => {
    if (!flags || saving) return
    const prev = flags
    const next = { ...flags, [env]: v }
    setFlags(next)
    setSaving(true)
    setMsg(null)
    try {
      await withTimeout(window.kimiApi.experimentalSet(next))
      setMsg({ ok: true, text: t('settings.cliExp.savedOk') })
    } catch (e) {
      if (e instanceof Error && e.message === 'save timeout') {
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
