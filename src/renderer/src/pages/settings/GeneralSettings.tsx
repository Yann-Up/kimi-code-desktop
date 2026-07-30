import { useEffect, useState } from 'react'
import { Section, Card, GroupLabel } from '../../components/settings/common'
import { FolderPickerDialog } from '../../components/FolderPickerDialog'
import type { ConnectionTargetConfig, ConnectionTargetInfo } from '../../platform/kimi-api'
import { useUi } from '../../stores/ui'

interface AppInfo {
  appVersion: string
  cliVersion: string | null
  port: number | null
  meta: Record<string, unknown> | null
}

interface KimiHomeInfo {
  home: string
  source: 'custom' | 'env' | 'default' | 'remote'
  defaultHome: string
}

interface KimiCliInfo {
  bin: string | null
  /** custom|env|home|path 为本机来源;auto 为远端自动探测(WSL/SSH) */
  source: 'custom' | 'env' | 'home' | 'path' | 'auto'
  version: string | null
}

const SOURCE_LABEL: Record<KimiHomeInfo['source'], string> = {
  custom: '自定义',
  env: '环境变量',
  default: '默认',
  remote: '远端'
}

const CLI_SOURCE_LABEL: Record<KimiCliInfo['source'], string> = {
  custom: '自定义',
  env: '环境变量',
  home: '官方脚本安装',
  path: 'PATH(npm 等)',
  auto: '自动探测'
}

export function GeneralSettings() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [permission, setPermission] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [homeInfo, setHomeInfo] = useState<KimiHomeInfo | null>(null)
  const [pickingHome, setPickingHome] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [homeError, setHomeError] = useState('')
  const [cliInfo, setCliInfo] = useState<KimiCliInfo | null>(null)
  const [editingCli, setEditingCli] = useState(false)
  const [cliPathText, setCliPathText] = useState('')
  const [cliSwitching, setCliSwitching] = useState(false)
  const [cliError, setCliError] = useState('')
  const [svcRunning, setSvcRunning] = useState<boolean | null>(null)
  const [svcBusy, setSvcBusy] = useState(false)
  const [autoStart, setAutoStart] = useState(false)
  const quotaRefreshSecs = useUi((s) => s.quotaRefreshSecs)
  const [npmUpgrading, setNpmUpgrading] = useState(false)
  // 远端(WSL/SSH)CLI 升级中标记
  const [cliUpgrading, setCliUpgrading] = useState(false)
  // 连接目标(本机 / WSL / SSH)
  const [connInfo, setConnInfo] = useState<ConnectionTargetInfo | null>(null)
  const [connTarget, setConnTarget] = useState<ConnectionTargetConfig['target']>('local')
  const [wslDistro, setWslDistro] = useState('')
  const [sshHost, setSshHost] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [sshAuth, setSshAuth] = useState<'password' | 'key'>('key')
  const [sshPassword, setSshPassword] = useState('')
  const [sshIdentity, setSshIdentity] = useState('')
  const [connSaving, setConnSaving] = useState(false)
  const [connError, setConnError] = useState('')
  const [connWarn, setConnWarn] = useState('')

  useEffect(() => {
    window.kimiApi.appInfo().then(setInfo).catch(() => {})
    window.kimiApi
      .rest({ path: '/api/v1/config' })
      .then((c) => setPermission((c as { default_permission_mode?: string }).default_permission_mode ?? ''))
      .catch(() => {})
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setHomeInfo(h as KimiHomeInfo))
      .catch(() => {})
    window.kimiApi
      .kimiCliGet()
      .then((c) => setCliInfo(c as KimiCliInfo))
      .catch(() => {})
    window.kimiApi
      .appInfo()
      .then((i: AppInfo) => setSvcRunning(i.cliVersion !== null))
      .catch(() => {})
    window.kimiApi
      .getAutoStart()
      .then((v) => setAutoStart(!!v))
      .catch(() => {})
    window.kimiApi
      .connectionTargetGet()
      .then((t) => {
        setConnInfo(t)
        setConnTarget(t.config.target)
        setWslDistro(t.config.wslDistro ?? '')
        setSshHost(t.config.sshHost ?? '')
        setSshUser(t.config.sshUser ?? '')
        setSshPort(t.config.sshPort ? String(t.config.sshPort) : '')
        setSshAuth(t.config.sshAuth ?? 'key')
        setSshIdentity(t.config.sshIdentity ?? '')
      })
      .catch(() => {})
    const offs = [
      window.kimiApi.onServerReady(() => setSvcRunning(true)),
      window.kimiApi.onServerStopped(() => setSvcRunning(false))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  /** 启动/停止本地服务(Tauri 壳专属;停止后回到手动启动页) */
  const toggleService = async () => {
    setSvcBusy(true)
    try {
      if (svcRunning) await window.kimiApi.stopBackend()
      else await window.kimiApi.startBackend()
    } catch {
      /* 状态由事件兜底 */
    } finally {
      setSvcBusy(false)
    }
  }

  const savePermission = async (mode: string) => {
    setPermission(mode)
    await window.kimiApi
      .rest({ path: '/api/v1/config', method: 'POST', body: { default_permission_mode: mode } })
      .catch(() => {})
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  /** 切换数据目录:后端会重启 kimi web 服务,完成后整页重载以重取全部状态 */
  const switchHome = async (path: string | null) => {
    setSwitching(true)
    setHomeError('')
    try {
      await window.kimiApi.kimiHomeSet(path)
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setHomeError(e instanceof Error ? e.message : String(e))
      setSwitching(false)
    }
  }

  /** 切换 CLI 二进制:同样触发服务重启 + 整页重载 */
  const switchCli = async (path: string | null) => {
    setCliSwitching(true)
    setCliError('')
    try {
      await window.kimiApi.kimiCliSet(path)
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setCliError(e instanceof Error ? e.message : String(e))
      setCliSwitching(false)
    }
  }

  /** 指定/清除远端 CLI 路径(WSL/SSH):后端校验可执行、持久化并重启服务 */
  const switchRemoteCli = async (path: string | null) => {
    setCliSwitching(true)
    setCliError('')
    try {
      await window.kimiApi.remoteBinSet(path)
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setCliError(e instanceof Error ? e.message : String(e))
      setCliSwitching(false)
    }
  }

  /** 远端 CLI 升级(Rust 侧按安装方式自动选官方安装脚本或 npm update -g) */
  const upgradeRemoteCli = () => {
    setCliUpgrading(true)
    setCliError('')
    window.kimiApi
      .cliUpgrade()
      .then(() => setTimeout(() => window.location.reload(), 600))
      .catch((e) => {
        setCliError(e instanceof Error ? e.message : String(e))
        setCliUpgrading(false)
      })
  }

  /** 保存连接目标:后端持久化并重启 kimi web 服务,完成后整页重载 */
  const saveConnection = async () => {
    setConnError('')
    setConnWarn('')
    let port: number | null = null
    if (connTarget === 'ssh' && sshPort.trim()) {
      const n = Number(sshPort.trim())
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        setConnError('SSH 端口必须是 1-65535 的整数')
        return
      }
      port = n
    }
    // 密码仅在新输入时上送;留空表示保持已保存的密码不变
    const password =
      connTarget === 'ssh' && sshAuth === 'password' && sshPassword ? sshPassword : undefined
    setConnSaving(true)
    try {
      const r = await window.kimiApi.connectionTargetSet(
        {
          target: connTarget,
          wslDistro: connTarget === 'wsl' ? wslDistro.trim() || null : null,
          sshHost: connTarget === 'ssh' ? sshHost.trim() || null : null,
          sshUser: connTarget === 'ssh' ? sshUser.trim() || null : null,
          sshPort: connTarget === 'ssh' ? port : null,
          sshIdentity:
            connTarget === 'ssh' && sshAuth === 'key' ? sshIdentity.trim() || null : null,
          sshAuth: connTarget === 'ssh' ? sshAuth : null,
          // 远端 CLI 覆盖由 CLI 卡片单独维护,重新保存连接目标时原样保留
          remoteBin: connInfo?.config.remoteBin ?? null
        },
        password
      )
      // keyring 保存失败:本次仅内存生效,重载前提示用户
      if (password && !r.passwordSaved) {
        setConnWarn('密码保存失败,本次仅保存在内存;下次启动需重新输入')
        setConnSaving(false)
        setTimeout(() => window.location.reload(), 2500)
        return
      }
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setConnError(e instanceof Error ? e.message : String(e))
      setConnSaving(false)
    }
  }

  return (
    <Section title="常规" desc="应用与 Kimi Code CLI 的基本信息">
      <GroupLabel>版本</GroupLabel>
      <Card>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-text-secondary">桌面应用版本</span>
            <span className="font-mono">{info?.appVersion ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Kimi Code CLI</span>
            <span className="font-mono">{info?.cliVersion ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">本地服务端口</span>
            <span className="font-mono">{info?.port ?? '—'}</span>
          </div>
        </div>
      </Card>

      <GroupLabel>连接目标</GroupLabel>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              kimi web 服务运行位置
              {connInfo && (
                <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 text-[11px] text-text-tertiary">
                  {connInfo.describe}
                </span>
              )}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              本机直接启动 CLI;WSL 经 wsl.exe 进入发行版;SSH 连接远程机器(支持密码 / 私钥认证,密码存系统凭据管理器)。切换将重启服务
            </p>
            <div className="mt-3 space-y-2 text-[13px]">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="conn-target"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={connTarget === 'local'}
                  onChange={() => setConnTarget('local')}
                />
                本机
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="conn-target"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={connTarget === 'wsl'}
                  onChange={() => setConnTarget('wsl')}
                />
                WSL
              </label>
              {connTarget === 'wsl' && (
                <input
                  className="ml-5 w-72 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
                  placeholder="发行版名称(留空 = 默认发行版)"
                  value={wslDistro}
                  onChange={(e) => setWslDistro(e.target.value)}
                />
              )}
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="conn-target"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={connTarget === 'ssh'}
                  onChange={() => setConnTarget('ssh')}
                />
                SSH(远程机器)
              </label>
              {connTarget === 'ssh' && (
                <div className="ml-5 space-y-2">
                  <input
                    className="w-72 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
                    placeholder="主机,可 user@host(必填)"
                    value={sshHost}
                    onChange={(e) => setSshHost(e.target.value)}
                  />
                  <input
                    className="w-72 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
                    placeholder="用户名(可选,优先于主机中的 user@)"
                    value={sshUser}
                    onChange={(e) => setSshUser(e.target.value)}
                  />
                  <input
                    className="w-72 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
                    placeholder="SSH 端口(可选,默认 22)"
                    value={sshPort}
                    onChange={(e) => setSshPort(e.target.value)}
                  />
                  <div className="flex items-center gap-4 text-[13px]">
                    <span className="text-text-secondary">认证方式</span>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="ssh-auth"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={sshAuth === 'key'}
                        onChange={() => setSshAuth('key')}
                      />
                      私钥
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="ssh-auth"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={sshAuth === 'password'}
                        onChange={() => setSshAuth('password')}
                      />
                      密码
                    </label>
                  </div>
                  {sshAuth === 'password' ? (
                    <input
                      type="password"
                      className="w-72 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
                      placeholder={
                        connInfo?.hasPassword ? '已保存,留空保持不变' : 'SSH 密码'
                      }
                      value={sshPassword}
                      onChange={(e) => setSshPassword(e.target.value)}
                    />
                  ) : (
                    <input
                      className="w-72 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
                      placeholder="私钥路径(可选,如 C:\Users\you\.ssh\id_ed25519)"
                      value={sshIdentity}
                      onChange={(e) => setSshIdentity(e.target.value)}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          <button
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={connSaving || (connTarget === 'ssh' && !sshHost.trim())}
            onClick={() => void saveConnection()}
          >
            {connSaving ? '保存中…' : '保存'}
          </button>
        </div>
        {connError && <p className="mt-2 text-[12px] text-danger">{connError}</p>}
        {connWarn && <p className="mt-2 text-[12px] text-warning">{connWarn}</p>}
        {/* 重跑首启向导:复位 setup_done 后以覆盖层打开向导,可取消 */}
        <div className="mt-3 border-t border-border-light pt-3">
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text-secondary hover:bg-surface-tertiary"
            onClick={() => {
              void window.kimiApi
                .setupStateReset()
                .then(() => useUi.getState().openOnboarding())
                .catch(() => {})
            }}
          >
            重新运行初始向导
          </button>
          <p className="mt-1.5 text-[11.5px] text-text-tertiary">
            重新走一遍连接目标选择流程;当前配置在向导完成前不会改动
          </p>
        </div>
      </Card>

      {/* 非本机目标使用远端自己的 ~/.kimi-code,数据目录设置不适用 */}
      {(!connInfo || connInfo.config.target === 'local') && (
        <>
          <GroupLabel>存储位置</GroupLabel>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">Kimi Code 数据目录</p>
            <p className="mt-0.5 truncate font-mono text-[12px] text-text-secondary">
              {homeInfo?.home ?? '—'}
              {homeInfo && (
                <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                  {SOURCE_LABEL[homeInfo.source]}
                </span>
              )}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              会话、配置、插件等数据的存放位置(默认在 C 盘用户目录);切换将重启本地服务并重新加载
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {homeInfo?.source === 'custom' && (
              <button
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
                disabled={switching}
                onClick={() => void switchHome(null)}
              >
                恢复默认
              </button>
            )}
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
              disabled={switching}
              onClick={() => setPickingHome(true)}
            >
              {switching ? '切换中…' : '修改'}
            </button>
          </div>
        </div>
          {homeError && <p className="mt-2 text-[12px] text-danger">{homeError}</p>}
        </Card>
        </>
      )}

      {/* CLI 程序:本机管理 Windows 上的 CLI;WSL/SSH 显示远端实际使用的 CLI 路径/版本,支持自定义远端路径与远端升级 */}
      <GroupLabel>CLI 程序</GroupLabel>
      <Card>
        {(!connInfo || connInfo.config.target === 'local') ? (
        <>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">Kimi Code CLI 可执行文件</p>
            <p className="mt-0.5 truncate font-mono text-[12px] text-text-secondary">
              {cliInfo?.bin ?? '—'}
              {cliInfo && (
                <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                  {CLI_SOURCE_LABEL[cliInfo.source]}
                </span>
              )}
              {cliInfo?.version && (
                <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                  v{cliInfo.version}
                </span>
              )}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              应用内一键升级仅适用于官方脚本安装;npm/自定义安装可直接点右侧"npm 升级"(等价 npm update -g)。切换将重启本地服务
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {cliInfo && cliInfo.source !== 'home' && (
              <button
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
                disabled={npmUpgrading || cliSwitching}
                onClick={() => {
                  setNpmUpgrading(true)
                  setCliError('')
                  window.kimiApi
                    .cliNpmUpgrade()
                    .then(() => setTimeout(() => window.location.reload(), 600))
                    .catch((e) => {
                      setCliError(e instanceof Error ? e.message : String(e))
                      setNpmUpgrading(false)
                    })
                }}
              >
                {npmUpgrading ? '升级中…' : 'npm 升级'}
              </button>
            )}
            {cliInfo?.source === 'custom' && (
              <button
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
                disabled={cliSwitching}
                onClick={() => void switchCli(null)}
              >
                恢复默认
              </button>
            )}
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
              disabled={cliSwitching}
              onClick={() => {
                setCliPathText(cliInfo?.bin ?? '')
                setEditingCli((v) => !v)
              }}
            >
              {cliSwitching ? '切换中…' : editingCli ? '取消' : '修改'}
            </button>
          </div>
        </div>
        {editingCli && (
          <div className="mt-3 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
              placeholder="CLI 路径,如 D:\Env\nodejs\kimi.cmd(npm 全局)或 C:\...\kimi.exe"
              value={cliPathText}
              onChange={(e) => setCliPathText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cliPathText.trim()) void switchCli(cliPathText.trim())
              }}
            />
            <button
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              disabled={cliSwitching || !cliPathText.trim()}
              onClick={() => void switchCli(cliPathText.trim())}
            >
              保存
            </button>
          </div>
        )}
        {cliError && <p className="mt-2 text-[12px] text-danger">{cliError}</p>}
        </>
        ) : (
        <>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">Kimi Code CLI 可执行文件</p>
            <p className="mt-0.5 truncate font-mono text-[12px] text-text-secondary">
              {cliInfo?.bin ?? '—'}
              {cliInfo && (
                <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                  {CLI_SOURCE_LABEL[cliInfo.source]}
                </span>
              )}
              {cliInfo?.version && (
                <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                  v{cliInfo.version}
                </span>
              )}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              CLI 在远端环境({connInfo?.describe ?? 'WSL/SSH'})运行;升级按安装方式自动选择官方安装脚本或 npm update -g,完成后重启服务
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
              disabled={cliUpgrading || cliSwitching}
              onClick={upgradeRemoteCli}
            >
              {cliUpgrading ? '升级中…' : '升级 CLI'}
            </button>
            {cliInfo?.source === 'custom' && (
              <button
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
                disabled={cliSwitching}
                onClick={() => void switchRemoteCli(null)}
              >
                恢复默认
              </button>
            )}
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
              disabled={cliSwitching}
              onClick={() => {
                setCliPathText(cliInfo?.bin ?? '')
                setEditingCli((v) => !v)
              }}
            >
              {cliSwitching ? '切换中…' : editingCli ? '取消' : '修改'}
            </button>
          </div>
        </div>
        {editingCli && (
          <div className="mt-3 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
              placeholder="远端绝对路径,如 /home/user/.kimi-code/bin/kimi"
              value={cliPathText}
              onChange={(e) => setCliPathText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cliPathText.trim()) void switchRemoteCli(cliPathText.trim())
              }}
            />
            <button
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              disabled={cliSwitching || !cliPathText.trim()}
              onClick={() => void switchRemoteCli(cliPathText.trim())}
            >
              保存
            </button>
          </div>
        )}
        {cliError && <p className="mt-2 text-[12px] text-danger">{cliError}</p>}
        </>
        )}
      </Card>

      <GroupLabel>本地服务</GroupLabel>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13.5px] font-medium">
              kimi web 服务
              {svcRunning !== null && (
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                    svcRunning
                      ? 'bg-success-soft text-success'
                      : 'bg-surface-tertiary text-text-tertiary'
                  }`}
                >
                  {svcRunning ? '运行中' : '未启动'}
                </span>
              )}
            </p>
            <p className="text-[12px] text-text-tertiary">
              停止后应用回到手动启动页;会话状态由 CLI 持久化,重连后恢复
            </p>
          </div>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
            disabled={svcBusy || svcRunning === null}
            onClick={() => void toggleService()}
          >
            {svcBusy ? '处理中…' : svcRunning ? '停止服务' : '启动服务'}
          </button>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-border-light pt-3 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={autoStart}
            onChange={(e) => {
              setAutoStart(e.target.checked)
              window.kimiApi.setAutoStart(e.target.checked).catch(() => {})
            }}
          />
          启动应用时自动连接服务(默认关闭,手动启动)
        </label>
      </Card>

      <GroupLabel>默认行为</GroupLabel>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13.5px] font-medium">默认权限模式</p>
            <p className="text-[12px] text-text-tertiary">新会话的工具调用审批策略</p>
          </div>
          <select
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none"
            value={permission}
            onChange={(e) => void savePermission(e.target.value)}
          >
            <option value="manual">手动审批</option>
            <option value="auto">自动通过</option>
            <option value="yolo">Yolo(全部放行)</option>
          </select>
        </div>
        {/* 额度条刷新间隔:存 localStorage,QuotaStrip 响应式生效 */}
        <div className="mt-3 flex items-center justify-between border-t border-border-light pt-3">
          <div>
            <p className="text-[13.5px] font-medium">额度条刷新间隔</p>
            <p className="text-[12px] text-text-tertiary">顶部额度/余额的自动刷新频率(每轮对话结束也会立即刷新)</p>
          </div>
          <select
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none"
            value={quotaRefreshSecs}
            onChange={(e) => useUi.getState().setQuotaRefreshSecs(Number(e.target.value))}
          >
            <option value={30}>30 秒</option>
            <option value={60}>1 分钟(默认)</option>
            <option value={120}>2 分钟</option>
            <option value={300}>5 分钟</option>
            <option value={0}>关闭自动刷新</option>
          </select>
        </div>
        {saved && <p className="mt-2 text-[12px] text-success">已保存</p>}
      </Card>

      <GroupLabel>诊断</GroupLabel>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13.5px] font-medium">运行日志</p>
            <p className="text-[12px] text-text-tertiary">
              WS 事件流日志默认开启(ws.log),遇到渲染/连接问题请把日志发给开发者
            </p>
          </div>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary"
            onClick={() => window.kimiApi.openLogs()}
          >
            打开日志目录
          </button>
        </div>
      </Card>

      {pickingHome && (
        <FolderPickerDialog
          title="选择数据目录"
          subtitle="Kimi Code 的会话与配置数据将存放在此"
          confirmLabel="设为数据目录"
          onSelect={(p) => {
            setPickingHome(false)
            void switchHome(p)
          }}
          onClose={() => setPickingHome(false)}
        />
      )}
    </Section>
  )
}
