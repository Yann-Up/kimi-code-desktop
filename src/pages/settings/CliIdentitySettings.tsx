/**
 * CLI 配置 · 身份:identity.name / identity.slug。
 * 自定义 agent 在系统提示中的自称;启动时解析一次,新会话生效。
 * 保存时提交 snake_case patch(深合并,留空不提交)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import {
  CliConfigGate,
  MergeNote,
  nested,
  SaveBar,
  str,
  TextField,
  useSaveState
} from './cliForm'

export function CliIdentitySettings() {
  const { config, loading, error, reload, saveSection } = useCliConfig()
  return (
    <CliConfigGate title="身份" desc="自定义 agent 的身份标识(config.toml [identity] 块)" loading={loading} error={error} onRetry={reload}>
      <IdentityForm config={config ?? {}} saveSection={saveSection} />
    </CliConfigGate>
  )
}

function IdentityForm({ config, saveSection }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState<string>(str(nested(config, 'identity', 'name')))
  const [slug, setSlug] = useState<string>(str(nested(config, 'identity', 'slug')))

  const { saving, saved, error, save } = useSaveState()

  const onSave = () =>
    void save(async () => {
      const identity: Record<string, string> = {}
      if (name.trim()) identity.name = name.trim()
      if (slug.trim()) identity.slug = slug.trim()
      if (!Object.keys(identity).length) return // 全部留空:无可提交内容
      await saveSection({ identity })
    })

  return (
    <>
      <GroupLabel>身份标识</GroupLabel>
      <Card className="space-y-4">
        <TextField
          label="名称(name)"
          desc="agent 在系统提示中的自称(填充 ${product_name});留空则使用默认"
          placeholder="如 Acme Dev Agent"
          value={name}
          onChange={setName}
        />
        <TextField
          label="标识(slug)"
          desc="协议字段使用的机器标识(User-Agent、MCP 客户端名);留空由 name 派生(小写、非字母数字折叠为 -)"
          placeholder="留空自动派生"
          mono
          value={slug}
          onChange={setSlug}
        />
      </Card>

      <div className="pt-3">
        <p className="text-[11.5px] text-text-tertiary">
          身份在启动时解析一次,并随连接宣告给 MCP 服务器与提供商;修改后需重启服务并在新会话中生效
        </p>
      </div>
      <div className="pt-3">
        <MergeNote />
      </div>
      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} />
    </>
  )
}
