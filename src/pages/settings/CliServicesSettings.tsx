/**
 * CLI 配置 · 服务与图像:services.moonshot_search / moonshot_fetch 的 base_url、
 * image 压缩参数、mcp 超时。api_key 由登录流程管理,不在此处编辑。
 * 保存时提交 snake_case patch(深合并,留空不提交)。
 */
import { useState } from 'react'
import { Card, GroupLabel } from '../../components/settings/common'
import { useCliConfig, type CliConfig } from '../../hooks/useCliConfig'
import { useT } from '../../i18n'
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
  const t = useT()
  const { config, loading, error, reload, saveSection, offline } = useCliConfig()
  return (
    <CliConfigGate title={t('settings.cliServices.pageTitle')} desc={t('settings.cliServices.desc')} loading={loading} error={error} onRetry={reload} offline={offline}>
      <ServicesForm config={config ?? {}} saveSection={saveSection} offline={offline} />
    </CliConfigGate>
  )
}

function ServicesForm({ config, saveSection, offline }: { config: CliConfig; saveSection: (p: Record<string, unknown>) => Promise<void>; offline: boolean }) {
  const t = useT()
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
        const s = raw.trim()
        if (s === '') return undefined
        const n = Number(s)
        if (!Number.isInteger(n) || n < 0) throw new Error(t('settings.cliCommon.errNonNegInt', { label }))
        return n
      }

      const image: Record<string, number> = {}
      const maxEdge = toInt(maxEdgePx, t('settings.cliServices.labelMaxEdge'))
      if (maxEdge !== undefined) image.max_edge_px = maxEdge
      const readBudget = toInt(readByteBudget, t('settings.cliServices.labelByteBudget'))
      if (readBudget !== undefined) image.read_byte_budget = readBudget

      const mcp: Record<string, number> = {}
      const startupMs = toInt(startupTimeoutMs, t('settings.cliServices.labelStartupTimeout'))
      if (startupMs !== undefined) mcp.startup_timeout_ms = startupMs
      const toolMs = toInt(toolTimeoutMs, t('settings.cliServices.labelToolTimeout'))
      if (toolMs !== undefined) mcp.tool_timeout_ms = toolMs

      const patch: Record<string, unknown> = {}
      if (Object.keys(services).length) patch.services = services
      if (Object.keys(image).length) patch.image = image
      if (Object.keys(mcp).length) patch.mcp = mcp
      await saveSection(patch)
    })

  return (
    <>
      <GroupLabel>{t('settings.cliServices.groupServices')}</GroupLabel>
      <Card className="space-y-4">
        <TextField
          label={t('settings.cliServices.searchUrlLabel')}
          desc={t('settings.cliServices.searchUrlDesc')}
          placeholder={t('settings.cliServices.searchUrlPlaceholder')}
          mono
          value={searchUrl}
          onChange={setSearchUrl}
        />
        <TextField
          label={t('settings.cliServices.fetchUrlLabel')}
          desc={t('settings.cliServices.fetchUrlDesc')}
          placeholder={t('settings.cliServices.fetchUrlPlaceholder')}
          mono
          value={fetchUrl}
          onChange={setFetchUrl}
        />
        <p className="rounded-lg bg-fill px-2.5 py-1.5 text-[11.5px] text-text-tertiary">
          {t('settings.cliServices.apiKeyNote')}
        </p>
      </Card>

      <GroupLabel>{t('settings.cliServices.groupImage')}</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label={t('settings.cliServices.maxEdgeLabel')}
          desc={t('settings.cliServices.maxEdgeDesc')}
          value={maxEdgePx}
          onChange={setMaxEdgePx}
        />
        <NumberField
          label={t('settings.cliServices.byteBudgetLabel')}
          desc={t('settings.cliServices.byteBudgetDesc')}
          value={readByteBudget}
          onChange={setReadByteBudget}
        />
      </Card>

      <GroupLabel>{t('settings.cliServices.groupMcp')}</GroupLabel>
      <Card className="space-y-4">
        <NumberField
          label={t('settings.cliServices.startupTimeoutLabel')}
          desc={t('settings.cliServices.startupTimeoutDesc')}
          value={startupTimeoutMs}
          onChange={setStartupTimeoutMs}
        />
        <NumberField
          label={t('settings.cliServices.toolTimeoutLabel')}
          desc={t('settings.cliServices.toolTimeoutDesc')}
          value={toolTimeoutMs}
          onChange={setToolTimeoutMs}
        />
      </Card>

      <div className="pt-3">
        <MergeNote />
      </div>
      <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} savedText={offline ? t('settings.cliCommon.savedOffline') : undefined} />
    </>
  )
}
