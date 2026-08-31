/**
 * CLI 配置 · 循环与后台:loop_control / background / subagent / swarm / token_counting。
 * 保存时提交 snake_case patch;数字留空不提交,0 表示"不限"(仅对支持 0 语义的字段)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import { useT } from '../../i18n'
import {
  bool,
  CliConfigGate,
  MergeNote,
  nested,
  numStr,
  NumberField,
  SaveBar,
  SelectField,
  str,
  ToggleField,
  useSaveState
} from './cliForm'

export function CliLoopSettings() {
  const t = useT()
  const { config, loading, error, reload, saveSection, offline } = useCliConfig()
  return (
    <CliConfigGate title={t('settings.cliLoop.pageTitle')} desc={t('settings.cliLoop.desc')} loading={loading} error={error} onRetry={reload} offline={offline}>
      <LoopForm config={config ?? {}} saveSection={saveSection} offline={offline} />
    </CliConfigGate>
  )
}

function LoopForm({ config, saveSection, offline }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void>; offline: boolean }) {
  const t = useT()
  const [maxStepsPerTurn, setMaxStepsPerTurn] = useState<string>(
    numStr(nested(config, ['loop_control', 'loopControl'], 'maxStepsPerTurn'))
  )
  const [maxAttemptsPerStep, setMaxAttemptsPerStep] = useState<string>(
    numStr(nested(config, ['loop_control', 'loopControl'], 'maxAttemptsPerStep')) || '10'
  )
  const [reservedContextSize, setReservedContextSize] = useState<string>(
    numStr(nested(config, ['loop_control', 'loopControl'], 'reservedContextSize'))
  )
  const [maxRunningTasks, setMaxRunningTasks] = useState<string>(numStr(nested(config, 'background', 'maxRunningTasks')))
  const [keepAliveOnExit, setKeepAliveOnExit] = useState<boolean>(
    bool(nested(config, 'background', 'keepAliveOnExit'), false)
  )
  const [bashAutoBackground, setBashAutoBackground] = useState<boolean>(
    bool(nested(config, 'background', 'bashAutoBackgroundOnTimeout'), true)
  )
  const [bashTaskTimeoutS, setBashTaskTimeoutS] = useState<string>(
    numStr(nested(config, 'background', 'bashTaskTimeoutS')) || '600'
  )
  const [subagentTimeoutMs, setSubagentTimeoutMs] = useState<string>(
    numStr(nested(config, 'subagent', 'timeoutMs')) || '7200000'
  )
  const [swarmTimeoutMs, setSwarmTimeoutMs] = useState<string>(
    numStr(nested(config, 'swarm', 'timeoutMs')) || '7200000'
  )
  const [strategy, setStrategy] = useState<string>(
    str(nested(config, ['token_counting', 'tokenCounting'], 'strategy')) || 'measured+estimated'
  )

  const STRATEGY_OPTIONS = [
    { value: 'measured+estimated', label: t('settings.cliLoop.strategyMeasuredEstimated') },
    { value: 'measured', label: t('settings.cliLoop.strategyMeasured') },
    { value: 'estimated', label: t('settings.cliLoop.strategyEstimated') }
  ]

  const { saving, saved, error, save } = useSaveState()

  /** 数字字段解析:留空返回 undefined(不提交),非法或负数抛错;合法返回数值 */
  const toInt = (raw: string, label: string): number | undefined => {
    const s = raw.trim()
    if (s === '') return undefined
    const n = Number(s)
    if (!Number.isInteger(n) || n < 0) throw new Error(t('settings.cliCommon.errNonNegInt', { label }))
    return n
  }

  const onSave = () =>
    void save(async () => {
      const loop: Record<string, number> = {}
      const bg: Record<string, number | boolean> = {}
      const put = (obj: Record<string, number | boolean>, key: string, raw: string, label: string) => {
        const v = toInt(raw, label)
        if (v !== undefined) obj[key] = v
      }
      put(loop, 'max_steps_per_turn', maxStepsPerTurn, t('settings.cliLoop.labelMaxSteps'))
      put(loop, 'max_attempts_per_step', maxAttemptsPerStep, t('settings.cliLoop.labelMaxAttempts'))
      put(loop, 'reserved_context_size', reservedContextSize, t('settings.cliLoop.labelReserved'))
      put(bg, 'max_running_tasks', maxRunningTasks, t('settings.cliLoop.labelMaxRunning'))
      put(bg, 'bash_task_timeout_s', bashTaskTimeoutS, t('settings.cliLoop.labelBashTimeout'))
      bg.keep_alive_on_exit = keepAliveOnExit
      bg.bash_auto_background_on_timeout = bashAutoBackground

      const patch: Record<string, unknown> = {}
      if (Object.keys(loop).length) patch.loop_control = loop
      patch.background = bg
      const subagentMs = toInt(subagentTimeoutMs, t('settings.cliLoop.labelSubagentTimeout'))
      if (subagentMs !== undefined) patch.subagent = { timeout_ms: subagentMs }
      const swarmMs = toInt(swarmTimeoutMs, t('settings.cliLoop.labelSwarmTimeout'))
      if (swarmMs !== undefined) patch.swarm = { timeout_ms: swarmMs }
      patch.token_counting = { strategy }
      await saveSection(patch)
    })

  return (
    <>
      <GroupLabel>{t('settings.cliLoop.groupLoop')}</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label={t('settings.cliLoop.maxStepsLabel')}
          desc={t('settings.cliLoop.maxStepsDesc')}
          value={maxStepsPerTurn}
          onChange={setMaxStepsPerTurn}
        />
        <NumberField
          label={t('settings.cliLoop.maxAttemptsLabel')}
          desc={t('settings.cliLoop.maxAttemptsDesc')}
          value={maxAttemptsPerStep}
          onChange={setMaxAttemptsPerStep}
        />
        <NumberField
          label={t('settings.cliLoop.reservedLabel')}
          desc={t('settings.cliLoop.reservedDesc')}
          value={reservedContextSize}
          onChange={setReservedContextSize}
        />
      </Card>

      <GroupLabel>{t('settings.cliLoop.groupBackground')}</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label={t('settings.cliLoop.maxRunningLabel')}
          desc={t('settings.cliLoop.maxRunningDesc')}
          value={maxRunningTasks}
          onChange={setMaxRunningTasks}
        />
        <ToggleField
          label={t('settings.cliLoop.keepAliveLabel')}
          desc={t('settings.cliLoop.keepAliveDesc')}
          checked={keepAliveOnExit}
          onChange={setKeepAliveOnExit}
        />
        <ToggleField
          label={t('settings.cliLoop.autoBgLabel')}
          desc={t('settings.cliLoop.autoBgDesc')}
          checked={bashAutoBackground}
          onChange={setBashAutoBackground}
        />
        <NumberField
          label={t('settings.cliLoop.bashTimeoutLabel')}
          desc={t('settings.cliLoop.bashTimeoutDesc')}
          value={bashTaskTimeoutS}
          onChange={setBashTaskTimeoutS}
        />
      </Card>

      <GroupLabel>{t('settings.cliLoop.groupSubagent')}</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label={t('settings.cliLoop.subagentTimeoutLabel')}
          desc={t('settings.cliLoop.subagentTimeoutDesc')}
          value={subagentTimeoutMs}
          onChange={setSubagentTimeoutMs}
        />
        <NumberField
          label={t('settings.cliLoop.swarmTimeoutLabel')}
          desc={t('settings.cliLoop.swarmTimeoutDesc')}
          value={swarmTimeoutMs}
          onChange={setSwarmTimeoutMs}
        />
      </Card>

      <GroupLabel>{t('settings.cliLoop.groupToken')}</GroupLabel>
      <Card className="space-y-4">
        <SelectField
          label={t('settings.cliLoop.strategyLabel')}
          desc={t('settings.cliLoop.strategyDesc')}
          value={strategy}
          onChange={setStrategy}
          options={STRATEGY_OPTIONS}
        />
      </Card>

      <div className="pt-3">
        <MergeNote />
      </div>
      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? t('settings.cliCommon.savedOffline') : undefined} />
    </>
  )
}
