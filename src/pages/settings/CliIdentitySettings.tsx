/**
 * CLI 配置 · 身份:identity.name / identity.slug。
 * 自定义 agent 在系统提示中的自称;启动时解析一次,新会话生效。
 * 注意:REST /api/v1/config 会静默丢弃 identity 段(实测 200 但不落盘),
 * 故本页保存改走文件合并写(cliConfigMerge,保留注释、自动备份);读取仍走 REST。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import { useT } from '../../i18n'
import {
  CliConfigGate,
  nested,
  SaveBar,
  str,
  TextField,
  useSaveState
} from './cliForm'

export function CliIdentitySettings() {
  const t = useT()
  const { config, loading, error, reload, offline } = useCliConfig()
  return (
    <CliConfigGate title={t('settings.cliIdentity')} desc={t('settings.cliIdentity.desc')} loading={loading} error={error} onRetry={reload} offline={offline}>
      <IdentityForm config={config ?? {}} />
    </CliConfigGate>
  )
}

function IdentityForm({ config }: { config: CliConfig }) {
  const t = useT()
  const [name, setName] = useState<string>(str(nested(config, 'identity', 'name')))
  const [slug, setSlug] = useState<string>(str(nested(config, 'identity', 'slug')))
  const [savedMsg, setSavedMsg] = useState('')

  const { saving, saved, error, save } = useSaveState()

  const onSave = () =>
    void save(async () => {
      // 文件合并写:null = 删除该键(清空输入即清除自定义,恢复默认身份)
      const backup = await window.kimiApi.cliConfigMerge({
        identity: {
          name: name.trim() ? name.trim() : null,
          slug: slug.trim() ? slug.trim() : null
        }
      })
      setSavedMsg(t('settings.cliIdentity.savedOk', { backup }))
      setTimeout(() => setSavedMsg(''), 4000)
    })

  return (
    <>
      <GroupLabel>{t('settings.cliIdentity.group')}</GroupLabel>
      <Card className="space-y-4">
        <TextField
          label={t('settings.cliIdentity.nameLabel')}
          desc={t('settings.cliIdentity.nameDesc')}
          placeholder={t('settings.cliIdentity.namePlaceholder')}
          value={name}
          onChange={setName}
        />
        <TextField
          label={t('settings.cliIdentity.slugLabel')}
          desc={t('settings.cliIdentity.slugDesc')}
          placeholder={t('settings.cliIdentity.slugPlaceholder')}
          mono
          value={slug}
          onChange={setSlug}
        />
      </Card>

      <div className="pt-3">
        <p className="text-[11.5px] text-text-tertiary">
          {t('settings.cliIdentity.noteResolve')}
        </p>
      </div>
      <div className="pt-3">
        <p className="text-[11.5px] text-text-tertiary">
          {t('settings.cliIdentity.noteWrite')}
        </p>
      </div>
      {savedMsg && <p className="pt-2 text-[12px] text-success">{savedMsg}</p>}
      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} />
    </>
  )
}
