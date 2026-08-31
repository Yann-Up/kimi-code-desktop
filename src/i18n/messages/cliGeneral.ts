// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// CLI 配置 · 通用行为页(CliGeneralSettings)+ 共享表单原语(cliForm,各 CLI 配置页复用)
export default {
  zh: {
    // 共享表单件(cliForm.tsx):路径列表、保存栏、合并语义提示、加载/离线门面
    'cliGeneral.form.deleteRow': '删除该行',
    'cliGeneral.form.addPath': '添加路径',
    'cliGeneral.form.browse': '浏览选择',
    'cliGeneral.form.pickDirTitle': '选择目录',
    'cliGeneral.form.pickDirConfirm': '添加此目录',
    'cliGeneral.form.saved': '已保存',
    'cliGeneral.form.saving': '保存中…',
    'cliGeneral.form.save': '保存',
    'cliGeneral.form.mergeNote':
      '写回为合并语义:仅提交本页涉及且已填写的键;留空项不会改动,已设置的键无法通过表单删除',
    'cliGeneral.form.offlineNotice':
      '服务未启动,当前直接读写 config.toml 配置文件;保存的内容将在重启服务后对新会话生效',
    'cliGeneral.form.loading': '加载中…',
    'cliGeneral.form.offlineReadFailed': '服务未启动且 config.toml 直读失败,请先在对话页启动服务后重试',
    'cliGeneral.form.loadFailed': '配置加载失败:{error}',
    'cliGeneral.form.retry': '重试',
    // 通用行为页(CliGeneralSettings.tsx)
    'cliGeneral.title': '通用行为',
    'cliGeneral.desc': '新会话的默认模型、权限与技能等通用行为(config.toml 顶层键)',
    'cliGeneral.perm.manual': '逐条确认',
    'cliGeneral.perm.yolo': '自动通过',
    'cliGeneral.perm.auto': '完全自主',
    'cliGeneral.group.modelPermission': '模型与权限',
    'cliGeneral.group.skills': '技能',
    'cliGeneral.group.skillDirs': '技能目录',
    'cliGeneral.group.agentDirs': '智能体目录',
    'cliGeneral.defaultModel': '默认模型',
    'cliGeneral.defaultModelDesc': '新会话使用的模型,必须是 models 中已定义的别名',
    'cliGeneral.defaultModelUnset': '未设置',
    'cliGeneral.defaultModelNoModelsDesc': '未在配置中发现 models 定义,可直接填写模型别名(如 kimi-code/k3)',
    'cliGeneral.defaultModelPlaceholder': '如 kimi-code/k3',
    'cliGeneral.defaultPermissionMode': '默认权限模式',
    'cliGeneral.defaultPermissionModeDesc':
      '新会话的工具调用审批策略:manual=每次询问、yolo=自动批准工具(仍可能提问)、auto=完全自主',
    'cliGeneral.defaultPlanMode': '默认计划模式',
    'cliGeneral.defaultPlanModeDesc': '新会话默认开启计划模式(先产出计划再执行)',
    'cliGeneral.mergeSkills': '合并所有可用技能',
    'cliGeneral.mergeSkillsDesc': '把各目录中的技能合并提供给模型(默认开启)',
    'cliGeneral.builtinSkills': '内置产品技能',
    'cliGeneral.builtinSkillsDesc':
      '向模型提供 Kimi Code 自身的内置技能(update-config、check-kimi-code-docs 等,默认开启);内置层优先级最低',
    // 默认搜索目录只读清单
    'cliGeneral.dirs.title': '默认搜索目录',
    'cliGeneral.dirs.desc': '按优先级从高到低排列;出现同名条目时,高优先级层级的生效',
    'cliGeneral.dirs.project': '项目级',
    'cliGeneral.dirs.user': '用户级',
    'cliGeneral.dirs.builtin': '内置',
    'cliGeneral.dirs.projectRoot': '<项目根>',
    'cliGeneral.dirs.projectNote': '项目根 = 从工作目录向上查找、最近的含 .git 的目录;仅对该项目生效',
    'cliGeneral.dirs.userNote': '对所有项目生效;~/.agents/{dir} 为跨工具共享目录,不随数据目录迁移',
    'cliGeneral.dirs.builtinPath': '随 CLI 自带',
    'cliGeneral.dirs.skillBuiltinNote': '产品类内置技能由上方开关控制',
    'cliGeneral.dirs.agentBuiltinNote': '随 CLI 自带;插件级介于用户级与内置之间',
    // 额外目录
    'cliGeneral.extraSkillDirs': '额外技能目录(extra_skill_dirs)',
    'cliGeneral.extraSkillDirsDesc': '叠加在默认目录之上,优先级介于用户级与内置之间;适合团队共享技能库等场景',
    'cliGeneral.extraSkillDirsPlaceholder': '如 ~/team-skills',
    'cliGeneral.extraAgentDirs': '额外智能体目录(extra_agent_dirs)',
    'cliGeneral.extraAgentDirsDesc': '额外的自定义 agent 搜索目录,优先级介于项目级与用户级之间',
    'cliGeneral.extraAgentDirsPlaceholder': '如 ~/team-agents',
    'cliGeneral.savedOffline': '已写入 config.toml;重启服务后新会话生效'
  } as Record<string, string>,
  en: {
    'cliGeneral.form.deleteRow': 'Delete this row',
    'cliGeneral.form.addPath': 'Add Path',
    'cliGeneral.form.browse': 'Browse',
    'cliGeneral.form.pickDirTitle': 'Select Directory',
    'cliGeneral.form.pickDirConfirm': 'Add This Directory',
    'cliGeneral.form.saved': 'Saved',
    'cliGeneral.form.saving': 'Saving…',
    'cliGeneral.form.save': 'Save',
    'cliGeneral.form.mergeNote':
      'Writes use merge semantics: only keys touched and filled in on this page are submitted; blank fields are left unchanged, and keys already set cannot be deleted from the form',
    'cliGeneral.form.offlineNotice':
      'Service is not running; config.toml is read and written directly. Saved changes take effect for new sessions after the service restarts',
    'cliGeneral.form.loading': 'Loading…',
    'cliGeneral.form.offlineReadFailed':
      'Service is not running and config.toml could not be read directly. Start the service on the chat page and try again',
    'cliGeneral.form.loadFailed': 'Failed to load configuration: {error}',
    'cliGeneral.form.retry': 'Retry',
    'cliGeneral.title': 'General Behavior',
    'cliGeneral.desc': 'General behavior for new sessions: default model, permissions, skills, etc. (top-level keys in config.toml)',
    'cliGeneral.perm.manual': 'Confirm Each',
    'cliGeneral.perm.yolo': 'Auto-Approve',
    'cliGeneral.perm.auto': 'Fully Autonomous',
    'cliGeneral.group.modelPermission': 'Model & Permissions',
    'cliGeneral.group.skills': 'Skills',
    'cliGeneral.group.skillDirs': 'Skill Directories',
    'cliGeneral.group.agentDirs': 'Agent Directories',
    'cliGeneral.defaultModel': 'Default Model',
    'cliGeneral.defaultModelDesc': 'Model used by new sessions; must be an alias defined in models',
    'cliGeneral.defaultModelUnset': 'Not set',
    'cliGeneral.defaultModelNoModelsDesc':
      'No models defined in the configuration; you can enter a model alias directly (e.g. kimi-code/k3)',
    'cliGeneral.defaultModelPlaceholder': 'e.g. kimi-code/k3',
    'cliGeneral.defaultPermissionMode': 'Default Permission Mode',
    'cliGeneral.defaultPermissionModeDesc':
      'Tool-call approval policy for new sessions: manual=ask every time, yolo=auto-approve tools (may still ask questions), auto=fully autonomous',
    'cliGeneral.defaultPlanMode': 'Default Plan Mode',
    'cliGeneral.defaultPlanModeDesc': 'New sessions start in plan mode by default (produce a plan before executing)',
    'cliGeneral.mergeSkills': 'Merge All Available Skills',
    'cliGeneral.mergeSkillsDesc': 'Merge skills from all directories for the model (enabled by default)',
    'cliGeneral.builtinSkills': 'Built-in Product Skills',
    'cliGeneral.builtinSkillsDesc':
      "Provide Kimi Code's own built-in skills to the model (update-config, check-kimi-code-docs, etc.; enabled by default); the built-in tier has the lowest priority",
    'cliGeneral.dirs.title': 'Default Search Directories',
    'cliGeneral.dirs.desc': 'Listed from highest to lowest priority; for same-named entries, the higher-priority tier wins',
    'cliGeneral.dirs.project': 'Project',
    'cliGeneral.dirs.user': 'User',
    'cliGeneral.dirs.builtin': 'Built-in',
    'cliGeneral.dirs.projectRoot': '<project root>',
    'cliGeneral.dirs.projectNote':
      'Project root = the nearest directory containing .git, found by walking up from the working directory; only applies to that project',
    'cliGeneral.dirs.userNote':
      'Applies to all projects; ~/.agents/{dir} is a cross-tool shared directory and does not move with the data directory',
    'cliGeneral.dirs.builtinPath': 'Ships with the CLI',
    'cliGeneral.dirs.skillBuiltinNote': 'Product built-in skills are controlled by the toggle above',
    'cliGeneral.dirs.agentBuiltinNote': 'Ships with the CLI; the plugin tier sits between user and built-in',
    'cliGeneral.extraSkillDirs': 'Extra Skill Directories (extra_skill_dirs)',
    'cliGeneral.extraSkillDirsDesc':
      'Stacked on top of the default directories, with priority between user and built-in; good for team-shared skill libraries',
    'cliGeneral.extraSkillDirsPlaceholder': 'e.g. ~/team-skills',
    'cliGeneral.extraAgentDirs': 'Extra Agent Directories (extra_agent_dirs)',
    'cliGeneral.extraAgentDirsDesc': 'Additional custom agent search directories, with priority between project and user',
    'cliGeneral.extraAgentDirsPlaceholder': 'e.g. ~/team-agents',
    'cliGeneral.savedOffline': 'Written to config.toml; takes effect for new sessions after the service restarts'
  } as Record<string, string>
}
