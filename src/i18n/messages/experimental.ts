// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// 实验性设置:CLI 实验性开关(CliExperimentalSettings)+ 桌面实验性(DesktopExperimentalSettings)
export default {
  zh: {
    // 两页共用的区块标题
    'settings.exp.title': '实验性功能',
    // CLI 实验性功能页
    'settings.cliExp.desc':
      '官方 CLI 的实验性特性开关(部分特性 CLI 默认开启,可在此关闭);经环境变量在启动服务时注入,切换后需重启服务生效(运行中会自动重启)',
    'settings.cliExp.groupToggles': '功能开关',
    'settings.cliExp.loading': '加载中…',
    'settings.cliExp.savedOk': '已保存;服务运行中时已自动重启,未启动则下次启动生效',
    'settings.cliExp.saveFailed': '保存失败:{error}',
    'settings.cliExp.footnote':
      '实验性功能可能不稳定,随 CLI 版本可能更名或移除;如遇异常可回到本页关闭对应开关',
    // 特性清单(与 FEATURES 注册表一一对应)
    'settings.cliExp.f.master.label': '实验性功能总开关',
    'settings.cliExp.f.master.desc':
      '启用当前 CLI 版本注册的全部实验性功能;风险最高,建议只开下面的单项',
    'settings.cliExp.f.secondaryModel.label': '二级模型(子代理)',
    'settings.cliExp.f.secondaryModel.desc':
      '开启后新派生的子代理(Agent / AgentSwarm)默认绑定二级模型,而不是继承主代理模型;桌面端此前一直默认开启',
    'settings.cliExp.f.toolSelect.label': '渐进式工具披露(tool-select)',
    'settings.cliExp.f.toolSelect.desc':
      'MCP 等工具 schema 不再塞进顶层 tools[],模型经 select_tools 按需加载;缩小系统提示词、提升 prompt 缓存命中(需模型支持动态加载工具)',
    'settings.cliExp.f.sessionTitle.label': 'AI 会话标题',
    'settings.cliExp.f.sessionTitle.desc':
      '首轮对话结束后自动生成简洁的会话标题,重命名时也可按需重新生成',
    'settings.cliExp.f.searchWorker.label': '搜索索引 worker 线程',
    'settings.cliExp.f.searchWorker.desc':
      '全局搜索索引(MiniDB 打开/同步/查询)放到独立 worker 线程运行,避免阻塞主线程;CLI 默认开启,可在此关闭',
    'settings.cliExp.f.subagentFork.label': '子代理上下文快照(subagent-fork)',
    'settings.cliExp.f.subagentFork.desc':
      'Agent / AgentSwarm 派生子代理时携带调用方的上下文快照,而不是全新空白上下文',
    'settings.cliExp.f.tower.label': 'tower 模式',
    'settings.cliExp.f.tower.desc':
      '协调多个 agent 围绕同一目标协作(tower mode)。注意:CLI 0.39.0 的 Web UI 尚无 /tower 入口,开启后目前只能在终端 TUI 里用(KIMI_CODE_EXPERIMENTAL_TOWER=1 kimi,然后 /tower on)',
    'settings.cliExp.f.waitFor.label': 'WaitFor 工具',
    'settings.cliExp.f.waitFor.desc':
      '模型可在当前轮内等待后台任务完成(WaitFor);CLI 默认开启,可在此关闭',
    'settings.cliExp.f.minidbRead.label': 'minidb 读模型',
    'settings.cliExp.f.minidbRead.desc':
      '会话索引与 wire 回放改用 minidb 派生的只读查询存储;CLI 默认开启,可在此关闭',
    'settings.cliExp.f.remoteControl.label': '远程控制(Remote Control)',
    'settings.cliExp.f.remoteControl.desc':
      '把本机 Web UI 经官方中继(code-rc.kimi.com)暴露到公网链接,可从手机/其他电脑操作本机 agent;开启后启动服务自动附加 --remote-control。需 CLI ≥ 0.39.0 且已登录 Kimi 账号(未登录会启动失败);持有链接的人等同于拥有本机操作权限,请勿分享;全机同一时间只允许一个 RC 实例',
    // Remote Control 访问链接面板
    'settings.cliExp.rcWaiting':
      '等待 Remote Control 就绪…服务重启并向中继注册后此处显示访问链接;若长时间无链接,请确认 CLI ≥ 0.39.0 且已登录 Kimi 账号',
    'settings.cliExp.rcCopied': '已复制',
    'settings.cliExp.rcCopy': '复制链接',
    'settings.cliExp.rcRefresh': '刷新',
    'settings.cliExp.rcNote':
      '手机扫码或在其他电脑浏览器打开链接,登录 Kimi 账号后即可远程操作本机 agent;链接含完整操作权限,请勿分享',
    // 桌面实验性功能页
    'settings.deskExp.desc':
      '桌面端自身的实验性特性,可能不稳定,后续版本可能调整或移除;如遇异常关闭对应开关即可',
    'settings.deskExp.pet': '桌宠',
    'settings.deskExp.petDesc':
      '在桌面悬浮一只宠物,随 Kimi Code 任务状态切换动作(左键拖动)',
    'settings.deskExp.petAvatar': '宠物形象',
    'settings.deskExp.petScanDesc':
      '外部宠物扫描自应用数据目录的 pets/(导入的宠物存这里)、kimi-code 数据目录与 ~/.petdex/pets/(需含 pet.json 与精灵图);切换即时生效',
    'settings.deskExp.petImportDesc':
      '导入 zip 时,目录名与显示名优先取 pet.json 的 slug/id/displayName/name 字段,这些字段都没有时才用 zip 文件名',
    'settings.deskExp.importZip': '导入 zip',
    'settings.deskExp.petTooLarge': '宠物包过大(上限 32MB)',
    'settings.deskExp.clickThrough': '点击穿透',
    'settings.deskExp.clickThroughDesc':
      '开启后鼠标直接穿过桌宠(无法拖动或右键),需回本页关闭',
    'settings.deskExp.wander': '闲置时四处走动',
    'settings.deskExp.wanderDesc': '空闲时宠物会在屏幕上随机溜达,来活了就停下',
    'settings.deskExp.skin': '皮肤',
    'settings.deskExp.standee': '背景立绘',
    'settings.deskExp.standeeDesc':
      '在主页、统计、设置页右侧显示内置立绘(对话页不生效)',
    'settings.deskExp.skinAvatar': '皮肤形象',
    'settings.deskExp.skinDirPre':
      '除内置皮肤外,也可把自己的图片(png/webp/jpg)放进皮肤目录使用,',
    'settings.deskExp.skinDirLink': '打开皮肤目录',
    'settings.deskExp.skinDirPost': ';放入后重开本页即可选择',
    'settings.deskExp.customSuffix': '(自选)',
    'settings.deskExp.opacity': '卡片不透明度',
    'settings.deskExp.opacityDesc':
      '数值越低,立绘从卡片下透出越明显(30% - 100%)',
    'settings.deskExp.inChat': '对话页内显示立绘',
    'settings.deskExp.inChatDesc':
      '在对话窗口(官方 web UI)右下角叠加显示当前皮肤立绘',
    'settings.deskExp.bridge': '页面桥接',
    'settings.deskExp.bridgeTitle': '官方页面桥接',
    'settings.deskExp.bridgeDesc':
      '皮肤立绘、主题/语言跟随依赖注入官方 web UI 的桥接脚本',
    'settings.deskExp.bridgeNone': '未连接(对话服务未启动)',
    'settings.deskExp.bridgeOk': '正常',
    'settings.deskExp.bridgeDegraded': '降级:官方主题契约缺失(官方可能已改版)'
  } as Record<string, string>,
  en: {
    'settings.exp.title': 'Experimental Features',
    'settings.cliExp.desc':
      'Toggles for the official CLI experimental features (some are enabled by default in the CLI and can be disabled here); injected as environment variables when the service starts, a restart is required to apply (auto-restarts while running)',
    'settings.cliExp.groupToggles': 'Feature Toggles',
    'settings.cliExp.loading': 'Loading…',
    'settings.cliExp.savedOk':
      'Saved. If the service was running it has been restarted automatically; otherwise it takes effect on next start',
    'settings.cliExp.saveFailed': 'Save failed: {error}',
    'settings.cliExp.footnote':
      'Experimental features may be unstable and may be renamed or removed with CLI versions; if something goes wrong, come back here and turn off the toggle',
    'settings.cliExp.f.master.label': 'Master Experimental Switch',
    'settings.cliExp.f.master.desc':
      'Enables all experimental features registered in the current CLI version; highest risk — enabling individual items below is recommended',
    'settings.cliExp.f.secondaryModel.label': 'Secondary Model (Subagents)',
    'settings.cliExp.f.secondaryModel.desc':
      'New subagents (Agent / AgentSwarm) bind to the secondary model by default instead of inheriting the main agent model; the desktop app previously kept this on',
    'settings.cliExp.f.toolSelect.label': 'Progressive Tool Disclosure (tool-select)',
    'settings.cliExp.f.toolSelect.desc':
      'Tool schemas such as MCP are no longer packed into the top-level tools[]; the model loads them on demand via select_tools, shrinking the system prompt and improving prompt-cache hits (requires a model that supports dynamic tool loading)',
    'settings.cliExp.f.sessionTitle.label': 'AI Session Titles',
    'settings.cliExp.f.sessionTitle.desc':
      'Automatically generates a concise session title after the first turn; can also regenerate on demand when renaming',
    'settings.cliExp.f.searchWorker.label': 'Search Index Worker Thread',
    'settings.cliExp.f.searchWorker.desc':
      'Runs the global search index (MiniDB open/sync/query) on a separate worker thread to avoid blocking the main thread; enabled by default in the CLI, can be disabled here',
    'settings.cliExp.f.subagentFork.label': 'Subagent Context Snapshot (subagent-fork)',
    'settings.cliExp.f.subagentFork.desc':
      "Agent / AgentSwarm fork subagents with the caller's context snapshot instead of a fresh blank context",
    'settings.cliExp.f.tower.label': 'tower mode',
    'settings.cliExp.f.tower.desc':
      'Coordinates multiple agents collaborating around the same goal (tower mode). Note: the CLI 0.39.0 Web UI has no /tower entry yet; once enabled it can only be used in the terminal TUI for now (KIMI_CODE_EXPERIMENTAL_TOWER=1 kimi, then /tower on)',
    'settings.cliExp.f.waitFor.label': 'WaitFor Tool',
    'settings.cliExp.f.waitFor.desc':
      'The model can wait for background tasks to finish within the current turn (WaitFor); enabled by default in the CLI, can be disabled here',
    'settings.cliExp.f.minidbRead.label': 'minidb Read Model',
    'settings.cliExp.f.minidbRead.desc':
      'Session index and wire replay switch to a minidb-derived read-only query store; enabled by default in the CLI, can be disabled here',
    'settings.cliExp.f.remoteControl.label': 'Remote Control',
    'settings.cliExp.f.remoteControl.desc':
      'Exposes the local Web UI to a public link via the official relay (code-rc.kimi.com), so you can operate the local agent from a phone or another computer; when enabled, the service starts with --remote-control automatically. Requires CLI ≥ 0.39.0 and a signed-in Kimi account (startup fails otherwise); anyone holding the link has full control of this machine — do not share it; only one RC instance is allowed per machine at a time',
    'settings.cliExp.rcWaiting':
      'Waiting for Remote Control… the access link appears here after the service restarts and registers with the relay; if no link shows up for a long time, make sure CLI ≥ 0.39.0 and a Kimi account is signed in',
    'settings.cliExp.rcCopied': 'Copied',
    'settings.cliExp.rcCopy': 'Copy Link',
    'settings.cliExp.rcRefresh': 'Refresh',
    'settings.cliExp.rcNote':
      'Scan the QR code with a phone or open the link in a browser on another computer, then sign in to your Kimi account to operate the local agent remotely; the link grants full control — do not share it',
    'settings.deskExp.desc':
      'Experimental features of the desktop shell itself; may be unstable and may change or be removed in future versions — just turn off the toggle if something goes wrong',
    'settings.deskExp.pet': 'Desktop Pet',
    'settings.deskExp.petDesc':
      'Floats a pet on the desktop that switches its animation with Kimi Code task status (drag with the left mouse button)',
    'settings.deskExp.petAvatar': 'Pet Appearance',
    'settings.deskExp.petScanDesc':
      'External pets are scanned from the app data directory pets/ (imported pets are stored here), the kimi-code data directory, and ~/.petdex/pets/ (must contain pet.json and a sprite sheet); switching takes effect immediately',
    'settings.deskExp.petImportDesc':
      'When importing a zip, the directory name and display name prefer the slug/id/displayName/name fields of pet.json; the zip file name is used only when none of these exist',
    'settings.deskExp.importZip': 'Import zip',
    'settings.deskExp.petTooLarge': 'Pet package too large (32 MB limit)',
    'settings.deskExp.clickThrough': 'Click-Through',
    'settings.deskExp.clickThroughDesc':
      'When enabled, the mouse passes through the pet (no dragging or right-click); come back to this page to turn it off',
    'settings.deskExp.wander': 'Wander When Idle',
    'settings.deskExp.wanderDesc':
      'The pet roams around the screen when idle and stops when there is work',
    'settings.deskExp.skin': 'Skin',
    'settings.deskExp.standee': 'Background Standee',
    'settings.deskExp.standeeDesc':
      'Shows a built-in standee on the right side of the home, stats, and settings pages (not on the chat page)',
    'settings.deskExp.skinAvatar': 'Skin',
    'settings.deskExp.skinDirPre':
      'Besides the built-in skins, you can put your own images (png/webp/jpg) into the skin directory: ',
    'settings.deskExp.skinDirLink': 'Open Skin Directory',
    'settings.deskExp.skinDirPost': '; reopen this page after adding files to select them',
    'settings.deskExp.customSuffix': ' (custom)',
    'settings.deskExp.opacity': 'Card Opacity',
    'settings.deskExp.opacityDesc':
      'The lower the value, the more the standee shows through the cards (30% - 100%)',
    'settings.deskExp.inChat': 'Show Standee on Chat Page',
    'settings.deskExp.inChatDesc':
      'Overlays the current skin standee at the bottom-right of the chat window (official web UI)',
    'settings.deskExp.bridge': 'Page Bridge',
    'settings.deskExp.bridgeTitle': 'Official Page Bridge',
    'settings.deskExp.bridgeDesc':
      'The skin standee and theme/language following rely on a bridge script injected into the official web UI',
    'settings.deskExp.bridgeNone': 'Not connected (chat service not started)',
    'settings.deskExp.bridgeOk': 'OK',
    'settings.deskExp.bridgeDegraded':
      'Degraded: official theme contract missing (official UI may have changed)'
  } as Record<string, string>
}
