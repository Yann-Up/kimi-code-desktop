// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// 主壳对话区(ShellHome / WebFrame):占位页、启动中、加载失败、iframe 被禁引导、CLI 安装确认
export default {
  zh: {
    // 服务事件
    'shell.serverExited': '后端服务意外退出:{detail}',
    // 未启动占位页
    'shell.offline.title': 'Kimi Code 服务未启动',
    'shell.offline.desc': '启动后此处将加载官方 Web UI 对话界面;统计、设置等本地页面现在即可使用',
    'shell.offline.start': '启动 Kimi Code 服务',
    // 启动中(含首次自动安装 CLI)
    'shell.starting.installingCli': '未检测到 Kimi Code CLI,正在自动下载安装最新版…',
    'shell.starting.starting': '正在启动 Kimi Code 服务…',
    'shell.starting.installHint': '首次安装需要几分钟,请保持网络畅通',
    // iframe 加载失败
    'shell.frameError.title': '无法加载对话界面',
    'shell.frameError.retry': '重试',
    // 服务端禁止 iframe 嵌入
    'shell.frameBlocked.title': '官方服务端禁止了 iframe 嵌入',
    'shell.frameBlocked.desc':
      '检测到响应头 CSP frame-ancestors,当前版本的官方服务端不允许被嵌入,对话界面无法在壳内显示。可改用系统浏览器访问,或留意官方更新说明。',
    'shell.frameBlocked.openExternal': '在系统浏览器打开',
    // 通道列表未就绪时的兜底通道名
    'shell.channelLocal': '本机',
    // 会话立绘快捷显隐按钮
    'shell.skin.show': '显示立绘',
    'shell.skin.hideSession': '暂时隐藏立绘(本次会话有效)',
    // 本机缺 CLI 的安装确认框
    'shell.installCli.title': '安装 Kimi Code CLI',
    'shell.installCli.desc': '本机未检测到 Kimi Code CLI。将使用官方安装脚本下载并安装最新版:',
    'shell.installCli.hint': '首次安装需要几分钟,请保持网络畅通;安装完成后服务会自动启动',
    'shell.installCli.cancel': '取消',
    'shell.installCli.recheck': '我已自行安装,重新检测',
    'shell.installCli.confirm': '安装并启动'
  } as Record<string, string>,
  en: {
    'shell.serverExited': 'Backend service exited unexpectedly: {detail}',
    'shell.offline.title': 'Kimi Code service is not running',
    'shell.offline.desc':
      'Once started, the official Web UI chat will load here; stats, settings and other local pages are available now',
    'shell.offline.start': 'Start Kimi Code Service',
    'shell.starting.installingCli': 'Kimi Code CLI not detected, downloading and installing the latest version…',
    'shell.starting.starting': 'Starting Kimi Code service…',
    'shell.starting.installHint': 'The first install takes a few minutes, please stay online',
    'shell.frameError.title': 'Failed to load the chat UI',
    'shell.frameError.retry': 'Retry',
    'shell.frameBlocked.title': 'The official server has blocked iframe embedding',
    'shell.frameBlocked.desc':
      'CSP frame-ancestors was detected in the response headers. The current official server does not allow embedding, so the chat UI cannot be shown inside the shell. Open it in your system browser instead, or watch the official release notes.',
    'shell.frameBlocked.openExternal': 'Open in System Browser',
    'shell.channelLocal': 'Local',
    'shell.skin.show': 'Show standee',
    'shell.skin.hideSession': 'Hide standee for now (this session only)',
    'shell.installCli.title': 'Install Kimi Code CLI',
    'shell.installCli.desc':
      'Kimi Code CLI was not detected on this machine. The latest version will be downloaded and installed with the official install script:',
    'shell.installCli.hint':
      'The first install takes a few minutes, please stay online; the service will start automatically once installed',
    'shell.installCli.cancel': 'Cancel',
    'shell.installCli.recheck': 'I installed it myself — re-detect',
    'shell.installCli.confirm': 'Install & Start'
  } as Record<string, string>
}
