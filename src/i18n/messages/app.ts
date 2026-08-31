// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// 应用根组件(App):启动失败页、启动中、CLI 升级提示与结果 toast、关窗确认框
export default {
  zh: {
    // 服务事件
    'app.serverExited': '后端服务意外退出:{detail}',
    // 启动失败页
    'app.error.title': '无法启动 Kimi Code 服务',
    'app.error.hint': '请确认已安装 Kimi Code CLI(kimi --version 可用)',
    'app.error.retry': '重试',
    // 启动中(含首次自动安装 CLI)
    'app.starting.installingCli': '未检测到 Kimi Code CLI,正在自动下载安装最新版…',
    'app.starting.starting': '正在启动 Kimi Code 服务…',
    'app.starting.installHint': '首次安装需要几分钟,请保持网络畅通',
    // CLI 升级结果 toast
    'app.upgrade.doneRestarted': '已更新到 {version},服务已自动重启',
    'app.upgrade.doneUnconfirmed': '更新已执行,但无法确认新版本,请重启应用确认',
    'app.upgrade.done': '已更新到 {version};若服务在运行,重启后生效',
    'app.upgrade.doneNoVersion': '更新已执行;若服务在运行,重启后生效',
    // CLI 新版本提示框
    'app.update.title': '发现 Kimi Code CLI 新版本',
    'app.update.versions': '当前 {current} → 最新 {latest}',
    'app.update.viaHome': '更新通过 `kimi upgrade` 完成,更新后服务会自动重启',
    'app.update.viaNpm':
      '当前为 npm 安装,更新通过 `npm update -g @moonshot-ai/kimi-code` 完成,更新后服务会自动重启',
    'app.update.target': '更新对象:{bin}',
    'app.update.skip': '跳过此版本',
    'app.update.later': '稍后',
    'app.update.failHome': '更新失败,请稍后在终端手动运行 kimi upgrade',
    'app.update.failNpm': '更新失败,请稍后在终端手动运行 npm update -g @moonshot-ai/kimi-code',
    'app.update.updating': '正在更新…',
    'app.update.now': '立即更新',
    // 关窗确认框
    'app.close.title': '是否关闭 Kimi Code Desktop?',
    'app.close.descRunning':
      'Kimi Code 服务正在运行中,退出将停止服务并中断所有进行中的会话;进入托盘则保持后台运行。',
    'app.close.descIdle': '可以退出程序,或进入托盘保持后台驻留(托盘图标可随时唤回)。',
    'app.close.cancel': '取消',
    'app.close.toTray': '进入托盘',
    'app.close.exit': '退出程序'
  } as Record<string, string>,
  en: {
    'app.serverExited': 'Backend service exited unexpectedly: {detail}',
    'app.error.title': 'Failed to start the Kimi Code service',
    'app.error.hint': 'Please make sure Kimi Code CLI is installed (kimi --version works)',
    'app.error.retry': 'Retry',
    'app.starting.installingCli': 'Kimi Code CLI not detected, downloading and installing the latest version…',
    'app.starting.starting': 'Starting Kimi Code service…',
    'app.starting.installHint': 'The first install takes a few minutes, please stay online',
    'app.upgrade.doneRestarted': 'Updated to {version}, the service restarted automatically',
    'app.upgrade.doneUnconfirmed':
      'Update applied, but the new version could not be confirmed. Restart the app to verify',
    'app.upgrade.done': 'Updated to {version}; if the service is running, it takes effect after a restart',
    'app.upgrade.doneNoVersion': 'Update applied; if the service is running, it takes effect after a restart',
    'app.update.title': 'New Kimi Code CLI version available',
    'app.update.versions': 'Current {current} → Latest {latest}',
    'app.update.viaHome': 'Updated via `kimi upgrade`; the service restarts automatically after the update',
    'app.update.viaNpm':
      'Installed via npm; updated via `npm update -g @moonshot-ai/kimi-code`. The service restarts automatically after the update',
    'app.update.target': 'Update target: {bin}',
    'app.update.skip': 'Skip This Version',
    'app.update.later': 'Later',
    'app.update.failHome': 'Update failed. Please run kimi upgrade manually in a terminal later',
    'app.update.failNpm':
      'Update failed. Please run npm update -g @moonshot-ai/kimi-code manually in a terminal later',
    'app.update.updating': 'Updating…',
    'app.update.now': 'Update Now',
    'app.close.title': 'Close Kimi Code Desktop?',
    'app.close.descRunning':
      'The Kimi Code service is running. Quitting will stop it and interrupt all ongoing sessions; minimizing to tray keeps it running in the background.',
    'app.close.descIdle':
      'You can quit the app, or minimize to the tray to keep it resident (the tray icon brings it back anytime).',
    'app.close.cancel': 'Cancel',
    'app.close.toTray': 'Minimize to Tray',
    'app.close.exit': 'Quit'
  } as Record<string, string>
}
