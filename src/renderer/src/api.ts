/**
 * api: window.kimiApi 的类型化快捷封装 + 通用类型定义。
 */

export interface SessionItem {
  id: string
  workspace_id?: string
  title: string
  created_at: string
  updated_at: string
  busy?: boolean
  main_turn_active?: boolean
  pending_interaction?: boolean
  archived?: boolean
  last_prompt?: string
  message_count?: number
  metadata?: { cwd?: string; [k: string]: unknown }
  agent_config?: {
    model?: string
    permission_mode?: 'manual' | 'auto' | 'yolo'
    plan_mode?: boolean
    [k: string]: unknown
  }
  usage?: { input_tokens?: number; output_tokens?: number; [k: string]: unknown }
}

export interface WorkspaceItem {
  id: string
  root: string
  name?: string
  display_name?: string
  session_count?: number
  [k: string]: unknown
}

export interface ModelItem {
  provider: string
  model: string
  display_name?: string
  max_context_size?: number
  capabilities?: string[]
  support_efforts?: string[]
  default_effort?: string
}

export interface SessionEvent {
  type: string
  seq?: number
  epoch?: string
  session_id: string
  timestamp?: number
  [k: string]: unknown
}

export const api = () => window.kimiApi

export async function rest<T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> }
): Promise<T> {
  return (await window.kimiApi.rest({ path, ...opts })) as T
}
