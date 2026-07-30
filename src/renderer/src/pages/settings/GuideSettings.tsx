import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Rocket, XCircle } from 'lucide-react'
import { rest } from '@/api'
import { useUi } from '../../stores/ui'
import { Section, Card, GroupLabel } from '../../components/settings/common'

interface AppInfo {
  cliVersion: string | null
}

type StepState = 'loading' | 'ok' | 'fail'

interface StepResult {
  state: StepState
  detail: string
}

const LOADING: StepResult = { state: 'loading', detail: '检查中…' }

function StepIcon({ state }: { state: StepState }) {
  if (state === 'ok') return <CheckCircle2 size={18} className="shrink-0 text-success" />
  if (state === 'fail') return <XCircle size={18} className="shrink-0 text-danger" />
  return <Loader2 size={18} className="shrink-0 animate-spin text-text-tertiary" />
}

export function GuideSettings() {
  const closeSettings = useUi((s) => s.closeSettings)
  const [cli, setCli] = useState<StepResult>(LOADING)
  const [model, setModel] = useState<StepResult>(LOADING)
  const [auth, setAuth] = useState<StepResult>(LOADING)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setCli(LOADING)
    setModel(LOADING)
    setAuth(LOADING)

    window.kimiApi
      .appInfo()
      .then((i) => {
        const v = (i as AppInfo).cliVersion
        setCli(
          v
            ? { state: 'ok', detail: `Kimi Code CLI ${v} 已就绪` }
            : { state: 'fail', detail: '未检测到 CLI,请确认已安装并重启应用' }
        )
      })
      .catch(() => setCli({ state: 'fail', detail: '获取应用信息失败,请确认主进程服务正常' }))

    rest<{ default_model?: string }>('/api/v1/config')
      .then((c) =>
        setModel(
          c.default_model
            ? { state: 'ok', detail: `默认模型:${c.default_model}` }
            : { state: 'fail', detail: '未配置默认模型,请用 /model 命令或到「模型设置」页选择' }
        )
      )
      .catch(() => setModel({ state: 'fail', detail: '读取配置失败,请确认本地服务已启动' }))

    rest('/api/v1/auth')
      .then(() => setAuth({ state: 'ok', detail: '已登录 Kimi 账户' }))
      .catch(() =>
        rest('/api/v1/oauth/usage')
          .then(() => setAuth({ state: 'ok', detail: '已登录 Kimi 账户' }))
          .catch(() => setAuth({ state: 'fail', detail: '未登录,请在聊天中执行 /login 完成登录' }))
      )
  }, [tick])

  const recheck = useCallback(() => setTick((t) => t + 1), [])

  const steps: { n: number; label: string; result: StepResult }[] = [
    { n: 1, label: '检查 CLI', result: cli },
    { n: 2, label: '检查默认模型', result: model },
    { n: 3, label: '检查账户认证', result: auth }
  ]

  return (
    <Section title="引导" desc="完成以下检查,快速开始你的第一个任务">
      <GroupLabel>环境检查</GroupLabel>
      <Card>
        <div className="divide-y divide-border-light">
          {steps.map((s) => (
            <div key={s.n} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <StepIcon state={s.result.state} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  {s.n}. {s.label}
                </p>
                <p
                  className={`mt-0.5 text-[12.5px] ${
                    s.result.state === 'fail' ? 'text-danger' : 'text-text-secondary'
                  }`}
                >
                  {s.result.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-border-light pt-3">
          <button
            onClick={recheck}
            className="text-[12.5px] text-primary transition-colors hover:text-primary-hover"
          >
            重新检查
          </button>
        </div>
      </Card>

      <GroupLabel>开始使用</GroupLabel>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium">一切就绪?</p>
            <p className="text-[12px] text-text-tertiary">选择工作区文件夹,向 Kimi 描述你的任务</p>
          </div>
          <button
            onClick={() => {
              closeSettings()
              window.dispatchEvent(new CustomEvent('kimi:new-task'))
            }}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover"
          >
            <Rocket size={14} />
            开始新任务
          </button>
        </div>
      </Card>
    </Section>
  )
}
