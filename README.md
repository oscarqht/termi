# termi

A lightweight desktop status bar app & browser-accessible terminal manager. Powered by an embedded high-performance Rust daemon (Axum + `portable-pty`) that spawns real PTY sessions and streams them to a modern React + `@xterm/xterm` web interface over WebSockets. Designed to give you frictionless access to your terminal locally, across your Tailscale network, or directly from mobile devices.

---

## ✨ Features

### 🖥️ Real PTY & High-Performance Daemon
- **Real shell sessions:** Backed by Rust's `portable-pty` with true pseudo-terminal emulation, multiplexed over WebSockets.
- **Deep scrollback buffer:** Up to 1,000,000 characters retained in memory per session and replayed instantly when connecting or reconnecting.
- **Session persistence across reboots:** Saved session records persist across restarts as dormant sessions and are seamlessly restored upon activation.
- **Dual running modes:** Run as a native desktop status bar / system tray app or as a standalone headless daemon (`termi --daemon`).
- **Tailscale auto-detection:** Automatically discovers and binds to your Tailscale network interface (`100.64.0.0/10`) with fallback to `127.0.0.1`, providing immediate, secure remote access across devices.

### 🗂️ Tabbed Dashboard & Session Management
- **Directory & Repo Grouping:** Active sessions are grouped by working directory / repository and sorted by last active timestamp for rapid context switching.
- **Quick Launch Cards:** Start sessions with custom working directories, recent directory history, and pre-configured quick commands (e.g., Claude Code, Gemini CLI, standard shells).
- **Native Folder Picker:** Browse and select any local folder via native OS file dialogs (`/api/choose-folder`).
- **Git Worktree & Branch Integration:**
  - Automatic Git repository detection (repo root, common directory, current branch, branch lists).
  - Create Git worktrees on the fly with automatic branch name normalization, validation, base branch selection, and upstream tracking.
  - Worktree management & safe deletion with optional branch cleanup.
  - Group sessions under parent repositories and their corresponding worktrees.

### 📝 Compose Editor & Slash Prompts
- **Multi-line Compose Modal:** Dedicated text editor for drafting complex multi-line commands, scripts, or LLM prompts before sending them to the terminal.
- **Slash Commands (`/`):** Autocomplete menu for inserting saved prompts directly into your compose draft or terminal input.
- **Saved Prompts Library:** Store, organize, and execute reusable prompts from the dedicated Prompts tab.
- **Draft Persistence:** Unsent compose text is preserved in local storage per session so you never lose unfinished thoughts.
- **Flexible Send Options:** Choose between sending text directly (with Enter) or inserting it into the prompt without executing.

### 📁 File & Image Uploads
- **Drag-and-Drop:** Drop files directly onto the terminal window or compose editor.
- **Clipboard Paste:** Paste screenshots and images directly from the clipboard.
- **Auto-Upload & Path Quoting:** Uploads files to the session's working directory (`/api/sessions/:id/upload`) and automatically inserts the properly shell-quoted path at the cursor.

### 📱 Mobile & Touch-Friendly Terminal
- **Inertia Touch Scrolling:** Smooth, momentum-based scrolling across the terminal screen optimized for touch gestures on iOS Safari and Android Chrome.
- **Alternate Screen Buffer Mouse Wheel Emulation:** Full touch-scroll support in mouse-tracking TUI applications such as Claude Code / Claude CLI, `vim`, `less`, `nano`, and `htop`.
- **Mobile Accessory Bar:** Floating, collapsible keyboard toolbar with essential keys:
  - `ESC`, `TAB`, `Ctrl`, `Alt`, Arrow keys (`←`, `→`, `↑`, `↓`), `PgUp`, `PgDn`
  - Shell symbols: `|`, `~`
  - Virtual keyboard toggle, compose editor shortcut, and saved prompts modal button.
- **Visual Viewport Adaptation:** Prevents the mobile on-screen keyboard from occluding the terminal view.

### ⚡ Custom Scripts & Task Runner
- **Custom Scripts Tab & Dock:** Configure and manage reusable task scripts.
- **Background Execution:** Run scripts with live log streaming, execution status indicators, and collapsible output viewer docks.

### 🔄 In-App Updates & Notifications
- **Automated Update Checking:** Periodically checks for new releases on GitHub.
- **Multi-Channel Notification:** Status bar tray notifications and in-app header banners with release notes and one-click update/restart.

---

## 🐜 Desktop Status Bar App

Termi runs as a lightweight, cross-platform status bar / system tray application (macOS menu bar, Windows system tray, Linux notification area) without cluttering your Dock or taskbar:

- **Left-click:** Opens Termi directly in your default web browser.
- **Right-click / Context Menu:**
  - *Open in Browser*
  - *Copy URL* (Tailscale or local network address)
  - *Grant Full Disk Access...* / *Full Disk Access Enabled* (macOS)
  - *Launch at Login* (toggle auto-start on system boot)
  - *Check for Updates...*
  - *Version display*
  - *Quit Termi* (prompts to keep background daemon and sessions running or stop all and quit)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://www.rust-lang.org/) (for Tauri and daemon builds)

### Development

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/oscarqht/termi.git
   cd termi
   npm install
   ```

2. **Run Desktop App (Tauri Dev Mode):**
   ```bash
   npm run app:dev
   ```

3. **Run Web Frontend Dev Server Only:**
   ```bash
   npm run dev
   ```

4. **Run Unit Tests:**
   ```bash
   npm test
   ```

---

## 📦 Building Distributables

### Build Desktop Packages
- **Build for current platform:**
  ```bash
  npm run app:build
  ```

- **Build for macOS (Apple Silicon `aarch64-apple-darwin`):**
  ```bash
  npm run app:build:mac
  ```

Generated installers and packages will be located in the `src-tauri/target/release/bundle/` directory.

### macOS Permissions & Full Disk Access (FDA)

Terminal emulators require **Full Disk Access** on macOS to run commands in protected user directories (`~/Downloads`, `~/Documents`, and `~/Desktop`) without recurring permission prompts.

- **1-Click Setup Script:**
  ```bash
  npm run app:setup-permissions
  ```
  Opens System Settings directly to **Privacy & Security → Full Disk Access** and reveals `Termi.app` in Finder for instant drag-and-drop setup.

- **From the Tray Menu:**
  Right-click the Termi status bar icon and click **⚠️ Grant Full Disk Access...**. Once granted, it dynamically updates to **✓ Full Disk Access Enabled**.

- **Free Personal Apple ID Signing ($0, no paid developer account):**
  To prevent macOS from resetting Full Disk Access permissions across local rebuilds:
  ```bash
  npm run app:sign:local
  ```

---

## 🖥️ Headless / Daemon Mode

You can run Termi purely as a background daemon on a server or remote workstation without launching the desktop GUI:

```bash
# Build the binary
cd src-tauri
cargo build --release

# Run in background daemon mode
./target/release/termi --daemon
```

### Configuration & Environment Variables

- `PORT` — Server port (default `3200`, automatically increments if port is in use).
- `HOST` — Override the bind address (defaults to auto-detected Tailscale IP, fallback `127.0.0.1`).
- `TERMI_CONFIG_DIR` — Custom directory path for storing configuration, saved prompts, and custom scripts (defaults to `~/.config/termi`).
