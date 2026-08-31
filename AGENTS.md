# AGENTS.md

本文件为 AI 编码代理提供本仓库的工作指引。

## 项目简介

Kimi Code Desktop:基于 [Kimi Code CLI](https://github.com/moonshotai/kimi-code) 的桌面客户端壳(Tauri v2 + React + TypeScript)。对话界面通过 iframe 内嵌官方 `kimi web` Web UI,壳自身提供用量统计、额度条、桌面通知、设置、托盘等能力。后端 `kimi web` 可运行在本机 / WSL / SSH 远端。

## 技术栈

- 前端:React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4 + zustand + lucide-react
- 后端:Rust(edition 2021, rust-version 1.77)+ Tauri v2 + tokio + reqwest(rustls)+ tokio-tungstenite + russh + keyring
- 主题:亮暗双主题,跟随官方 web UI(data-theme 属性切换,见下「约定」);色值全面对齐官方实测(浅色白底 + 官方蓝 #1783ff,深色纯中性灰 #121212 系 + #1a88ff)
- 字体:官方同款可变字体内嵌(src/assets/fonts,Schibsted Grotesk Variable 拉丁 + Noto Sans SC Variable 中文,均为 OFL 开源;栈与渲染参数见 theme.css;行标题 13px/475 对齐官方 .rlabel)

## 目录结构

```
src/                    渲染进程(React)
  components/           壳组件:ShellHome(视图容器,导航在标题栏)/ TitleBar(铺平用量条(QuotaStrip)+ 对话/统计/设置/检查更新/主题切换图标导航(官方同款黑底 tooltip)+ 多通道切换器 + 窗口控制;主题切换经 pushThemeToFrames 反推官方 iframe,官方 MutationObserver 监听 data-color-scheme 无刷新跟随;检查更新按钮常驻,点击=手动检查,有新版出红点,点开 UpdateDialog(发现新版本/忽略此版本/下载安装))/ QuotaStrip(标题栏铺平式用量直显:实时指标胶囊 + 各窗口迷你额度计 + 钱包,停止服务带确认)/ SkinStandee(实验性皮肤立绘,设置/统计/主页透出) / settings/ / pet/(桌宠窗口 PetWindow + 悬浮菜单 PetMenu)
  components/ui/        官方 kimi web 自研 ui-* 组件库(Vue)的 React 复刻:Select(fixed+portal 毛玻璃弹层、行首蓝对勾)、Switch(36×20)、Segmented(分段选择器,2-4 个短选项用;透明槽(不加背景色)+ 细边,elevated 选中面;白底页面上使用需经 className 补 bg-surface-tertiary 槽色)、Input/Textarea(inputCls/textareaCls 类串 + 组件;md 38px/sm 32px,0.5px border-strong 边,input-bg 底[浅纯白/深 10% 白]+ shadow-xs,focus = accent 边 + 3px accent-soft 环,hover 无变化);样式值实测自 CLI dist-web,新增表单控件一律用这套,不用原生 <select>/自绘开关/手写 input 类串。设置页卡片为官方填充式灰面板(components/settings/common.tsx 的 Card = surface-tertiary 无底边),面板内徽章/控件槽用 bg-fill、按钮/选中项用 bg-elevated;图表/明细表等数据可视化用 SurfaceCard(白底细边,灰面板会让图表发闷、热力图无色档融底)
  pages/                Onboarding / Settings(设置页「资源」组含插件分区 PluginsSettings:经 kimi web REST /api/v1/plugins* 管理插件,与 TUI /plugins 等效,安装/启停/移除均由 CLI 自身落盘;老版本 CLI 无此路由时提示升级)/ stats
  platform/kimi-api.ts  壳与渲染层的 API 契约(window.kimiApi)
  platform/tauri.ts     契约的 Tauri 实现(invoke / 事件监听)
  platform/os.ts        运行平台判定(IS_MAC/IS_WINDOWS,UA 方式;WSL 入口仅 Windows、协议 URL 分叉用)
  platform/protocol.ts  pet:// skin:// 自定义协议供图 URL 的平台分叉(Windows/Linux 为 http://<scheme>.localhost,mac 为 <scheme>://localhost;Rust handler 按 path 解析不受形态影响,CSP 两种形态均已放行)
  stores/ui.ts          界面状态(zustand)
src-tauri/src/          Rust 后端
  lib.rs                Tauri 入口与命令注册
  server.rs             spawn/管理 `kimi web` 进程,解析地址与 token;首选端口按构建类型分叉(release 58666 / dev 58766)
  rest.rs / ws.rs       REST 客户端与 WS 通知订阅器(/api/v1/*)
  cli.rs                CLI 自检测 / 安装 / 升级
  ssh.rs                进程内 SSH 客户端与端口转发
  config.rs / local_store.rs / target.rs   配置、本地数据直读、运行目标(本机/WSL/SSH)
  skin.rs               用户自选皮肤(实验性):扫描 <config_dir>/skins 下的 png/webp/jpg,经 skin:// 自定义协议供图;内置皮肤注册表在前端(src/components/skins.ts,构建时扫描 src/assets/skins);开关与选中存 desktop-config.json 的 skin_enabled/skin_slug,立绘渲染见 SkinStandee;对话页内透出(skin_in_chat):主窗口 initialization_script_for_all_frames 注入 assets/chat_skin_inject.js(仅回环源子框架生效,内含 origin 守卫),壳侧桥接见 src/components/chatSkinBridge.ts(postMessage 协议:ready/cfg,素材经壳 fetch 转 dataURL 投递),不碰 dist-web、官方升级零影响。同一注入脚本尾部还有 prefs 模块:上报官方 web UI 的主题/语言(读 kimi-web.color-scheme/kimi-locale,hook localStorage 写入实现同帧低延迟同步,MutationObserver/matchMedia/轮询兜底;加载 3s 后健康自检上报,官方改版契约失效时降级可见),壳侧桥接 src/components/chatPrefsBridge.ts → stores/ui.ts 的 theme/locale(持久化 kimi.theme/kimi.locale,同源桌宠窗经 storage 事件跟随);上行消息统一经 src/components/bridgeGuard.ts 三重校验(origin + 来源 iframe + name 下发的 nonce);桥接健康状态在 设置→桌面·实验性「页面桥接」可见;反推通道 set 消息(theme/locale 均可选):theme 三态 light/dark/system(壳 ShellTheme 同三态,stores/ui.ts resolveTheme 经 matchMedia 解析落地 data-theme + 系统明暗监听;上报带 themePref 原始偏好防 system 被解析值覆盖)写存储+DOM 官方无刷新跟随(标题栏/设置页共用 pushThemeToFrames),locale 只写 kimi-locale 存储、下次加载生效(pushLocaleToFrames,设置→常规「界面」卡的主题/语言/字号三行)。已知限制:官方设置页主题选择器是挂载时读存储的 React 态(无 storage 监听),壳侧改写后其选中显示要刷新页面才同步(CSS 本身即时生效)
  pet.rs                桌宠悬浮窗(实验性):透明置顶小窗 + 状态机(ws.rs 事件驱动);内置宠物注册表 builtin_pets()(素材 src/assets/pets/<slug>/),并扫描 <config_dir>/pets(custom,导入落点,与 skins 同级;后续"自定义存储路径"随 config::config_dir 一并切换)、<kimi_home>/pets(兼容旧布局)与 ~/.petdex/pets(兼容 kimi-pet.v0/petdex 布局),外部精灵图经 pet:// 自定义协议供图;右键唤前端自绘菜单(换宠物悬停子菜单/点击穿透/隐藏,PetWindow 内渲染,动作直调 petSet* 命令,失焦/Esc 关闭);支持设置页导入 zip 宠物包(pet::import_zip 解压校验到 <config_dir>/pets);开关存 desktop-config.json 的 pet_enabled/pet_slug/pet_click_through(穿透开启后窗口忽略鼠标,只能到设置页关闭);M5+M6 扩展:pet-menu 悬浮菜单窗(label pet-menu,失焦 hide 收起;单击开关菜单、双击唤回主窗 pet_restore_main)、pet:bubble/pet:minions/pet:menu-visible 事件(turn 概要/审批详情/配额提醒、活跃子代理计数、菜单开着压制气泡)、tired/sleep 时长显示态、闲置散步(pet_wander 配置 + pet_nudge 挪窗)、pet_menu_* 系列命令(钉选存 menu_pinned_sessions)
  updater.rs            应用自动更新(tauri-plugin-updater + 静态 latest.json,minisign 签名校验):app_update_check/app_update_install 命令 + 启动延迟静默自检(dev 跳过,dev 下由 TitleBar 挂载时静默检查兜底);发现新版时标题栏常驻更新按钮出红点(ArrowDownToLine + bg-danger 圆点;点击=手动检查,有新版直接开弹窗,无新版出「已是最新」瞬时反馈;「忽略此版本」持久化 localStorage kimi.appUpdateIgnored),点开 UpdateDialog(版本说明/取消/忽略/打开下载页/下载并安装,进度走全局 store appInstalling/appProgress);下载与安装分两步,安装前先 stop_all_backends 关停所有通道 kimi web(插件 install 是 ShellExecute 拉起 NSIS 后 std::process::exit,不触发 ExitRequested,不停则服务变孤儿占住首选端口、重启后端口顺延);双下载源按序回退——CNB 镜像优先(cnb.cool 仓 updater 分支的 latest.json raw 链接)、GitHub Releases 兜底,check 外包 15s tokio 超时(不能用 UpdaterBuilder::timeout,它会同时掐断 download);签名公钥在 tauri.conf.json plugins.updater.pubkey,私钥 ~/.tauri/kimi-desktop.key 不入库(CI 走 TAURI_SIGNING_PRIVATE_KEY secret);发版见 .github/workflows/release.yml(push v* tag → 草稿 Release;release-windows 出 NSIS + 便携 zip,release-macos 串行跟跑、出未签名的 Apple Silicon dmg 并合并双平台 latest.json——并行会互相覆盖丢平台;mac 产物无 Developer ID 签名,首次打开需在 系统设置→隐私与安全性 允许(或 xattr -d com.apple.quarantine)),正式发布(published)后 .github/workflows/sync-cnb.yml 自动把 tag 与 CNB 版 latest.json 同步到 CNB 镜像仓(CNB 仓 .cnb.yml 流水线建 Release 并回传安装器附件 setup.exe + msi,仅 Windows;darwin 平台 URL 在 CNB 版 latest.json 中保持 GitHub 直链;需 CNB_TOKEN secret,权限 repo-code 读写)
build/                  图标等资源;design/ 设计稿;docs/ 评审与跟踪文档;out/renderer 前端构建产物
```

## 常用命令

```bash
npm install
npm run tauri:dev        # 开发(vite dev 5188 + cargo 增量编译);合并 src-tauri/tauri.dev.conf.json
                         # (独立 identifier → 单实例锁/配置目录/WebView2 profile 与正式版隔离,可并存)
npm run typecheck        # 渲染层与 vite 配置的 TS 检查(提交前必过)
npm run build:renderer   # 仅构建前端 → out/renderer
npm run tauri:build      # 打包当前平台安装包(产物在 src-tauri/target/release/bundle/);
                         # 已开启 updater 产物,需先 export TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kimi-desktop.key
cd src-tauri && cargo check   # Rust 侧检查(提交前必过)
```

## 约定

- **API 契约先行**:渲染层不直接 invoke;新增壳能力时先扩展 `platform/kimi-api.ts` 接口,再在 `platform/tauri.ts` 实现,Rust 侧在 `lib.rs` 注册命令,三处保持同步。
- **本地数据直读 kimi_home 目录**(技能/子代理/mcp.json/usage 聚合);配额、统计等走 REST(Bearer 认证)。
  ⚠️ kimi_home **不一定是 `~/.kimi-code`**:`cli::kimi_home()` 的解析顺序是 用户自定义(desktop-config.json 的 kimi_home)> `KIMI_CODE_HOME` 环境变量 > 默认 `~/.kimi-code`。任何读写 kimi-code 数据目录的代码都必须走 `cli::kimi_home()`,严禁硬编码 `~/.kimi-code`(M3 实测:本机设了 `KIMI_CODE_HOME=D:\Administrator\kimi-code`,写默认目录会导致功能静默失效)。
- **配置原子写**:`desktop-config.json` / `mcp.json` 先写临时文件再替换;mcp.json 写盘前留 `.kimi-desktop-bak` 备份。
- **主题双态**:组件一律用 `bg-surface`/`text-text` 等令牌类(theme.css `@theme`),禁止硬编码色值;暗色经 `[data-theme='dark']` 覆盖同名变量生效,新增颜色要亮暗各给一值;确需主题无关的固定色(如 QR 白底、深色 toast)须注释说明。
- **i18n 已全量落地**(语言跟随官方 UI,经 chatPrefsBridge 写入 store):`src/i18n/index.ts` 导出 `useT()`(组件内,响应式)/`t()`(非组件上下文,常别名 tStatic 用于持久事件回调防闭包钉住旧 locale);词条按模块放 `src/i18n/messages/<area>.ts`(zh/en 必须成对,点分键,{name} 插值,zh 为源)。新增用户可见文案一律进字典,禁止在组件里写死中文;代码注释保持中文不进字典。
- **config.toml 合并写用 `toml_edit`** 以保留注释/格式;只读解析用 `toml`。
- **本机 CLI 双候选选新**(`cli::ensure_local_bin_pick`):数据目录/bin 与 PATH 同时存在 kimi 且非同一文件时,启动后首次检测按 `--version` 选较新的生效(平局/探测失败维持 home 优先;custom/KIMI_CODE_BIN 覆盖绝对优先),避免数据目录残留旧版静默遮蔽 npm 全局新版;每次运行只比较一次,set_cli_bin/set_kimi_home 后失效重估。升级通道按生效来源分叉:home=`kimi upgrade`,其余=`npm update -g`。
- 注释和文档用中文(README 中英双语),代码标识符用英文。
- 日期/统计口径依赖**本地时区日历日**(chrono,不用 UTC)。

## 安全红线(勿破坏)

- Bearer token 不出本机:REST/WS/iframe 只连 `127.0.0.1`;日志需按 "token" 关键字过滤。
- SSH host key 采用 TOFU:指纹存 `known_hosts`,变更即拒绝连接;SSH 密码只存系统凭据管理器(keyring),不落明文。
- 聊天外链一律转系统浏览器打开(仅 http/https),webview 不导航离开应用。
- iframe 直嵌依赖 loopback 下官方服务端不发 CSP frame-ancestors / X-Frame-Options,不要引入破坏该前提的反向代理。

## 注意事项

- 无测试套件;验证手段是 `npm run typecheck` + `cargo check` + 手动 `tauri:dev`。
- **dev 与正式版并存设计**:`tauri:dev` 合并 `tauri.dev.conf.json`(identifier `...-dev`)→ 单实例锁、`app_data_dir`(desktop-config.json/logs/自定义 skins/pets)、WebView2 用户数据目录全部随 identifier 隔离;`server::START_PORT` 按 `cfg!(debug_assertions)` 分叉(dev 58766 / release 58666,顺延窗口互不重叠),reclaim 各管各的首选端口、互不回收;窗口标题/托盘 tooltip dev 加 `[dev]` 后缀(lib.rs `APP_DISPLAY_NAME`)。kimi_home 默认仍共享(真实会话/配额/token,CLI 注册表天然支持多实例);需要隔离数据时设 `KIMI_CODE_HOME=<scratch>` 再启动 dev 即可。
- 仅 Windows(NSIS)实机验证过;macOS(Apple Silicon dmg,未签名,minimumSystemVersion 13.3)已随 release.yml 出包并做了平台分叉适配(CLI 安装/升级走 install.sh/bash -lc、协议 URL 形态、桥接 origin 白名单补 tauri://localhost、非 Windows 隐藏 WSL 入口、Dock Reopen 唤回主窗),但未经真机实测——WKWebView 下 `tauri://localhost` 的 isSecureContext、iframe 嵌 127.0.0.1 的 localStorage 分区行为是首要验证项。改动尽量保持跨平台可行,但不要为未测试平台做投机性适配。
- 许可证 MIT,引入运行时依赖时注意许可证兼容(勿引入 copyleft 组件)。
- `token 时序竞争`、`崩溃自愈(server:exited)` 等时序逻辑见 README「关键实现细节」,改动前先读。
- **运行期建窗/关窗的命令必须是 async**:同步命令占住主线程,`WebviewWindowBuilder::build()` 等事件循环初始化 WebView2 会死锁(桌宠 M1 实测踩过,见 docs/desktop-pet-design.md)。
- **关窗语义**:点 X 一律 `prevent_close` + emit `app:close-requested`(payload=是否有后端在跑),前端弹"是否关闭进程"确认框——"退出程序"走 `confirm_close`(app.exit),"进入托盘"走 `hide_main_to_tray`(必须是 async 命令);最小化按钮 − 只是普通任务栏最小化,不进托盘。托盘图标 `include_bytes!` 内嵌(不依赖 resource_dir/cwd);托盘唤回统一走 `restore_main`(unminimize+show+focus,托盘左键/菜单/单实例复用)。
