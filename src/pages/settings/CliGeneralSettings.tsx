/**
 * CLI 配置 · 通用行为:default_model / default_permission_mode / default_plan_mode /
 * merge_all_available_skills / builtin_product_skills / extra_skill_dirs / extra_agent_dirs。
 * 保存时提交 snake_case patch(深合并,空输入不提交该键)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import {
  bool,
  cleanList,
  CliConfigGate,
  FieldRow,
  listStr,
  nested,
  PathListField,
  SaveBar,
  SelectField,
  str,
  ToggleField,
  useSaveState
} from './cliForm'

const PERMISSION_OPTIONS = [
  { value: 'manual', label: 'manual(每次询问)' },
  { value: 'yolo', label: 'yolo(自动批准工具)' },
  { value: 'auto', label: 'auto(完全自主)' }
]

export function CliGeneralSettings() {
  const { config, loading, error, reload, saveSection } = useCliConfig()
  return (
    <CliConfigGate title="通用行为" desc="新会话的默认模型、权限与技能等通用行为(config.toml 顶层键)" loading={loading} error={error} onRetry={reload}>
      <GeneralForm config={config ?? {}} saveSection={saveSection} />
    </CliConfigGate>
  )
}

function GeneralForm({ config, saveSection }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void> }) {
  // default_model 选项来自 config.models 的键;当前值不在其中时兜底加入
  const modelKeys = (() => {
    const m = nested(config, 'models')
    return m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m as Record<string, unknown>) : []
  })()
  const curModel = str(nested(config, 'default_model'))
  const modelOptions = curModel && !modelKeys.includes(curModel) ? [curModel, ...modelKeys] : modelKeys

  const [defaultModel, setDefaultModel] = useState(curModel)
  const [permissionMode, setPermissionMode] = useState(str(nested(config, 'default_permission_mode')) || 'manual')
  const [planMode, setPlanMode] = useState<boolean>(bool(nested(config, 'default_plan_mode'), false))
  const [mergeSkills, setMergeSkills] = useState<boolean>(bool(nested(config, 'merge_all_available_skills'), true))
  const [builtinSkills, setBuiltinSkills] = useState<boolean>(bool(nested(config, 'builtin_product_skills'), true))
  const [skillDirs, setSkillDirs] = useState<string[]>(listStr(nested(config, 'extra_skill_dirs')))
  const [agentDirs, setAgentDirs] = useState<string[]>(listStr(nested(config, 'extra_agent_dirs')))

  const { saving, saved, error, save } = useSaveState()

  const onSave = () =>
    void save(async () => {
      const patch: Record<string, unknown> = {}
      if (defaultModel.trim()) patch.default_model = defaultModel.trim()
      patch.default_permission_mode = permissionMode
      patch.default_plan_mode = planMode
      patch.merge_all_available_skills = mergeSkills
      patch.builtin_product_skills = builtinSkills
      const sd = cleanList(skillDirs)
      if (sd.length) patch.extra_skill_dirs = sd
      const ad = cleanList(agentDirs)
      if (ad.length) patch.extra_agent_dirs = ad
      await saveSection(patch)
    })

  return (
    <>
      <GroupLabel>模型与权限</GroupLabel>
      <Card className="space-y-4">
        {modelOptions.length > 0 ? (
          <SelectField
            label="默认模型"
            desc="新会话使用的模型,必须是 models 中已定义的别名"
            placeholder="未设置"
            value={defaultModel}
            onChange={setDefaultModel}
            options={modelOptions.map((m) => ({ value: m, label: m }))}
          />
        ) : (
          <FieldRow
            label="默认模型"
            desc="未在配置中发现 models 定义,可直接填写模型别名(如 kimi-code/k3)"
            control={
              <input
                className="w-64 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
                placeholder="如 kimi-code/k3"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              />
            }
          />
        )}
        <SelectField
          label="默认权限模式"
          desc="新会话的工具调用审批策略:manual=每次询问、yolo=自动批准工具(仍可能提问)、auto=完全自主"
          value={permissionMode}
          onChange={setPermissionMode}
          options={PERMISSION_OPTIONS}
        />
        <ToggleField
          label="默认计划模式"
          desc="新会话默认开启计划模式(先产出计划再执行)"
          checked={planMode}
          onChange={setPlanMode}
        />
      </Card>

      <GroupLabel>技能</GroupLabel>
      <Card className="space-y-4">
        <ToggleField
          label="合并所有可用技能"
          desc="把各目录中的技能合并提供给模型(默认开启)"
          checked={mergeSkills}
          onChange={setMergeSkills}
        />
        <ToggleField
          label="内置产品技能"
          desc="向模型提供 Kimi Code 自身的内置技能(update-config、check-kimi-code-docs 等,默认开启)"
          checked={builtinSkills}
          onChange={setBuiltinSkills}
        />
        <PathListField
          label="额外技能目录(extra_skill_dirs)"
          desc="额外的技能搜索目录,叠加在默认目录之上"
          placeholder="如 D:\my-skills"
          values={skillDirs}
          onChange={setSkillDirs}
        />
        <PathListField
          label="额外智能体目录(extra_agent_dirs)"
          desc="额外的自定义 agent 搜索目录,叠加在默认目录之上"
          placeholder="如 D:\my-agents"
          values={agentDirs}
          onChange={setAgentDirs}
        />
      </Card>

      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} />
    </>
  )
}
