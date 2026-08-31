import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Section, Card, GroupLabel } from '../../components/settings/common'
import { FolderPickerDialog } from '../../components/FolderPickerDialog'
import type {
  ConnectionTargetInfo,
  WebServerOptions
} from '../../platform/kimi-api'
import { useUi } from '../../stores/ui'
import { useT } from '../../i18n'
import { pushLocaleToFrames, pushThemeToFrames } from '../../components/chatPrefsBridge'
import { Select } from '../../components/ui/Select'
import { Segmented } from '../../components/ui/Segmented'
import { inputCls as uiInputCls } from '../../components/ui/Input'

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

/* ---------------- CLI 来源卡片(本机 / 远端 WSL/SSH) ---------------- */

/**
 * CLI 程序卡片:本机与远端(WSL/SSH)共用同一结构,差异通过参数注入——
 * 说明文案、升级按钮(本机「npm 升级」仅非官方安装可见 / 远端「升级 CLI」)、
 * 恢复默认与保存的目标函数(本机 kimiCliSet / 远端 remoteBinSet)、编辑输入占位符。
 */
function CliSourceCard(props: {
  cliInfo: KimiCliInfo | null
  description: string
  checking: boolean
  onCheck: () => void
  /** 升级按钮参数;visible=false 时不渲染 */
  upgrade: {
    visible: boolean
    label: string
    busyLabel: string
    busy: boolean
    onUpgrade: () => void
  }
  switching: boolean
  onReset: () => void
  editing: boolean
  onToggleEditing: () => void
  pathText: string
  onPathTextChange: (v: string) => void
  placeholder: string
  onSavePath: (p: string) => void
  error: string
  checkMsg: { ok: boolean; text: string } | null
}) {
  const {
    cliInfo,
    description,
    checking,
    onCheck,
    upgrade,
    switching,
    onReset,
    editing,
    onToggleEditing,
    pathText,
    onPathTextChange,
    placeholder,
    onSavePath,
    error,
    checkMsg
  } = props
  const t = useT()
  const CLI_SOURCE_LABEL: Record<KimiCliInfo['source'], string> = {
    custom: t('settings.general.srcCustom'),
    env: t('settings.general.srcEnv'),
    home: t('settings.general.cliSrcHome'),
    path: t('settings.general.cliSrcPath'),
    auto: t('settings.general.cliSrcAuto')
  }
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-[475]">{t('settings.general.cliExecutable')}</p>
          <p className="mt-0.5 truncate font-mono text-[12px] text-text-secondary">
            {cliInfo?.bin ?? '—'}
            {cliInfo && (
              <span className="ml-2 rounded bg-fill px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                {CLI_SOURCE_LABEL[cliInfo.source]}
              </span>
            )}
            {cliInfo?.version && (
              <span className="ml-2 rounded bg-fill px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                v{cliInfo.version}
              </span>
            )}
          </p>
          <p className="mt-1 text-[12px] text-text-tertiary">{description}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
            disabled={checking || upgrade.busy || switching}
            onClick={onCheck}
          >
            {checking ? t('settings.general.checking') : t('settings.general.checkUpdate')}
          </button>
          {upgrade.visible && (
            <button
              className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
              disabled={upgrade.busy || switching}
              onClick={upgrade.onUpgrade}
            >
              {upgrade.busy ? upgrade.busyLabel : upgrade.label}
            </button>
          )}
          {cliInfo?.source === 'custom' && (
            <button
              className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
              disabled={switching}
              onClick={onReset}
            >
              {t('settings.general.resetDefault')}
            </button>
          )}
          <button
            className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
            disabled={switching}
            onClick={onToggleEditing}
          >
            {switching
              ? t('settings.general.switching')
              : editing
                ? t('settings.general.cancel')
                : t('settings.general.edit')}
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <input
            className={uiInputCls('sm', 'min-w-0 flex-1 font-mono')}
            placeholder={placeholder}
            value={pathText}
            onChange={(e) => onPathTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathText.trim()) void onSavePath(pathText.trim())
            }}
          />
          <button
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={switching || !pathText.trim()}
            onClick={() => void onSavePath(pathText.trim())}
          >
            {t('settings.general.save')}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      {checkMsg && (
        <p className={`mt-2 text-[12px] ${checkMsg.ok ? 'text-success' : 'text-warning'}`}>
          {checkMsg.text}
        </p>
      )}
    </>
  )
}

export function GeneralSettings() {
  const t = useT()
  const SOURCE_LABEL: Record<KimiHomeInfo['source'], string> = {
    custom: t('settings.general.srcCustom'),
    env: t('settings.general.srcEnv'),
    default: t('settings.general.srcDefault'),
    remote: t('settings.general.srcRemote')
  }
  const [info, setInfo] = useState<AppInfo | null>(null)
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
  const quotaRefreshSecs = useUi((s) => s.quotaRefreshSecs)
  const settingsZoom = useUi((s) => s.settingsZoom)
  const theme = useUi((s) => s.theme)
  const locale = useUi((s) => s.locale)
  const [npmUpgrading, setNpmUpgrading] = useState(false)
  // 手动检查更新状态与结果
  const [cliChecking, setCliChecking] = useState(false)
  const [cliCheckMsg, setCliCheckMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 远端(WSL/SSH)CLI 升级中标记
  const [cliUpgrading, setCliUpgrading] = useState(false)
  // 连接目标信息(本机 / WSL / SSH),仅用于条件渲染存储位置与 CLI 卡片;编辑入口已迁移至「通道」页
  const [connInfo, setConnInfo] = useState<ConnectionTargetInfo | null>(null)
  // kimi web 启动参数(首选端口);保存后运行中的服务由后端自动重启
  const [webOpts, setWebOpts] = useState<WebServerOptions | null>(null)
  const [webPortText, setWebPortText] = useState('')
  const [webSaving, setWebSaving] = useState(false)
  const [webMsg, setWebMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 应用自身更新(桌面应用,区别于下方 CLI 升级);结果与下载状态存全局 store,
  // 启动静默自检先于本页打开、或下载中切换 tab 再回来,状态都不丢失
  const appUpdate = useUi((s) => s.appUpdate)
  const appInstalling = useUi((s) => s.appInstalling)
  const appProgress = useUi((s) => s.appProgress)
  const [appChecking, setAppChecking] = useState(false)
  const [appMsg, setAppMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 本页所有服务信息/事件跟随激活通道:切换通道后重探
  const activeChannel = useUi((s) => s.activeChannel)

  /** 手动检查应用更新(GitHub Releases);结果写全局 store,错误就地展示 */
  const checkAppUpdate = () => {
    setAppChecking(true)
    setAppMsg(null)
    window.kimiApi
      .appUpdateCheck()
      .then((r) => {
        useUi.getState().setAppUpdate(r)
        if (!r) setAppMsg({ ok: true, text: t('settings.general.appLatest') })
      })
      .catch((e) => setAppMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setAppChecking(false))
  }

  /** 下载并安装应用更新:成功安装时进程被安装器接管重启,正常 resolve 意味着
   *  重新检查时更新已不存在(Release 被撤回等),需复位状态提示用户 */
  const installAppUpdate = () => {
    const { setAppInstalling, setAppProgress } = useUi.getState()
    setAppInstalling(true)
    setAppMsg(null)
    setAppProgress(null)
    window.kimiApi
      .appUpdateInstall()
      .then(() => {
        setAppInstalling(false)
        setAppMsg({ ok: false, text: t('settings.general.appUpdateGone') })
      })
      .catch((e) => {
        setAppMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
        setAppInstalling(false)
      })
  }

  useEffect(() => {
    window.kimiApi.appInfo(activeChannel).then(setInfo).catch(() => {})
    window.kimiApi
      .kimiHomeGet()
      .then((h) => setHomeInfo(h as KimiHomeInfo))
      .catch(() => {})
    window.kimiApi
      .kimiCliGet()
      .then((c) => setCliInfo(c as KimiCliInfo))
      .catch(() => {})
    window.kimiApi
      .appInfo(activeChannel)
      .then((i: AppInfo) => setSvcRunning(i.cliVersion !== null))
      .catch(() => {})
    window.kimiApi
      .connectionTargetGet()
      .then((t) => setConnInfo(t))
      .catch(() => {})
    window.kimiApi
      .webServerGet()
      .then((o) => {
        setWebOpts(o)
        setWebPortText(String(o.port))
      })
      .catch(() => {})
    const refreshInfo = () => {
      window.kimiApi
        .appInfo(activeChannel)
        .then((i: AppInfo) => {
          setInfo(i)
          setSvcRunning(i.cliVersion !== null)
        })
        .catch(() => {})
    }
    const offs = [
      // 服务启停后端口/版本信息会变化,重新拉 appInfo(只关心激活通道的事件)
      window.kimiApi.onServerReady((info) => {
        if (info.channel === activeChannel) refreshInfo()
      }),
      window.kimiApi.onServerStopped((info) => {
        if (info.channel === activeChannel) refreshInfo()
      }),
      window.kimiApi.onServerExited((info) => {
        if (info.channel === activeChannel) refreshInfo()
      })
    ]
    return () => offs.forEach((off) => off())
  }, [activeChannel])

  /** 启动/停止激活通道服务(停止后对话页不可用,统计/设置等本地页面不受影响) */
  const toggleService = async () => {
    setSvcBusy(true)
    try {
      if (svcRunning) await window.kimiApi.stopBackend(activeChannel)
      else await window.kimiApi.startBackend(activeChannel)
    } catch {
      /* 状态由事件兜底 */
    } finally {
      setSvcBusy(false)
    }
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

  /** 手动检查 CLI 更新(对比 npm registry 最新版;本机/远端目标通用) */
  const checkCliUpdate = () => {
    setCliChecking(true)
    setCliCheckMsg(null)
    setCliError('')
    window.kimiApi
      .cliCheckUpdate()
      .then((r) => {
        setCliCheckMsg(
          r.hasUpdate
            ? {
                ok: false,
                text: t('settings.general.cliNewVersion', {
                  latest: r.latest,
                  current: r.current ?? t('settings.general.cliUnknown')
                })
              }
            : { ok: true, text: t('settings.general.cliLatest', { latest: r.latest }) }
        )
      })
      .catch((e) => setCliError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCliChecking(false))
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

  /** 保存 kimi web 启动参数(首选端口) */
  const saveWebOpts = async () => {
    const port = parseInt(webPortText, 10)
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      setWebMsg({ ok: false, text: t('settings.general.portInvalid') })
      return
    }
    setWebSaving(true)
    setWebMsg(null)
    try {
      const saved = await window.kimiApi.webServerSet({ port })
      setWebOpts(saved)
      setWebPortText(String(saved.port))
      setWebMsg({
        ok: true,
        text: svcRunning
          ? t('settings.general.portSavedRestart')
          : t('settings.general.portSavedNext')
      })
    } catch (e) {
      setWebMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setWebSaving(false)
    }
  }

  return (
    <Section title={t('settings.general')} desc={t('settings.general.pageDesc')}>
      <GroupLabel>{t('settings.general.groupVersion')}</GroupLabel>
      <Card>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-text-secondary">{t('settings.general.appVersionLabel')}</span>
            <span className="font-mono">{info?.appVersion ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Kimi Code CLI</span>
            {/* cliInfo 来自本地探测(kimi --version),不依赖服务运行 */}
            <span className="font-mono">{cliInfo?.version ?? '—'}</span>
          </div>
        </div>
      </Card>

      {/* 应用自身更新:GitHub Releases 通道;启动时静默自检,此处手动检查与执行更新 */}
      <GroupLabel>{t('settings.general.groupAppUpdate')}</GroupLabel>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-[475]">
              {t('settings.general.appUpdateTitle')}
              {appUpdate && (
                <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-[11px] text-success">
                  {t('settings.general.appNewVersion', { version: appUpdate.version })}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-text-tertiary">
              {t('settings.general.appUpdateDescPre')}{' '}
              <span className="font-mono">{info?.appVersion ?? '—'}</span>
              {t('settings.general.appUpdateDescPost')}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
              disabled={appChecking || appInstalling}
              onClick={checkAppUpdate}
            >
              {appChecking ? t('settings.general.checking') : t('settings.general.checkUpdate')}
            </button>
            {appUpdate && (
              <button
                className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                disabled={appInstalling}
                onClick={installAppUpdate}
              >
                {appInstalling
                  ? t('settings.general.downloading')
                  : t('settings.general.downloadAndRestart')}
              </button>
            )}
          </div>
        </div>
        {appUpdate?.notes && (
          <p className="mt-2 whitespace-pre-wrap text-[12px] text-text-secondary">{appUpdate.notes}</p>
        )}
        {appInstalling && appProgress && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-fill">
              <div
                className={`h-full rounded-full bg-primary ${appProgress.total ? 'transition-all' : 'animate-pulse'}`}
                style={{
                  width: appProgress.total
                    ? `${Math.min(100, Math.round((appProgress.downloaded / appProgress.total) * 100))}%`
                    : '100%'
                }}
              />
            </div>
            <p className="mt-1 text-[12px] text-text-tertiary">
              {appProgress.total
                ? t('settings.general.appProgressTotal', {
                    downloaded: (appProgress.downloaded / 1024 / 1024).toFixed(1),
                    total: (appProgress.total / 1024 / 1024).toFixed(1)
                  })
                : t('settings.general.appProgressNoTotal', {
                    downloaded: (appProgress.downloaded / 1024 / 1024).toFixed(1)
                  })}
            </p>
          </div>
        )}
        {appMsg && (
          <p className={`mt-2 text-[12px] ${appMsg.ok ? 'text-success' : 'text-danger'}`}>
            {appMsg.text}
          </p>
        )}
      </Card>

      {/* 连接目标的编辑入口已迁移至「通道」设置页(ChannelsSettings) */}

      {/* 非本机目标使用远端自己的 ~/.kimi-code,数据目录设置不适用 */}
      {(!connInfo || connInfo.config.target === 'local') && (
        <>
          <GroupLabel>{t('settings.general.groupStorage')}</GroupLabel>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-[475]">{t('settings.general.dataDirTitle')}</p>
            <p className="mt-0.5 truncate font-mono text-[12px] text-text-secondary">
              {homeInfo?.home ?? '—'}
              {homeInfo && (
                <span className="ml-2 rounded bg-fill px-1.5 py-0.5 font-sans text-[11px] text-text-tertiary">
                  {SOURCE_LABEL[homeInfo.source]}
                </span>
              )}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              {t('settings.general.dataDirDesc')}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {homeInfo?.source === 'custom' && (
              <button
                className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
                disabled={switching}
                onClick={() => void switchHome(null)}
              >
                {t('settings.general.resetDefault')}
              </button>
            )}
            <button
              className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
              disabled={switching}
              onClick={() => setPickingHome(true)}
            >
              {switching ? t('settings.general.switching') : t('settings.general.edit')}
            </button>
          </div>
        </div>
          {homeError && <p className="mt-2 text-[12px] text-danger">{homeError}</p>}
        </Card>
        </>
      )}

      {/* CLI 程序:本机管理 Windows 上的 CLI;WSL/SSH 显示远端实际使用的 CLI 路径/版本,支持自定义远端路径与远端升级 */}
      <GroupLabel>{t('settings.general.groupCli')}</GroupLabel>
      <Card>
        {(!connInfo || connInfo.config.target === 'local') ? (
          <CliSourceCard
            cliInfo={cliInfo}
            description={t('settings.general.cliDescLocal')}
            checking={cliChecking}
            onCheck={checkCliUpdate}
            upgrade={{
              visible: !!cliInfo && cliInfo.source !== 'home',
              label: t('settings.general.npmUpgrade'),
              busyLabel: t('settings.general.upgrading'),
              busy: npmUpgrading,
              onUpgrade: () => {
                setNpmUpgrading(true)
                setCliError('')
                window.kimiApi
                  .cliUpgrade()
                  .then(() => setTimeout(() => window.location.reload(), 600))
                  .catch((e) => {
                    setCliError(e instanceof Error ? e.message : String(e))
                    setNpmUpgrading(false)
                  })
              }
            }}
            switching={cliSwitching}
            onReset={() => void switchCli(null)}
            editing={editingCli}
            onToggleEditing={() => {
              setCliPathText(cliInfo?.bin ?? '')
              setEditingCli((v) => !v)
            }}
            pathText={cliPathText}
            onPathTextChange={setCliPathText}
            placeholder={t('settings.general.cliPlaceholderLocal')}
            onSavePath={(p) => void switchCli(p)}
            error={cliError}
            checkMsg={cliCheckMsg}
          />
        ) : (
          <CliSourceCard
            cliInfo={cliInfo}
            description={t('settings.general.cliDescRemote', {
              target: connInfo?.describe ?? 'WSL/SSH'
            })}
            checking={cliChecking}
            onCheck={checkCliUpdate}
            upgrade={{
              visible: true,
              label: t('settings.general.upgradeCli'),
              busyLabel: t('settings.general.upgrading'),
              busy: cliUpgrading,
              onUpgrade: upgradeRemoteCli
            }}
            switching={cliSwitching}
            onReset={() => void switchRemoteCli(null)}
            editing={editingCli}
            onToggleEditing={() => {
              setCliPathText(cliInfo?.bin ?? '')
              setEditingCli((v) => !v)
            }}
            pathText={cliPathText}
            onPathTextChange={setCliPathText}
            placeholder={t('settings.general.cliPlaceholderRemote')}
            onSavePath={(p) => void switchRemoteCli(p)}
            error={cliError}
            checkMsg={cliCheckMsg}
          />
        )}
      </Card>

      <GroupLabel>{t('settings.general.groupLocalService')}</GroupLabel>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-[475]">
              {t('settings.general.svcTitle')}
              {svcRunning !== null && (
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                    svcRunning
                      ? 'bg-success-soft text-success'
                      : 'bg-fill text-text-tertiary'
                  }`}
                >
                  {svcRunning ? t('settings.general.svcRunning') : t('settings.general.svcStopped')}
                </span>
              )}
            </p>
            <p className="text-[12px] text-text-tertiary">
              {t('settings.general.svcDesc')}
            </p>
            {/* 端口只有服务运行时才存在(server_info),故放在本卡片而不是版本卡片 */}
            {svcRunning && info?.port && (
              <p className="mt-1 text-[12px] text-text-tertiary">
                {t('settings.general.svcPort')}{' '}
                <span className="font-mono text-text-secondary">{info.port}</span>
              </p>
            )}
          </div>
          <button
            className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover disabled:opacity-50"
            disabled={svcBusy || svcRunning === null}
            onClick={() => void toggleService()}
          >
            {svcBusy
              ? t('settings.general.svcBusy')
              : svcRunning
                ? t('settings.general.svcStop')
                : t('settings.general.svcStart')}
          </button>
        </div>
      </Card>

      <GroupLabel>{t('settings.general.groupServiceArgs')}</GroupLabel>
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-[475]">{t('settings.general.portTitle')}</p>
              <p className="mt-0.5 text-[12px] text-text-tertiary">
                {t('settings.general.portDesc')}
              </p>
            </div>
            <input
              className={uiInputCls('sm', 'w-28 shrink-0 font-mono')}
              value={webPortText}
              disabled={!webOpts || webSaving}
              onChange={(e) => setWebPortText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveWebOpts()
              }}
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            {webMsg && (
              <p className={`text-[12px] ${webMsg.ok ? 'text-success' : 'text-danger'}`}>
                {webMsg.text}
              </p>
            )}
            <button
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              disabled={!webOpts || webSaving}
              onClick={() => void saveWebOpts()}
            >
              {webSaving ? t('settings.general.saving') : t('settings.general.save')}
            </button>
          </div>
        </div>
      </Card>

      <GroupLabel>{t('settings.general.groupUi')}</GroupLabel>
      <Card>
        {/* 主题:壳 store + 反推对话 iframe(官方无刷新跟随);语言:壳页面即时生效,
            对话页经注入脚本写 kimi-locale,下次加载必然生效(官方是否无刷新跟随取决于其自身) */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-[475]">{t('settings.general.themeTitle')}</p>
            <p className="text-[12px] text-text-tertiary">{t('settings.general.themeDesc')}</p>
          </div>
          <Segmented
            value={theme}
            options={[
              {
                value: 'light',
                label: (
                  <>
                    <Sun size={13} /> {t('settings.general.themeLight')}
                  </>
                )
              },
              {
                value: 'dark',
                label: (
                  <>
                    <Moon size={13} /> {t('settings.general.themeDark')}
                  </>
                )
              },
              { value: 'system', label: t('settings.general.themeSystem') }
            ]}
            onChange={(v) => {
              const next = v as 'light' | 'dark' | 'system'
              useUi.getState().setTheme(next)
              pushThemeToFrames(next)
            }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border-light pt-3">
          <div>
            <p className="text-[13px] font-[475]">{t('settings.general.langTitle')}</p>
            <p className="text-[12px] text-text-tertiary">{t('settings.general.langDesc')}</p>
          </div>
          <Segmented
            value={locale}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' }
            ]}
            onChange={(v) => {
              const next = v as 'zh' | 'en'
              useUi.getState().setLocale(next)
              pushLocaleToFrames(next)
            }}
          />
        </div>
        {/* 设置页字体大小:存 localStorage,SettingsPage 根节点经 CSS zoom 响应式生效 */}
        <div className="mt-3 flex items-center justify-between border-t border-border-light pt-3">
          <div>
            <p className="text-[13px] font-[475]">{t('settings.general.zoomTitle')}</p>
            <p className="text-[12px] text-text-tertiary">{t('settings.general.zoomDesc')}</p>
          </div>
          <Segmented
            value={String(settingsZoom)}
            options={[
              { value: '90', label: t('settings.general.zoomSmaller') },
              { value: '100', label: t('settings.general.zoomStandard') },
              { value: '110', label: t('settings.general.zoomLarger') },
              { value: '125', label: t('settings.general.zoomLargest') }
            ]}
            onChange={(v) => useUi.getState().setSettingsZoom(Number(v))}
          />
        </div>
      </Card>

      <GroupLabel>{t('settings.general.groupMisc')}</GroupLabel>
      <Card>
        {/* 额度条刷新间隔:存 localStorage,QuotaStrip 响应式生效 */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-[475]">{t('settings.general.refreshTitle')}</p>
            <p className="text-[12px] text-text-tertiary">{t('settings.general.refreshDesc')}</p>
          </div>
          <Select
            className="w-[170px]"
            value={String(quotaRefreshSecs)}
            options={[
              { value: '30', label: t('settings.general.refreshOpt30s') },
              { value: '60', label: t('settings.general.refreshOpt1m') },
              { value: '120', label: t('settings.general.refreshOpt2m') },
              { value: '300', label: t('settings.general.refreshOpt5m') },
              { value: '0', label: t('settings.general.refreshOff') }
            ]}
            onChange={(v) => useUi.getState().setQuotaRefreshSecs(Number(v))}
          />
        </div>
      </Card>

      <GroupLabel>{t('settings.general.groupDiagnostics')}</GroupLabel>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-[475]">{t('settings.general.logsTitle')}</p>
            <p className="text-[12px] text-text-tertiary">
              {t('settings.general.logsDesc')}
            </p>
          </div>
          <button
            className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover"
            onClick={() => window.kimiApi.openLogs()}
          >
            {t('settings.general.logsOpen')}
          </button>
        </div>
      </Card>

      {pickingHome && (
        <FolderPickerDialog
          title={t('settings.general.pickHomeTitle')}
          subtitle={t('settings.general.pickHomeSubtitle')}
          confirmLabel={t('settings.general.pickHomeConfirm')}
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
