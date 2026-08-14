import { useState } from 'react'
import { ArrowLeft, Loader2, Monitor, Server, Terminal, X } from 'lucide-react'
import type { ConnectionTargetConfig } from '../platform/kimi-api'
import { useUi } from '../stores/ui'

type Target = ConnectionTargetConfig['target']

/** 测试结果:成功带版本号,失败带错误文案 */
type TestResult = { ok: true; version: string } | { ok: false; error: string } | null

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary'

/**
 * 连接目标向导:选择 kimi web 服务的运行目标(本机 / WSL / SSH),
 * WSL/SSH 需先测试连接通过,完成后保存配置并启动后端。
 * onCancel 存在时(设置页/占位页触发的覆盖层)显示"取消"按钮,仅关闭向导不做改动。
 * initialTarget:打开时预选的目标(占位页点 WSL/SSH 带入),直接进入对应配置步骤。
 */
export function OnboardingPage({
  onDone,
  onCancel,
  initialTarget
}: {
  onDone: () => void
  onCancel?: () => void
  initialTarget?: Target | null
}) {
  // 步骤:目标选择 → 配置(wsl/ssh);local 在选择页直接完成
  const [target, setTarget] = useState<Target | null>(initialTarget ?? null)
  const [wslDistro, setWslDistro] = useState('')
  const [sshHost, setSshHost] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [sshAuth, setSshAuth] = useState<'password' | 'key'>('key')
  const [sshPassword, setSshPassword] = useState('')
  const [sshIdentity, setSshIdentity] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult>(null)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState('')

  /** 按当前输入组装连接配置(与 Rust ConnectionConfig 字段一一对应) */
  const buildConfig = (t: Target): ConnectionTargetConfig => ({
    target: t,
    wslDistro: t === 'wsl' ? wslDistro.trim() || null : null,
    sshHost: t === 'ssh' ? sshHost.trim() || null : null,
    sshUser: t === 'ssh' ? sshUser.trim() || null : null,
    sshPort: t === 'ssh' && sshPort.trim() ? Number(sshPort.trim()) : null,
    sshIdentity: t === 'ssh' && sshAuth === 'key' ? sshIdentity.trim() || null : null,
    sshAuth: t === 'ssh' ? sshAuth : null
  })

  /** 输入变化后已通过的测试结果作废,需重新测试 */
  const invalidateTest = () => setTestResult(null)

  /** 表单是否可提交测试 */
  const canTest = (() => {
    if (target === 'wsl') return true
    if (target === 'ssh') {
      if (!sshHost.trim()) return false
      if (sshPort.trim()) {
        const n = Number(sshPort.trim())
        if (!Number.isInteger(n) || n < 1 || n > 65535) return false
      }
      if (sshAuth === 'password') return !!sshPassword
      return true // 私钥路径可留空(用默认 ~/.ssh 下的 key)
    }
    return false
  })()

  /** 测试连接:不持久化,仅验证目标上 kimi CLI 可用 */
  const testConnection = async () => {
    if (!target) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.kimiApi.connectionTargetTest(
        buildConfig(target),
        target === 'ssh' && sshAuth === 'password' ? sshPassword : undefined
      )
      setTestResult({ ok: true, version: r.version })
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  /** 完成:持久化配置(Rust 侧写 setupDone + 重启后端由调用方触发) */
  const finish = async (t: Target) => {
    setFinishing(true)
    setFinishError('')
    try {
      const cfg = buildConfig(t)
      const r = await window.kimiApi.connectionTargetSet(
        cfg,
        t === 'ssh' && sshAuth === 'password' ? sshPassword : undefined
      )
      // 密码落 keyring 失败时提示,但不阻塞启动(本次内存生效)
      if (t === 'ssh' && sshAuth === 'password' && sshPassword && !r.passwordSaved) {
        setFinishError('密码保存失败,本次仅保存在内存;下次启动需重新输入')
        // 给用户看到提示的时间,再继续启动
        await new Promise((resolve) => setTimeout(resolve, 1800))
      }
      useUi.getState().setConnectionTarget(cfg.target)
      onDone()
    } catch (e) {
      setFinishError(e instanceof Error ? e.message : String(e))
      setFinishing(false)
    }
  }

  const targets: { id: Target; icon: typeof Monitor; title: string; desc: string }[] = [
    { id: 'local', icon: Monitor, title: '本机', desc: '在这台电脑上直接运行 Kimi Code CLI' },
    { id: 'wsl', icon: Terminal, title: 'WSL', desc: '在 Windows 的 WSL 发行版中运行 CLI' },
    { id: 'ssh', icon: Server, title: 'SSH', desc: '连接远程机器,在远端运行 CLI' }
  ]

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-surface-secondary p-6">
      <div className="relative w-full max-w-xl">
        {/* 重进入模式(设置页触发)可取消,仅关闭向导 */}
        {onCancel && (
          <button
            className="absolute -top-2 right-0 rounded-lg p-1.5 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary"
            title="取消"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        )}
        <div className="mb-6 text-center">
          <p className="text-xl font-semibold">欢迎使用 Kimi Code Desktop</p>
          <p className="mt-1 text-[13px] text-text-tertiary">
            首次启动,请选择 Kimi Code 服务的运行位置
          </p>
        </div>

        {/* 步骤 1:目标选择(本机可直接完成) */}
        <div className="grid grid-cols-3 gap-3">
          {targets.map((t) => {
            const Icon = t.icon
            const active = target === t.id
            return (
              <button
                key={t.id}
                className={`rounded-xl border bg-surface p-4 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:border-primary/50 hover:bg-surface-tertiary'
                }`}
                onClick={() => {
                  if (t.id === 'local') return // 本机走卡片下方按钮直接完成
                  setTarget(t.id)
                  setTestResult(null)
                  setFinishError('')
                }}
              >
                <Icon size={20} className={active ? 'text-primary' : 'text-text-secondary'} />
                <p className="mt-2 text-[14px] font-medium">{t.title}</p>
                <p className="mt-1 text-[12px] leading-snug text-text-tertiary">{t.desc}</p>
                {t.id === 'local' && (
                  <span
                    className="mt-3 inline-block rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover"
                    onClick={(e) => {
                      e.stopPropagation()
                      void finish('local')
                    }}
                  >
                    {finishing && target !== 'wsl' && target !== 'ssh' ? '启动中…' : '完成并启动'}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* 步骤 2:WSL / SSH 连接配置 */}
        {(target === 'wsl' || target === 'ssh') && (
          <div className="mt-4 rounded-xl border border-border bg-surface p-4">
            {target === 'wsl' ? (
              <div className="space-y-2">
                <p className="text-[13.5px] font-medium">WSL 发行版</p>
                <input
                  className={inputCls}
                  placeholder="发行版名称(留空 = 默认发行版,如 Ubuntu)"
                  value={wslDistro}
                  onChange={(e) => {
                    setWslDistro(e.target.value)
                    invalidateTest()
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[13.5px] font-medium">SSH 连接</p>
                <div className="flex gap-2">
                  {/* 主机框 flex-1 占据剩余宽度;端口用固定宽度的包裹 div,
                      避免 inputCls 的 w-full 与 w-24 宽度类冲突把主机框挤没 */}
                  <input
                    className={`${inputCls} flex-1`}
                    placeholder="主机,可 user@host(必填)"
                    value={sshHost}
                    onChange={(e) => {
                      setSshHost(e.target.value)
                      invalidateTest()
                    }}
                  />
                  <div className="w-24 shrink-0">
                    <input
                      className={inputCls}
                      placeholder="端口 22"
                      value={sshPort}
                      onChange={(e) => {
                        setSshPort(e.target.value)
                        invalidateTest()
                      }}
                    />
                  </div>
                </div>
                <input
                  className={inputCls}
                  placeholder="用户名(可选,优先于主机中的 user@)"
                  value={sshUser}
                  onChange={(e) => {
                    setSshUser(e.target.value)
                    invalidateTest()
                  }}
                />
                <div className="flex items-center gap-4 pt-1 text-[13px]">
                  <span className="text-text-secondary">认证方式</span>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="ob-ssh-auth"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={sshAuth === 'key'}
                      onChange={() => {
                        setSshAuth('key')
                        invalidateTest()
                      }}
                    />
                    私钥
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="ob-ssh-auth"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={sshAuth === 'password'}
                      onChange={() => {
                        setSshAuth('password')
                        invalidateTest()
                      }}
                    />
                    密码
                  </label>
                </div>
                {sshAuth === 'password' ? (
                  <input
                    type="password"
                    className={inputCls}
                    placeholder="SSH 密码(保存在系统凭据管理器,不落地明文)"
                    value={sshPassword}
                    onChange={(e) => {
                      setSshPassword(e.target.value)
                      invalidateTest()
                    }}
                  />
                ) : (
                  <input
                    className={inputCls}
                    placeholder="私钥路径(可选,如 C:\Users\you\.ssh\id_ed25519)"
                    value={sshIdentity}
                    onChange={(e) => {
                      setSshIdentity(e.target.value)
                      invalidateTest()
                    }}
                  />
                )}
              </div>
            )}

            {/* 测试结果反馈 */}
            {testResult?.ok && (
              <p className="mt-2 text-[12px] text-success">连接成功:kimi {testResult.version}</p>
            )}
            {testResult && !testResult.ok && (
              <p className="mt-2 text-[12px] text-danger">{testResult.error}</p>
            )}
            {finishError && <p className="mt-2 text-[12px] text-danger">{finishError}</p>}

            <div className="mt-3 flex items-center justify-between">
              <button
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
                onClick={() => {
                  setTarget(null)
                  setTestResult(null)
                  setFinishError('')
                }}
              >
                <ArrowLeft size={13} /> 返回
              </button>
              <div className="flex gap-2">
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
                  disabled={testing || !canTest}
                  onClick={() => void testConnection()}
                >
                  {testing && <Loader2 size={13} className="animate-spin" />}
                  {testing ? '测试中…' : '测试连接'}
                </button>
                {/* 必须先测试通过才允许完成,降低首启失败率 */}
                <button
                  className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                  disabled={finishing || !testResult?.ok}
                  onClick={() => target && void finish(target)}
                >
                  {finishing ? '启动中…' : '完成并启动'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
