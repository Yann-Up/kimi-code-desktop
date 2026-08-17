/**
 * CLI 配置 · 循环与后台:loop_control / background / subagent / token_counting。
 * 保存时提交 snake_case patch;数字留空不提交,0 表示"不限"(仅对支持 0 语义的字段)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
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

const STRATEGY_OPTIONS = [
  { value: 'measured+estimated', label: 'measured+estimated(实测+预估)' },
  { value: 'measured', label: 'measured(仅实测)' },
  { value: 'estimated', label: 'estimated(仅预估)' }
]

export function CliLoopSettings() {
  const { config, loading, error, reload, saveSection, offline } = useCliConfig()
  return (
    <CliConfigGate title="循环与后台" desc="Agent 循环步数/压缩阈值、后台任务与子智能体运行参数(config.toml 多块)" loading={loading} error={error} onRetry={reload} offline={offline}>
      <LoopForm config={config ?? {}} saveSection={saveSection} offline={offline} />
    </CliConfigGate>
  )
}

function LoopForm({ config, saveSection, offline }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void>; offline: boolean }) {
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
  const [strategy, setStrategy] = useState<string>(
    str(nested(config, ['token_counting', 'tokenCounting'], 'strategy')) || 'measured+estimated'
  )

  const { saving, saved, error, save } = useSaveState()

  /** 数字字段解析:留空返回 undefined(不提交),非法或负数抛错;合法返回数值 */
  const toInt = (raw: string, label: string): number | undefined => {
    const t = raw.trim()
    if (t === '') return undefined
    const n = Number(t)
    if (!Number.isInteger(n) || n < 0) throw new Error(`${label}必须是非负整数`)
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
      put(loop, 'max_steps_per_turn', maxStepsPerTurn, '每轮最大步数')
      put(loop, 'max_attempts_per_step', maxAttemptsPerStep, '单步最大尝试次数')
      put(loop, 'reserved_context_size', reservedContextSize, '预留上下文')
      put(bg, 'max_running_tasks', maxRunningTasks, '后台任务并发数')
      put(bg, 'bash_task_timeout_s', bashTaskTimeoutS, 'Bash 后台任务超时')
      bg.keep_alive_on_exit = keepAliveOnExit
      bg.bash_auto_background_on_timeout = bashAutoBackground

      const patch: Record<string, unknown> = {}
      if (Object.keys(loop).length) patch.loop_control = loop
      patch.background = bg
      const subagentMs = toInt(subagentTimeoutMs, '子智能体超时')
      if (subagentMs !== undefined) patch.subagent = { timeout_ms: subagentMs }
      patch.token_counting = { strategy }
      await saveSection(patch)
    })

  return (
    <>
      <GroupLabel>循环控制(loop_control)</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label="每轮最大步数(max_steps_per_turn)"
          desc="单轮对话的最大执行步数;0 或留空 = 不限"
          value={maxStepsPerTurn}
          onChange={setMaxStepsPerTurn}
        />
        <NumberField
          label="单步最大尝试次数(max_attempts_per_step)"
          desc="单步失败时的最大总尝试次数(含首次,默认 10)"
          value={maxAttemptsPerStep}
          onChange={setMaxAttemptsPerStep}
        />
        <NumberField
          label="预留上下文(reserved_context_size)"
          desc="为模型输出预留的 token 数;剩余上下文低于该值触发自动压缩"
          value={reservedContextSize}
          onChange={setReservedContextSize}
        />
      </Card>

      <GroupLabel>后台任务(background)</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label="后台任务并发上限(max_running_tasks)"
          desc="同时运行的后台任务数上限"
          value={maxRunningTasks}
          onChange={setMaxRunningTasks}
        />
        <ToggleField
          label="会话关闭时保留后台任务(keep_alive_on_exit)"
          desc="默认会话关闭时会请求停止所有后台任务;开启后任务可越过会话存活"
          checked={keepAliveOnExit}
          onChange={setKeepAliveOnExit}
        />
        <ToggleField
          label="前台命令超时转后台(bash_auto_background_on_timeout)"
          desc="前台 Bash 命令超时后转为后台任务继续运行,而非直接终止(默认开启)"
          checked={bashAutoBackground}
          onChange={setBashAutoBackground}
        />
        <NumberField
          label="Bash 后台任务超时(bash_task_timeout_s)"
          desc="后台 Bash 任务默认超时(秒);0 = 不限时"
          value={bashTaskTimeoutS}
          onChange={setBashTaskTimeoutS}
        />
      </Card>

      <GroupLabel>子智能体(subagent)</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label="子智能体超时(timeout_ms)"
          desc="单个子智能体的最长运行时间(毫秒,默认 7200000 即 2 小时);0 = 不限时"
          value={subagentTimeoutMs}
          onChange={setSubagentTimeoutMs}
        />
      </Card>

      <GroupLabel>Token 统计(token_counting)</GroupLabel>
      <Card className="space-y-4">
        <SelectField
          label="统计口径(strategy)"
          desc="对外报告的上下文 token 数量口径;内部压缩判断不受影响"
          value={strategy}
          onChange={setStrategy}
          options={STRATEGY_OPTIONS}
        />
      </Card>

      <div className="pt-3">
        <MergeNote />
      </div>
      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? '已写入 config.toml;重启服务后新会话生效' : undefined} />
    </>
  )
}
