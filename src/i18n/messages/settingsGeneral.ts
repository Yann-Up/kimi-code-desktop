// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// 设置→常规页(GeneralSettings):服务信息卡片、CLI 升级、数据目录、Web 服务端口、应用更新卡片等
export default {
  zh: {
    // 页面描述与分组
    'settings.general.pageDesc': '应用与 Kimi Code CLI 的基本信息',
    'settings.general.groupVersion': '版本',
    'settings.general.groupAppUpdate': '应用更新',
    'settings.general.groupStorage': '存储位置',
    'settings.general.groupCli': 'CLI 程序',
    'settings.general.groupLocalService': '本地服务',
    'settings.general.groupServiceArgs': '服务启动参数',
    'settings.general.groupUi': '界面',
    'settings.general.groupMisc': '其他',
    'settings.general.groupDiagnostics': '诊断',
    // 来源徽章(数据目录 / CLI 共用 custom|env)
    'settings.general.srcCustom': '自定义',
    'settings.general.srcEnv': '环境变量',
    'settings.general.srcDefault': '默认',
    'settings.general.srcRemote': '远端',
    'settings.general.cliSrcHome': '官方脚本安装',
    'settings.general.cliSrcPath': 'PATH(npm 等)',
    'settings.general.cliSrcAuto': '自动探测',
    // 版本卡片
    'settings.general.appVersionLabel': '桌面应用版本',
    // 通用按钮
    'settings.general.checking': '检查中…',
    'settings.general.checkUpdate': '检查更新',
    'settings.general.resetDefault': '恢复默认',
    'settings.general.switching': '切换中…',
    'settings.general.cancel': '取消',
    'settings.general.edit': '修改',
    'settings.general.save': '保存',
    'settings.general.saving': '保存中…',
    // 应用更新卡片
    'settings.general.appUpdateTitle': '桌面应用更新',
    'settings.general.appNewVersion': '新版本 v{version}',
    'settings.general.appUpdateDescPre': '当前版本',
    'settings.general.appUpdateDescPost':
      ';检查 GitHub Releases 上的新版本,更新包经签名校验,下载完成后自动安装并重启',
    'settings.general.appLatest': '已是最新版本',
    'settings.general.appUpdateGone': '更新已不可用,请重新检查',
    'settings.general.downloading': '下载中…',
    'settings.general.downloadAndRestart': '下载并重启更新',
    'settings.general.appProgressTotal': '已下载 {downloaded} / {total} MB,完成后将自动安装并重启',
    'settings.general.appProgressNoTotal': '已下载 {downloaded} MB,完成后将自动安装并重启',
    // 数据目录卡片
    'settings.general.dataDirTitle': 'Kimi Code 数据目录',
    'settings.general.dataDirDesc':
      '会话、配置、插件等数据的存放位置(默认在 C 盘用户目录);切换将重启本地服务并重新加载',
    // CLI 程序卡片
    'settings.general.cliExecutable': 'Kimi Code CLI 可执行文件',
    'settings.general.cliDescLocal':
      '应用内一键升级仅适用于官方脚本安装;npm/自定义安装可直接点右侧"npm 升级"(等价 npm update -g)。切换将重启本地服务',
    'settings.general.cliDescRemote':
      'CLI 在远端环境({target})运行;升级按安装方式自动选择官方安装脚本或 npm update -g,完成后重启服务',
    'settings.general.npmUpgrade': 'npm 升级',
    'settings.general.upgrading': '升级中…',
    'settings.general.upgradeCli': '升级 CLI',
    'settings.general.cliPlaceholderLocal':
      'CLI 路径,如 D:\\Env\\nodejs\\kimi.cmd(npm 全局)或 C:\\...\\kimi.exe',
    'settings.general.cliPlaceholderRemote': '远端绝对路径,如 /home/user/.kimi-code/bin/kimi',
    'settings.general.cliNewVersion': '发现新版本 v{latest}(当前 v{current}),可点击右侧升级',
    'settings.general.cliUnknown': '未知',
    'settings.general.cliLatest': '已是最新版本(v{latest})',
    // 本地服务卡片
    'settings.general.svcTitle': 'kimi web 服务',
    'settings.general.svcRunning': '运行中',
    'settings.general.svcStopped': '未启动',
    'settings.general.svcDesc': '停止后对话页不可用;会话状态由 CLI 持久化,重连后恢复',
    'settings.general.svcPort': '本地服务端口',
    'settings.general.svcBusy': '处理中…',
    'settings.general.svcStop': '停止服务',
    'settings.general.svcStart': '启动服务',
    // 启动自动拉起开关(本地服务卡片内)
    'settings.general.autoStartTitle': '启动应用时自动拉起服务',
    'settings.general.autoStartDesc': '打开应用后自动启动激活通道的 Kimi Code 服务;关闭后需在对话页手动启动',
    // 服务启动参数卡片
    'settings.general.portTitle': '服务端口',
    'settings.general.portDesc':
      'kimi web 绑定的首选端口(默认 58666);被占用时自动顺延,保存后运行中的服务会自动重启',
    'settings.general.portInvalid': '端口需为 1-65535 的数字',
    'settings.general.portSavedRestart': '已保存,运行中的服务已自动重启生效',
    'settings.general.portSavedNext': '已保存,下次启动服务时生效',
    // 界面卡片
    'settings.general.themeTitle': '主题',
    'settings.general.themeDesc': '对话页无刷新跟随;跟随系统按系统明暗自动切换',
    'settings.general.themeLight': '月之亮面',
    'settings.general.themeDark': '月之暗面',
    'settings.general.themeSystem': '跟随系统',
    'settings.general.langTitle': '语言',
    'settings.general.langDesc': '自定义页面即时生效;对话页下次加载后跟随',
    'settings.general.zoomTitle': '设置页字体大小',
    'settings.general.zoomDesc': '整体缩放设置页的字体与控件(立即生效,仅影响设置页)',
    'settings.general.zoomSmaller': '较小',
    'settings.general.zoomStandard': '标准',
    'settings.general.zoomLarger': '较大',
    'settings.general.zoomLargest': '特大',
    // 其他卡片
    'settings.general.refreshTitle': '额度条刷新间隔',
    'settings.general.refreshDesc': '顶部额度/余额的自动刷新频率(每轮对话结束也会立即刷新)',
    'settings.general.refreshOpt30s': '30 秒',
    'settings.general.refreshOpt1m': '1 分钟(默认)',
    'settings.general.refreshOpt2m': '2 分钟',
    'settings.general.refreshOpt5m': '5 分钟',
    'settings.general.refreshOff': '关闭自动刷新',
    // 诊断卡片
    'settings.general.logsTitle': '运行日志',
    'settings.general.logsDesc': 'WS 事件流日志默认开启(ws.log),遇到渲染/连接问题请把日志发给开发者',
    'settings.general.logsOpen': '打开日志目录',
    // 数据目录选择对话框
    'settings.general.pickHomeTitle': '选择数据目录',
    'settings.general.pickHomeSubtitle': 'Kimi Code 的会话与配置数据将存放在此',
    'settings.general.pickHomeConfirm': '设为数据目录'
  } as Record<string, string>,
  en: {
    'settings.general.pageDesc': 'Basic information about the app and Kimi Code CLI',
    'settings.general.groupVersion': 'Version',
    'settings.general.groupAppUpdate': 'App Update',
    'settings.general.groupStorage': 'Storage Location',
    'settings.general.groupCli': 'CLI Program',
    'settings.general.groupLocalService': 'Local Service',
    'settings.general.groupServiceArgs': 'Service Startup Options',
    'settings.general.groupUi': 'Interface',
    'settings.general.groupMisc': 'Miscellaneous',
    'settings.general.groupDiagnostics': 'Diagnostics',
    'settings.general.srcCustom': 'Custom',
    'settings.general.srcEnv': 'Env Variable',
    'settings.general.srcDefault': 'Default',
    'settings.general.srcRemote': 'Remote',
    'settings.general.cliSrcHome': 'Official Installer',
    'settings.general.cliSrcPath': 'PATH (npm etc.)',
    'settings.general.cliSrcAuto': 'Auto-detected',
    'settings.general.appVersionLabel': 'Desktop App Version',
    'settings.general.checking': 'Checking…',
    'settings.general.checkUpdate': 'Check for Updates',
    'settings.general.resetDefault': 'Reset to Default',
    'settings.general.switching': 'Switching…',
    'settings.general.cancel': 'Cancel',
    'settings.general.edit': 'Edit',
    'settings.general.save': 'Save',
    'settings.general.saving': 'Saving…',
    'settings.general.appUpdateTitle': 'Desktop App Update',
    'settings.general.appNewVersion': 'New version v{version}',
    'settings.general.appUpdateDescPre': 'Current version',
    'settings.general.appUpdateDescPost':
      '; checks GitHub Releases for new versions. Update packages are signature-verified and installed automatically after download, followed by a restart',
    'settings.general.appLatest': 'Already up to date',
    'settings.general.appUpdateGone': 'Update no longer available, please check again',
    'settings.general.downloading': 'Downloading…',
    'settings.general.downloadAndRestart': 'Download & Restart to Update',
    'settings.general.appProgressTotal':
      'Downloaded {downloaded} / {total} MB; will install and restart automatically when complete',
    'settings.general.appProgressNoTotal':
      'Downloaded {downloaded} MB; will install and restart automatically when complete',
    'settings.general.dataDirTitle': 'Kimi Code Data Directory',
    'settings.general.dataDirDesc':
      'Where sessions, config, plugins and other data are stored (defaults to the user directory on drive C:); switching restarts the local service and reloads',
    'settings.general.cliExecutable': 'Kimi Code CLI Executable',
    'settings.general.cliDescLocal':
      'In-app one-click upgrade only works for official-script installs; npm/custom installs can use "npm Upgrade" on the right (equivalent to npm update -g). Switching restarts the local service',
    'settings.general.cliDescRemote':
      'The CLI runs in the remote environment ({target}); upgrade picks the official install script or npm update -g based on the install method, then restarts the service',
    'settings.general.npmUpgrade': 'npm Upgrade',
    'settings.general.upgrading': 'Upgrading…',
    'settings.general.upgradeCli': 'Upgrade CLI',
    'settings.general.cliPlaceholderLocal':
      'CLI path, e.g. D:\\Env\\nodejs\\kimi.cmd (npm global) or C:\\...\\kimi.exe',
    'settings.general.cliPlaceholderRemote': 'Remote absolute path, e.g. /home/user/.kimi-code/bin/kimi',
    'settings.general.cliNewVersion':
      'New version v{latest} available (current v{current}); click upgrade on the right',
    'settings.general.cliUnknown': 'unknown',
    'settings.general.cliLatest': 'Already on the latest version (v{latest})',
    'settings.general.svcTitle': 'kimi web Service',
    'settings.general.svcRunning': 'Running',
    'settings.general.svcStopped': 'Not Running',
    'settings.general.svcDesc':
      'Chat page is unavailable while stopped; session state is persisted by the CLI and restored on reconnect',
    'settings.general.svcPort': 'Local service port',
    'settings.general.svcBusy': 'Working…',
    'settings.general.svcStop': 'Stop Service',
    'settings.general.svcStart': 'Start Service',
    'settings.general.autoStartTitle': 'Auto-start service on launch',
    'settings.general.autoStartDesc':
      'Automatically start the Kimi Code service of the active channel when the app opens; when off, start it manually from the chat page',
    'settings.general.portTitle': 'Service Port',
    'settings.general.portDesc':
      'Preferred port kimi web binds to (default 58666); automatically increments when occupied, and saving restarts the running service',
    'settings.general.portInvalid': 'Port must be a number between 1 and 65535',
    'settings.general.portSavedRestart': 'Saved; the running service has been restarted automatically',
    'settings.general.portSavedNext': 'Saved; takes effect the next time the service starts',
    'settings.general.themeTitle': 'Theme',
    'settings.general.themeDesc':
      'The chat page follows without reload; System follows your OS appearance',
    'settings.general.themeLight': 'Light',
    'settings.general.themeDark': 'Dark',
    'settings.general.themeSystem': 'System',
    'settings.general.langTitle': 'Language',
    'settings.general.langDesc':
      'Custom pages switch immediately; the chat page follows on its next load',
    'settings.general.zoomTitle': 'Settings Font Size',
    'settings.general.zoomDesc':
      'Scales fonts and controls on the settings page (applies immediately, settings page only)',
    'settings.general.zoomSmaller': 'Small',
    'settings.general.zoomStandard': 'Standard',
    'settings.general.zoomLarger': 'Large',
    'settings.general.zoomLargest': 'Extra Large',
    'settings.general.refreshTitle': 'Quota Bar Refresh Interval',
    'settings.general.refreshDesc':
      'Auto-refresh frequency for the quota/balance bar at the top (also refreshes immediately after each conversation turn)',
    'settings.general.refreshOpt30s': '30 seconds',
    'settings.general.refreshOpt1m': '1 minute (default)',
    'settings.general.refreshOpt2m': '2 minutes',
    'settings.general.refreshOpt5m': '5 minutes',
    'settings.general.refreshOff': 'Disable Auto-refresh',
    'settings.general.logsTitle': 'Runtime Logs',
    'settings.general.logsDesc':
      'WS event stream logging is on by default (ws.log); send the logs to the developer when you hit rendering/connection issues',
    'settings.general.logsOpen': 'Open Logs Folder',
    'settings.general.pickHomeTitle': 'Select Data Directory',
    'settings.general.pickHomeSubtitle': 'Kimi Code sessions and configuration data will be stored here',
    'settings.general.pickHomeConfirm': 'Set as Data Directory'
  } as Record<string, string>
}
