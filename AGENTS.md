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
  components/           壳组件:ShellHome(三 tab 主页)/ QuotaStrip / TitleBar / settings/
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
build/                  图标等资源;design/ 设计稿;docs/ 评审与跟踪文档;out/renderer 前端构建产物
```

## 常用命令

```bash
npm install
npm run tauri:dev        # 开发(vite dev 5188 + cargo 增量编译)
npm run typecheck        # 渲染层与 vite 配置的 TS 检查(提交前必过)
npm run build:renderer   # 仅构建前端 → out/renderer
npm run tauri:build      # 打包当前平台安装包(产物在 src-tauri/target/release/bundle/)
cd src-tauri && cargo check   # Rust 侧检查(提交前必过)
```

## 约定

- **API 契约先行**:渲染层不直接 invoke;新增壳能力时先扩展 `platform/kimi-api.ts` 接口,再在 `platform/tauri.ts` 实现,Rust 侧在 `lib.rs` 注册命令,三处保持同步。
- **本地数据直读 `~/.kimi-code`**(技能/子代理/mcp.json/usage 聚合);配额、统计等走 REST(Bearer 认证)。
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
