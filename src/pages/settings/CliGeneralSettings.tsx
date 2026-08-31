/**
 * CLI 配置 · 通用行为:default_model / default_permission_mode / default_plan_mode /
 * merge_all_available_skills / builtin_product_skills / extra_skill_dirs / extra_agent_dirs。
 * 保存时提交 snake_case patch(深合并,空输入不提交该键)。
 * 技能/智能体目录区:先只读展示默认搜索目录(按优先级,用户级路径经 kimiHomeGet 解析),
 * 再接可编辑的额外目录,让用户清楚额外目录叠加在哪一层。
 */
import { useEffect, useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { Segmented } from '../../components/ui/Segmented'
import { inputCls as uiInputCls } from '../../components/ui/Input'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import { useT } from '../../i18n'
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

export function CliGeneralSettings() {
  const t = useT()
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
    <CliConfigGate title={t('cliGeneral.title')} desc={t('cliGeneral.desc')} loading={loading} error={error} onRetry={reload} offline={offline}>
      <GeneralForm config={config ?? {}} saveSection={saveSection} home={home || '~/.kimi-code'} offline={offline} />
    </CliConfigGate>
  )
}

/** 默认搜索目录只读清单:按优先级从高到低列出各层级,给「额外目录」一个参照系 */
function DefaultDirs(props: { tiers: { label: string; paths: string[]; note?: string }[] }) {
  const t = useT()
  return (
    <div>
      <p className="text-[13px] font-[475]">{t('cliGeneral.dirs.title')}</p>
      <p className="mt-0.5 text-[12px] text-text-tertiary">
        {t('cliGeneral.dirs.desc')}
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
  const t = useT()
  const permissionOptions = [
    { value: 'manual', label: t('cliGeneral.perm.manual') },
    { value: 'yolo', label: t('cliGeneral.perm.yolo') },
    { value: 'auto', label: t('cliGeneral.perm.auto') }
  ]
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
      <GroupLabel>{t('cliGeneral.group.modelPermission')}</GroupLabel>
      <Card className="space-y-4">
        {modelOptions.length > 0 ? (
          <SelectField
            label={t('cliGeneral.defaultModel')}
            desc={t('cliGeneral.defaultModelDesc')}
            placeholder={t('cliGeneral.defaultModelUnset')}
            value={defaultModel}
            onChange={setDefaultModel}
            options={modelOptions.map((m) => ({ value: m, label: m }))}
          />
        ) : (
          <FieldRow
            label={t('cliGeneral.defaultModel')}
            desc={t('cliGeneral.defaultModelNoModelsDesc')}
            control={
              <input
                className={uiInputCls('md', 'w-64 font-mono')}
                placeholder={t('cliGeneral.defaultModelPlaceholder')}
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              />
            }
          />
        )}
        <FieldRow
          label={t('cliGeneral.defaultPermissionMode')}
          desc={t('cliGeneral.defaultPermissionModeDesc')}
          control={
            <Segmented
              value={permissionMode || 'manual'}
              options={permissionOptions}
              onChange={setPermissionMode}
            />
          }
        />
        <ToggleField
          label={t('cliGeneral.defaultPlanMode')}
          desc={t('cliGeneral.defaultPlanModeDesc')}
          checked={planMode}
          onChange={setPlanMode}
        />
      </Card>

      <GroupLabel>{t('cliGeneral.group.skills')}</GroupLabel>
      <Card className="space-y-4">
        <ToggleField
          label={t('cliGeneral.mergeSkills')}
          desc={t('cliGeneral.mergeSkillsDesc')}
          checked={mergeSkills}
          onChange={setMergeSkills}
        />
        <ToggleField
          label={t('cliGeneral.builtinSkills')}
          desc={t('cliGeneral.builtinSkillsDesc')}
          checked={builtinSkills}
          onChange={setBuiltinSkills}
        />
      </Card>

      <GroupLabel>{t('cliGeneral.group.skillDirs')}</GroupLabel>
      <Card className="space-y-4">
        <DefaultDirs
          tiers={[
            {
              label: t('cliGeneral.dirs.project'),
              paths: [`${t('cliGeneral.dirs.projectRoot')}/.kimi-code/skills`, `${t('cliGeneral.dirs.projectRoot')}/.agents/skills`],
              note: t('cliGeneral.dirs.projectNote')
            },
            {
              label: t('cliGeneral.dirs.user'),
              paths: [`${home}/skills`, '~/.agents/skills'],
              note: t('cliGeneral.dirs.userNote', { dir: 'skills' })
            },
            { label: t('cliGeneral.dirs.builtin'), paths: [t('cliGeneral.dirs.builtinPath')], note: t('cliGeneral.dirs.skillBuiltinNote') }
          ]}
        />
        <PathListField
          label={t('cliGeneral.extraSkillDirs')}
          desc={t('cliGeneral.extraSkillDirsDesc')}
          placeholder={t('cliGeneral.extraSkillDirsPlaceholder')}
          values={skillDirs}
          onChange={setSkillDirs}
        />
      </Card>

      <GroupLabel>{t('cliGeneral.group.agentDirs')}</GroupLabel>
      <Card className="space-y-4">
        <DefaultDirs
          tiers={[
            {
              label: t('cliGeneral.dirs.project'),
              paths: [`${t('cliGeneral.dirs.projectRoot')}/.kimi-code/agents`, `${t('cliGeneral.dirs.projectRoot')}/.agents/agents`],
              note: t('cliGeneral.dirs.projectNote')
            },
            {
              label: t('cliGeneral.dirs.user'),
              paths: [`${home}/agents`, '~/.agents/agents'],
              note: t('cliGeneral.dirs.userNote', { dir: 'agents' })
            },
            { label: t('cliGeneral.dirs.builtin'), paths: ['plan / coder / explore'], note: t('cliGeneral.dirs.agentBuiltinNote') }
          ]}
        />
        <PathListField
          label={t('cliGeneral.extraAgentDirs')}
          desc={t('cliGeneral.extraAgentDirsDesc')}
          placeholder={t('cliGeneral.extraAgentDirsPlaceholder')}
          values={agentDirs}
          onChange={setAgentDirs}
        />
      </Card>

      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? t('cliGeneral.savedOffline') : undefined} />
    </>
  )
}
