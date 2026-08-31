import { useState } from 'react'
import { ArrowLeft, Loader2, Monitor, Server, Terminal, X } from 'lucide-react'
import type { ConnectionTargetConfig } from '../platform/kimi-api'
import { inputCls as uiInputCls } from '../components/ui/Input'
import { useUi } from '../stores/ui'
import { useT } from '../i18n'

type Target = ConnectionTargetConfig['target']

/** 测试结果:成功带版本号,失败带错误文案 */
type TestResult = { ok: true; version: string } | { ok: false; error: string } | null

const inputCls = uiInputCls('sm', 'w-full font-mono')

/**
 * 连接目标向导:选择 kimi web 服务的运行目标(本机 / WSL / SSH),
 * WSL/SSH 需先测试连接通过,完成后保存配置。
 * - mode='switch'(默认):调 connectionTargetSet 切换激活通道目标并重启服务(原行为);
 * - mode='add':调 addChannel 只追加一条通道,不切换激活、不重启(设置→通道页"添加通道"用)。
 * onCancel 存在时(设置页/占位页触发的覆盖层)显示"取消"按钮,仅关闭向导不做改动。
 * initialTarget:打开时预选的目标(占位页点 WSL/SSH 带入),直接进入对应配置步骤。
 */
export function OnboardingPage({
  onDone,
  onCancel,
  initialTarget,
  mode = 'switch'
}: {
  onDone: () => void
  onCancel?: () => void
  initialTarget?: Target | null
  mode?: 'switch' | 'add'
}) {
  const t = useT()
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

  /** 完成:switch 模式调 connectionTargetSet(持久化 + 重启,由调用方启动);add 模式调 addChannel(只追加) */
  const finish = async (tgt: Target) => {
    // 双击/连点守卫:本机卡片的"完成并启动"是 span 无 disabled,重复触发会连续重启后端
    if (finishing) return
    setFinishing(true)
    setFinishError('')
    try {
      const cfg = buildConfig(tgt)
      if (mode === 'add') {
        // 添加通道:只追加不切换激活;label 省略由后端按目标展示名生成
        await window.kimiApi.addChannel(
          cfg,
          undefined,
          tgt === 'ssh' && sshAuth === 'password' ? sshPassword : undefined
        )
        onDone()
        return
      }
      const r = await window.kimiApi.connectionTargetSet(
        cfg,
        tgt === 'ssh' && sshAuth === 'password' ? sshPassword : undefined
      )
      // 密码落 keyring 失败时提示,但不阻塞启动(本次内存生效)
      if (tgt === 'ssh' && sshAuth === 'password' && sshPassword && !r.passwordSaved) {
        setFinishError(t('onboarding.passwordSaveFailed'))
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
    { id: 'local', icon: Monitor, title: t('onboarding.targetLocalTitle'), desc: t('onboarding.targetLocalDesc') },
    { id: 'wsl', icon: Terminal, title: 'WSL', desc: t('onboarding.targetWslDesc') },
    { id: 'ssh', icon: Server, title: 'SSH', desc: t('onboarding.targetSshDesc') }
  ]

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-surface-secondary p-6">
      <div className="relative w-full max-w-xl">
        {/* 重进入模式(设置页触发)可取消,仅关闭向导 */}
        {onCancel && (
          <button
            className="absolute -top-2 right-0 rounded-lg p-1.5 text-text-tertiary hover:bg-surface-tertiary hover:text-text"
            title={t('onboarding.cancel')}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        )}
        <div className="mb-6 text-center">
          <p className="text-xl font-semibold">{t('onboarding.welcome')}</p>
          <p className="mt-1 text-[13px] text-text-tertiary">
            {mode === 'add' ? t('onboarding.subtitleAdd') : t('onboarding.subtitleFirst')}
          </p>
        </div>

        {/* 步骤 1:目标选择(本机可直接完成;add 模式下本机已存在,置灰不可选) */}
        <div className="grid grid-cols-3 gap-3">
          {targets.map((tg) => {
            const Icon = tg.icon
            const active = target === tg.id
            const isLocal = tg.id === 'local'
            // add 模式:本机通道恒在,无需添加
            const disabledCard = mode === 'add' && isLocal
            return (
              <button
                key={tg.id}
                disabled={disabledCard}
                className={`rounded-xl border bg-surface p-4 text-left transition-colors ${
                  disabledCard
                    ? 'cursor-not-allowed opacity-50'
                    : active
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:border-primary/50 hover:bg-surface-tertiary'
                }`}
                onClick={() => {
                  if (tg.id === 'local') return // 本机走卡片下方按钮直接完成
                  setTarget(tg.id)
                  setTestResult(null)
                  setFinishError('')
                }}
              >
                <Icon size={20} className={active ? 'text-primary' : 'text-text-secondary'} />
                <p className="mt-2 text-[14px] font-medium">{tg.title}</p>
                <p className="mt-1 text-[12px] leading-snug text-text-tertiary">{tg.desc}</p>
                {isLocal && (
                  <span
                    className={`mt-3 inline-block rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${
                      disabledCard
                        ? 'bg-surface-tertiary text-text-tertiary'
                        : 'bg-primary text-white hover:bg-primary-hover'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!disabledCard) void finish('local')
                    }}
                  >
                    {disabledCard
                      ? t('onboarding.localExists')
                      : finishing && target !== 'wsl' && target !== 'ssh'
                        ? t('onboarding.starting')
                        : t('onboarding.finishStart')}
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
                <p className="text-[13px] font-[475]">{t('onboarding.wslDistro')}</p>
                <input
                  className={inputCls}
                  placeholder={t('onboarding.wslDistroPlaceholder')}
                  value={wslDistro}
                  onChange={(e) => {
                    setWslDistro(e.target.value)
                    invalidateTest()
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] font-[475]">{t('onboarding.sshConnection')}</p>
                <div className="flex gap-2">
                  {/* 主机框 flex-1 占据剩余宽度;端口用固定宽度的包裹 div,
                      避免 inputCls 的 w-full 与 w-24 宽度类冲突把主机框挤没 */}
                  <input
                    className={`${inputCls} flex-1`}
                    placeholder={t('onboarding.sshHostPlaceholder')}
                    value={sshHost}
                    onChange={(e) => {
                      setSshHost(e.target.value)
                      invalidateTest()
                    }}
                  />
                  <div className="w-24 shrink-0">
                    <input
                      className={inputCls}
                      placeholder={t('onboarding.sshPortPlaceholder')}
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
                  placeholder={t('onboarding.sshUserPlaceholder')}
                  value={sshUser}
                  onChange={(e) => {
                    setSshUser(e.target.value)
                    invalidateTest()
                  }}
                />
                <div className="flex items-center gap-4 pt-1 text-[13px]">
                  <span className="text-text-secondary">{t('onboarding.authMethod')}</span>
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
                    {t('onboarding.authKey')}
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
                    {t('onboarding.authPassword')}
                  </label>
                </div>
                {sshAuth === 'password' ? (
                  <input
                    type="password"
                    className={inputCls}
                    placeholder={t('onboarding.sshPasswordPlaceholder')}
                    value={sshPassword}
                    onChange={(e) => {
                      setSshPassword(e.target.value)
                      invalidateTest()
                    }}
                  />
                ) : (
                  <input
                    className={inputCls}
                    placeholder={t('onboarding.sshIdentityPlaceholder')}
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
              <p className="mt-2 text-[12px] text-success">{t('onboarding.connected', { version: testResult.version })}</p>
            )}
            {testResult && !testResult.ok && (
              <p className="mt-2 text-[12px] text-danger">{testResult.error}</p>
            )}
            {finishError && <p className="mt-2 text-[12px] text-danger">{finishError}</p>}

            <div className="mt-3 flex items-center justify-between">
              <button
                className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover"
                onClick={() => {
                  setTarget(null)
                  setTestResult(null)
                  setFinishError('')
                }}
              >
                <ArrowLeft size={13} /> {t('onboarding.back')}
              </button>
              <div className="flex gap-2">
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
                  disabled={testing || !canTest}
                  onClick={() => void testConnection()}
                >
                  {testing && <Loader2 size={13} className="animate-spin" />}
                  {testing ? t('onboarding.testing') : t('onboarding.testConnection')}
                </button>
                {/* 必须先测试通过才允许完成,降低首启失败率 */}
                <button
                  className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                  disabled={finishing || !testResult?.ok}
                  onClick={() => target && void finish(target)}
                >
                  {finishing
                    ? mode === 'add'
                      ? t('onboarding.adding')
                      : t('onboarding.starting')
                    : mode === 'add'
                      ? t('onboarding.addChannel')
                      : t('onboarding.finishStart')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
