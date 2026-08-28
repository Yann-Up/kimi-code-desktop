/**
 * CLI 配置 · 服务与图像:services.moonshot_search / moonshot_fetch 的 base_url、
 * image 压缩参数、mcp 超时。api_key 由登录流程管理,不在此处编辑。
 * 保存时提交 snake_case patch(深合并,留空不提交)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import {
  CliConfigGate,
  MergeNote,
  nested,
  numStr,
  NumberField,
  SaveBar,
  str,
  TextField,
  useSaveState
} from './cliForm'

export function CliServicesSettings() {
  const { config, loading, error, reload, saveSection, offline } = useCliConfig()
  return (
    <CliConfigGate title="服务与图像" desc="联网搜索/抓取服务、图片压缩与 MCP 超时(config.toml services / image / mcp 块)" loading={loading} error={error} onRetry={reload} offline={offline}>
      <ServicesForm config={config ?? {}} saveSection={saveSection} offline={offline} />
    </CliConfigGate>
  )
}

function ServicesForm({ config, saveSection, offline }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void>; offline: boolean }) {
  const [searchUrl, setSearchUrl] = useState<string>(str(nested(config, 'services', ['moonshotSearch', 'moonshot_search'], 'baseUrl')))
  const [fetchUrl, setFetchUrl] = useState<string>(str(nested(config, 'services', ['moonshotFetch', 'moonshot_fetch'], 'baseUrl')))
  const [maxEdgePx, setMaxEdgePx] = useState<string>(numStr(nested(config, 'image', 'maxEdgePx')) || '2000')
  const [readByteBudget, setReadByteBudget] = useState<string>(numStr(nested(config, 'image', 'readByteBudget')) || '262144')
  const [startupTimeoutMs, setStartupTimeoutMs] = useState<string>(numStr(nested(config, 'mcp', 'startupTimeoutMs')) || '30000')
  const [toolTimeoutMs, setToolTimeoutMs] = useState<string>(numStr(nested(config, 'mcp', 'toolTimeoutMs')) || '60000')

  const { saving, saved, error, save } = useSaveState()

  const onSave = () =>
    void save(async () => {
      const services: Record<string, unknown> = {}
      if (searchUrl.trim()) services.moonshot_search = { base_url: searchUrl.trim() }
      if (fetchUrl.trim()) services.moonshot_fetch = { base_url: fetchUrl.trim() }

      const toInt = (raw: string, label: string): number | undefined => {
        const t = raw.trim()
        if (t === '') return undefined
        const n = Number(t)
        if (!Number.isInteger(n) || n < 0) throw new Error(`${label}必须是非负整数`)
        return n
      }

      const image: Record<string, number> = {}
      const maxEdge = toInt(maxEdgePx, '图片最长边上限')
      if (maxEdge !== undefined) image.max_edge_px = maxEdge
      const readBudget = toInt(readByteBudget, '图片字节预算')
      if (readBudget !== undefined) image.read_byte_budget = readBudget

      const mcp: Record<string, number> = {}
      const startupMs = toInt(startupTimeoutMs, 'MCP 启动超时')
      if (startupMs !== undefined) mcp.startup_timeout_ms = startupMs
      const toolMs = toInt(toolTimeoutMs, 'MCP 工具超时')
      if (toolMs !== undefined) mcp.tool_timeout_ms = toolMs

      const patch: Record<string, unknown> = {}
      if (Object.keys(services).length) patch.services = services
      if (Object.keys(image).length) patch.image = image
      if (Object.keys(mcp).length) patch.mcp = mcp
      await saveSection(patch)
    })

  return (
    <>
      <GroupLabel>联网服务(services)</GroupLabel>
      <Card className="space-y-4">
        <TextField
          label="联网搜索地址(搜索服务 base_url)"
          desc="moonshot_search 的 API 地址;留空使用内置默认"
          placeholder="默认:https://api.kimi.com/coding/v1/search"
          mono
          value={searchUrl}
          onChange={setSearchUrl}
        />
        <TextField
          label="网页抓取地址(抓取服务 base_url)"
          desc="moonshot_fetch 的 API 地址;留空使用内置默认"
          placeholder="默认:https://api.kimi.com/coding/v1/fetch"
          mono
          value={fetchUrl}
          onChange={setFetchUrl}
        />
        <p className="rounded-lg bg-fill px-2.5 py-1.5 text-[11.5px] text-text-tertiary">
          api_key 由登录流程写入管理,请勿在此处手工填写
        </p>
      </Card>

      <GroupLabel>图像(image)</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label="最长边上限(max_edge_px)"
          desc="图片最长边像素上限,超出按比例缩小(默认 2000)"
          value={maxEdgePx}
          onChange={setMaxEdgePx}
        />
        <NumberField
          label="图片字节预算(read_byte_budget)"
          desc="模型自行读取图片的字节预算,限制请求体体积(默认 262144 即 256KB)"
          value={readByteBudget}
          onChange={setReadByteBudget}
        />
      </Card>

      <GroupLabel>MCP(mcp)</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label="连接超时(startup_timeout_ms)"
          desc="MCP 服务器连接+工具发现的全局默认超时(毫秒,默认 30000)"
          value={startupTimeoutMs}
          onChange={setStartupTimeoutMs}
        />
        <NumberField
          label="工具调用超时(tool_timeout_ms)"
          desc="MCP 单次工具调用的全局默认超时(毫秒,默认 60000)"
          value={toolTimeoutMs}
          onChange={setToolTimeoutMs}
        />
      </Card>

      <div className="pt-3">
        <MergeNote />
      </div>
      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? '已写入 config.toml;重启服务后新会话生效' : undefined} />
    </>
  )
}
