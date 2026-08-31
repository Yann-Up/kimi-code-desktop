// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// CLI 配置其余小节:思考 / 主循环 / 服务 / 身份 / 高级
// (节名 'settings.cliThinking' 等在 settingsShell.ts,此处为页内文案)
export default {
  zh: {
    // 公共
    'settings.cliCommon.savedOffline': '已写入 config.toml;重启服务后新会话生效',
    'settings.cliCommon.errNonNegInt': '{label}必须是非负整数',

    // 思考(CliThinkingSettings)
    'settings.cliThinking.desc': 'Thinking 模式的全局默认行为(config.toml [thinking] 块)',
    'settings.cliThinking.keepAll': 'all(保留历史思考内容)',
    'settings.cliThinking.keepOff': 'off(关闭)',
    'settings.cliThinking.enableLabel': '默认开启思考',
    'settings.cliThinking.enableDesc': '新会话默认启用 Thinking 模式;关闭则强制不思考',
    'settings.cliThinking.effortLabel': '思考强度(effort)',
    'settings.cliThinking.effortDesc':
      'Kimi 模型若配置值不在 support_efforts 列表中,会回退到该模型的默认强度;留空跟随模型默认',
    'settings.cliThinking.effortPlaceholder': '未设置(跟随模型默认)',
    'settings.cliThinking.keepLabel': '保留历史思考(keep)',
    'settings.cliThinking.keepDesc': '保留之前轮次的思考内容供后续参考;关闭后不保留',

    // 主循环(CliLoopSettings)
    'settings.cliLoop.pageTitle': '循环与后台',
    'settings.cliLoop.desc': 'Agent 循环步数/压缩阈值、后台任务与子智能体运行参数(config.toml 多块)',
    'settings.cliLoop.groupLoop': '循环控制(loop_control)',
    'settings.cliLoop.groupBackground': '后台任务(background)',
    'settings.cliLoop.groupSubagent': '子智能体(subagent / swarm)',
    'settings.cliLoop.groupToken': 'Token 统计(token_counting)',
    'settings.cliLoop.maxStepsLabel': '每轮最大步数(max_steps_per_turn)',
    'settings.cliLoop.maxStepsDesc': '单轮对话的最大执行步数;0 或留空 = 不限',
    'settings.cliLoop.maxAttemptsLabel': '单步最大尝试次数(max_attempts_per_step)',
    'settings.cliLoop.maxAttemptsDesc': '单步失败时的最大总尝试次数(含首次,默认 10)',
    'settings.cliLoop.reservedLabel': '预留上下文(reserved_context_size)',
    'settings.cliLoop.reservedDesc': '为模型输出预留的 token 数;剩余上下文低于该值触发自动压缩',
    'settings.cliLoop.maxRunningLabel': '后台任务并发上限(max_running_tasks)',
    'settings.cliLoop.maxRunningDesc': '同时运行的后台任务数上限',
    'settings.cliLoop.keepAliveLabel': '会话关闭时保留后台任务(keep_alive_on_exit)',
    'settings.cliLoop.keepAliveDesc': '默认会话关闭时会请求停止所有后台任务;开启后任务可越过会话存活',
    'settings.cliLoop.autoBgLabel': '前台命令超时转后台(bash_auto_background_on_timeout)',
    'settings.cliLoop.autoBgDesc': '前台 Bash 命令超时后转为后台任务继续运行,而非直接终止(默认开启)',
    'settings.cliLoop.bashTimeoutLabel': 'Bash 后台任务超时(bash_task_timeout_s)',
    'settings.cliLoop.bashTimeoutDesc': '后台 Bash 任务默认超时(秒);0 = 不限时',
    'settings.cliLoop.subagentTimeoutLabel': '子智能体超时(timeout_ms)',
    'settings.cliLoop.subagentTimeoutDesc':
      '单个子智能体的最长运行时间(毫秒,默认 7200000 即 2 小时);0 = 不限时;CLI 0.39.0 起不再覆盖 AgentSwarm 派生的子代理',
    'settings.cliLoop.swarmTimeoutLabel': 'Swarm 子智能体超时(swarm.timeout_ms)',
    'settings.cliLoop.swarmTimeoutDesc':
      'AgentSwarm 派生子代理的最长运行时间(毫秒,默认 7200000 即 2 小时,需 CLI ≥ 0.39.0);0 = 不限时',
    'settings.cliLoop.strategyLabel': '统计口径(strategy)',
    'settings.cliLoop.strategyDesc': '对外报告的上下文 token 数量口径;内部压缩判断不受影响',
    'settings.cliLoop.strategyMeasuredEstimated': 'measured+estimated(实测+预估)',
    'settings.cliLoop.strategyMeasured': 'measured(仅实测)',
    'settings.cliLoop.strategyEstimated': 'estimated(仅预估)',
    'settings.cliLoop.labelMaxSteps': '每轮最大步数',
    'settings.cliLoop.labelMaxAttempts': '单步最大尝试次数',
    'settings.cliLoop.labelReserved': '预留上下文',
    'settings.cliLoop.labelMaxRunning': '后台任务并发数',
    'settings.cliLoop.labelBashTimeout': 'Bash 后台任务超时',
    'settings.cliLoop.labelSubagentTimeout': '子智能体超时',
    'settings.cliLoop.labelSwarmTimeout': 'Swarm 子智能体超时',

    // 服务(CliServicesSettings)
    'settings.cliServices.pageTitle': '服务与图像',
    'settings.cliServices.desc': '联网搜索/抓取服务、图片压缩与 MCP 超时(config.toml services / image / mcp 块)',
    'settings.cliServices.groupServices': '联网服务(services)',
    'settings.cliServices.groupImage': '图像(image)',
    'settings.cliServices.groupMcp': 'MCP(mcp)',
    'settings.cliServices.searchUrlLabel': '联网搜索地址(搜索服务 base_url)',
    'settings.cliServices.searchUrlDesc': 'moonshot_search 的 API 地址;留空使用内置默认',
    'settings.cliServices.searchUrlPlaceholder': '默认:https://api.kimi.com/coding/v1/search',
    'settings.cliServices.fetchUrlLabel': '网页抓取地址(抓取服务 base_url)',
    'settings.cliServices.fetchUrlDesc': 'moonshot_fetch 的 API 地址;留空使用内置默认',
    'settings.cliServices.fetchUrlPlaceholder': '默认:https://api.kimi.com/coding/v1/fetch',
    'settings.cliServices.apiKeyNote': 'api_key 由登录流程写入管理,请勿在此处手工填写',
    'settings.cliServices.maxEdgeLabel': '最长边上限(max_edge_px)',
    'settings.cliServices.maxEdgeDesc': '图片最长边像素上限,超出按比例缩小(默认 2000)',
    'settings.cliServices.byteBudgetLabel': '图片字节预算(read_byte_budget)',
    'settings.cliServices.byteBudgetDesc': '模型自行读取图片的字节预算,限制请求体体积(默认 262144 即 256KB)',
    'settings.cliServices.startupTimeoutLabel': '连接超时(startup_timeout_ms)',
    'settings.cliServices.startupTimeoutDesc': 'MCP 服务器连接+工具发现的全局默认超时(毫秒,默认 30000)',
    'settings.cliServices.toolTimeoutLabel': '工具调用超时(tool_timeout_ms)',
    'settings.cliServices.toolTimeoutDesc': 'MCP 单次工具调用的全局默认超时(毫秒,默认 60000)',
    'settings.cliServices.labelMaxEdge': '图片最长边上限',
    'settings.cliServices.labelByteBudget': '图片字节预算',
    'settings.cliServices.labelStartupTimeout': 'MCP 启动超时',
    'settings.cliServices.labelToolTimeout': 'MCP 工具超时',

    // 身份(CliIdentitySettings)
    'settings.cliIdentity.desc': '自定义 agent 的身份标识(config.toml [identity] 块)',
    'settings.cliIdentity.group': '身份标识',
    'settings.cliIdentity.nameLabel': '名称(name)',
    'settings.cliIdentity.nameDesc': 'agent 在系统提示中的自称(填充 ${product_name}),支持中文;留空则使用默认',
    'settings.cliIdentity.namePlaceholder': '如 Acme Dev Agent / 小明助手',
    'settings.cliIdentity.slugLabel': '标识(slug)',
    'settings.cliIdentity.slugDesc':
      '协议字段使用的机器标识(User-Agent、MCP 客户端名),仅 ASCII;留空由 name 派生(小写、非字母数字折叠为 -),纯中文名无法派生时将回退为 agent',
    'settings.cliIdentity.slugPlaceholder': '留空自动派生',
    'settings.cliIdentity.noteResolve':
      '身份在启动时解析一次,并随连接宣告给 MCP 服务器与提供商;修改后需重启服务并在新会话中生效',
    'settings.cliIdentity.noteWrite':
      '保存直接写入 config.toml(留空 = 删除该自定义键,恢复默认身份),写前自动备份为 .kimi-desktop-bak',
    'settings.cliIdentity.savedOk': '已写入 config.toml(备份于 {backup});重启服务后新会话生效',

    // 高级(CliAdvancedSettings)
    'settings.cliAdvanced.desc':
      '直接编辑 config.toml 源文件(当前连接目标的数据目录下);其余可视化页面覆盖不到的键(telemetry、permission、tools、hooks 等)都可以在这里维护',
    'settings.cliAdvanced.groupSource': 'config.toml 源文件',
    'settings.cliAdvanced.loading': '加载中…',
    'settings.cliAdvanced.readFailed': '读取失败:{error}',
    'settings.cliAdvanced.retry': '重试',
    'settings.cliAdvanced.notFound': '未找到 config.toml(CLI 首次运行后自动创建);点击下方编辑可直接新建',
    'settings.cliAdvanced.createEdit': '新建并编辑',
    'settings.cliAdvanced.fileMissing': '(文件尚不存在)',
    'settings.cliAdvanced.bytes': '{n} 字节',
    'settings.cliAdvanced.cancel': '取消',
    'settings.cliAdvanced.writing': '写入中…',
    'settings.cliAdvanced.save': '保存',
    'settings.cliAdvanced.reload': '重新载入',
    'settings.cliAdvanced.edit': '编辑',
    'settings.cliAdvanced.savedOk': '已写入(备份于 {backup}),新会话生效',
    'settings.cliAdvanced.saveFailed': '保存失败:{error}',
    'settings.cliAdvanced.footnote':
      '写入前会自动备份当前文件为 .kimi-desktop-bak;不对内容做 TOML 语法校验,配置错误将在 CLI 下次启动时报出,修改后需重启服务并在新会话中生效'
  } as Record<string, string>,
  en: {
    // Shared
    'settings.cliCommon.savedOffline':
      'Written to config.toml; takes effect for new sessions after restarting the service',
    'settings.cliCommon.errNonNegInt': '{label} must be a non-negative integer',

    // Thinking (CliThinkingSettings)
    'settings.cliThinking.desc': 'Global default behavior of Thinking mode (config.toml [thinking] block)',
    'settings.cliThinking.keepAll': 'all (keep past thinking)',
    'settings.cliThinking.keepOff': 'off (disabled)',
    'settings.cliThinking.enableLabel': 'Enable thinking by default',
    'settings.cliThinking.enableDesc':
      'New sessions use Thinking mode by default; when off, thinking is forced off',
    'settings.cliThinking.effortLabel': 'Thinking effort (effort)',
    'settings.cliThinking.effortDesc':
      "If the configured value is not in the Kimi model's support_efforts list, it falls back to the model's default effort; leave empty to follow the model default",
    'settings.cliThinking.effortPlaceholder': 'Not set (follow model default)',
    'settings.cliThinking.keepLabel': 'Keep past thinking (keep)',
    'settings.cliThinking.keepDesc':
      'Keep thinking content from previous turns for later reference; not kept when off',

    // Main loop (CliLoopSettings)
    'settings.cliLoop.pageTitle': 'Loop & Background',
    'settings.cliLoop.desc':
      'Agent loop step/compression thresholds, background task and subagent runtime parameters (multiple config.toml blocks)',
    'settings.cliLoop.groupLoop': 'Loop control (loop_control)',
    'settings.cliLoop.groupBackground': 'Background tasks (background)',
    'settings.cliLoop.groupSubagent': 'Subagents (subagent / swarm)',
    'settings.cliLoop.groupToken': 'Token counting (token_counting)',
    'settings.cliLoop.maxStepsLabel': 'Max steps per turn (max_steps_per_turn)',
    'settings.cliLoop.maxStepsDesc': 'Max execution steps per conversation turn; 0 or empty = unlimited',
    'settings.cliLoop.maxAttemptsLabel': 'Max attempts per step (max_attempts_per_step)',
    'settings.cliLoop.maxAttemptsDesc':
      'Max total attempts when a step fails (including the first, default 10)',
    'settings.cliLoop.reservedLabel': 'Reserved context (reserved_context_size)',
    'settings.cliLoop.reservedDesc':
      'Tokens reserved for model output; auto-compaction triggers when remaining context drops below this',
    'settings.cliLoop.maxRunningLabel': 'Background task concurrency (max_running_tasks)',
    'settings.cliLoop.maxRunningDesc': 'Maximum number of concurrently running background tasks',
    'settings.cliLoop.keepAliveLabel': 'Keep background tasks on session close (keep_alive_on_exit)',
    'settings.cliLoop.keepAliveDesc':
      'By default all background tasks are asked to stop when the session closes; when enabled, tasks may outlive the session',
    'settings.cliLoop.autoBgLabel': 'Move timed-out foreground commands to background (bash_auto_background_on_timeout)',
    'settings.cliLoop.autoBgDesc':
      'A foreground Bash command that times out keeps running as a background task instead of being killed (on by default)',
    'settings.cliLoop.bashTimeoutLabel': 'Background Bash task timeout (bash_task_timeout_s)',
    'settings.cliLoop.bashTimeoutDesc': 'Default timeout for background Bash tasks (seconds); 0 = no limit',
    'settings.cliLoop.subagentTimeoutLabel': 'Subagent timeout (timeout_ms)',
    'settings.cliLoop.subagentTimeoutDesc':
      'Max runtime of a single subagent (ms, default 7200000 = 2 hours); 0 = no limit; since CLI 0.39.0 no longer overrides subagents spawned by AgentSwarm',
    'settings.cliLoop.swarmTimeoutLabel': 'Swarm subagent timeout (swarm.timeout_ms)',
    'settings.cliLoop.swarmTimeoutDesc':
      'Max runtime of AgentSwarm-spawned subagents (ms, default 7200000 = 2 hours, requires CLI ≥ 0.39.0); 0 = no limit',
    'settings.cliLoop.strategyLabel': 'Counting strategy (strategy)',
    'settings.cliLoop.strategyDesc':
      'How context token counts are reported externally; internal compaction decisions are unaffected',
    'settings.cliLoop.strategyMeasuredEstimated': 'measured+estimated (measured + estimated)',
    'settings.cliLoop.strategyMeasured': 'measured (measured only)',
    'settings.cliLoop.strategyEstimated': 'estimated (estimated only)',
    'settings.cliLoop.labelMaxSteps': 'Max steps per turn',
    'settings.cliLoop.labelMaxAttempts': 'Max attempts per step',
    'settings.cliLoop.labelReserved': 'Reserved context',
    'settings.cliLoop.labelMaxRunning': 'Background task concurrency',
    'settings.cliLoop.labelBashTimeout': 'Background Bash task timeout',
    'settings.cliLoop.labelSubagentTimeout': 'Subagent timeout',
    'settings.cliLoop.labelSwarmTimeout': 'Swarm subagent timeout',

    // Services (CliServicesSettings)
    'settings.cliServices.pageTitle': 'Services & Image',
    'settings.cliServices.desc':
      'Web search/fetch services, image compression and MCP timeouts (config.toml services / image / mcp blocks)',
    'settings.cliServices.groupServices': 'Web services (services)',
    'settings.cliServices.groupImage': 'Image (image)',
    'settings.cliServices.groupMcp': 'MCP (mcp)',
    'settings.cliServices.searchUrlLabel': 'Search service URL (search service base_url)',
    'settings.cliServices.searchUrlDesc': 'API endpoint for moonshot_search; leave empty to use the built-in default',
    'settings.cliServices.searchUrlPlaceholder': 'Default: https://api.kimi.com/coding/v1/search',
    'settings.cliServices.fetchUrlLabel': 'Fetch service URL (fetch service base_url)',
    'settings.cliServices.fetchUrlDesc': 'API endpoint for moonshot_fetch; leave empty to use the built-in default',
    'settings.cliServices.fetchUrlPlaceholder': 'Default: https://api.kimi.com/coding/v1/fetch',
    'settings.cliServices.apiKeyNote': 'api_key is written and managed by the login flow; do not edit it here',
    'settings.cliServices.maxEdgeLabel': 'Max edge (max_edge_px)',
    'settings.cliServices.maxEdgeDesc':
      'Pixel limit for the longest image edge; larger images are scaled down proportionally (default 2000)',
    'settings.cliServices.byteBudgetLabel': 'Image byte budget (read_byte_budget)',
    'settings.cliServices.byteBudgetDesc':
      'Byte budget for images read by the model itself, limiting request body size (default 262144 = 256KB)',
    'settings.cliServices.startupTimeoutLabel': 'Connection timeout (startup_timeout_ms)',
    'settings.cliServices.startupTimeoutDesc':
      'Global default timeout for MCP server connection + tool discovery (ms, default 30000)',
    'settings.cliServices.toolTimeoutLabel': 'Tool call timeout (tool_timeout_ms)',
    'settings.cliServices.toolTimeoutDesc':
      'Global default timeout for a single MCP tool call (ms, default 60000)',
    'settings.cliServices.labelMaxEdge': 'Image max edge',
    'settings.cliServices.labelByteBudget': 'Image byte budget',
    'settings.cliServices.labelStartupTimeout': 'MCP startup timeout',
    'settings.cliServices.labelToolTimeout': 'MCP tool timeout',

    // Identity (CliIdentitySettings)
    'settings.cliIdentity.desc': 'Custom identity of the agent (config.toml [identity] block)',
    'settings.cliIdentity.group': 'Identity',
    'settings.cliIdentity.nameLabel': 'Name (name)',
    'settings.cliIdentity.nameDesc':
      'How the agent calls itself in the system prompt (fills ${product_name}); Chinese is supported; leave empty to use the default',
    'settings.cliIdentity.namePlaceholder': 'e.g. Acme Dev Agent / Xiaoming Assistant',
    'settings.cliIdentity.slugLabel': 'Slug (slug)',
    'settings.cliIdentity.slugDesc':
      'Machine identifier used in protocol fields (User-Agent, MCP client name), ASCII only; when empty it is derived from name (lowercased, non-alphanumerics collapsed to -); a pure-Chinese name cannot be derived and falls back to agent',
    'settings.cliIdentity.slugPlaceholder': 'Leave empty to derive automatically',
    'settings.cliIdentity.noteResolve':
      'Identity is resolved once at startup and announced to MCP servers and providers on connect; changes take effect after restarting the service in new sessions',
    'settings.cliIdentity.noteWrite':
      'Saving writes directly to config.toml (empty = remove the custom key and restore the default identity); the file is automatically backed up as .kimi-desktop-bak first',
    'settings.cliIdentity.savedOk':
      'Written to config.toml (backup at {backup}); takes effect for new sessions after restarting the service',

    // Advanced (CliAdvancedSettings)
    'settings.cliAdvanced.desc':
      'Edit the config.toml source file directly (in the data directory of the current connection target); keys not covered by the other visual pages (telemetry, permission, tools, hooks, etc.) can be maintained here',
    'settings.cliAdvanced.groupSource': 'config.toml source file',
    'settings.cliAdvanced.loading': 'Loading…',
    'settings.cliAdvanced.readFailed': 'Read failed: {error}',
    'settings.cliAdvanced.retry': 'Retry',
    'settings.cliAdvanced.notFound':
      'config.toml not found (created automatically on the CLI first run); click Edit below to create it directly',
    'settings.cliAdvanced.createEdit': 'Create & Edit',
    'settings.cliAdvanced.fileMissing': '(file does not exist yet)',
    'settings.cliAdvanced.bytes': '{n} bytes',
    'settings.cliAdvanced.cancel': 'Cancel',
    'settings.cliAdvanced.writing': 'Writing…',
    'settings.cliAdvanced.save': 'Save',
    'settings.cliAdvanced.reload': 'Reload',
    'settings.cliAdvanced.edit': 'Edit',
    'settings.cliAdvanced.savedOk': 'Written (backup at {backup}); takes effect in new sessions',
    'settings.cliAdvanced.saveFailed': 'Save failed: {error}',
    'settings.cliAdvanced.footnote':
      "The current file is automatically backed up as .kimi-desktop-bak before writing; no TOML syntax validation is performed — configuration errors will surface on the CLI's next start; changes take effect after restarting the service in new sessions"
  } as Record<string, string>
}
