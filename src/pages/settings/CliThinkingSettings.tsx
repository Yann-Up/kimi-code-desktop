/**
 * CLI 配置 · 思考:thinking.enabled / thinking.effort / thinking.keep。
 * 保存时提交 snake_case patch(深合并,effort 留空不提交)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
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

const KEEP_OPTIONS = [
  { value: 'all', label: 'all(保留历史思考内容)' },
  { value: 'off', label: 'off(关闭)' }
]

export function CliThinkingSettings() {
  const { config, loading, error, reload, saveSection, offline } = useCliConfig()
  return (
    <CliConfigGate title="思考" desc="Thinking 模式的全局默认行为(config.toml [thinking] 块)" loading={loading} error={error} onRetry={reload} offline={offline}>
      <ThinkingForm config={config ?? {}} saveSection={saveSection} offline={offline} />
    </CliConfigGate>
  )
}

function ThinkingForm({ config, saveSection, offline }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void>; offline: boolean }) {
  const [enabled, setEnabled] = useState<boolean>(bool(nested(config, 'thinking', 'enabled'), true))
  const [effort, setEffort] = useState<string>(str(nested(config, 'thinking', 'effort')))
  const [keep, setKeep] = useState<string>(str(nested(config, 'thinking', 'keep')) || 'all')

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
          label="默认开启思考"
          desc="新会话默认启用 Thinking 模式;关闭则强制不思考"
          checked={enabled}
          onChange={setEnabled}
        />
        <SelectField
          label="思考强度(effort)"
          desc="Kimi 模型若配置值不在 support_efforts 列表中,会回退到该模型的默认强度;留空跟随模型默认"
          placeholder="未设置(跟随模型默认)"
          value={effort}
          onChange={setEffort}
          options={EFFORT_OPTIONS}
        />
        <SelectField
          label="保留历史思考(keep)"
          desc="保留之前轮次的思考内容供后续参考;关闭后不保留"
          value={keep}
          onChange={setKeep}
          options={KEEP_OPTIONS}
        />
      </Card>

      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? '已写入 config.toml;重启服务后新会话生效' : undefined} />
    </>
  )
}
