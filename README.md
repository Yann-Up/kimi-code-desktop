<div align="center">

<img src="design/logo-final.png" width="96" alt="Kimi Code Desktop" />

# Kimi Code Desktop

**[Kimi Code CLI](https://github.com/moonshotai/kimi-code) 的桌面客户端——把官方 Web UI 装进原生窗口,再加用量统计、额度条、桌宠、托盘与自动更新。**

[![Release](https://img.shields.io/github/v/release/Yann-Up/kimi-code-desktop?display_name=tag&sort=semver)](https://github.com/Yann-Up/kimi-code-desktop/releases/latest)
[![CI](https://github.com/Yann-Up/kimi-code-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Yann-Up/kimi-code-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20Apple%20Silicon-lightgrey)

中文 · [English](#english) · [下载 Download](https://github.com/Yann-Up/kimi-code-desktop/releases/latest)

</div>

> **桌面壳,而非 AI 运行时**:对话界面直接内嵌官方 `kimi web` 的 Web UI(iframe),会话、模型、工具、Git 改动面板等能力全部来自官方界面,随 CLI 升级自动同步——**CLI 升级即 UI 升级**。未安装 CLI 时首次启动自动下载安装;已安装则检测更新,询问后一键升级。

## 截图

<table>
  <tr>
    <td><img src="docs/kimiweb页面.png" alt="对话(官方 Web UI 内嵌)" /></td>
    <td><img src="docs/统计.png" alt="用量统计" /></td>
  </tr>
  <tr>
    <td><img src="docs/设置.png" alt="设置" /></td>
    <td><img src="docs/桌宠立绘设置.png" alt="桌宠与皮肤立绘" /></td>
  </tr>
</table>

🐾 桌宠动起来什么样 → [演示视频](docs/桌宠.mp4)

## 功能

### 对话(官方 Web UI 内嵌)

- iframe 直连本地 `kimi web` 服务(`http://127.0.0.1:<port>/#token=<token>`),token 由壳自动注入,无需登录
- 会话列表、流式回复、工具调用、审批、模型/供应商设置等均由官方 UI 提供
- 聊天中的外链一律转系统浏览器打开,webview 不导航离开应用

### 壳自身提供的能力

- **用量统计**:时间范围、统计卡、GitHub 式活跃热力图、按天模型堆叠趋势、实时曲线
- **标题栏额度条**:各窗口额度(5 小时/1 周/月度)铺平直显 + 实时指标胶囊(TTFT / 输出速度)
- **桌面通知**:窗口失焦时,任务完成 / 待审批 / 待回答发桌面通知
- **桌面宠物**(实验性):透明置顶小窗,状态随会话事件变化,支持气泡提醒与自定义宠物包导入
- **皮肤立绘**(实验性):设置/统计/主页透出立绘,支持自定义皮肤
- **设置**:常规(数据目录、CLI 来源、日志)/ CLI 配置(模型与供应商、权限模式等)/ MCP(可视化 + JSON 编辑,写盘自动备份)/ 技能 / 子智能体 / 命令 / 通道 / 插件
- **桌面集成**:系统托盘、单实例、全平台自绘标题栏(macOS 自绘交通灯)、亮暗双主题

### 远端后端

除本机外,后端 `kimi web` 也可运行在 **WSL** 或 **SSH 主机** 上:内建进程内 SSH 客户端与端口转发,host key 采用 TOFU 校验,密码只存系统凭据管理器,不落明文。

### 自动更新

内置自动更新(tauri-plugin-updater):启动静默检查,发现新版在标题栏出红点,确认后自动下载、安装并重启;更新包经 minisign 签名校验。国内用户走 CNB 镜像加速,GitHub Releases 兜底。

## 下载

从 [Releases](https://github.com/Yann-Up/kimi-code-desktop/releases/latest) 获取最新版:

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows x64 | `*_x64-setup.exe` | NSIS 安装版(推荐) |
| Windows x64 | `*_x64-portable.zip` | 免安装便携版 |
| Windows x64 | `*_x64_en-US.msi` | MSI 安装包 |
| macOS(Apple Silicon) | `*_aarch64.dmg` | 仅 M 系列芯片;**未签名未公证**,见下方说明 |

> ⚠️ **macOS 首次打开会被 Gatekeeper 拦截**(未付费签名/公证),二选一:
> 1. 系统设置 → 隐私与安全性 → 找到 "Kimi Code Desktop" → **仍要打开**
> 2. 终端执行:`xattr -d com.apple.quarantine /Applications/Kimi\ Code\ Desktop.app`

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
  └── 本地数据   → kimi_home 直读(技能/子代理/mcp.json/usage 聚合/盘符)
渲染进程(React + zustand,src/)
  ├── components/ShellHome.tsx  视图容器:对话(iframe)/ 统计 / 设置
  ├── components/TitleBar.tsx   标题栏:额度条 + 导航 + 窗口控制
  ├── platform/kimi-api.ts      壳与渲染层之间的 API 契约(window.kimiApi)
  ├── platform/tauri.ts         契约的 Tauri 实现(invoke/事件监听)
  └── stores/ui.ts              界面状态
```

<details>
<summary><b>关键实现细节(踩过的坑,供参考)</b></summary>

- **iframe 直嵌可行**:loopback 下官方服务端不发 CSP frame-ancestors / X-Frame-Options,无需反代;壳在 healthz 通过后会 HEAD `/` 做一次预警检查,命中则显示"改用系统浏览器"引导页而非空白 iframe。注意 `--host 0.0.0.0` 时官方会下发 `frame-ancestors 'self'`(实测 0.36.1,loopback 请求也带),与内嵌互斥,故壳不提供局域网开放选项;需要局域网访问请自行在终端跑 `kimi web --host 0.0.0.0` 用浏览器直连
- **token 时序竞争**:前端拿 `web_ui_url` 带重试,后端未就绪时不白屏
- **端口稳定(源即身份)**:web UI 的"新浏览器"验证状态按 iframe 源(`http://127.0.0.1:<port>`)存 localStorage,端口漂移就会重弹验证;故固定起始端口(release 58666 / dev 58766),且启动前先回收首选端口上的残留实例(应用崩溃/强杀留下的孤儿:token 可用时 POST shutdown + 注册表 pid 强杀兜底;token 不可用但端口被占且注册表心跳新鲜时按 pid 直接强杀)保证该端口可用;其他端口上用户另开的 kimi web 实例不动。应用更新安装前也会先停妥所有通道服务(updater 插件安装时强杀进程,不触发 ExitRequested 优雅关停)
- **崩溃自愈**:kimi web 意外退出时壳会清理连接状态并广播 `server:exited`,可就地重启服务
- **macOS 交通灯**:主窗全平台 `decorations(false)` 全自绘标题栏;mac 的三灯为前端自绘(原生 Overlay 灯位由 AppKit 按 28pt 标准栏定位,与自绘栏不对中),失焦置灰、绿灯进出原生全屏
- token 统计口径:`usage.record` ≈ `step.end`(交叉验证差 1%),输入/输出/缓存分开记账

</details>

## 安全说明

- **Bearer token 不出本机**:REST/WS/iframe 只连 `127.0.0.1`,token 由壳持有,日志按 "token" 关键字过滤
- **SSH host key 采用 TOFU**:首次连接记录指纹到配置目录 `known_hosts`,指纹变更即拒绝连接;SSH 密码只存系统凭据管理器
- **外链隔离**:聊天内容中的链接一律由系统浏览器打开(仅放行 http/https)
- **配置原子写**:`desktop-config.json` / `mcp.json` 先写临时文件再替换;mcp.json 另有 `.kimi-desktop-bak` 备份
- CLI 自动安装使用官方安装脚本(`irm | iex` / `curl | sh`),与官方文档推荐方式一致

## 开发

```bash
npm install
npm run tauri:dev      # 开发(vite dev 5188 端口 + cargo 增量编译,首次较慢)
npm run typecheck      # 渲染层与 vite 配置的 TS 检查
```

需要 Rust 工具链(cargo)。Windows 下使用系统 WebView2,安装包体积显著小于 Electron 方案。

```bash
# 打包(已开启 updater 产物,本地打包需指向签名私钥):
export TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kimi-desktop.key   # Windows: set 或 $env:
npm run tauri:build    # 产出当前平台的安装包(src-tauri/target/release/bundle/)
```

### 发版(维护者)

tag 触发 `.github/workflows/release.yml`(Windows → macOS 串行构建 + 签名 + latest.json,产出草稿 Release),正式发布后 `sync-cnb.yml` 同步到 CNB 镜像:

```bash
# 1. 三处版本号保持一致:src-tauri/tauri.conf.json、src-tauri/Cargo.toml、package.json
# 2. 提交后打 tag 并推送
git tag v0.5.6 && git push --tags
# 3. workflow 产出草稿 Release;确认后在 Releases 页发布为正式版
```

需要一次性配置仓库 Secrets:`TAURI_SIGNING_PRIVATE_KEY`(开发机 `~/.tauri/kimi-desktop.key` 的文件内容;该私钥无密码、不入库,丢失则无法继续签发更新)与 `CNB_TOKEN`(镜像同步)。签名公钥内嵌于 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。

## 行为说明

- **启动即进主页面**:不自动拉起 kimi web;对话页显示占位图(可选服务运行位置:本机/WSL/SSH),点"启动 Kimi Code 服务"后才加载官方 Web UI。本机未安装 CLI 时先弹安装确认,不静默下载。服务启停入口:对话页占位图(启动)与 设置 → 常规(启停);停止后统计/设置等本地页面不受影响
- 已知限制:通知点击不聚焦主窗口(插件限制)、通知不带图标

## 贡献

欢迎 Issue 与 Pull Request。提交前请确保:

- `npm run typecheck` 通过
- `cd src-tauri && cargo check` 通过

提交 PR 即表示你同意以本项目的 MIT 许可证授权你的贡献。觉得好用的话,欢迎点个 ⭐

## 商标声明

"Kimi"、"Kimi Code" 及相关名称与标识的权利归 Moonshot AI(月之暗面)所有。本项目是基于 Kimi Code CLI 的桌面客户端壳,使用这些名称仅为描述兼容性目的。

## License

Copyright (C) 2025 Kimi Code Desktop contributors

本项目以 [MIT License](LICENSE) 开源。要点(以许可证原文为准):

- **可以自由使用、复制、修改、分发**,包括商业用途和闭源分发——MIT 不附加开源义务
- **唯一要求**:保留版权声明与许可证文本
- 本软件按"原样"提供,不附带任何担保

第三方运行时/构建依赖均为宽松许可证(MIT / Apache-2.0 / BSD / ISC),与 MIT 兼容。Kimi Code CLI 本身由 Moonshot AI 按其自身条款分发,不属于本仓库的授权范围。

---

## English

<div align="center">

**A desktop client for [Kimi Code CLI](https://github.com/moonshotai/kimi-code) — the official Web UI in a native window, plus usage stats, a quota strip, a desktop pet, tray integration and self-update.**

</div>

This is a **desktop shell, not an AI runtime**: the chat UI embeds the official `kimi web` Web UI directly via iframe (`http://127.0.0.1:<port>/#token=<token>`, token injected by the shell), so sessions, models, tools and the Git changes panel all come from the official UI and upgrade in lockstep with the CLI. The app auto-installs the CLI on first launch and offers in-app upgrades.

**What the shell adds**

- Usage statistics: heatmap, per-day model trends, realtime curves
- Title-bar quota strip: per-window quotas (5h / weekly / monthly) + live metrics (TTFT / output speed)
- Desktop notifications when unfocused (turn finished / pending approval / pending question)
- Desktop pet & skin standee (experimental), plugin management
- Settings: general / CLI config / MCP (visual + JSON, auto-backup) / skills / sub-agents / commands / channels
- Tray, single-instance, self-drawn title bar (incl. macOS traffic lights), light & dark themes
- Remote backends: run `kimi web` on WSL or over SSH (built-in SSH client with port forwarding, TOFU host keys, passwords in the OS credential manager)
- Self-update from signed GitHub Releases (CNB mirror first for CN users)

**Download** — [Releases](https://github.com/Yann-Up/kimi-code-desktop/releases/latest): Windows x64 (`setup.exe` / `msi` / portable zip) and macOS Apple Silicon (`aarch64.dmg`). The macOS build is unsigned: allow it in System Settings → Privacy & Security, or run `xattr -d com.apple.quarantine /Applications/Kimi\ Code\ Desktop.app`.

```bash
npm install
npm run tauri:dev     # dev (vite + cargo)
npm run tauri:build   # build installer for the current platform
```

Licensed under the **MIT License** (see [LICENSE](LICENSE)): free to use, modify, and distribute — including commercially and in closed-source form — as long as the copyright notice and license text are retained. "Kimi" and "Kimi Code" are trademarks of Moonshot AI; this project is a desktop client for the CLI and is distributed under its own license.
