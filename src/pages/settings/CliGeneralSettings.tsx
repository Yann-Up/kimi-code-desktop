/**
 * CLI 配置 · 通用行为:default_model / default_permission_mode / default_plan_mode /
 * merge_all_available_skills / builtin_product_skills / extra_skill_dirs / extra_agent_dirs。
 * 保存时提交 snake_case patch(深合并,空输入不提交该键)。
 * 技能/智能体目录区:先只读展示默认搜索目录(按优先级,用户级路径经 kimiHomeGet 解析),
 * 再接可编辑的额外目录,让用户清楚额外目录叠加在哪一层。
 */
import { useEffect, useState } from 'react'
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
  const { config, loading, error, reload, saveSection, offline } = useCliConfig()
  // 激活通道的 kimi 数据目录(本机/远端通用),用于把用户级默认目录解析成真实路径展示
  const [home, setHome] = useState('')
  useEffect(() => {
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setHome(typeof h?.home === 'string' && h.home ? h.home : '~/.kimi-code'))
      .catch(() => setHome('~/.kimi-code'))
  }, [])
  return (
    <CliConfigGate title="通用行为" desc="新会话的默认模型、权限与技能等通用行为(config.toml 顶层键)" loading={loading} error={error} onRetry={reload} offline={offline}>
      <GeneralForm config={config ?? {}} saveSection={saveSection} home={home || '~/.kimi-code'} offline={offline} />
    </CliConfigGate>
  )
}

/** 默认搜索目录只读清单:按优先级从高到低列出各层级,给「额外目录」一个参照系 */
function DefaultDirs(props: { tiers: { label: string; paths: string[]; note?: string }[] }) {
  return (
    <div>
      <p className="text-[13.5px] font-medium">默认搜索目录</p>
      <p className="mt-0.5 text-[12px] text-text-tertiary">
        按优先级从高到低排列;出现同名条目时,高优先级层级的生效
      </p>
      <div className="mt-2 space-y-2">
        {props.tiers.map((t) => (
          <div key={t.label} className="flex items-baseline gap-3 text-[12px]">
            <span className="w-16 shrink-0 text-text-secondary">{t.label}</span>
            <div className="min-w-0 flex-1">
              {t.paths.map((p) => (
                <p key={p} className="truncate font-mono text-text-tertiary" title={p}>
                  {p}
                </p>
              ))}
              {t.note && <p className="text-[11.5px] text-text-tertiary">{t.note}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GeneralForm({ config, saveSection, home, offline }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void>; home: string; offline: boolean }) {
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
          desc="向模型提供 Kimi Code 自身的内置技能(update-config、check-kimi-code-docs 等,默认开启);内置层优先级最低"
          checked={builtinSkills}
          onChange={setBuiltinSkills}
        />
      </Card>

      <GroupLabel>技能目录</GroupLabel>
      <Card className="space-y-4">
        <DefaultDirs
          tiers={[
            {
              label: '项目级',
              paths: ['<项目根>/.kimi-code/skills', '<项目根>/.agents/skills'],
              note: '项目根 = 从工作目录向上查找、最近的含 .git 的目录;仅对该项目生效'
            },
            {
              label: '用户级',
              paths: [`${home}/skills`, '~/.agents/skills'],
              note: '对所有项目生效;~/.agents/skills 为跨工具共享目录,不随数据目录迁移'
            },
            { label: '内置', paths: ['随 CLI 自带'], note: '产品类内置技能由上方开关控制' }
          ]}
        />
        <PathListField
          label="额外技能目录(extra_skill_dirs)"
          desc="叠加在默认目录之上,优先级介于用户级与内置之间;适合团队共享技能库等场景"
          placeholder="如 ~/team-skills"
          values={skillDirs}
          onChange={setSkillDirs}
        />
      </Card>

      <GroupLabel>智能体目录</GroupLabel>
      <Card className="space-y-4">
        <DefaultDirs
          tiers={[
            {
              label: '项目级',
              paths: ['<项目根>/.kimi-code/agents', '<项目根>/.agents/agents'],
              note: '项目根 = 从工作目录向上查找、最近的含 .git 的目录;仅对该项目生效'
            },
            {
              label: '用户级',
              paths: [`${home}/agents`, '~/.agents/agents'],
              note: '对所有项目生效;~/.agents/agents 为跨工具共享目录,不随数据目录迁移'
            },
            { label: '内置', paths: ['plan / coder / explore'], note: '随 CLI 自带;插件级介于用户级与内置之间' }
          ]}
        />
        <PathListField
          label="额外智能体目录(extra_agent_dirs)"
          desc="额外的自定义 agent 搜索目录,优先级介于项目级与用户级之间"
          placeholder="如 ~/team-agents"
          values={agentDirs}
          onChange={setAgentDirs}
        />
      </Card>

      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? '已写入 config.toml;重启服务后新会话生效' : undefined} />
    </>
  )
}
