# Tauri v2 + Pure Rust Blueprint: Ultra-Lightweight Cross-Platform Desktop App

This blueprint provides a comprehensive architectural guide and step-by-step migration pattern for converting web applications and heavy Electron utilities into ultra-lightweight, production-grade native desktop applications using **Tauri v2** and **Pure Rust**.

---

## 1. Why Migrate from Electron to Tauri v2 + Pure Rust?

In this project (**Termi**), replacing Electron with Tauri v2 and a native Rust backend produced dramatic improvements across every metric:

| Metric | Electron + Node.js | Tauri v2 + Pure Rust | Improvement |
| :--- | :--- | :--- | :--- |
| **macOS DMG Installer Size** | `256 MB` | `6.1 MB` | **97.6% smaller** (42x reduction) |
| **Installed macOS App (`.app`)** | `830 MB` | `15 MB` | **98.2% smaller** (55x reduction) |
| **Windows NSIS Installer Size** | `~210 MB` | `~8 MB` | **96.2% smaller** (26x reduction) |
| **Idle Memory Consumption (RSS)**| `~140 - 220 MB` | `~25 - 35 MB` | **85% less RAM** |
| **App Startup Time** | `~1.8s - 2.5s` | `< 150ms` | Instantaneous |
| **External Dependencies** | Node runtime, Chromium, node-pty C++ prebuilds | 0 external runtimes (single static binary) | No Node/Chromium bloat |

---

## 2. High-Level Architecture

Termi is designed as a **Headless Status Bar / Menu Bar Agent**:
- **Native Tray**: Runs silently in the macOS menu bar or Windows notification area without cluttering the Dock or Windows Taskbar.
- **Embedded Web Server**: A high-performance async Rust server (**Axum 0.8** + **Tokio**) serves the React/Vite frontend and handles REST APIs and WebSockets.
- **In-Memory Asset Embedding**: The Vite production build (`dist/`) is compiled directly into the Rust binary via **`rust-embed`**, eliminating relative path resolution bugs and file system permission issues.
- **Native PTY Engine**: Interactive terminal sessions are managed natively via **`portable-pty`** with OS threads and lock-free channels, avoiding buggy Node native C++ bindings (`node-pty`).
- **Tailscale & LAN Discovery**: Automatically discovers the Tailscale interface (`100.64.0.0/10`) to allow remote mobile terminal access while listening on all interfaces (`0.0.0.0`).

```
┌────────────────────────────────────────────────────────┐
│                     OS System Tray                     │
│  [Left Click] -> Open Default Browser (Chrome/Safari) │
│  [Right Click] -> Context Menu (Copy URL, Auto-Start) │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│              Tauri v2 Runtime (Pure Rust)              │
│                                                        │
│  ┌───────────────────────┐   ┌──────────────────────┐  │
│  │   Axum HTTP Server    │   │ Session Manager      │  │
│  │   - REST Endpoints    │   │ - portable-pty       │  │
│  │   - WebSocket (/ws)   │   │ - 1MB Output Buffer  │  │
│  │   - rust-embed SPA    │   │ - Shell Spawning     │  │
│  └───────────────────────┘   └──────────────────────┘  │
│  ┌───────────────────────┐   ┌──────────────────────┐  │
│  │ Auto-Updater Plugin   │   │ Auto-Start Plugin    │  │
│  │ - Ed25519 Signatures  │   │ - Launch at Login    │  │
│  │ - GitHub Releases API │   │ - Registry / Launchd │  │
│  └───────────────────────┘   └──────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 3. Project File Structure

```
.
├── src/                        # Frontend React + TypeScript source
├── dist/                       # Vite build output (bundled into Rust binary)
├── assets/                     # App icons (icon.png, icon.ico)
├── scripts/
│   └── bump-version.js         # Automated semantic version bumper for CI
├── src-tauri/
│   ├── Cargo.toml              # Rust crate manifest & dependencies
│   ├── build.rs                # Tauri build hook
│   ├── tauri.conf.json         # Tauri v2 configuration
│   ├── Info.plist              # macOS LSUIElement configuration
│   ├── capabilities/
│   │   └── default.json        # Tauri v2 security capabilities
│   ├── icons/                  # 32x32, 128x128, 512x512, .icns, .ico
│   └── src/
│       ├── main.rs             # Application entrypoint
│       ├── lib.rs              # Tauri builder, plugins, activation policy
│       ├── server.rs           # Axum HTTP + WebSocket + rust-embed
│       ├── session.rs          # portable-pty manager & ring buffer
│       ├── tray.rs             # System tray menu and click actions
│       └── updater.rs          # Background auto-update check & install
└── .github/
    └── workflows/
        └── release.yml         # GitHub Actions cross-platform release pipeline
```

---

## 4. Key Rust Implementations

### A. Embedding Frontend Directly into Binary (`src-tauri/src/server.rs`)
Rather than relying on disk paths (`../dist`), `rust-embed` bakes the frontend bundle into the executable's `.rodata` section (~500KB overhead).

```rust
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Assets;

async fn static_or_spa_fallback(uri: axum::http::Uri) -> axum::response::Response {
    let mut path = uri.path().trim_start_matches('/');
    if path.is_empty() {
        path = "index.html";
    }

    if let Some(file) = Assets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return (
            [(axum::http::header::CONTENT_TYPE, mime.as_ref())],
            file.data,
        ).into_response();
    }

    // Single Page Application (SPA) fallback
    if let Some(index) = Assets::get("index.html") {
        return (
            [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
            index.data,
        ).into_response();
    }

    (axum::http::StatusCode::NOT_FOUND, "Not Found").into_response()
}
```

### B. High-Performance PTY Engine with `portable-pty` (`src-tauri/src/session.rs`)
Cross-platform pseudo-terminal execution without native C++ compilation:

```rust
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};

let pty_system = NativePtySystem::default();
let pair = pty_system.openpty(PtySize {
    rows: 24,
    cols: 80,
    pixel_width: 0,
    pixel_height: 0,
})?;

#[cfg(target_os = "windows")]
let mut cmd = CommandBuilder::new("powershell.exe");
#[cfg(target_os = "macos")]
let mut cmd = CommandBuilder::new("/bin/zsh");
#[cfg(target_os = "macos")]
cmd.arg("-l");
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
let mut cmd = CommandBuilder::new("/bin/bash");
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
cmd.arg("-l");

// Configure terminal emulation and color capabilities (crucial for GUI apps)
cmd.env("TERM", "xterm-256color");
cmd.env("COLORTERM", "truecolor");
cmd.env("TERM_PROGRAM", "Apple_Terminal");
cmd.env("TERM_PROGRAM_VERSION", "470.2");
cmd.env("LANG", "en_US.UTF-8");

let child = pair.slave.spawn_command(cmd)?;
```
- **PTY Writer**: Uses an async Tokio unbounded channel worker thread to safely send keyboard input to `Box<dyn Write + Send>` without blocking the async runtime.
- **PTY Reader**: Dedicated OS thread reads raw terminal bytes with multi-byte UTF-8 chunk boundary preservation into an in-memory 1,000,000-character circular buffer and broadcasts updates to connected WebSockets via `tokio::sync::broadcast`.

### C. Headless macOS Configuration (No Dock Icon, No Cmd+Tab)
To keep the app completely in the menu bar:
1. In `src-tauri/Info.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>LSUIElement</key>
       <true/>
   </dict>
   </plist>
   ```
2. In `src-tauri/src/lib.rs`:
   ```rust
   .setup(move |app| {
       #[cfg(target_os = "macos")]
       app.set_activation_policy(tauri::ActivationPolicy::Accessory);
       Ok(())
   })
   ```

---

## 5. Built-in Cryptographic Auto-Updater

Tauri v2 uses **Ed25519** public/private keypairs to sign update bundles.

### 1. Key Generation
Generate the signing keypair:
```bash
npx tauri signer generate -w src-tauri/termi.key
```
This produces:
- `src-tauri/termi.key` (Private key — keep secret, add to `.gitignore` and GitHub Repository Secrets)
- `src-tauri/termi.key.pub` (Public key — embedded in `tauri.conf.json`)

### 2. Configuration (`src-tauri/tauri.conf.json`)
```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/oscarqht/termi/releases/latest/download/latest.json"
    ],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6..."
  }
}
```

### 3. Background Polling & Installation (`src-tauri/src/updater.rs`)
```rust
use tauri_plugin_updater::UpdaterExt;

pub fn start_update_checker(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial check 5 seconds after startup
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        check_and_apply_update(&app).await;

        // Recurring check every 4 hours
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(4 * 3600));
        loop {
            interval.tick().await;
            check_and_apply_update(&app).await;
        }
    });
}
```

---

## 6. GitHub Actions CI/CD Release Pipeline

The pipeline automates:
1. Version bumps on push to `main` (synchronizing `package.json`, `tauri.conf.json`, and `Cargo.toml`).
2. Concurrent matrix builds for macOS (Apple Silicon `aarch64`) and Windows (`x64`).
3. Cryptographic signing of binaries with `TAURI_SIGNING_PRIVATE_KEY`.
4. Generating `latest.json` with signature blocks and direct download links.
5. Publishing the GitHub release.

### Workflow File (`.github/workflows/release.yml`)

```yaml
name: Release

on:
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: write

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

jobs:
  prepare:
    name: Prepare Tag & Version
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.version_step.outputs.tag }}
      version: ${{ steps.version_step.outputs.version }}
      should_release: ${{ steps.version_step.outputs.should_release }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - id: version_step
        run: |
          if [ "${{ github.ref_type }}" = "tag" ]; then
            echo "tag=${{ github.ref_name }}" >> "$GITHUB_OUTPUT"
            echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
            echo "should_release=true" >> "$GITHUB_OUTPUT"
          else
            node scripts/bump-version.js
          fi

  build:
    name: Build (${{ matrix.platform }}-${{ matrix.arch }})
    needs: prepare
    if: needs.prepare.outputs.should_release == 'true'
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            arch: aarch64
            targets: aarch64-apple-darwin
            args: '--target aarch64-apple-darwin'
          - platform: windows-latest
            arch: x64
            targets: ''
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.prepare.outputs.tag }}
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.targets }}
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: npm ci
      - run: npm run build
      - name: Build and Package with Tauri Action
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
        with:
          tagName: ${{ needs.prepare.outputs.tag }}
          releaseName: 'Termi ${{ needs.prepare.outputs.tag }}'
          releaseBody: 'See assets below to install Termi.'
          releaseDraft: true
          prerelease: false
          includeUpdaterJson: false
          retryAttempts: 3
          args: ${{ matrix.args }}

  publish:
    name: Publish Release
    needs: [prepare, build]
    if: needs.prepare.outputs.should_release == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.prepare.outputs.tag }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - env:
          GH_TOKEN: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}
        run: |
          node scripts/generate-updater-json.js "${{ needs.prepare.outputs.tag }}"
      - env:
          GH_TOKEN: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}
        run: |
          gh release edit "${{ needs.prepare.outputs.tag }}" --draft=false
```

---

## 7. Migration Checklist for Future Projects

Follow these steps to convert any existing Web/Electron project to this architecture:

1. **Install Tauri CLI**:
   ```bash
   npm install -D @tauri-apps/cli@^2
   ```
2. **Initialize Tauri**:
   ```bash
   npx tauri init
   ```
3. **Generate Multi-Resolution Icons**:
   ```bash
   npx tauri icon path/to/icon.png -o src-tauri/icons
   ```
4. **Configure `src-tauri/Cargo.toml`**:
   Add `axum`, `tokio`, `portable-pty`, `rust-embed`, `tauri-plugin-updater`, `tauri-plugin-autostart`, and `rfd`.
5. **Set up `rust-embed`**:
   Point `#[folder = "../dist"]` to your frontend build directory and handle SPA routing.
6. **Configure Auto-Updater Keys**:
   ```bash
   npx tauri signer generate -w src-tauri/myapp.key
   ```
   Add public key to `tauri.conf.json` and private key to GitHub Repository Secrets as `TAURI_SIGNING_PRIVATE_KEY`.
7. **Set up GitHub Actions**:
   Drop in `.github/workflows/release.yml` and `scripts/bump-version.js`.

---

## 8. Common Pitfalls & Solutions

### ⚠️ macOS Gatekeeper: "App is damaged and can't be opened. You should move it to the Bin."
- **Root Cause**: When an app is built without `"signingIdentity": "-"` in `tauri.conf.json`, `codesign` produces an invalid signature state (`code has no resources but signature indicates they must be present`). Gatekeeper treats this signature mismatch as a corrupted/damaged binary.
- **The Fix in Repository**:
  In `src-tauri/tauri.conf.json`, explicitly specify ad-hoc signing:
  ```json
  "bundle": {
    "macOS": {
      "signingIdentity": "-"
    }
  }
  ```
- **How End Users Open Unsigned Apps**:
  For apps distributed without an Apple Developer ID ($99/year), macOS quarantine requires approval:
  - **Option 1**: Go to **System Settings > Privacy & Security**, scroll to Security, and click **"Open Anyway"**.
  - **Option 2**: Control-click (or right-click) the app in Finder and choose **Open**.
  - **Option 3**: In Terminal, clear the quarantine attribute:
    ```bash
    xattr -cr /Applications/Termi.app
    ```

### ⚠️ macOS Permissions (TCC): Repeated "Termi would like to access files in your Downloads folder"
- **Root Cause**: macOS TCC protects user folders (`~/Downloads`, `~/Documents`, `~/Desktop`). When Termi is ad-hoc signed (`"-"`), its designated requirement is its binary hash (`cdhash`). Every build/update produces a different hash, causing macOS to treat the updated app as a new entity and revoke/reset previous permissions.
- **Solution 1 (Full Disk Access)**: Grant Termi Full Disk Access to avoid folder prompts altogether:
  ```bash
  npm run app:setup-permissions
  ```
  Or right-click the Termi status bar icon and choose **⚠️ Grant Full Disk Access...**.
- **Solution 2 (Persistent Updates with Free Personal Apple ID)**:
  Sign with a free Personal Team Apple ID certificate ($0, no paid developer account needed):
  ```bash
  npm run app:sign:local
  ```
  This locks the code signing requirement to your Personal Team ID rather than the binary hash, so Full Disk Access and all permissions permanently persist across all updates!

