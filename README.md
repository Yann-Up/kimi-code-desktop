<div align="center">

<img src="design/logo-final.png" width="96" alt="Kimi Code Desktop" />

# Kimi Code Desktop

**A desktop client for [Kimi Code CLI](https://github.com/moonshotai/kimi-code) — the official Web UI in a native window, plus usage stats, a quota strip, a desktop pet, tray integration and self-update.**

[![Release](https://img.shields.io/github/v/release/Yann-Up/kimi-code-desktop?display_name=tag&sort=semver)](https://github.com/Yann-Up/kimi-code-desktop/releases/latest)
[![CI](https://github.com/Yann-Up/kimi-code-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Yann-Up/kimi-code-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20Apple%20Silicon-lightgrey)

English · [中文](README.zh-CN.md) · [Download](https://github.com/Yann-Up/kimi-code-desktop/releases/latest)

</div>

> **A desktop shell, not an AI runtime**: the chat UI embeds the official `kimi web` Web UI directly via iframe (`http://127.0.0.1:<port>/#token=<token>`, token injected by the shell), so sessions, models, tools and the Git changes panel all come from the official UI and upgrade in lockstep with the CLI — **upgrade the CLI and the UI upgrades with it**. The app auto-installs the CLI on first launch and offers one-click upgrades when a newer CLI is detected.

## Screenshots

<table>
  <tr>
    <td><img src="docs/kimiweb页面.png" alt="Chat (official Web UI embedded)" /></td>
    <td><img src="docs/统计.png" alt="Usage statistics" /></td>
  </tr>
  <tr>
    <td><img src="docs/设置.png" alt="Settings" /></td>
    <td><img src="docs/桌宠立绘设置.png" alt="Desktop pet & skin standee" /></td>
  </tr>
</table>


## Features

### Chat (official Web UI embedded)

- The chat tab talks to the local `kimi web` service via iframe (`http://127.0.0.1:<port>/#token=<token>`); the token is injected by the shell — no login needed
- Session list, streaming replies, tool calls, approvals, model/provider settings — all served by the official UI
- Links in chat always open in the system browser; the webview never navigates away from the app

### What the shell itself adds

- **Usage statistics**: time ranges, stat cards, a GitHub-style activity heatmap, per-day model trends, realtime curves
- **Title-bar quota strip**: per-window quotas (5-hour / weekly / monthly) always visible + a live-metrics capsule (TTFT / output speed)
- **Desktop notifications**: when the window is unfocused — turn finished / pending approval / pending question
- **Desktop pet** (experimental): a transparent always-on-top window whose state follows session events, with bubble reminders and custom pet-pack import
- **Skin standee** (experimental): character art on the settings/stats/home pages, custom skins supported
- **Settings**: general (data dir, CLI source, logs) / CLI config (models & providers, permission modes, etc.) / MCP (visual + JSON editing, auto-backup on write) / skills / sub-agents / commands / channels / plugins
- **Desktop integration**: system tray, single-instance, self-drawn title bar on all platforms (incl. macOS traffic lights), light & dark themes

### Remote backends

Besides the local machine, the `kimi web` backend can also run on **WSL** or an **SSH host**: a built-in in-process SSH client with port forwarding, TOFU host-key verification, and passwords stored only in the OS credential manager — never in plaintext config.

### Self-update

Built-in auto-update (tauri-plugin-updater): a silent check at startup, a red dot on the title-bar button when a new version is found, and one-click download/install/restart; update packages are verified with minisign signatures. CN users are served via a CNB mirror first, with GitHub Releases as fallback.

## Download

Get the latest version from [Releases](https://github.com/Yann-Up/kimi-code-desktop/releases/latest):

| Platform | File | Notes |
| --- | --- | --- |
| Windows x64 | `*_x64-setup.exe` | NSIS installer (recommended) |
| Windows x64 | `*_x64-portable.zip` | Portable, no install |
| Windows x64 | `*_x64_en-US.msi` | MSI installer |
| macOS (Apple Silicon) | `*_aarch64.dmg` | M-series only; **unsigned & not notarized**, see below |

> ⚠️ **macOS Gatekeeper will block the first launch** (the build is not signed/notarized — that requires a paid Apple Developer account). Either:
> 1. System Settings → Privacy & Security → find "Kimi Code Desktop" → **Open Anyway**
> 2. Or run in Terminal: `xattr -d com.apple.quarantine /Applications/Kimi\ Code\ Desktop.app`

## Architecture

```
Tauri Rust backend (src-tauri/)
  ├── CLI self-check: auto-install via official script if missing; prompt to upgrade when outdated
  ├── spawn `kimi web --no-open --port <free port>`    # backend service (local/WSL/SSH)
  │     parse the address & token from the stdout banner / PTY output
  ├── web_ui_url command → http://127.0.0.1:<port>/#token=<token> (loaded by the iframe)
  ├── WS notification subscriber → /api/v1/ws (internal to the shell, not forwarded to the renderer)
  │     subscribes sessions for turn.ended / work_changed → desktop notifications when unfocused
  ├── REST client → /api/v1/* (Bearer auth; used by shell features like quotas/stats)
  └── Local data   → read kimi_home directly (skills / sub-agents / mcp.json / usage aggregation / drives)
Renderer (React + zustand, src/)
  ├── components/ShellHome.tsx  view container: chat (iframe) / stats / settings
  ├── components/TitleBar.tsx   title bar: quota strip + navigation + window controls
  ├── platform/kimi-api.ts      API contract between shell and renderer (window.kimiApi)
  ├── platform/tauri.ts         Tauri implementation of the contract (invoke / event listeners)
  └── stores/ui.ts              UI state
```

## Security notes

- **The bearer token never leaves the machine**: REST/WS/iframe connect only to `127.0.0.1`; the token is held by the shell and logs are filtered on the keyword "token"
- **SSH host keys use TOFU**: the fingerprint is recorded to `known_hosts` in the config dir on first connect; a changed fingerprint refuses the connection. SSH passwords live only in the OS credential manager
- **Link isolation**: links in chat content always open in the system browser (http/https only)
- **Atomic config writes**: `desktop-config.json` / `mcp.json` are written to a temp file then replaced; `mcp.json` additionally keeps a `.kimi-desktop-bak` backup
- CLI auto-install uses the official install scripts (`irm | iex` / `curl | sh`), matching the official documentation

## Development

```bash
npm install
npm run tauri:dev      # dev (vite dev on :5188 + incremental cargo build; first run is slow)
npm run typecheck      # TS checks for the renderer and vite config
```

Requires the Rust toolchain (cargo). On Windows the system WebView2 is used, making the installer significantly smaller than an Electron equivalent.

```bash
# Packaging (updater artifacts are enabled; point to the signing key for local builds):
export TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kimi-desktop.key   # Windows: set or $env:
npm run tauri:build    # installer for the current platform (src-tauri/target/release/bundle/)
```

### Releasing (maintainers)

A tag triggers `.github/workflows/release.yml` (Windows → macOS serial build + signing + latest.json, producing a draft Release); publishing the release then syncs to the CNB mirror via `sync-cnb.yml`:

```bash
# 1. Keep the version in sync in three places: src-tauri/tauri.conf.json, src-tauri/Cargo.toml, package.json
# 2. Commit, then tag and push
git tag v0.5.6 && git push --tags
# 3. The workflow produces a draft Release; review and publish it on the Releases page
```

One-time repo Secrets: `TAURI_SIGNING_PRIVATE_KEY` (contents of `~/.tauri/kimi-desktop.key` on the dev machine; the key has no passphrase and is never committed — losing it means updates can no longer be signed) and `CNB_TOKEN` (mirror sync). The public key is embedded in `src-tauri/tauri.conf.json` at `plugins.updater.pubkey`.

## Behavior notes

- **Straight to the main page on launch**: kimi web is not auto-started; the chat page shows a placeholder (with a choice of where the service runs: local / WSL / SSH) and loads the official Web UI only after you click "Start Kimi Code service". If the CLI is missing locally, an install confirmation pops up first — nothing is downloaded silently. Start/stop entry points: the chat placeholder (start) and Settings → General (start/stop); stopping the service does not affect local pages like stats/settings
- Known limitations: clicking a notification does not focus the main window (plugin limitation); notifications carry no icon

## Contributing

Issues and Pull Requests are welcome. Before submitting, make sure:

- `npm run typecheck` passes
- `cd src-tauri && cargo check` passes

By submitting a PR you agree to license your contribution under this project's MIT license. If you find it useful, a ⭐ is appreciated.

## Trademark notice

"Kimi", "Kimi Code" and related names and logos are the property of Moonshot AI. This project is a desktop client shell for Kimi Code CLI; these names are used solely to describe compatibility.

## License

Copyright (C) 2025 Kimi Code Desktop contributors

This project is open source under the [MIT License](LICENSE). In short (the license text prevails):

- **Free to use, copy, modify, and distribute** — including commercially and in closed-source form; MIT imposes no open-source obligation
- **The only requirement**: retain the copyright notice and the license text
- The software is provided "as is", without warranty of any kind

Third-party runtime/build dependencies are all permissively licensed (MIT / Apache-2.0 / BSD / ISC) and MIT-compatible. Kimi Code CLI itself is distributed by Moonshot AI under its own terms and is outside the scope of this repository's license.
