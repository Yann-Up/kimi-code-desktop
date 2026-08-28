/**
 * CLI 配置 · 实验性功能:官方 CLI 实验性特性的开关(默认关闭,经环境变量在启动 kimi web 时注入)。
 * 开关持久化在 desktop-config.json(experimental 字段);激活通道服务运行中切换时后端自动重启生效。
 */
import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, GroupLabel, Section } from '../../components/settings/common'
import { ToggleField } from './cliForm'

/** Remote Control 开关的 env 名(开关打开时在下方展示访问链接) */
const RC_ENV = 'KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL'

interface FeatureDef {
  /** 注入给 CLI 的环境变量名 */
  env: string
  label: string
  desc: string
}

/** 官方实验性特性清单(与 CLI 0.39.0 FlagResolver 注册表一致;新增实验特性时在此追加。
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
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_SUBAGENT_FORK',
    label: '子代理上下文快照(subagent-fork)',
    desc: 'Agent / AgentSwarm 派生子代理时携带调用方的上下文快照,而不是全新空白上下文'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_TOWER',
    label: 'tower 模式',
    desc: '协调多个 agent 围绕同一目标协作(tower mode)。注意:CLI 0.39.0 的 Web UI 尚无 /tower 入口,开启后目前只能在终端 TUI 里用(KIMI_CODE_EXPERIMENTAL_TOWER=1 kimi,然后 /tower on)'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_WAIT_FOR',
    label: 'WaitFor 工具',
    desc: '模型可在当前轮内等待后台任务完成(WaitFor);CLI 默认开启,可在此关闭'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL',
    label: 'minidb 读模型',
    desc: '会话索引与 wire 回放改用 minidb 派生的只读查询存储;CLI 默认开启,可在此关闭'
  },
  {
    env: 'KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL',
    label: '远程控制(Remote Control)',
    desc: '把本机 Web UI 经官方中继(code-rc.kimi.com)暴露到公网链接,可从手机/其他电脑操作本机 agent;开启后启动服务自动附加 --remote-control。需 CLI ≥ 0.39.0 且已登录 Kimi 账号(未登录会启动失败);持有链接的人等同于拥有本机操作权限,请勿分享;全机同一时间只允许一个 RC 实例'
  }
]

/** Remote Control 访问链接面板:开关打开时展示。
 *  开启后服务自动重启、CLI 向官方中继注册需几秒:未拿到链接时每 3s 轮询,最多 10 次 */
function RemoteControlLink() {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const st = await window.kimiApi.remoteControlStatus()
      setUrl(st?.url ?? null)
      return Boolean(st?.url)
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async (n: number) => {
      const ok = await load()
      if (!cancelled && !ok && n < 10) setTimeout(() => void tick(n + 1), 3000)
    }
    void tick(0)
    return () => {
      cancelled = true
    }
  }, [load])

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  if (!url) {
    return (
      <p className="mt-1.5 text-[11.5px] text-text-tertiary">
        等待 Remote Control 就绪…服务重启并向中继注册后此处显示访问链接;若长时间无链接,请确认 CLI ≥ 0.39.0 且已登录 Kimi 账号
      </p>
    )
  }
  return (
    <div className="mt-1.5">
      <div className="flex items-start gap-3">
        {/* 白底衬底保证扫码对比度(深色皮肤/立绘透出时仍需可读) */}
        <div className="shrink-0 rounded-lg border border-border bg-white p-1.5">
          <QRCodeSVG value={url} size={120} />
        </div>
        <div className="min-w-0">
          <p className="break-all font-mono text-[12px] text-primary">{url}</p>
          <div className="mt-1 flex items-center gap-2">
            <button
              className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-text-secondary transition-colors hover:bg-surface"
              onClick={() => void copy()}
            >
              {copied ? '已复制' : '复制链接'}
            </button>
            <button
              className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-text-secondary transition-colors hover:bg-surface"
              onClick={() => void load()}
            >
              刷新
            </button>
          </div>
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-text-tertiary">
        手机扫码或在其他电脑浏览器打开链接,登录 Kimi 账号后即可远程操作本机 agent;链接含完整操作权限,请勿分享
      </p>
    </div>
  )
}

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
      desc="官方 CLI 的实验性特性开关(部分特性 CLI 默认开启,可在此关闭);经环境变量在启动服务时注入,切换后需重启服务生效(运行中会自动重启)"
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
                {f.env === RC_ENV && (flags[f.env] ?? false) && <RemoteControlLink />}
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
