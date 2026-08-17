/**
 * CLI 配置 · 实验性功能:官方 CLI 实验性特性的开关(默认关闭,经环境变量在启动 kimi web 时注入)。
 * 开关持久化在 desktop-config.json(experimental 字段);激活通道服务运行中切换时后端自动重启生效。
 */
import { useEffect, useState } from 'react'
import { Card, GroupLabel, Section } from '../../components/settings/common'
import { ToggleField } from './cliForm'

interface FeatureDef {
  /** 注入给 CLI 的环境变量名 */
  env: string
  label: string
  desc: string
}

/** 官方实验性特性清单(与 CLI 0.36.1 FlagResolver 注册表一致;新增实验特性时在此追加。
 *  开关有效值以后端 experimental_get 返回为准:用户设置 > 桌面默认 > CLI 默认) */
const FEATURES: FeatureDef[] = [
  {
    env: 'KIMI_CODE_EXPERIMENTAL_FLAG',
    label: '实验性功能总开关',
    desc: '启用当前 CLI 版本注册的全部实验性功能;风险最高,建议只开下面的单项'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL',
    label: '二级模型(子代理)',
    desc: '开启后新派生的子代理(Agent / AgentSwarm)默认绑定二级模型,而不是继承主代理模型;桌面端此前一直默认开启'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_TOOL_SELECT',
    label: '渐进式工具披露(tool-select)',
    desc: 'MCP 等工具 schema 不再塞进顶层 tools[],模型经 select_tools 按需加载;缩小系统提示词、提升 prompt 缓存命中(需模型支持动态加载工具)'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_AUTO_SESSION_TITLE',
    label: 'AI 会话标题',
    desc: '首轮对话结束后自动生成简洁的会话标题,重命名时也可按需重新生成'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER',
    label: '搜索索引 worker 线程',
    desc: '全局搜索索引(MiniDB 打开/同步/查询)放到独立 worker 线程运行,避免阻塞主线程;CLI 默认开启,可在此关闭'
  }
]

export function CliExperimentalSettings() {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.kimiApi
      .experimentalGet()
      .then(setFlags)
      .catch(() => setFlags({}))
  }, [])

  const toggle = async (env: string, v: boolean) => {
    if (!flags || saving) return
    const next = { ...flags, [env]: v }
    setFlags(next)
    setSaving(true)
    setMsg(null)
    try {
      await window.kimiApi.experimentalSet(next)
      setMsg({ ok: true, text: '已保存;服务运行中时已自动重启,未启动则下次启动生效' })
    } catch (e) {
      setFlags(flags) // 失败回滚
      setMsg({ ok: false, text: `保存失败:${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="实验性功能"
      desc="官方 CLI 的实验性特性开关(官方默认关闭);经环境变量在启动服务时注入,切换后需重启服务生效(运行中会自动重启)"
    >
      <GroupLabel>功能开关</GroupLabel>
      <Card>
        {flags === null ? (
          <p className="text-[12px] text-text-tertiary">加载中…</p>
        ) : (
          <div className="divide-y divide-border-light">
            {FEATURES.map((f) => (
              <div key={f.env} className="py-2 first:pt-0 last:pb-0">
                <ToggleField
                  label={f.label}
                  desc={f.desc}
                  checked={flags[f.env] ?? false}
                  onChange={(v) => void toggle(f.env, v)}
                />
                <p className="mt-0.5 font-mono text-[11px] text-text-tertiary">{f.env}</p>
              </div>
            ))}
          </div>
        )}
        {msg && (
          <p className={`mt-2 text-[12px] ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>
        )}
      </Card>

      <p className="mt-3 text-[11.5px] text-text-tertiary">
        实验性功能可能不稳定,随 CLI 版本可能更名或移除;如遇异常可回到本页关闭对应开关
      </p>
    </Section>
  )
}
