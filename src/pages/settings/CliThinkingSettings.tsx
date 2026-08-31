/**
 * CLI 配置 · 思考:thinking.enabled / thinking.effort / thinking.keep。
 * 保存时提交 snake_case patch(深合并,effort 留空不提交)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import { useT } from '../../i18n'
import {
  bool,
  CliConfigGate,
  nested,
  SaveBar,
  SelectField,
  str,
  ToggleField,
  useSaveState
} from './cliForm'

const EFFORT_OPTIONS = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' }
]

export function CliThinkingSettings() {
  const t = useT()
  const { config, loading, error, reload, saveSection, offline } = useCliConfig()
  return (
    <CliConfigGate title={t('settings.cliThinking')} desc={t('settings.cliThinking.desc')} loading={loading} error={error} onRetry={reload} offline={offline}>
      <ThinkingForm config={config ?? {}} saveSection={saveSection} offline={offline} />
    </CliConfigGate>
  )
}

function ThinkingForm({ config, saveSection, offline }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void>; offline: boolean }) {
  const t = useT()
  const [enabled, setEnabled] = useState<boolean>(bool(nested(config, 'thinking', 'enabled'), true))
  const [effort, setEffort] = useState<string>(str(nested(config, 'thinking', 'effort')))
  const [keep, setKeep] = useState<string>(str(nested(config, 'thinking', 'keep')) || 'all')

  const KEEP_OPTIONS = [
    { value: 'all', label: t('settings.cliThinking.keepAll') },
    { value: 'off', label: t('settings.cliThinking.keepOff') }
  ]

  const { saving, saved, error, save } = useSaveState()

  const onSave = () =>
    void save(async () => {
      const thinking: Record<string, unknown> = { enabled }
      if (effort.trim()) thinking.effort = effort
      thinking.keep = keep
      await saveSection({ thinking })
    })

  return (
    <>
      <GroupLabel>Thinking</GroupLabel>
      <Card className="space-y-4">
        <ToggleField
          label={t('settings.cliThinking.enableLabel')}
          desc={t('settings.cliThinking.enableDesc')}
          checked={enabled}
          onChange={setEnabled}
        />
        <SelectField
          label={t('settings.cliThinking.effortLabel')}
          desc={t('settings.cliThinking.effortDesc')}
          placeholder={t('settings.cliThinking.effortPlaceholder')}
          value={effort}
          onChange={setEffort}
          options={EFFORT_OPTIONS}
        />
        <SelectField
          label={t('settings.cliThinking.keepLabel')}
          desc={t('settings.cliThinking.keepDesc')}
          value={keep}
          onChange={setKeep}
          options={KEEP_OPTIONS}
        />
      </Card>

      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? t('settings.cliCommon.savedOffline') : undefined} />
    </>
  )
}
