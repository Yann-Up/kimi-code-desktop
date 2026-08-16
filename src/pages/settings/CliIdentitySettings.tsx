/**
 * CLI 配置 · 身份:identity.name / identity.slug。
 * 自定义 agent 在系统提示中的自称;启动时解析一次,新会话生效。
 * 注意:REST /api/v1/config 会静默丢弃 identity 段(实测 200 但不落盘),
 * 故本页保存改走文件合并写(cliConfigMerge,保留注释、自动备份);读取仍走 REST。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import {
  CliConfigGate,
  nested,
  SaveBar,
  str,
  TextField,
  useSaveState
} from './cliForm'

export function CliIdentitySettings() {
  const { config, loading, error, reload } = useCliConfig()
  return (
    <CliConfigGate title="身份" desc="自定义 agent 的身份标识(config.toml [identity] 块)" loading={loading} error={error} onRetry={reload}>
      <IdentityForm config={config ?? {}} />
    </CliConfigGate>
  )
}

function IdentityForm({ config }: { config: CliConfig }) {
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
      setSavedMsg(`已写入 config.toml(备份于 ${backup});重启服务后新会话生效`)
      setTimeout(() => setSavedMsg(''), 4000)
    })

  return (
    <>
      <GroupLabel>身份标识</GroupLabel>
      <Card className="space-y-4">
        <TextField
          label="名称(name)"
          desc="agent 在系统提示中的自称(填充 ${product_name}),支持中文;留空则使用默认"
          placeholder="如 Acme Dev Agent / 小明助手"
          value={name}
          onChange={setName}
        />
        <TextField
          label="标识(slug)"
          desc="协议字段使用的机器标识(User-Agent、MCP 客户端名),仅 ASCII;留空由 name 派生(小写、非字母数字折叠为 -),纯中文名无法派生时将回退为 agent"
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
        <p className="text-[11.5px] text-text-tertiary">
          保存直接写入 config.toml(留空 = 删除该自定义键,恢复默认身份),写前自动备份为 .kimi-desktop-bak
        </p>
      </div>
      {savedMsg && <p className="pt-2 text-[12px] text-success">{savedMsg}</p>}
      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} />
    </>
  )
}
