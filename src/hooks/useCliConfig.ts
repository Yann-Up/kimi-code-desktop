import { useCallback, useEffect, useState } from 'react'
import { rest } from '../api'

/**
 * GET /api/v1/config 返回的 CLI 配置(config.toml 内容)。
 * 实测结构:顶层键 snake_case(default_permission_mode、loop_control、token_counting),
 * 嵌套块 camelCase(subagent.timeoutMs、mcp.startupTimeoutMs、image.maxEdgePx、services.moonshotSearch.baseUrl)。
 */
export type CliConfig = Record<string, unknown>

/**
 * CLI 配置数据层:GET /api/v1/config → { config, loading, error, reload }。
 * 服务未启动时 GET 失败(error 含 "server not ready"),页面据此显示空态。
 * 服务恢复(server:ready)时自动重新拉取。
 */
export function useCliConfig() {
  const [config, setConfig] = useState<CliConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = (await rest<unknown>('/api/v1/config')) as CliConfig | null
      setConfig(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // 服务在页面停留期间恢复(如从对话页启动后切回),自动重取,无需手动刷新
    const off = window.kimiApi.onServerReady(() => void reload())
    return () => {
      off()
    }
  }, [reload])

  /**
   * 提交 snake_case 局部 patch(服务端深合并,未提交的键保持不变),成功后重新拉取。
   * 失败抛给调用方展示;merge 无法删除已设置的键,清空某键 = 不提交该键。
   */
  const saveSection = useCallback(
    async (patch: Record<string, unknown>) => {
      await rest('/api/v1/config', { method: 'POST', body: patch })
      await reload()
    },
    [reload]
  )

  return { config, loading, error, reload, saveSection }
}
