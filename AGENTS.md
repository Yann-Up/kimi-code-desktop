# AGENTS.md

本文件为 AI 编码代理提供本仓库的工作指引。

## 项目简介

Kimi Code Desktop:基于 [Kimi Code CLI](https://github.com/moonshotai/kimi-code) 的桌面客户端壳(Tauri v2 + React + TypeScript)。对话界面通过 iframe 内嵌官方 `kimi web` Web UI,壳自身提供用量统计、额度条、桌面通知、设置、托盘等能力。后端 `kimi web` 可运行在本机 / WSL / SSH 远端。

## 技术栈

- 前端:React 18 + TypeScript + Vite 5 + Tailwind CSS 4 + zustand + lucide-react
- 后端:Rust(edition 2021, rust-version 1.77)+ Tauri v2 + tokio + reqwest(rustls)+ tokio-tungstenite + russh + keyring
- 主题:白底 + 蓝色(Kimi Web 风格)

## 目录结构

```
src/                    渲染进程(React)
  components/           壳组件:ShellHome(三 tab 主页)/ QuotaStrip / TitleBar / SkinStandee(实验性皮肤立绘,设置/统计/主页透出) / settings/ / pet/(桌宠窗口)
  pages/                Onboarding / Settings / stats
  platform/kimi-api.ts  壳与渲染层的 API 契约(window.kimiApi)
  platform/tauri.ts     契约的 Tauri 实现(invoke / 事件监听)
  stores/ui.ts          界面状态(zustand)
src-tauri/src/          Rust 后端
  lib.rs                Tauri 入口与命令注册
  server.rs             spawn/管理 `kimi web` 进程,解析地址与 token
  rest.rs / ws.rs       REST 客户端与 WS 通知订阅器(/api/v1/*)
  cli.rs                CLI 自检测 / 安装 / 升级
  ssh.rs                进程内 SSH 客户端与端口转发
  config.rs / local_store.rs / target.rs   配置、本地数据直读、运行目标(本机/WSL/SSH)
  skin.rs               用户自选皮肤(实验性):扫描 <config_dir>/skins 下的 png/webp/jpg,经 skin:// 自定义协议供图;内置皮肤注册表在前端(src/components/skins.ts,构建时扫描 src/assets/skins);开关与选中存 desktop-config.json 的 skin_enabled/skin_slug,立绘渲染见 SkinStandee
  pet.rs                桌宠悬浮窗(实验性):透明置顶小窗 + 状态机(ws.rs 事件驱动);内置宠物注册表 builtin_pets()(素材 src/assets/pets/<slug>/),并扫描 <kimi_home>/pets 与 ~/.petdex/pets(兼容 kimi-pet.v0/petdex 布局),外部精灵图经 pet:// 自定义协议供图;开关存 desktop-config.json 的 pet_enabled/pet_slug
  updater.rs            应用自动更新(tauri-plugin-updater + GitHub Releases latest.json,minisign 签名校验):app_update_check/app_update_install 命令 + 启动延迟静默自检(dev 跳过);签名公钥在 tauri.conf.json plugins.updater.pubkey,私钥 ~/.tauri/kimi-desktop.key 不入库(CI 走 TAURI_SIGNING_PRIVATE_KEY secret);发版见 .github/workflows/release.yml(push v* tag → 草稿 Release)
build/                  图标等资源;design/ 设计稿;docs/ 评审与跟踪文档;out/renderer 前端构建产物
```

## 常用命令

```bash
npm install
npm run tauri:dev        # 开发(vite dev 5188 + cargo 增量编译)
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
- **config.toml 合并写用 `toml_edit`** 以保留注释/格式;只读解析用 `toml`。
- 注释和文档用中文(README 中英双语),代码标识符用英文。
- 日期/统计口径依赖**本地时区日历日**(chrono,不用 UTC)。

## 安全红线(勿破坏)

- Bearer token 不出本机:REST/WS/iframe 只连 `127.0.0.1`;日志需按 "token" 关键字过滤。
- SSH host key 采用 TOFU:指纹存 `known_hosts`,变更即拒绝连接;SSH 密码只存系统凭据管理器(keyring),不落明文。
- 聊天外链一律转系统浏览器打开(仅 http/https),webview 不导航离开应用。
- iframe 直嵌依赖 loopback 下官方服务端不发 CSP frame-ancestors / X-Frame-Options,不要引入破坏该前提的反向代理。

## 注意事项

- 无测试套件;验证手段是 `npm run typecheck` + `cargo check` + 手动 `tauri:dev`。
- 仅 Windows(NSIS)验证过;改动尽量保持跨平台可行,但不要为未测试平台做投机性适配。
- 许可证 AGPL-3.0-only,勿引入不兼容许可证的运行时依赖。
- `token 时序竞争`、`崩溃自愈(server:exited)` 等时序逻辑见 README「关键实现细节」,改动前先读。
- **运行期建窗/关窗的命令必须是 async**:同步命令占住主线程,`WebviewWindowBuilder::build()` 等事件循环初始化 WebView2 会死锁(桌宠 M1 实测踩过,见 docs/desktop-pet-design.md)。
- **关窗语义**:点 X 一律 `prevent_close` + emit `app:close-requested`(payload=是否有后端在跑),前端弹"是否关闭进程"确认框——"退出程序"走 `confirm_close`(app.exit),"进入托盘"走 `hide_main_to_tray`(必须是 async 命令);最小化按钮 − 只是普通任务栏最小化,不进托盘。托盘图标 `include_bytes!` 内嵌(不依赖 resource_dir/cwd);托盘唤回统一走 `restore_main`(unminimize+show+focus,托盘左键/菜单/单实例复用)。
