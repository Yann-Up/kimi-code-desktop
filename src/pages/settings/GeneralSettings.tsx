import { useEffect, useState } from 'react'
import { Section, Card, GroupLabel } from '../../components/settings/common'
import { FolderPickerDialog } from '../../components/FolderPickerDialog'
import type {
  AppUpdateProgress,
  ConnectionTargetInfo,
  WebServerOptions
} from '../../platform/kimi-api'
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
  return (
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
          <p className="mt-1 text-[12px] text-text-tertiary">{description}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
            disabled={checking || upgrade.busy || switching}
            onClick={onCheck}
          >
            {checking ? '检查中…' : '检查更新'}
          </button>
          {upgrade.visible && (
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
              disabled={upgrade.busy || switching}
              onClick={upgrade.onUpgrade}
            >
              {upgrade.busy ? upgrade.busyLabel : upgrade.label}
            </button>
          )}
          {cliInfo?.source === 'custom' && (
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
              disabled={switching}
              onClick={onReset}
            >
              恢复默认
            </button>
          )}
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
            disabled={switching}
            onClick={onToggleEditing}
          >
            {switching ? '切换中…' : editing ? '取消' : '修改'}
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-text-tertiary"
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
            保存
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
  // 应用自身更新(桌面应用,区别于下方 CLI 升级);结果存全局 store,
  // 启动静默自检先于本页打开时也能直接展示
  const appUpdate = useUi((s) => s.appUpdate)
  const [appChecking, setAppChecking] = useState(false)
  const [appMsg, setAppMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [appInstalling, setAppInstalling] = useState(false)
  const [appProgress, setAppProgress] = useState<AppUpdateProgress | null>(null)
  // 本页所有服务信息/事件跟随激活通道:切换通道后重探
  const activeChannel = useUi((s) => s.activeChannel)

  useEffect(() => window.kimiApi.onAppUpdateProgress(setAppProgress), [])

  /** 手动检查应用更新(GitHub Releases);结果写全局 store,错误就地展示 */
  const checkAppUpdate = () => {
    setAppChecking(true)
    setAppMsg(null)
    window.kimiApi
      .appUpdateCheck()
      .then((r) => {
        useUi.getState().setAppUpdate(r)
        if (!r) setAppMsg({ ok: true, text: '已是最新版本' })
      })
      .catch((e) => setAppMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setAppChecking(false))
  }

  /** 下载并安装应用更新:成功安装时进程被安装器接管重启,正常 resolve 意味着
   *  重新检查时更新已不存在(Release 被撤回等),需复位状态提示用户 */
  const installAppUpdate = () => {
    setAppInstalling(true)
    setAppMsg(null)
    setAppProgress(null)
    window.kimiApi
      .appUpdateInstall()
      .then(() => {
        setAppInstalling(false)
        setAppMsg({ ok: false, text: '更新已不可用,请重新检查' })
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
            ? { ok: false, text: `发现新版本 v${r.latest}(当前 v${r.current ?? '未知'}),可点击右侧升级` }
            : { ok: true, text: `已是最新版本(v${r.latest})` }
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
      setWebMsg({ ok: false, text: '端口需为 1-65535 的数字' })
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
        text: svcRunning ? '已保存,运行中的服务已自动重启生效' : '已保存,下次启动服务时生效'
      })
    } catch (e) {
      setWebMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setWebSaving(false)
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
            {/* cliInfo 来自本地探测(kimi --version),不依赖服务运行 */}
            <span className="font-mono">{cliInfo?.version ?? '—'}</span>
          </div>
        </div>
      </Card>

      {/* 应用自身更新:GitHub Releases 通道;启动时静默自检,此处手动检查与执行更新 */}
      <GroupLabel>应用更新</GroupLabel>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">
              桌面应用更新
              {appUpdate && (
                <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-[11px] text-success">
                  新版本 v{appUpdate.version}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-text-tertiary">
              当前版本 <span className="font-mono">{info?.appVersion ?? '—'}</span>
              ;检查 GitHub Releases 上的新版本,更新包经签名校验,下载完成后自动安装并重启
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
              disabled={appChecking || appInstalling}
              onClick={checkAppUpdate}
            >
              {appChecking ? '检查中…' : '检查更新'}
            </button>
            {appUpdate && (
              <button
                className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                disabled={appInstalling}
                onClick={installAppUpdate}
              >
                {appInstalling ? '下载中…' : '下载并重启更新'}
              </button>
            )}
          </div>
        </div>
        {appUpdate?.notes && (
          <p className="mt-2 whitespace-pre-wrap text-[12px] text-text-secondary">{appUpdate.notes}</p>
        )}
        {appInstalling && appProgress && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
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
                ? `已下载 ${(appProgress.downloaded / 1024 / 1024).toFixed(1)} / ${(appProgress.total / 1024 / 1024).toFixed(1)} MB`
                : `已下载 ${(appProgress.downloaded / 1024 / 1024).toFixed(1)} MB`}
              ,完成后将自动安装并重启
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
          <CliSourceCard
            cliInfo={cliInfo}
            description={'应用内一键升级仅适用于官方脚本安装;npm/自定义安装可直接点右侧"npm 升级"(等价 npm update -g)。切换将重启本地服务'}
            checking={cliChecking}
            onCheck={checkCliUpdate}
            upgrade={{
              visible: !!cliInfo && cliInfo.source !== 'home',
              label: 'npm 升级',
              busyLabel: '升级中…',
              busy: npmUpgrading,
              onUpgrade: () => {
                setNpmUpgrading(true)
                setCliError('')
                window.kimiApi
                  .cliNpmUpgrade()
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
            placeholder="CLI 路径,如 D:\Env\nodejs\kimi.cmd(npm 全局)或 C:\...\kimi.exe"
            onSavePath={(p) => void switchCli(p)}
            error={cliError}
            checkMsg={cliCheckMsg}
          />
        ) : (
          <CliSourceCard
            cliInfo={cliInfo}
            description={`CLI 在远端环境(${connInfo?.describe ?? 'WSL/SSH'})运行;升级按安装方式自动选择官方安装脚本或 npm update -g,完成后重启服务`}
            checking={cliChecking}
            onCheck={checkCliUpdate}
            upgrade={{
              visible: true,
              label: '升级 CLI',
              busyLabel: '升级中…',
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
            placeholder="远端绝对路径,如 /home/user/.kimi-code/bin/kimi"
            onSavePath={(p) => void switchRemoteCli(p)}
            error={cliError}
            checkMsg={cliCheckMsg}
          />
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
              停止后对话页不可用;会话状态由 CLI 持久化,重连后恢复
            </p>
            {/* 端口只有服务运行时才存在(server_info),故放在本卡片而不是版本卡片 */}
            {svcRunning && info?.port && (
              <p className="mt-1 text-[12px] text-text-tertiary">
                本地服务端口 <span className="font-mono text-text-secondary">{info.port}</span>
              </p>
            )}
          </div>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-tertiary disabled:opacity-50"
            disabled={svcBusy || svcRunning === null}
            onClick={() => void toggleService()}
          >
            {svcBusy ? '处理中…' : svcRunning ? '停止服务' : '启动服务'}
          </button>
        </div>
      </Card>

      <GroupLabel>服务启动参数</GroupLabel>
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">服务端口</p>
              <p className="mt-0.5 text-[12px] text-text-tertiary">
                kimi web 绑定的首选端口(默认 58666);被占用时自动顺延,保存后运行中的服务会自动重启
              </p>
            </div>
            <input
              className="w-28 shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none disabled:opacity-50"
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
              {webSaving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </Card>

      <GroupLabel>界面</GroupLabel>
      <Card>
        {/* 设置页字体大小:存 localStorage,SettingsPage 根节点经 CSS zoom 响应式生效 */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13.5px] font-medium">设置页字体大小</p>
            <p className="text-[12px] text-text-tertiary">整体缩放设置页的字体与控件(立即生效,仅影响设置页)</p>
          </div>
          <select
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none"
            value={settingsZoom}
            onChange={(e) => useUi.getState().setSettingsZoom(Number(e.target.value))}
          >
            <option value={90}>较小(90%)</option>
            <option value={100}>标准(100%,默认)</option>
            <option value={110}>较大(110%)</option>
            <option value={125}>特大(125%)</option>
          </select>
        </div>
      </Card>

      <GroupLabel>其他</GroupLabel>
      <Card>
        {/* 额度条刷新间隔:存 localStorage,QuotaStrip 响应式生效 */}
        <div className="flex items-center justify-between">
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
