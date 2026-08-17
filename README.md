# Kimi Code Desktop

[English](#english) | 中文

基于 [Kimi Code CLI](https://github.com/moonshotai/kimi-code) 的桌面客户端。白底 + 蓝色主题(Kimi Web 风格),Tauri v2(Rust)+ React + TypeScript 实现。

> 桌面壳而非 AI 运行时:对话界面直接内嵌官方 `kimi web` 的 Web UI(iframe),会话/模型/工具/Git 改动面板等能力全部来自官方界面,随 CLI 升级自动同步。
> 未安装 CLI 时应用会在首次启动时自动下载安装;已安装则检测更新,有新版时询问后一键升级。

## 功能

### 对话(官方 Web UI 内嵌)
- 对话页通过 iframe 直连本地 `kimi web` 服务(`http://127.0.0.1:<port>/#token=<token>`),token 由壳自动注入,无需登录
- 会话列表、流式回复、工具调用、审批、Git 改动面板、模型/供应商设置等均由官方 UI 提供,**CLI 升级即 UI 升级**
- 聊天中的外链点击一律转系统浏览器打开,webview 不导航离开应用

### 壳自身提供的能力
- **用量统计 tab**:时间范围、统计卡、GitHub 式活跃热力图、按天模型堆叠趋势、实时曲线(数据源为 wire.jsonl 的 usage.record,已与 step.end 交叉验证无重复计数)
- **额度条**:Token/MCP 额度实时展示
- **桌面通知**:窗口失焦时,任务完成 / 待审批 / 待回答会发桌面通知
- **设置**:常规(数据目录自定义、CLI 来源选择、日志)/ CLI 配置(模型与供应商、通用行为[默认模型/权限模式/plan 模式等]、循环与后台、服务与图像、思考、身份、实验开关)/ MCP(可视化 + JSON 编辑,写盘自动备份)/ 技能 / 子智能体 / 命令 / 通道
- **桌面集成**:系统托盘、单实例、无边框窗口自定义标题栏

### 远端后端
除本机外,后端 `kimi web` 也可运行在 **WSL** 或 **SSH 主机** 上(应用内建进程内 SSH 客户端与端口转发,密码存系统凭据管理器,不落明文配置)。

## 架构

```
Tauri Rust 后端(src-tauri/)
  ├── CLI 自检测:未安装→官方脚本自动安装;有更新→询问后升级
  ├── spawn `kimi web --no-open --port <空闲端口>`   # 后端服务(本机/WSL/SSH)
  │     从 stdout banner / PTY 输出解析地址与 token
  ├── web_ui_url 命令 → http://127.0.0.1:<port>/#token=<token>(供 iframe 加载)
  ├── WS 通知订阅器 → /api/v1/ws(壳内部订阅,不转发给渲染层)
  │     枚举会话订阅 turn.ended / work_changed → 失焦时发桌面通知
  ├── REST 客户端 → /api/v1/*(Bearer 认证,额度/统计等壳自身功能使用)
  └── 本地数据   → ~/.kimi-code 直读(技能/子代理/mcp.json/usage 聚合/盘符)
渲染进程(React + zustand,src/)
  ├── components/ShellHome.tsx  三 tab 壳:对话(iframe)/ 统计 / 设置
  ├── components/QuotaStrip.tsx 额度条
  ├── platform/kimi-api.ts      壳与渲染层之间的 API 契约(window.kimiApi)
  ├── platform/tauri.ts         契约的 Tauri 实现(invoke/事件监听)
  └── stores/ui.ts              界面状态
```

### 关键实现细节(踩过的坑,供参考)
- **iframe 直嵌可行**:loopback 下官方服务端不发 CSP frame-ancestors / X-Frame-Options,无需反代;壳在 healthz 通过后会 HEAD `/` 做一次预警检查
- **token 时序竞争**:前端拿 `web_ui_url` 带重试,后端未就绪时不白屏
- **端口稳定(源即身份)**:web UI 的"新浏览器"验证状态按 iframe 源(`http://127.0.0.1:<port>`)存 localStorage,端口漂移就会重弹验证;故固定从 58666 起,且启动前先回收同 home 的残留实例(应用崩溃/强杀留下的孤儿,POST shutdown + 注册表 pid 强杀兜底)保证该端口可用
- **崩溃自愈**:kimi web 意外退出时壳会清理连接状态并广播 `server:exited`,可就地重启服务
- token 统计口径:`usage.record` ≈ `step.end`(交叉验证差 1%),输入/输出/缓存分开记账

## 安全说明

- **Bearer token 不出本机**:REST/WS/iframe 只连 `127.0.0.1`,token 由壳持有,日志按 "token" 关键字过滤。
- **SSH host key 采用 TOFU**(trust on first use):首次连接记录指纹到配置目录 `known_hosts`,之后指纹变更会拒绝连接并提示(防中间人攻击);SSH 密码只存系统凭据管理器。
- **外链隔离**:聊天内容中的链接点击后一律由系统外部浏览器打开(仅放行 http/https),webview 不会导航离开应用。
- **配置原子写**:`desktop-config.json` / `mcp.json` 均先写临时文件再替换,避免崩溃留下截断文件;mcp.json 另有 `.kimi-desktop-bak` 备份。
- 首次启动时 CLI 自动安装使用官方安装脚本(`irm | iex` / `curl | sh`),与 Kimi Code 官方文档推荐方式一致。

## 开发

```bash
npm install
npm run tauri:dev      # 开发(vite dev 5188 端口 + cargo 增量编译,首次较慢)
npm run typecheck      # 渲染层与 vite 配置的 TS 检查
```

需要 Rust 工具链(cargo)。Windows 下使用系统 WebView2,安装包体积显著小于 Electron 方案。

## 打包

```bash
npm run tauri:build    # 产出当前平台的安装包(产物在 src-tauri/target/release/bundle/)
```

目前在 Windows(NSIS 安装包)上验证;macOS / Linux 可按 Tauri 默认目标构建,尚未测试,欢迎反馈。

## 行为说明

- **启动即进主页面**:启动应用后直接进入三 tab 主页面,不自动拉起 kimi web;对话页显示占位图(可选服务运行位置:本机/WSL/SSH,未配置过的远端目标会先进连接向导),点"启动 Kimi Code 服务"后才加载官方 Web UI。本机未安装 CLI 时会先弹安装确认,不静默下载。设置 → 常规 → 本地服务 与额度条的"停止服务"可随时停止/启动服务,停止后对话页回到占位图,统计/设置等本地页面不受影响
- **数据目录自定义** 与 **CLI 来源选择**(见上方"设置"章节)

已知限制:通知点击不聚焦主窗口(插件限制)、通知不带图标。

## 贡献

欢迎 Issue 与 Pull Request。提交前请确保:

- `npm run typecheck` 通过
- `cd src-tauri && cargo check` 通过

提交 PR 即表示你同意以本项目的 AGPL-3.0 许可证授权你的贡献。

## 商标声明

"Kimi"、"Kimi Code" 及相关名称与标识的权利归 Moonshot AI(月之暗面)所有。本项目是基于 Kimi Code CLI 的桌面客户端壳,使用这些名称仅为描述兼容性目的。

## License

Copyright (C) 2025 Kimi Code Desktop contributors

本项目以 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 开源。要点(以许可证原文为准):

- **可以自由使用、复制、修改、分发**,包括商业用途和收费分发——AGPL 不禁止"卖钱"。
- **核心约束是"Copyleft 延伸到网络服务"**:分发修改后的版本,或把(修改过的)本软件作为网络服务对外提供,都必须以 AGPL-3.0 向接收者/用户提供对应的完整源代码。
- 即:**不能拿这套代码改了之后闭源发布或闭源提供 SaaS 服务**;只要遵守开源义务,商用本身是被允许的。
- 本软件按"原样"提供,不附带任何担保(详见许可证第 15、16 条)。

### 第三方组件

运行时/构建依赖均为宽松许可证(MIT / Apache-2.0 / BSD / ISC,如 React、Tauri、zustand 等),与 AGPL-3.0 兼容;`sharp`(Apache-2.0)仅用于设计期图标脚本,不进入运行时产物。Kimi Code CLI 本身由 Moonshot AI 按其自身条款分发,不属于本仓库的授权范围。

---

## English

A desktop client for [Kimi Code CLI](https://github.com/moonshotai/kimi-code), built with Tauri v2 (Rust) + React + TypeScript.

This is a **desktop shell, not an AI runtime**: the chat UI embeds the official `kimi web` Web UI directly via iframe (`http://127.0.0.1:<port>/#token=<token>`, token injected by the shell), so sessions, models, tools and the Git changes panel all come from the official UI and upgrade in lockstep with the CLI. The app auto-installs the CLI on first launch and offers in-app upgrades. The backend can run on the local machine, in WSL, or on a remote host over SSH (built-in SSH client with port forwarding; host keys are verified TOFU-style; passwords live in the OS credential manager).

What the shell itself adds: a usage-statistics tab (heatmap / per-day model trends / realtime curves), a quota strip, desktop notifications when the window is unfocused (turn finished / pending approval / pending question), settings (general / CLI config / MCP / skills / sub-agents / commands / channels), system tray, and single-instance.

```bash
npm install
npm run tauri:dev     # dev
npm run tauri:build   # build installer for the current platform
```

Licensed under **AGPL-3.0** (see [LICENSE](LICENSE)): free to use, modify, and distribute — including commercially — but any distributed derivative or network service built on this code must also be open-sourced under AGPL-3.0. "Kimi" and "Kimi Code" are trademarks of Moonshot AI; this project is a desktop client for the CLI and is distributed under its own license.
