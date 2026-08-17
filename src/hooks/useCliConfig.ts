import { useCallback, useEffect, useState } from 'react'
import { rest } from '../api'

/**
 * CLI 配置数据层:REST 优先 + 文件兜底。
 * - 在线:GET/POST /api/v1/config(服务端写盘并更新内存,新会话即刻生效);
 *   实测返回顶层 snake_case、嵌套块 camelCase(subagent.timeoutMs 等)。
 * - 离线("server not ready"):直读直写 config.toml(cliConfigParsed / cliConfigMerge,
 *   toml_edit 合并保留注释、写前自动备份);此模式下保存需重启服务后生效。
 * offline 标记当前是否处于文件兜底模式,页面据此展示提醒。
 * 服务恢复(server:ready)时自动重新拉取回到在线模式。
 */
export type CliConfig = Record<string, unknown>

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
   * 在线走 REST;离线(或保存时发现服务已停)降级为 config.toml 合并写。
   * 失败抛给调用方展示;merge 无法删除已设置的键,清空某键 = 不提交该键。
   */
  const saveSection = useCallback(
    async (patch: Record<string, unknown>) => {
      if (offline) {
        await window.kimiApi.cliConfigMerge(patch)
      } else {
        try {
          await rest('/api/v1/config', { method: 'POST', body: patch })
        } catch (e) {
          if (!isOfflineErr(e)) throw e
          // 页面停留期间服务停了:降级直写文件
          await window.kimiApi.cliConfigMerge(patch)
          setOffline(true)
        }
      }
      await reload()
    },
    [offline, reload]
  )

  return { config, loading, error, reload, saveSection, offline }
}
