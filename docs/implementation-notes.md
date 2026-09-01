# 关键实现细节(踩过的坑)

> 本文档收录开发过程中实测踩过的坑与时序逻辑,改动相关代码前先读。
> 原载于 README,后为保持首页精简移至此处。

- **iframe 直嵌可行**:loopback 下官方服务端不发 CSP frame-ancestors / X-Frame-Options,无需反代;壳在 healthz 通过后会 HEAD `/` 做一次预警检查,命中则显示"改用系统浏览器"引导页而非空白 iframe。注意 `--host 0.0.0.0` 时官方会下发 `frame-ancestors 'self'`(实测 0.36.1,loopback 请求也带),与内嵌互斥,故壳不提供局域网开放选项;需要局域网访问请自行在终端跑 `kimi web --host 0.0.0.0` 用浏览器直连
- **token 时序竞争**:前端拿 `web_ui_url` 带重试,后端未就绪时不白屏
- **端口稳定(源即身份)**:web UI 的"新浏览器"验证状态按 iframe 源(`http://127.0.0.1:<port>`)存 localStorage,端口漂移就会重弹验证;故固定起始端口(release 58666 / dev 58766),且启动前先回收首选端口上的残留实例(应用崩溃/强杀留下的孤儿:token 可用时 POST shutdown + 注册表 pid 强杀兜底;token 不可用但端口被占且注册表心跳新鲜——CLI 每 15s 刷新 heartbeat_at——时按 pid 直接强杀)保证该端口可用;其他端口上用户另开的 kimi web 实例不动。应用更新安装前也会先停妥所有通道服务(updater 插件安装时强杀进程,不触发 ExitRequested 优雅关停)
- **崩溃自愈**:kimi web 意外退出时壳会清理连接状态并广播 `server:exited`,可就地重启服务
- **macOS 交通灯**:主窗全平台 `decorations(false)` 全自绘标题栏;mac 的三灯为前端自绘(原生 Overlay 灯位由 AppKit 按 28pt 标准栏定位,与 48px 自绘栏垂直不对中,`traffic_light_position` 偏移语义依赖按钮 frame 内部值、无实机难校准),失焦置灰(亮 #d6d6d6 / 暗 #55565a),绿灯走 `windowControl('fullscreen')` 进出原生全屏
- token 统计口径:`usage.record` ≈ `step.end`(交叉验证差 1%),输入/输出/缓存分开记账
