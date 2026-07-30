# Kimi Code Desktop

[English](#english) | 中文

基于 [Kimi Code CLI](https://github.com/moonshotai/kimi-code) 的桌面客户端。白底 + 蓝色主题(Kimi Web 风格),Tauri v2(Rust)+ React + TypeScript 实现。

> 桌面壳而非 AI 运行时:所有会话/模型/工具能力由 Kimi Code CLI(`kimi web` 本地服务,REST + WebSocket)提供。
> 未安装 CLI 时应用会在首次启动时自动下载安装;已安装则检测更新,有新版时询问后一键升级。

## 功能

### 会话与对话
- **会话侧栏**:按工作区分组、搜索、归档/恢复、重命名;工作区行 hover 快捷操作(新建对话/重命名/注销工作区);可整体收起(Ctrl+B)
- **新建任务**:应用内文件夹浏览器,支持盘符选择(此电脑层级)与路径直输;**新建对话**:在当前/最近工作区秒开
- **聊天**:流式 Markdown、代码高亮、思考过程折叠、工具调用卡片(连续调用自动聚合)、子代理状态卡、审批卡片(批准/会话级批准/拒绝)、问答卡片(单选/多选/自定义)

### Composer(对齐 Kimi Web)
- **状态条 chips**:后台 Bash(N)、子 Agent(N)、待办(完成/总数),点击弹出明细(任务状态/耗时/todo 清单)
- **权限模式**:自动通过/手动审批/Yolo(弹层带说明)
- **模式**:默认/计划/Swarm/目标(目标带 goal 输入)
- **模型选择**:按供应商分组的弹层
- **思考强度**:按模型 `support_efforts` 动态生成(名称数量不限),真实回显(会话值 → 模型 default_effort → 全局配置),`always_thinking` 模型不显示"关"
- **附件**:任意文件(图片直传,其它走 files API);粘贴、**全窗口拖拽**(拖到应用任意角落松开即上传)、按钮选择三通道

### 面板
- **Git 面板**:分支、工作区改动(增删统计 + 单文件 diff 着色)、提交历史;轮次结束自动刷新
- **代码预览面板**:编辑器式 diff 视图(行号、红删绿增、@@ 蓝底、文件切换)

### 设置
常规(**数据目录自定义**:Kimi Code 工作区默认在 C 盘用户目录,可改到其它路径,切换自动重启本地服务;**CLI 来源选择**:官方脚本安装 / npm 全局(.cmd shim)/ 自定义路径,应用内一键升级仅对官方脚本安装开放 / 默认权限模式 / 日志)/ 代码预览 / **模型设置**(Kimi 账号 OAuth 设备码登录、Token/MCP 额度、模型列表设默认、自定义供应商滑出面板:ID/名称/类型/URL/密钥/模型行(含上下文大小)/请求头行、模型深度编辑 display_name·max_context_size·capabilities·support_efforts·default_effort、次主力模型 secondary_model、全局思考配置)/ 子智能体(可委派 profile + 当前会话运行中子代理)/ 插件管理 / 技能 / MCP(可视化 + JSON 编辑,写盘自动备份)/ 命令 / **使用统计**(时间范围、统计卡、GitHub 式活跃热力图、按天模型堆叠趋势、模型 donut;数据源为 wire.jsonl 的 usage.record,已与 step.end 交叉验证无重复计数)/ 引导

### 桌面集成
系统托盘、任务完成/待审批桌面通知、单实例、无边框窗口自定义标题栏

### 远端后端
除本机外,后端 `kimi web` 也可运行在 **WSL** 或 **SSH 主机** 上(应用内建进程内 SSH 客户端与端口转发,密码存系统凭据管理器,不落明文配置)。

## 架构

```
Tauri Rust 后端(src-tauri/)
  ├── CLI 自检测:未安装→官方脚本自动安装;有更新→询问后升级
  ├── spawn `kimi web --no-open --port <空闲端口>`   # 后端服务(本机/WSL/SSH)
  ├── REST 代理  → http://127.0.0.1:<port>/api/v1/*(Bearer 认证,统一信封 {code,msg,data})
  ├── WS 代理    → /api/v1/ws(渲染进程无法设 Bearer 头,必须由壳代理)
  │                帧格式:{type=事件名, seq, epoch, session_id, payload}
  ├── Git        → git status/log/diff
  └── 本地数据   → ~/.kimi-code 直读(插件/技能/子代理/cron/mcp.json/usage 聚合/盘符)
渲染进程(React + zustand)
  ├── platform/kimi-api.ts  壳与渲染层之间的 API 契约(window.kimiApi)
  ├── platform/tauri.ts     契约的 Tauri 实现(invoke/事件监听)
  ├── stores/sessions.ts  会话与工作区
  ├── stores/stream.ts    聊天归一化:snapshot 水合 + WS 事件走同一条 reducer
  └── stores/ui.ts/git.ts 界面状态
```

### 关键实现细节(踩过的坑,供参考)
- **断线恢复**:seq/epoch 游标 + `resync_required` → snapshot 重建
- **崩溃自愈**:kimi web 意外退出时壳会清理连接状态并广播 `server:exited`,前端回到手动启动页,可就地重启服务
- **新建会话必须显式带 `agent_config.model`**(空串会报 `model.not_configured`)
- **providers REST 的 models 必须是对象数组**(`{model, max_context_size}` 必填);`custom_headers` 不在 providers REST 内,需走 `POST /api/v1/config` merge(会真实写入 config.toml 并随请求发送)
- **`GET /api/v1/config` 返回 camelCase**(maxContextSize/supportEfforts),写回用 snake_case
- **审批/问答列表端点需要 `?status=pending`**,响应为 `{items}` 包裹
- **会话删除只有归档**(CLI 0.29.2 无删除端点)
- token 统计口径:`usage.record` ≈ `step.end`(交叉验证差 1%),输入/输出/缓存分开记账

## 安全说明

- **Bearer token 不出本机**:REST/WS 只连 `127.0.0.1`,token 由壳持有,日志按 "token" 关键字过滤。
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

- **手动启动后端**:默认启动应用后**不自动连接** kimi web 服务,进入手动启动页(显示 CLI 二进制/版本/数据目录),点击"启动 Kimi Code 服务"才连接;可在启动页或设置页勾选"启动应用时自动连接"恢复自动模式。设置 → 常规 → 本地服务 可随时停止/启动服务
- **数据目录自定义** 与 **CLI 来源选择**(见上方"设置"章节)

已知限制:通知点击不聚焦主窗口(插件限制)、通知不带图标。

## 当前边界(受 CLI 0.29.2 限制)

- 插件的禁用/卸载、定时任务管理、记忆与索引库:CLI 暂无服务端接口(页面已隐藏,开放后恢复)
- 会话删除 = 归档(可恢复),无物理删除

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

运行时/构建依赖均为宽松许可证(MIT / Apache-2.0 / BSD / ISC,如 React、Tauri、zustand、highlight.js 等),与 AGPL-3.0 兼容;`sharp`(Apache-2.0)仅用于设计期图标脚本,不进入运行时产物。Kimi Code CLI 本身由 Moonshot AI 按其自身条款分发,不属于本仓库的授权范围。

---

## English

A desktop client for [Kimi Code CLI](https://github.com/moonshotai/kimi-code), built with Tauri v2 (Rust) + React + TypeScript.

This is a **desktop shell, not an AI runtime**: all session/model/tool capabilities are provided by the CLI's local `kimi web` service (REST + WebSocket). The app auto-installs the CLI on first launch and offers in-app upgrades. The backend can run on the local machine, in WSL, or on a remote host over SSH (built-in SSH client with port forwarding; host keys are verified TOFU-style; passwords live in the OS credential manager).

Highlights: streaming chat with tool-call/approval/sub-agent cards, permission modes (auto/manual/Yolo), plan/Swarm/goal modes, thinking-effort control, full-window drag & drop attachments, Git panel with diff view, model/provider management with OAuth device-code login, usage statistics with heatmap, system tray and desktop notifications.

```bash
npm install
npm run tauri:dev     # dev
npm run tauri:build   # build installer for the current platform
```

Licensed under **AGPL-3.0** (see [LICENSE](LICENSE)): free to use, modify, and distribute — including commercially — but any distributed derivative or network service built on this code must also be open-sourced under AGPL-3.0. "Kimi" and "Kimi Code" are trademarks of Moonshot AI; this project is a desktop client for the CLI and is distributed under its own license.
