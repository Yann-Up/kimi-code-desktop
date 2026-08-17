# 发布前 Review 问题清理清单

来源:2026-08-17 发布前整体 review(14 路并行审查,覆盖全部 Rust/TS 源码、打包配置、安全红线、文档一致性)。
当时代码基线:commit `dc45d89` + 工作区未提交改动。

> 定位说明:文中行号为审查时快照;同日已删除 lib.rs 六个死命令(约 250 行),其后行号有偏移,建议按符号名搜索定位。

## 本轮已修复(备查)

| 项 | 位置 | 修复方式 |
| --- | --- | --- |
| 🔴 离线直读 config.toml 时 camelCase 叶子键读取失败,保存会覆盖真实配置 | `cliForm.tsx` `nested()` | 路径段自动兼容 snake/camel 变体(`keyVariants`) |
| `cli:installing` 无条件翻相,卸载 ShellHome 销毁常驻 iframe | `App.tsx` | 仅非 ready 时翻 'starting' |
| 向导「完成并启动」双击触发两次后端重启 | `OnboardingPage.tsx` `finish()` | 在途守卫 |
| 连续天数被 7/30 天窗口截断 | `UsageSettings.tsx` | 改用全量请求的后端 `streak` |
| 6 个死命令注册(open_external/notify/rest_file/rest_upload/fetch_provider_models/local_plugins)+ 死事件 `cli:installed` | `lib.rs`/`rest.rs`/`local_store.rs` | 已删除,含下游死代码 |
| README cron/定时任务、设置清单失实 | `README.md` | 已更新(中英 + 架构图) |
| npm 全局安装(kimi.cmd)检测恒失败、npm 升级路径不可达 | `cli.rs` `kimi_bin()` | PATH 兜底前 `where.exe`/`which` 解析 shim |
| 删除通道无确认;SSH 密码残留 keyring | `ChannelsSettings.tsx`/`ssh.rs`/`lib.rs` | 二次确认 + `delete_password` 清理 |

验证:`npm run typecheck` ✅、`cargo check` ✅(零警告)、`cargo test` 8/8 ✅、`build:renderer` ✅。

## 待实测确认(定级依赖结果)

- **T1 — SSH 远端端口被占时的 token 假设**(`server.rs` `start()` 兜底分支):代码假设"转发仍命中同 home 的已有实例,token 一致可用";但 CLI 0.29.2+ 每进程生成 token 且不回写 `server.token`,banner 捕获的是新实例 token,而转发固定指向旧实例端口 → healthz 认证失败、45s 超时杀新实例。若实测 CLI 按 home 复用 token 则无需改;否则从 banner 的 Local URL 行解析实际绑定端口建转发。
- **T2 — `kimi upgrade` 与运行中 kimi web 的文件锁**(`cli.rs` `cli_upgrade`):当前先升级后停服务,Windows 下 exe 被占用可能失败或半升级(npm 路径风险低)。实测确认后,按需改为 stop → upgrade → start。

## 🟠 Major(建议下版修)

### Rust 核心时序

1. **`init_backend` 索引 panic 竞态** — `lib.rs` `init_backend`:`&map[channel]` 直接索引;`remove_channel` 与 restart/bootstrap 的 stop→start 窗口叠加时条目已被删 → panic,且刚启动的 kimi web 失去状态绑定而泄漏。→ 改 `map.get(channel)`,取不到则停掉新服务并早退。
2. **`manual_stop` 与 `init_backend` 之间的未保护窗口** — `lib.rs` `run_bootstrap`:`stop_backend` 落在 swap(false) 之后、init 之前时,终态为 `backend_running=false` 但 `server_info.is_some()`,`start_backend` 判活永久 no-op——UI 显示已停止、点启动无反应,只能重启应用。→ swap 检查与 init 并入同一次 map 锁临界区,或 init 前复查 manual_stop。
3. **`ServerManager::start()` 全程持锁** — `server.rs`:spawn 后 detect/banner/token 轮询/healthz 全在 manager 锁内(SSH 最坏约 4 分钟),退出清理与 stop 全部阻塞;强杀则 kimi web 成孤儿。→ spawn 后尽早把 handle 存入独立内层状态,启动阶段不持大锁,启动可被 stop 中止。
4. **端口分配无进程级预留** — `server.rs` `free_port`:bind 探测即释放,各通道独立锁,并发启动可选中同一端口;叠加 CLI"端口被占自动 +1",healthz 打到先占者实例 → 45s 超时自杀。→ 进程级端口登记表,或探测 listener 持有到子进程绑定完成。
5. **`refresh_channels` 重置 "local" 通道目标覆盖** — `cli.rs`:无条件 `map.insert("local", Local)`,静默清掉 `set_connection_target` 的覆盖;已在远端运行的 "local" 通道服务与后续路由(统计/local_store/重启)错位。→ refresh 保留显式覆盖,或把向导选择落成正式通道、废弃双轨。

### SSH / WS

6. **TOFU 在 known_hosts 读取错误时 fail-open** — `ssh.rs` `check_known_host`:`read_to_string(...).unwrap_or_default()` 把"存在但读不出"(权限/损坏/非 UTF-8)当空文件 → 任意 host key 被接受,"变更即拒绝"红线失效。→ 按 `ErrorKind::NotFound` 区分,其他读取错误拒绝连接。
7. **SSH 共享连接单槽缓存** — `ssh.rs` `SHARED_CLIENT`:双 SSH 通道并存时每次跨通道操作 full 重连(握手+认证+TOFU),秒级延迟 + 服务端认证日志压力。→ 改 `HashMap<cache_key, Arc<SshClient>>`,`invalidate()` 按 key 精确失效。
8. **WS 读循环无应用层看门狗** — `ws.rs`:SSH 转发半开(TCP 假死无 RST)时 `read.next()` 永久挂起,通知静默丢失且重连机制不触发。→ `read.next()` 包 `timeout`(服务端心跳周期的 2~3 倍),超时按断线进重连。

### 前端

9. **`useCliConfig` 不感知 `activeChannel`** — 设置页停留期间切通道后,展示仍是旧通道配置,而保存缺省打到"激活通道":按 A 通道视图编辑的 patch 静默写进 B 通道。→ `activeChannel` 加入 reload 依赖,或加载时锁定 channel、保存时显式携带。
10. **保存反馈不可见 + 表单瞬态丢失** — `useCliConfig.saveSection` 末尾 `await reload()` 翻 loading,`CliConfigGate` 卸载整棵表单子树:`setSaved(true)` 落在已卸载实例,"已保存"从不显示,折叠/输入态全丢(`CliModelsSettings.apply()` 同款)。→ reload 加 `silent` 参数不碰 loading,或 Gate 只拦截首次加载。
11. **`local_mcp_read` 把读取失败吞成 `{}`** — `local_store.rs` 读路径返回 `Value` 而非 `Result`:远端瞬态故障时前端显示"暂无配置",此时保存会覆盖原有配置(仅 `.kimi-desktop-bak` 兜底);前端 `configErr` 分支实际不可达。→ 区分"文件不存在 → 空配置"与"读取失败 → Err",前端据 Err 显示错误态。

## 🟡 Minor(可排期)

### Rust

- `cli.rs` `is_newer`:预发布语义反了(`0.30.0-beta.1` 被判新于 `0.30.0`,预发布用户永远收不到正式版提示);版本串带前缀时 major 解析为 0。→ 引 semver crate 或先正则提取数字段。
- `server.rs`:进程"秒挂"无早退——banner 等满 12s 后再空轮询 token 25 轮(SSH 最坏分钟级)才报错。→ token 等待阶段同样每轮检查 probe。
- `server.rs`:退出监控把 `try_wait` 的 `Err` 当已退出做清理但不动 `mgr.proc`,误报时下次 start 覆盖旧 handle → 孤儿。→ 该分支先 `take()` 走 `kill_handle` 兜底。
- `server.rs`/`ssh.rs`:`parse_banner_token` 不剥 ANSI(SSH pty 路径横幅着色时解析失败);`TokenSlot` 只留第一个,误报行永久占槽。→ 行首匹配 `token:` + strip ANSI + 最小长度校验。
- `lib.rs`:退出清理(ExitRequested → stop/SSH close)无超时兜底,清理一挂应用永不退出。→ 整块包 `tokio::time::timeout`(如 10s),超时 `exit(0)`。
- `lib.rs` `start_backend`:无"启动中"去重,bootstrap 在途时重复调用会并行再跑一遍(代次 +2、WS 重建、事件双发)。→ per-channel bootstrapping 标志。
- `lib.rs` `restart_backend`:无条件启动后端——服务本已停止时,set_kimi_home/set_cli_bin 等会把服务拉起,与 `experimental_set` 先判 running 的口径不一致。→ 记录调用前 running,未运行则只清状态不启动。
- `lib.rs`:`Client::builder().build()` 失败回退 `Client::new()` 会静默丢掉全部超时设置。→ 直接 expect 或删回退。
- `ws.rs`:`connect_async` 无超时(对端 accept 后永不回 upgrade 时任务永久挂起);`reconnect_attempts` 在 connect 成功即清零,flapping 场景退避失效(恒 1s 紧循环)。→ 各加 10s 超时 / 存活超阈值再清零。
- `ws.rs` `dbg()`:未落实"日志按 token 关键字过滤"红线(server.rs 有同款实现,这里漏了);`LIST sessions {e}` 会原样记录服务端返回字符串。→ dbg 内统一过滤。
- `ws.rs`:每个 WS 事件(含高频流式 delta)一次 `spawn_blocking` 磁盘 I/O,ws.log 几分钟滚满一代;滚动 rename 有并发竞态且 Windows 下目标已存在即失败。→ EVT 级降频或默认关;rename 前先删旧文件。
- `ws.rs`:`generation` 字段与 getter 无消费方;`subscribe/unsubscribe` 的 cursor 参数零调用方;`subscriptions` 只增不减,长跑后 client_hello 无界变大。→ 清死代码 + 会话回收。
- `rest.rs` `request()`:非 2xx 且响应体非 JSON 时丢失 body 文本,只回 canonical_reason(如 "Not Found")。→ 回退读 `text()` 截断带入。
- `ssh.rs`:`request_pty(false, ...)` want_reply=false,pty 分配失败无感知 → 远端进程脱离 pty,断连收不到 SIGHUP 成孤儿。→ want_reply=true 并显式报错。
- `ssh.rs`:并发首连对 known_hosts 的 read-modify-write 无互斥,可能丢记录/写重复行。→ 进程内文件互斥锁。
- `target.rs` `read_token`:"认证/连接失败立即终止"靠错误文案子串匹配,"SSH 握手/认证超时"不含子串 → 重试 25 轮约 10 分钟才报错。→ 错误分类改结构化标记。
- `target.rs`:`echo $HOME` 与 kimi 探测经 login shell,profile/motd 输出会混入 stdout 被当作路径。→ 哨兵包裹截取或只取最后一行。
- `config.rs` `write_atomic`:Windows 先删原文件再 rename,remove 后崩溃只剩 .tmp,配置静默丢失。→ `load()` 端加 .tmp 回退读取。
- `config.rs`:JSON 损坏静默回退全默认,下一次 save 覆盖损坏文件且无备份。→ 解析失败先复制 `.corrupt` 备份。
- `config.rs` `save()`:固定 tmp 名 + 无锁 load→modify→save,两命令并发互相覆盖。→ 进程级互斥锁。
- `local_store.rs` `merge_config_toml`:`read_text(...).unwrap_or_default()` 分不清"不存在"与"读失败"(权限/杀软锁定),后者会把现存配置覆盖成残缺文件。→ 存在但读失败时返回 Err。
- `local_store.rs`:`(page - 1) * page_size` 在 u32 内相乘,超大 page 时 debug panic/release 回绕。→ 转 usize 再乘。
- `local_store.rs` `aggregate_usage_daily`:`days` 无上限,`today - days(u32::MAX)` 时 NaiveDate 溢出 panic。→ `days.clamp(1, 3650)`。
- `Cargo.toml`:`rust-version = "1.77"` 失真——传递依赖 russh 需 1.85、keyring 需 1.88、notify-rust 需 1.89,1.77 工具链无法构建。→ 提升到 1.88 并同步 AGENTS.md。
- `lib.rs` `server:ready` 事件载荷带明文 `token`,渲染层从不消费(iframe src 走 `web_ui_url` 重取),属无谓的凭据广播。→ 从载荷与 `ServerReadyInfo` 删 token 字段。

### 前端

- `TitleBar.tsx`:切通道后 `cliVersion` 不清空(新通道未运行时继续显示旧版本),旧通道 `appInfo` Promise 未取消、晚到会再覆盖。→ effect 开头清空 + cancelled 标记。
- `ShellHome.tsx`:WebFrame src 拉取与停止服务竞态——停止后重试失败无条件置 'error',重试必再失败,通道卡错误态只能去设置页恢复。→ 失败分支函数式检查当前态仍为 'on' 再置 'error'。
- `ShellHome.tsx`:`getChannels` 失败被静默吞掉时,WebFrame 兜底单通道永停 'checking' 启动动画。→ 拉取失败按 'off' 渲染占位页。
- `QuotaStrip.tsx`:`appInfo(activeChannel)` 探测 Promise 未取消,快速切通道时旧结果晚到造成按钮可见性闪烁。→ cancelled 标记。
- `FolderPickerDialog.tsx`:键入路径未回车直接点"在此文件夹开始",选中的是旧 `current.path`,输入被静默忽略;并发 `browse()` 无序号,last-resolved-wins。→ 确认时先采用 `pathText`;请求序号。
- `ApiCallsTable.tsx`:`fmtMs` 对 <1s 返回裸数字无单位;数据缩减后停留在高页显示"暂无记录"和"第 5 / 2 页";`load` 无竞态防护,旧闭包响应可覆盖新页数据。→ 补 `ms`;`page > totalPages` 时回退;请求序号丢弃过期响应。
- `OnboardingPage.tsx`:`passwordSaved=false` 分支已死(Rust 侧 keyring 失败直接报错);人为等待 1.8s 期间取消向导,悬挂 continuation 仍会 `onDone()` 启动服务。→ 删死分支;`await` 后检查 cancelled。
- `CliModelsSettings.tsx`:头注释"密钥清空 = 保持不变"与实现矛盾(清空 = null 合并删除)。→ 更正注释。
- `cliForm.tsx` `PathListField`:离线模式下「浏览选择」仍可用,但目录浏览走 REST 必然失败。→ offline 时隐藏/禁用该按钮。
- `CliExperimentalSettings.tsx`:`experimentalGet` 返回含默认值的有效值,切换任一开关会把全部有效值固化为用户设置(未来 CLI 默认值变更失效),且配置里表外已有的键被整体替换丢弃。→ 只持久化用户显式改动的键。
- `CliGeneralSettings.tsx`:`extra_skill_dirs`/`extra_agent_dirs` 清空所有行后保存等于不提交(合并语义无法删除),本页恰恰没有 `MergeNote` 提示;`default_model` 同理。→ 补 MergeNote 或支持空数组显式提交。
- `McpSettings.tsx`:设置页 tab 切换即卸载组件,未保存的可视化/JSON 编辑静默丢失,无挽留。→ dirty 时切 tab 给确认,或草稿态上移页面级。
- `SubagentsSettings.tsx`:列表 `key={p.name}`,Rust 去重 `seen` 未预置内置名(plan/coder/explore),用户自建同名 .md 会产生 key 冲突 + 重复卡片。→ Rust 端预置内置名,前端 key 拼来源后缀。
- `UsageSettings.tsx`:LiveTrend 15s 轮询只判断 `document.hidden`,切到「调用明细」子 tab 时本组件仅 CSS 隐藏仍空跑。→ 轮询条件叠加子 tab 可见性。
- `kimi-api.ts`:约 20 个方法返回 `Promise<any>`,Rust 字段改名时 typecheck 完全无感(而 typecheck 是唯一门禁)。→ 稳定形状逐步落成导出接口。
- `tauri.conf.json`:`csp: null`,壳页面无 CSP 纵深(index.html 的 meta CSP 已是最小集,可对照显式化)。→ `default-src 'self'; frame-src` 限 loopback,dev/打包两模式各验证一次。
- `capabilities/default.json`:`core:default` 顺带授予 `allow-emit`/`allow-emit-to`,渲染层只 listen。→ 如需严格最小化,枚举 core 子权限替换整条。
- `tsconfig.web.json`:未声明 `"types"`,`@types/node` 的 `process`/`Buffer` 全局类型泄漏进渲染层,typecheck 拦不住误用 Node API。→ `compilerOptions.types: []`。

### 文档

- `README.md:81`:占位页交互描述过时(目标选择已迁至通道切换器与设置→通道页,占位页只剩启动按钮)。
- `README.md:8` 与 `:81` 自相矛盾(英文版 `:120` 同):顶部"未安装 CLI 首次启动自动下载安装" vs 代码为确认弹窗后才装。→ 统一为"确认后自动安装"。
- `AGENTS.md`:"无测试套件"已过时(`local_store.rs`/`target.rs` 有 8 个 cargo 单测);目录结构未列 `hooks/`、`api.ts`、`theme.css` 等。→ 更新表述。

## ⚪ Nit(有空随手)

- `lib.rs`:远端探测失败回退把字面值 `"~/.kimi-code"` 同时作为 home/defaultHome 返回,前端若拿去拼路径会出错;头注释引用已删除的 `git.rs` 模块(`target.rs` 同)。
- `cli.rs`:`kill_on_drop` 只杀直接子进程,600s 超时后安装脚本下游子进程可能继续跑(状态不一致)。→ Windows 超时清理改 `taskkill /T`。
- `target.rs`:SSH `channel_id` 不含 port/auth,同 `user@host` 不同端口无法并存为两通道;async 上下文用阻塞 `std::fs::read_dir` 逐层遍历;备份 `copy` 失败 `let _ =` 静默(写入本身原子,风险可接受,建议至少记日志)。
- `local_store.rs`:`json_to_toml` 对数组内对象静默丢弃(未来合并写 `[[table]]` 段会丢数据);DST 边界 `.single()` 回退为 0(午夜切换时区每年命中一两次);首次写 mcp.json(未实际备份)也返回 backup 路径,前端提示会误导;单测 `read_parsed_real_config_shape` 读开发机真实配置,环境缺 `provider` 键时失败。
- `Cargo.toml`:直依赖 toml 0.8 与树内 toml 0.9/1.x 并存(toml_edit 共 4 份),纯构建体积问题。
- `useActiveSessionId.ts`:无消费方(死代码);服务停止后轮询失败时 id 不清空。
- `stores/ui.ts`:`?? s.connectionTarget ?? 'local'` 第二段为死代码;`setActiveChannel` 连续并发无序号保护。
- `App.tsx`:`upgradeMsg` 的 `setTimeout` 卸载不清理,连续两条消息时旧 timer 提前清新消息;渲染期 `useUi.getState()` 非响应式读取 onboardingMode/onboardingTarget。
- `tauri.ts`:`on()` 中 `listen()` reject 会产生 unhandled rejection。→ `pending.catch(() => {})`。
- `api.ts`:`WorkspaceItem`/`ModelItem`/`SessionEvent` 三个导出类型无使用方;`rest()` 不透传 `channel`。
- `kimi-api.ts`:`days`/`page`/`pageSize` 契约 number 而 Rust 为 u32(传负数/小数以原始 serde 错误 reject);`:41` keyring 失败兜底注释与 OnboardingPage 死分支对应,一并清理。
- `ApiCallsTable.tsx`:首载无骨架/占位;行 key 含索引,刷新时整表 remount(百行规模无实际影响)。
- `OnboardingPage.tsx`:本机「完成并启动」为 span 嵌 button,无键盘聚焦/a11y;`target=wsl/ssh` 时该入口不显示"启动中…"文案。
- `CliExperimentalSettings.tsx`:saving 期间开关未禁用,点击被静默吞掉无反馈。
- `CliIdentitySettings.tsx`:保存成功后 `savedMsg` 与 SaveBar 默认"已保存"双提示并存。
- `CliModelsSettings.tsx`:`lockAlias` 时别名输入框仍可键入但改动被静默丢弃(应 disabled);编辑 provider 已删的模型时供应商兜底为列表第一项,点保存即静默改绑;校验/删除错误统一显示在页面最底部,长列表下不易看到。
- `McpSettings.tsx`:「确认删除」3s 自动复原的 setTimeout 未在卸载时清理;启用服务器写显式 `enabled: true` 而非移除该键,与"缺省即启用"口径不一致。
- `UsageSettings.tsx`:364 天首屏请求无 cancel 标记(Skills/Subagents/Commands 同);`:90` 注释"15 周前"与 `HEATMAP_WEEKS = 52` 不符。
- `GeneralSettings.tsx`:挂载时 `appInfo(activeChannel)` 调了两次;本机官方脚本安装时本页无升级按钮,描述有歧义。
- `CommandsSettings.tsx`:`scope: 'user' | 'project'` 与 Rust 实际返回 `'user' | 'agents'` 不符(字段未使用,仅类型失真)。
- `capabilities/default.json`:显式列出的 4 条 allow-is-*/listen 已被 `core:default` 涵盖,冗余。
- `tauri.conf.json`:identifier `com.github.yann.kimi-desktop` 一经发布不可变更,首发前确认归属定稿;NSIS 未配 publisher/copyright,安装程序发布者显示为空。
- `vite.renderer.config.mts`:头注释引用已不存在的 `electron.vite.config.ts`。
- `build/icon.png`:未被任何配置引用,疑似 Electron 遗留死资源。
- `ShellHome.tsx`:iframe 无 `sandbox` 属性——内嵌官方 UI 的功能必需,记录为已接受风险而非缺陷。

## 建议处理节奏

1. **下个小版本(v0.3.4)**:Major 1-5(Rust 时序,均为小改动)+ 9-11(前端数据正确性)+ 待实测 T1/T2。
2. **再下一版(v0.3.5)**:Major 6-8(SSH/WS 加固)+ Minor 中 `rust-version`、`server:ready` token 字段、配置原子写/锁三件套。
3. **体验批**:Minor 前端各条可打包一次"设置页打磨"提交。
4. **Nit**:不设里程碑,随相关文件改动顺手清理。
