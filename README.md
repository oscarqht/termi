# termi

A browser-based terminal. Runs a small Node server that spawns real PTY sessions and streams them to a React + xterm.js frontend over WebSockets, so you can open a terminal from any browser on your Tailscale network.

## Features

- Real shell sessions via `node-pty`, multiplexed over WebSocket
- Multiple concurrent sessions, each with its own working directory and optional initial command(s)
- Native macOS folder picker for choosing a session's working directory
- Per-session local scrollback history
- Binds to your Tailscale interface automatically (falls back to `127.0.0.1`)

## Desktop Status Bar App

Termi can run as a lightweight, cross-platform status bar / system tray application (macOS menu bar, Windows system tray, Linux notification area):

- **Status Bar Icon:** Ant icon 🐜 residing in your menu bar / system tray with no Dock icon.
- **Left-click:** Opens Termi directly in your default web browser.
- **Right-click / Context Menu:**
  - *Open in Browser*
  - *Copy URL* (Tailscale or local network address)
  - *Server Status* (shows active host and port)
  - *Launch at Login* (toggle auto-start on computer login)
  - *Quit Termi*

### Run Status Bar App Locally

```bash
npm run app
```

### Build Distributable Packages

- **Build for macOS (`.dmg` & `.zip`):**
  ```bash
  npm run app:build:mac
  ```

- **Build for Windows (`.exe` installer & portable):**
  ```bash
  npm run app:build:win
  ```

- **Build for both:**
  ```bash
  npm run app:build:all
  ```

Generated installers and packages will be located in the `dist/` directory.

### Automated Releases (GitHub Actions)

The repository includes [`.github/workflows/release.yml`](file:///.github/workflows/release.yml):
- **Push to `main` branch:** Automatically detects the current version, bumps the minor version (e.g. `0.1.0` -> `0.2.0`), tags `v0.2.0`, builds both macOS and Windows packages, and publishes a new GitHub Release.
- **Manual tag push:** Pushing any `v*` tag directly also triggers multi-platform builds and creates the GitHub Release.

## Headless / Terminal Mode

### Development
```bash
npm install
npm run dev
```

### Production Server
```bash
npm run build
npm start
```

## Configuration

- `PORT` — server port (default `3200`, auto-increments if port is occupied)
- `HOST` — override the auto-detected bind address (defaults to Tailscale IP, fallback `127.0.0.1`)
