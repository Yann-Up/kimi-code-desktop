// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// 插件设置页(PluginsSettings):已安装列表 / 插件市场 / 从 URL 安装
export default {
  zh: {
    // 区块标题与描述
    'settings.plugins.title': '插件',
    'settings.plugins.desc':
      '管理 Kimi Code 插件(与 TUI /plugins 等效,经本机 kimi web 服务操作)\n插件变更需在会话中运行 /reload 或开新会话后生效',
    // 子 tab 与工具栏
    'settings.plugins.tabInstalled': '已安装',
    'settings.plugins.tabMarket': '插件市场',
    'settings.plugins.refresh': '刷新',
    // 加载 / 错误态
    'settings.plugins.needBackend': '插件管理需后端服务运行中(kimi web)',
    'settings.plugins.starting': '启动中…',
    'settings.plugins.startBackend': '启动后端服务',
    'settings.plugins.unsupported': '当前 CLI 版本不支持插件管理,请先升级 CLI(设置 → 常规)',
    'settings.plugins.loadFailed': '加载失败:{error}',
    'settings.plugins.loading': '加载中…',
    // 空态
    'settings.plugins.emptyInstalled': '尚未安装插件,可到「插件市场」或下方从 URL 安装',
    'settings.plugins.emptyMarket': '插件市场暂无条目',
    // 徽标
    'settings.plugins.badgeError': '异常',
    'settings.plugins.badgeDisabled': '已禁用',
    'settings.plugins.sourceLocal': '本地',
    'settings.plugins.tierOfficial': '官方',
    'settings.plugins.tierCurated': '精选',
    // 已安装列表操作
    'settings.plugins.clickEnable': '点击启用',
    'settings.plugins.clickDisable': '点击禁用',
    'settings.plugins.confirmRemove': '确认移除?',
    'settings.plugins.removeTitle': '移除(仅删安装记录,文件保留在磁盘)',
    // 操作反馈
    'settings.plugins.flashEnabled': '{name} 已启用(/reload 或新会话生效)',
    'settings.plugins.flashDisabled': '{name} 已禁用(/reload 或新会话生效)',
    'settings.plugins.opFailed': '操作失败:{error}',
    'settings.plugins.flashRemoved': '已移除 {name}(/reload 或新会话生效)',
    'settings.plugins.removeFailed': '移除失败:{error}',
    'settings.plugins.installDone': '安装完成(/reload 或新会话生效)',
    'settings.plugins.installFailed': '安装失败:{error}',
    // 能力摘要
    'settings.plugins.capSkills': '技能 {count}',
    'settings.plugins.capCommands': '命令 {count}',
    'settings.plugins.capHooks': '钩子 {count}',
    // 市场条目
    'settings.plugins.installedLabel': '已安装',
    'settings.plugins.installedDisabled': '(已禁用)',
    'settings.plugins.update': '更新',
    'settings.plugins.install': '安装',
    // 从 URL 安装
    'settings.plugins.fromUrlTitle': '从 URL 安装',
    'settings.plugins.fromUrlDesc':
      '支持 GitHub 仓库 URL(可带 /tree/<ref>、/releases/tag/<tag>、/commit/<sha>)、zip 包 URL、本地绝对路径',
    'settings.plugins.fromUrlPlaceholder':
      'https://github.com/owner/repo 或 https://…/plugin.zip 或 D:\\path\\to\\plugin',
    'settings.plugins.installing': '安装中…'
  } as Record<string, string>,
  en: {
    'settings.plugins.title': 'Plugins',
    'settings.plugins.desc':
      'Manage Kimi Code plugins (equivalent to TUI /plugins, via the local kimi web service)\nPlugin changes take effect after running /reload in a session or starting a new session',
    'settings.plugins.tabInstalled': 'Installed',
    'settings.plugins.tabMarket': 'Marketplace',
    'settings.plugins.refresh': 'Refresh',
    'settings.plugins.needBackend': 'Plugin management requires the backend service (kimi web) to be running',
    'settings.plugins.starting': 'Starting…',
    'settings.plugins.startBackend': 'Start Backend',
    'settings.plugins.unsupported':
      'The current CLI version does not support plugin management. Please upgrade the CLI first (Settings → General)',
    'settings.plugins.loadFailed': 'Load failed: {error}',
    'settings.plugins.loading': 'Loading…',
    'settings.plugins.emptyInstalled':
      'No plugins installed yet. Install one from the Marketplace or from a URL below',
    'settings.plugins.emptyMarket': 'No entries in the marketplace yet',
    'settings.plugins.badgeError': 'Error',
    'settings.plugins.badgeDisabled': 'Disabled',
    'settings.plugins.sourceLocal': 'Local',
    'settings.plugins.tierOfficial': 'Official',
    'settings.plugins.tierCurated': 'Curated',
    'settings.plugins.clickEnable': 'Click to enable',
    'settings.plugins.clickDisable': 'Click to disable',
    'settings.plugins.confirmRemove': 'Confirm removal?',
    'settings.plugins.removeTitle': 'Remove (only deletes the install record; files stay on disk)',
    'settings.plugins.flashEnabled': '{name} enabled (takes effect after /reload or a new session)',
    'settings.plugins.flashDisabled': '{name} disabled (takes effect after /reload or a new session)',
    'settings.plugins.opFailed': 'Operation failed: {error}',
    'settings.plugins.flashRemoved': 'Removed {name} (takes effect after /reload or a new session)',
    'settings.plugins.removeFailed': 'Remove failed: {error}',
    'settings.plugins.installDone': 'Installed (takes effect after /reload or a new session)',
    'settings.plugins.installFailed': 'Install failed: {error}',
    'settings.plugins.capSkills': '{count} skills',
    'settings.plugins.capCommands': '{count} commands',
    'settings.plugins.capHooks': '{count} hooks',
    'settings.plugins.installedLabel': 'Installed',
    'settings.plugins.installedDisabled': ' (disabled)',
    'settings.plugins.update': 'Update',
    'settings.plugins.install': 'Install',
    'settings.plugins.fromUrlTitle': 'Install from URL',
    'settings.plugins.fromUrlDesc':
      'Supports GitHub repo URLs (optionally with /tree/<ref>, /releases/tag/<tag>, /commit/<sha>), zip URLs, and local absolute paths',
    'settings.plugins.fromUrlPlaceholder':
      'https://github.com/owner/repo or https://…/plugin.zip or D:\\path\\to\\plugin',
    'settings.plugins.installing': 'Installing…'
  } as Record<string, string>
}
