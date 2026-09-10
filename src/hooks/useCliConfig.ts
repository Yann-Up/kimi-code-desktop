import { useCallback, useEffect, useState } from 'react'
import { rest } from '../api'

/**
 * CLI 配置数据层:REST 优先 + 文件兜底。
 * - 在线:GET/POST /api/v1/config(服务端写盘并更新内存,新会话即刻生效);
 *   实测返回顶层 snake_case、嵌套块 camelCase(subagent.timeoutMs 等)。
 * - 离线("server not ready"):直读直写 config.toml(cliConfigParsed / cliConfigMerge,
 *   toml_edit 合并保留注释、写前自动备份);此模式下保存需重启服务后生效。
 * - 在线保存按 REST_CONFIG_KEYS 白名单分流:REST 只认这 20 个顶层键(其余被 zod
 *   strip 后返回 200 但不落盘),白名单内的键走 REST 即刻生效,白名单外的键
 *   (swarm/token_counting/image/mcp/builtin_product_skills/extra_agent_dirs 等)
 *   走 cliConfigMerge 文件合并写、需重启服务后生效。
 * offline 标记当前是否处于文件兜底模式,页面据此展示提醒。
 * 服务恢复(server:ready)时自动重新拉取回到在线模式。
 */
export type CliConfig = Record<string, unknown>

/**
 * REST POST /api/v1/config 接受的顶层键白名单。
 * 来源:CLI 0.42 patchConfigRequestSchema(zod strip 未知键,返回 200 但不落盘)。
 * 新 CLI 扩容白名单时文件写路径仍正确,仅需重启生效;届时可在此补充新键恢复即刻生效。
 */
const REST_CONFIG_KEYS = new Set([
  'providers',
  'default_provider',
  'default_model',
  'models',
  'thinking',
  'plan_mode',
  'yolo',
  'default_permission_mode',
  'default_plan_mode',
  'permission',
  'hooks',
  'services',
  'merge_all_available_skills',
  'extra_skill_dirs',
  'loop_control',
  'background',
  'subagent',
  'secondary_model',
  'experimental',
  'telemetry',
])

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 服务离线判定:rest 在服务未启动时报 "server not ready" */
function isOfflineErr(e: unknown): boolean {
  return errText(e).toLowerCase().includes('server not ready')
}

export function useCliConfig() {
  const [config, setConfig] = useState<CliConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = (await rest<unknown>('/api/v1/config')) as CliConfig | null
      setConfig(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
      setOffline(false)
    } catch (e) {
      if (!isOfflineErr(e)) {
        setError(errText(e))
      } else {
        // 服务未启动:兜底直读 config.toml(snake_case 原样)
        try {
          const parsed = await window.kimiApi.cliConfigParsed()
          setConfig(parsed && typeof parsed === 'object' ? (parsed as CliConfig) : {})
          setOffline(true)
        } catch (e2) {
          setError(errText(e2))
        }
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // 服务在页面停留期间恢复(如从对话页启动后切回),自动重取回到在线模式
    const off = window.kimiApi.onServerReady(() => void reload())
    return () => {
      off()
    }
  }, [reload])

  /**
   * 提交 snake_case 局部 patch(深合并,未提交的键保持不变),成功后重新拉取。
   * 在线时按 REST_CONFIG_KEYS 分流:白名单内的键走 REST(即刻生效),其余键走
   * config.toml 合并写(重启服务后生效);离线(或保存时发现服务已停)整个 patch
   * 降级为文件合并写。失败抛给调用方展示;merge 无法删除已设置的键,清空某键 = 不提交该键。
   */
  const saveSection = useCallback(
    async (patch: Record<string, unknown>) => {
      if (offline) {
        await window.kimiApi.cliConfigMerge(patch)
      } else {
        const restPatch: Record<string, unknown> = {}
        const filePatch: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(patch)) {
          if (REST_CONFIG_KEYS.has(key)) {
            restPatch[key] = value
          } else {
            filePatch[key] = value
          }
        }
        try {
          if (Object.keys(restPatch).length > 0) {
            await rest('/api/v1/config', { method: 'POST', body: restPatch })
          }
        } catch (e) {
          if (!isOfflineErr(e)) throw e
          // 页面停留期间服务停了:白名单部分一并降级直写文件
          Object.assign(filePatch, restPatch)
          setOffline(true)
        }
        if (Object.keys(filePatch).length > 0) {
          await window.kimiApi.cliConfigMerge(filePatch)
        }
      }
      await reload()
    },
    [offline, reload]
  )

  return { config, loading, error, reload, saveSection, offline }
}
