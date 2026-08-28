/**
 * i18n:壳自定义页面的轻量中英方案(不引框架,官方 web UI 仅 zh/en 两语,对齐即可)。
 * locale 存 stores/ui.ts(chatPrefsBridge 随官方 UI 上报写入,持久化 kimi.locale)。
 *
 * 字典按模块分文件(messages/<area>.ts),各导出 { zh, en } 扁平键值,
 * 键用点分命名(如 'nav.chat'、'settings.general.title'),此处聚合。
 * 新增文案约定:两个语言都写;支持 {name} 占位插值:t('x', { name: '...' })。
 *
 * 组件内一律用 useT()(订阅 locale,切换语言即时重渲染);
 * 非组件上下文(模块级/回调外)可用 t(),但它不触发重渲染。
 */
import { useUi, type ShellLocale } from '../stores/ui'
import shell from './messages/shell'
import chrome from './messages/chrome'
import onboarding from './messages/onboarding'
import settingsShell from './messages/settingsShell'
import settingsGeneral from './messages/settingsGeneral'
import settingsChannelsUsage from './messages/settingsChannelsUsage'
import cliGeneral from './messages/cliGeneral'
import cliModels from './messages/cliModels'
import cliMisc from './messages/cliMisc'
import experimental from './messages/experimental'
import mcp from './messages/mcp'
import agentic from './messages/agentic'
import stats from './messages/stats'
import pet from './messages/pet'
import app from './messages/app'

export type Messages = Record<string, string>

const dicts: Record<ShellLocale, Messages> = { zh: {}, en: {} }
for (const m of [
  shell,
  chrome,
  onboarding,
  settingsShell,
  settingsGeneral,
  settingsChannelsUsage,
  cliGeneral,
  cliModels,
  cliMisc,
  experimental,
  mcp,
  agentic,
  stats,
  pet,
  app
]) {
  Object.assign(dicts.zh, m.zh)
  Object.assign(dicts.en, m.en)
}

function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`
  )
}

/** 非响应式取值:缺 key 回退 key 本身(便于排查遗漏) */
export function t(key: string, vars?: Record<string, string | number>): string {
  const d = dicts[useUi.getState().locale]
  return format(d[key] ?? dicts.zh[key] ?? key, vars)
}

/** 组件内使用:订阅 locale,语言切换即时生效 */
export function useT() {
  const locale = useUi((s) => s.locale)
  return (key: string, vars?: Record<string, string | number>): string => {
    const d = dicts[locale]
    return format(d[key] ?? dicts.zh[key] ?? key, vars)
  }
}
