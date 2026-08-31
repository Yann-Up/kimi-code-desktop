// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// agentic 资源设置页:技能(SkillsSettings)/ 子代理(SubagentsSettings)/ 命令(CommandsSettings)
export default {
  zh: {
    // 技能
    'settings.skills.loadFailed': '加载用户级技能失败',
    'settings.skills.desc':
      '全局(用户级)技能,对当前目标的所有项目生效,来自两个目录:\n{home}/skills(数据目录/skills)\n~/.agents/skills\n项目级技能不在此管理,在会话中由官方 UI 加载;技能在下次会话生效',
    'settings.skills.descNoHome':
      '全局(用户级)技能:数据目录/skills 与 ~/.agents/skills 对所有项目生效;项目级技能在会话中由官方 UI 管理',
    'settings.skills.userLevel': '用户级技能',
    'settings.skills.empty': '未发现用户级技能(数据目录/skills 与 ~/.agents/skills)',
    'settings.skills.scopeDataDir': '数据目录',
    'settings.skills.detailDesc': '描述',
    'settings.skills.noDesc': '(无描述)',
    'settings.skills.detailPath': '路径',
    // 子代理
    'settings.subagents.loadFailed': '加载子智能体列表失败',
    'settings.subagents.desc':
      '全局(用户级)子智能体 profile,对当前目标的所有项目生效,来自两个目录:\n{home}/agents(数据目录/agents)\n~/.agents/agents\n项目级子智能体不在此管理;点击卡片查看完整信息,新会话生效',
    'settings.subagents.descNoHome':
      '全局(用户级)子智能体 profile:数据目录/agents 与 ~/.agents/agents 对所有项目生效;项目级不在此管理',
    'settings.subagents.userLevel': '用户级 Profile',
    'settings.subagents.empty': '未发现子智能体 profile(数据目录/agents 与 ~/.agents/agents)',
    'settings.subagents.builtin': '内置',
    'settings.subagents.scopeDataDir': '数据目录',
    'settings.subagents.detailDesc': '描述',
    'settings.subagents.noDesc': '(无描述)',
    'settings.subagents.tools': '可用工具',
    'settings.subagents.detailPath': '路径',
    // 命令
    'settings.commands.desc': '在聊天输入框中以 / 开头的斜杠命令',
    'settings.commands.builtinGroup': '内置命令',
    'settings.commands.skillGroup': '技能命令',
    'settings.commands.loadFailed': '读取技能列表失败',
    'settings.commands.emptySkills': '暂无自定义技能,安装技能后可通过 /skill:<名称> 调用',
    'settings.commands.cmdLogin': '登录 Kimi 账户',
    'settings.commands.cmdLogout': '退出当前账户',
    'settings.commands.cmdModel': '查看或切换当前使用的模型',
    'settings.commands.cmdCompact': '压缩会话上下文,释放 Token 预算',
    'settings.commands.cmdUndo': '撤销上一次的代码修改',
    'settings.commands.cmdExport': '导出当前会话记录',
    'settings.commands.cmdMcpConfig': '查看或编辑 MCP 服务器配置',
    'settings.commands.cmdUsage': '查看 Token 用量与额度',
    'settings.commands.cmdStatus': '查看会话与服务运行状态',
    'settings.commands.cmdHelp': '查看帮助与全部可用命令'
  } as Record<string, string>,
  en: {
    // Skills
    'settings.skills.loadFailed': 'Failed to load user-level skills',
    'settings.skills.desc':
      'Global (user-level) skills apply to all projects of the current target, from two directories:\n{home}/skills (data directory/skills)\n~/.agents/skills\nProject-level skills are not managed here; the official UI loads them in sessions. Skills take effect in the next session',
    'settings.skills.descNoHome':
      'Global (user-level) skills: data directory/skills and ~/.agents/skills apply to all projects; project-level skills are managed by the official UI in sessions',
    'settings.skills.userLevel': 'User-Level Skills',
    'settings.skills.empty':
      'No user-level skills found (data directory/skills and ~/.agents/skills)',
    'settings.skills.scopeDataDir': 'data dir',
    'settings.skills.detailDesc': 'Description',
    'settings.skills.noDesc': '(no description)',
    'settings.skills.detailPath': 'Path',
    // Subagents
    'settings.subagents.loadFailed': 'Failed to load subagent profiles',
    'settings.subagents.desc':
      'Global (user-level) subagent profiles apply to all projects of the current target, from two directories:\n{home}/agents (data directory/agents)\n~/.agents/agents\nProject-level subagents are not managed here; click a card for full details. Takes effect in new sessions',
    'settings.subagents.descNoHome':
      'Global (user-level) subagent profiles: data directory/agents and ~/.agents/agents apply to all projects; project-level ones are not managed here',
    'settings.subagents.userLevel': 'User-Level Profiles',
    'settings.subagents.empty':
      'No subagent profiles found (data directory/agents and ~/.agents/agents)',
    'settings.subagents.builtin': 'Built-in',
    'settings.subagents.scopeDataDir': 'data dir',
    'settings.subagents.detailDesc': 'Description',
    'settings.subagents.noDesc': '(no description)',
    'settings.subagents.tools': 'Available Tools',
    'settings.subagents.detailPath': 'Path',
    // Commands
    'settings.commands.desc': 'Slash commands starting with / in the chat input',
    'settings.commands.builtinGroup': 'Built-in Commands',
    'settings.commands.skillGroup': 'Skill Commands',
    'settings.commands.loadFailed': 'Failed to read the skill list',
    'settings.commands.emptySkills':
      'No custom skills yet. Once installed, invoke a skill via /skill:<name>',
    'settings.commands.cmdLogin': 'Sign in to your Kimi account',
    'settings.commands.cmdLogout': 'Sign out of the current account',
    'settings.commands.cmdModel': 'View or switch the current model',
    'settings.commands.cmdCompact': 'Compact the session context to free up token budget',
    'settings.commands.cmdUndo': 'Undo the last code change',
    'settings.commands.cmdExport': 'Export the current session',
    'settings.commands.cmdMcpConfig': 'View or edit MCP server configuration',
    'settings.commands.cmdUsage': 'View token usage and quota',
    'settings.commands.cmdStatus': 'View session and service status',
    'settings.commands.cmdHelp': 'View help and all available commands'
  } as Record<string, string>
}
