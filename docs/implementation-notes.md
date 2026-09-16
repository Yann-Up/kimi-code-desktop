# 关键实现细节(踩过的坑)

> 本文档收录开发过程中实测踩过的坑与时序逻辑,改动相关代码前先读。
> 原载于 README,后为保持首页精简移至此处。

- **iframe 直嵌可行**:loopback 下官方服务端不发 CSP frame-ancestors / X-Frame-Options,无需反代;壳在 healthz 通过后会 HEAD `/` 做一次预警检查,命中则显示"改用系统浏览器"引导页而非空白 iframe。注意 `--host 0.0.0.0` 时官方会下发 `frame-ancestors 'self'`(实测 0.36.1,loopback 请求也带),与内嵌互斥,故壳不提供局域网开放选项;需要局域网访问请自行在终端跑 `kimi web --host 0.0.0.0` 用浏览器直连
- **token 时序竞争**:前端拿 `web_ui_url` 带重试,后端未就绪时不白屏
- **端口稳定(源即身份)**:web UI 的"新浏览器"验证状态按 iframe 源(`http://127.0.0.1:<port>`)存 localStorage,端口漂移就会重弹验证;故固定起始端口(release 58666 / dev 58766),且启动前先回收首选端口上的残留实例(应用崩溃/强杀留下的孤儿:token 可用时 POST shutdown + 注册表 pid 强杀兜底;token 不可用但端口被占且注册表心跳新鲜——CLI 每 15s 刷新 heartbeat_at——时按 pid 直接强杀)保证该端口可用;其他端口上用户另开的 kimi web 实例不动。应用更新安装前也会先停妥所有通道服务(updater 插件安装时强杀进程,不触发 ExitRequested 优雅关停)
- **崩溃自愈**:kimi web 意外退出时壳会清理连接状态并广播 `server:exited`,可就地重启服务;退出监控只在服务就绪后启动——启动期失败由 healthz 轮询里的早退探针覆盖并直接随 start 错误返回(带 stderr 尾部),若监控与启动并发竞报,会先广播一条只有 exit code 的劣质消息把可读原因盖掉(实测两文案随机出现)
- **RC 单例冲突自愈**:CLI 对 `--remote-control` 做全机单例,锁载体是 `<kimi_home>/server/rc.json`(pid 活性判定),与实例注册表是两套账本——注册表回收覆盖不到的 RC 持有者(父进程崩溃留下的孤儿、注册表条目被清理、用户另开)会让新实例必被 CLI 拒启(exit 1,"Remote Control is already running"),重试永远失败。壳的对策分三层,全部在 server.rs:
  1. **启动前预检**(`rc_precheck`,RC 开启时本机/WSL/SSH 通用):锁 pid 已死 → 直接启动(CLI 会覆盖残留 rc.json);健康(healthz 凭 server.token 通过)→ 收养为本通道后端(`ServiceHandle::Adopted`,不再 spawn);进程在但端口不可达 → 区分半死与"还在启动"(rc.json 的 started_at < 20s 时 15×1s 重探给足启动窗口,否则 3×500ms),半死才强杀;服务可达但凭据不符/状态异常、非回环 origin(`--host 0.0.0.0` 下可达性判定不可靠,不误杀)、杀不掉 → 结构化冲突错误。SSH 无前向转发探不了 HTTP,活锁一律冲突;本机另有 rc.json 指向壳自身 pid 的防御
  2. **强杀前的身份核验**(`rc_killable`,防 rc.json 的 pid 被系统复用后误杀):进程 basename 必须是 kimi/kimi.exe;node/node.exe(npm 安装形态)还需命令行含 "kimi" 佐证;其余一律不杀转冲突。强杀后等退净(≤3s,CLI 按 pid 活性判锁,不等则随即重启仍撞锁)
  3. **结构化冲突错误 + 前端定向处置**:预检冲突与 spawn 后被拒的兜底(stderr 尾部命中同样签名时改写,3×100ms 重试防 drain 竞态)统一返回 `RC_CONFLICT|pid=..|origin=..`;前端(App/ShellHome,含 starting 态的 server:error 订阅)解析后出"结束旧实例并重试"按钮走 `rc_kill_holder` 命令(同一份核验 + 本机自身 pid 拒绝 + 杀后 3s 复核未退净报错),成功后自动重新走 start 流程

  收养实例的生命周期:退出监控改用 healthz 探活(10 连败 ≈5s 判死);停服/退出只 POST shutdown + 等退净(≤5s,防 restart 回马枪把将死实例收养回来),绝不强杀。注意这是统一语义——用户在终端手动常驻的 RC 实例一旦被壳收养,壳停服/退出时也会被 POST shutdown 收编;不想被收编就在 设置→CLI 配置 关掉 Remote Control 开关
- **macOS 交通灯**:主窗全平台 `decorations(false)` 全自绘标题栏;mac 的三灯为前端自绘(原生 Overlay 灯位由 AppKit 按 28pt 标准栏定位,与 48px 自绘栏垂直不对中,`traffic_light_position` 偏移语义依赖按钮 frame 内部值、无实机难校准),失焦置灰(亮 #d6d6d6 / 暗 #55565a),绿灯走 `windowControl('fullscreen')` 进出原生全屏
- token 统计口径:`usage.record` ≈ `step.end`(交叉验证差 1%),输入/输出/缓存分开记账
