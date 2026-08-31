/**
 * ChannelsSettings: 设置 → 桌面 → 通道页。
 * 通道列表(label / 类型徽标 / 运行状态 / 启动·停止 / 删除[local 不显示])
 * + 「添加通道」按钮:打开 OnboardingPage 覆盖层(add 模式,完成后刷新列表)。
 */
import { useState } from 'react'
import { Monitor, Plus, Server, Terminal, Trash2 } from 'lucide-react'
import { Section, Card } from '../../components/settings/common'
import { useUi } from '../../stores/ui'
import { useT } from '../../i18n'
import type { ChannelInfo } from '../../platform/kimi-api'

/** 通道类型徽标:本机 / WSL / SSH */
function ChannelBadge({ target }: { target: ChannelInfo['target'] }) {
  const t = useT()
  const cfg: Record<ChannelInfo['target'], { label: string; cls: string }> = {
    local: { label: t('settings.channels.targetLocal'), cls: 'bg-primary-soft text-primary' },
    wsl: { label: 'WSL', cls: 'bg-emerald-500/10 text-emerald-600' },
    ssh: { label: 'SSH', cls: 'bg-sky-500/10 text-sky-600' }
  }
  const c = cfg[target]
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${c.cls}`}>{c.label}</span>
  )
}

const TARGET_ICON: Record<ChannelInfo['target'], typeof Monitor> = {
  local: Monitor,
  wsl: Terminal,
  ssh: Server
}

export function ChannelsSettings() {
  const t = useT()
  const channels = useUi((s) => s.channels)
  const activeChannel = useUi((s) => s.activeChannel)
  const setActiveChannel = useUi((s) => s.setActiveChannel)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  /** 删除二次确认:第一次点击进入确认态(3 秒自动复原),再点才真正删除 */
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  /** 重新拉取通道列表填充 store */
  const refresh = () => {
    window.kimiApi
      .getChannels()
      .then((r) => useUi.getState().setChannels(r.channels, r.active))
      .catch(() => {})
  }

  /** 启动 / 停止该通道服务 */
  const toggle = async (c: ChannelInfo) => {
    setBusyId(c.id)
    setError('')
    try {
      if (c.running) await window.kimiApi.stopBackend(c.id)
      else await window.kimiApi.startBackend(c.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
      // running 状态由 server:ready/stopped/exited 事件更新,这里兜底拉一次
      refresh()
    }
  }

  /** 删除通道:local 不可删;删除激活通道后 active 回落 "local" */
  const remove = async (c: ChannelInfo) => {
    setBusyId(c.id)
    setError('')
    try {
      await window.kimiApi.removeChannel(c.id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Section title={t('settings.channels.title')} desc={t('settings.channels.desc')}>
      <Card>
        <div className="space-y-1">
          {channels.map((c) => {
            const Icon = TARGET_ICON[c.target]
            const isActive = c.id === activeChannel
            const busy = busyId === c.id
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
                  isActive ? 'bg-primary-soft' : 'hover:bg-fill'
                }`}
              >
                <Icon size={15} className="shrink-0 text-text-tertiary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{c.label}</span>
                    <ChannelBadge target={c.target} />
                    {isActive && (
                      <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {t('settings.channels.current')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-text-tertiary">
                    {c.running ? t('settings.channels.running') : t('settings.channels.stopped')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!isActive && c.id !== 'local' && (
                    <button
                      className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-text hover:bg-fill disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void setActiveChannel(c.id)}
                    >
                      {t('settings.channels.setActive')}
                    </button>
                  )}
                  <button
                    className={`rounded-lg px-3 py-1 text-[12.5px] font-medium disabled:opacity-50 ${
                      c.running
                        ? 'border border-border text-text hover:bg-fill'
                        : 'bg-primary text-white hover:bg-primary-hover'
                    }`}
                    disabled={busy}
                    onClick={() => void toggle(c)}
                  >
                    {busy
                      ? t('settings.channels.busy')
                      : c.running
                        ? t('settings.channels.stop')
                        : t('settings.channels.start')}
                  </button>
                  {c.id !== 'local' && (
                    <button
                      className={`rounded-lg border p-1 disabled:opacity-50 ${
                        confirmDel === c.id
                          ? 'border-danger bg-danger-soft px-2 text-[12px] text-danger'
                          : 'border-border text-text-tertiary hover:border-danger-soft hover:bg-danger-soft hover:text-danger'
                      }`}
                      title={t('settings.channels.deleteTitle')}
                      disabled={busy}
                      onClick={() => {
                        if (confirmDel !== c.id) {
                          setConfirmDel(c.id)
                          setTimeout(() => setConfirmDel((v) => (v === c.id ? null : v)), 3000)
                          return
                        }
                        setConfirmDel(null)
                        void remove(c)
                      }}
                    >
                      {confirmDel === c.id ? t('settings.channels.confirmDelete') : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        <div className="mt-3 border-t border-border-light pt-3">
          <button
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
            onClick={() => useUi.getState().openOnboarding(undefined, 'add')}
          >
            <Plus size={14} /> {t('settings.channels.add')}
          </button>
          <p className="mt-1.5 text-[11.5px] text-text-tertiary">
            {t('settings.channels.addHint')}
          </p>
        </div>
      </Card>
    </Section>
  )
}
