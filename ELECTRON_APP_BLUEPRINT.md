# Blueprint: Converting a Web/Node App into a Cross-Platform Electron Tray App with Automated CI/CD

This document serves as a complete, reusable blueprint for converting any Node.js/web application into a lightweight, cross-platform (macOS & Windows) status bar / system tray application with automated multi-platform builds and GitHub Releases.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Step 1: Modularize the Backend Server](#step-1-modularize-the-backend-server)
3. [Step 2: Electron Main Process (Headless Tray Agent)](#step-2-electron-main-process-headless-tray-agent)
4. [Step 3: Multi-Platform Assets & Icon Generation](#step-3-multi-platform-assets--icon-generation)
5. [Step 4: Handling Native C++ Modules & Prebuilds](#step-4-handling-native-c-modules--prebuilds)
6. [Step 5: Packaging Configuration (`electron-builder`)](#step-5-packaging-configuration-electron-builder)
7. [Step 6: Automated GitHub Actions CI/CD Pipeline](#step-6-automated-github-actions-cicd-pipeline)
8. [Critical Gotchas & Troubleshooting Guide](#critical-gotchas--troubleshooting-guide)

---

## 1. Architecture Overview

Traditional Electron applications wrap a web view in a bulky browser window (`BrowserWindow`), which consumes heavy RAM and duplicates browser functionality.

For developer tools, daemons, or terminal servers, a **Headless Menu Bar / Tray Agent** pattern is superior:
- **No GUI Window**: The app runs silently in the background with no Dock/Taskbar presence.
- **Embedded Node Server**: The Electron main process boots your existing Node/Express server in-process.
- **System Tray Icon**: Lives in the macOS menu bar and Windows notification tray.
- **Native Browser Hand-off**: Clicking the tray icon opens the user's default browser (or mobile devices over VPN/Tailscale) to the bound local URL.
- **Native OS Dialogs**: Replaces web hacks with native OS folder picker dialogs (`dialog.showOpenDialog`).

```
[ Electron Main Process (Headless) ]
  ├── 1. Requests Single-Instance Lock
  ├── 2. Hides Dock (macOS: LSUIElement / app.dock.hide())
  ├── 3. Spawns Embedded HTTP / WebSocket Server (auto-picks available port)
  ├── 4. Binds Status Bar / Tray Icon
  │       ├── Left-click: shell.openExternal(serverUrl)
  │       └── Right-click: Context Menu (Copy URL, Launch at Login, Quit)
  └── 5. Listens to Native Dialog Requests (e.g., Folder Picker)
```

---

## 2. Step 1: Modularize the Backend Server

Instead of letting `server.listen(...)` run immediately on import, export an async function `startServer(options)`.

### Key Requirements
1. **Dynamic Port Conflict Resolution**: If default port (e.g. 3200) is occupied, automatically increment and retry until a free port is found.
2. **Pluggable Native Handlers**: Allow Electron to inject native dialog handlers (e.g., `chooseFolderHandler`).
3. **Preserve CLI Standalone Mode**: Keep the file runnable directly via `node server/index.js` or `npm run dev`.

### Implementation Template (`server/index.js`)

```javascript
import http from 'node:http';
import express from 'express';

const app = express();

export function startServer(options = {}) {
  const defaultPort = parseInt(options.port || process.env.PORT || '3200', 10);
  const host = options.host || '0.0.0.0';
  const chooseFolderHandler = options.chooseFolderHandler || null;

  // Endpoint taking advantage of native desktop folder picker
  app.post('/api/choose-folder', async (req, res) => {
    if (chooseFolderHandler) {
      try {
        const folder = await chooseFolderHandler();
        return res.json({ folder });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    // Fallback for CLI/headless mode
    res.json({ folder: null });
  });

  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    function tryListen(portToTry) {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`Port ${portToTry} in use, trying ${portToTry + 1}...`);
          tryListen(portToTry + 1);
        } else {
          reject(err);
        }
      });

      server.listen(portToTry, host, () => {
        const boundPort = server.address().port;
        resolve({ server, port: boundPort, host });
      });
    }

    tryListen(defaultPort);
  });
}

// Support running standalone: node server/index.js
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startServer();
}
```

---

## 3. Step 2: Electron Main Process (Headless Tray Agent)

### Implementation Template (`electron/main.js`)

```javascript
import { app, Tray, Menu, shell, dialog, Notification } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production' || app.isPackaged;

let tray = null;
let serverInstance = null;
let serverUrl = '';

// 1. Enforce Single-Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// 2. Hide Dock Icon on macOS (Headless menu bar agent)
if (process.platform === 'darwin' && app.dock) {
  app.dock.hide();
}

function resolveAsset(relativePath) {
  return isProd
    ? path.join(process.resourcesPath, relativePath)
    : path.join(__dirname, '..', relativePath);
}

function getTrayIconPath() {
  if (process.platform === 'darwin') {
    // trayIcon.png (22x22) and trayIcon@2x.png (44x44)
    return resolveAsset('assets/trayIcon.png');
  }
  // Windows: 16x16 or 32x32
  return resolveAsset('assets/trayIcon-16.png');
}

function createTray() {
  const iconPath = getTrayIconPath();
  tray = new Tray(iconPath);

  // macOS Template Image: automatically adapts to light and dark menu bars
  if (process.platform === 'darwin') {
    tray.setImage(iconPath);
    tray.setIgnoreDoubleClickEvents(true);
  }

  tray.setToolTip(`My App — Running on ${serverUrl}`);

  const updateMenu = () => {
    const isLoginItem = app.getLoginItemSettings().openAtLogin;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `My App (${serverUrl})`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open in Browser',
        click: () => shell.openExternal(serverUrl),
      },
      {
        label: 'Copy URL',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(serverUrl);
        },
      },
      { type: 'separator' },
      {
        label: 'Launch at Login',
        type: 'checkbox',
        checked: isLoginItem,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
          updateMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateMenu();

  // Left click directly opens the browser
  tray.on('click', () => {
    shell.openExternal(serverUrl);
  });
}

app.whenReady().then(async () => {
  // Start the server, injecting native dialog for folder picking
  const result = await startServer({
    isProd,
    chooseFolderHandler: async () => {
      const res = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      });
      return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
    },
  });

  serverInstance = result.server;
  serverUrl = `http://localhost:${result.port}`;

  createTray();

  // Optional: show a startup notification
  if (Notification.isSupported()) {
    new Notification({
      title: 'My App is Running',
      body: `Running in the status bar at ${serverUrl}`,
    }).show();
  }
});

app.on('window-all-closed', (e) => e.preventDefault());
```

---

## 4. Step 3: Multi-Platform Assets & Icon Generation

A complete Electron distribution requires specific image formats for macOS, Windows, and the Web:

| Asset | Format | Dimension | Usage |
|---|---|---|---|
| `assets/icon.png` | PNG | 512x512 | macOS App Icon & Linux |
| `assets/icon.ico` | ICO | Multi-size (16–256) | Windows Application Icon |
| `assets/trayIcon.png` | PNG | 22x22 | macOS Menu Bar (Standard) |
| `assets/trayIcon@2x.png` | PNG | 44x44 | macOS Menu Bar (Retina) |
| `assets/trayIcon-16.png` | PNG | 16x16 | Windows System Tray |
| `public/favicon.png` | PNG | 64x64 | Web UI Favicon |

### Generator Script (`scripts/generate-icons.py`)

Run `python3 scripts/generate-icons.py` using Pillow (`pip install Pillow`):

```python
from PIL import Image, ImageDraw

def generate_icons(source_image_path):
    src = Image.open(source_image_path).convert('RGBA')
    w, h = src.size

    # 1. 512x512 Main Application Icon (Squircle background)
    app_icon = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    draw = ImageDraw.Draw(app_icon)
    draw.rounded_rectangle([0, 0, 512, 512], radius=110, fill=(255, 255, 255, 255))
    
    # Scale and center glyph
    scaled = src.resize((360, 360), Image.Resampling.LANCZOS)
    app_icon.paste(scaled, (76, 76), scaled)
    app_icon.save('assets/icon.png')

    # 2. Windows Multi-Resolution .ICO
    app_icon.save('assets/icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])

    # 3. macOS / Windows Status Bar Icons (White glyph on transparent background)
    r, g, b, a = src.split()
    white_glyph = Image.merge('RGBA', (
        Image.new('L', (w, h), 255),
        Image.new('L', (w, h), 255),
        Image.new('L', (w, h), 255),
        a
    ))

    tray_specs = [
        (22, 22, 'assets/trayIcon.png'),
        (44, 44, 'assets/trayIcon@2x.png'),
        (16, 16, 'assets/trayIcon-16.png'),
        (32, 32, 'assets/trayIcon-32.png')
    ]
    for tw, th, out in tray_specs:
        canvas = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
        dim = tw - 2
        ratio = float(dim) / max(w, h)
        gw, gh = int(w * ratio), int(h * ratio)
        res = white_glyph.resize((gw, gh), Image.Resampling.LANCZOS)
        canvas.paste(res, ((tw - gw) // 2, (th - gh) // 2), res)
        canvas.save(out)

    # 4. Web Favicon
    fav = app_icon.resize((64, 64), Image.Resampling.LANCZOS)
    fav.save('public/favicon.png')

if __name__ == '__main__':
    generate_icons('assets/logo-source.png')
```

---

## 5. Step 4: Handling Native C++ Modules & Prebuilds

If your backend relies on native Node addons (such as `node-pty`, `sqlite3`, `better-sqlite3`, or `sharp`):

1. **ASAR Unpacking**: Native binary `.node` files, `.dll`, `.dylib`, or helper executables cannot run directly inside a packed `.asar` archive. They must be unpacked.
2. **Cross-Platform Postinstall**: Unix commands like `chmod +x` will crash on Windows CI runners (`cmd.exe`). Use Node.js wrappers instead.

### In `package.json`:

```json
{
  "scripts": {
    "postinstall": "node -e \"if (process.platform !== 'win32') { try { require('child_process').execSync('chmod +x node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null'); } catch(e){} }\""
  }
}
```

---

## 6. Step 5: Packaging Configuration (`electron-builder`)

Add the complete `build` block in `package.json`.

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "main": "electron/main.js",
  "scripts": {
    "app": "npm run build && electron .",
    "app:build": "npm run build && electron-builder --publish never",
    "app:build:mac": "npm run build && electron-builder --mac --publish never",
    "app:build:win": "npm run build && electron-builder --win --x64 --publish never",
    "app:build:all": "npm run build && electron-builder --mac --win --publish never"
  },
  "build": {
    "appId": "com.myapp.app",
    "productName": "MyApp",
    "afterPack": "scripts/after-pack.js",
    "mac": {
      "category": "public.app-category.developer-tools",
      "target": ["dmg", "zip"],
      "icon": "assets/icon.png",
      "extendInfo": {
        "LSUIElement": 1
      }
    },
    "win": {
      "target": ["nsis", "portable"],
      "icon": "assets/icon.ico"
    },
    "files": [
      "dist/**/*",
      "server/**/*",
      "electron/**/*",
      "assets/**/*",
      "package.json"
    ],
    "asar": true,
    "asarUnpack": [
      "**/node_modules/node-pty/**"
    ]
  }
}
```

> **Key settings explained:**
> - `LSUIElement: 1`: Tells macOS that this is an agent app (never creates a Dock icon, even on system cold boot).
> - `--publish never`: Prevents `electron-builder` from attempting to publish directly during the build step in CI.
> - `afterPack`: Re-signs nested binaries on macOS so Gatekeeper won't report the app as damaged.

---

## 7. Step 6: Automated GitHub Actions CI/CD Pipeline

This setup accomplishes:
1. **Push to `main`**: Inspects tags/version, bumps the minor version (`0.1.0` $\rightarrow$ `0.2.0`), commits `chore(release): v0.2.0 [skip ci]`, creates git tag `v0.2.0`, and pushes both.
2. **Build Matrix**: Runs concurrently on `macos-latest` and `windows-latest`.
3. **Unified Release**: Gathers `.dmg`, `.zip`, and `.exe` artifacts and publishes an official GitHub Release.
4. **Manual Tag Support**: Pushing any tag (`git push origin v1.0.0`) bypasses the bump step and immediately builds and releases.

### 1. Version Bump Script (`scripts/bump-version.js`)

```javascript
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const isDryRun = process.argv.includes('--dry-run');

// 1. Skip if the commit is already an automated release
try {
  const lastCommitMsg = execSync('git log -1 --pretty=%B', { encoding: 'utf8' });
  if (lastCommitMsg.includes('[skip ci]') || lastCommitMsg.includes('chore(release):')) {
    console.log('Automated release commit detected. Skipping version bump.');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_release=false\n');
    }
    process.exit(0);
  }
} catch (e) {
  console.warn('Could not read git log:', e.message);
}

// 2. Read latest git tag or package.json
let currentVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version || '0.1.0';
try {
  const latestTag = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf8' }).trim();
  const cleanTag = latestTag.replace(/^v/, '');
  if (/^\d+\.\d+\.\d+$/.test(cleanTag)) {
    currentVersion = cleanTag;
  }
} catch {
  // No git tags exist yet
}

// 3. Increment minor version: X.Y.Z -> X.(Y+1).0
const parts = currentVersion.split('.').map(Number);
const major = isNaN(parts[0]) ? 0 : parts[0];
const minor = isNaN(parts[1]) ? 1 : parts[1];
const nextVersion = `${major}.${minor + 1}.0`;
const nextTag = `v${nextVersion}`;

console.log(`Current: ${currentVersion} -> Next: ${nextVersion} (${nextTag})`);

if (isDryRun) {
  process.exit(0);
}

// 4. Update package.json and package-lock.json
execSync(`npm version ${nextVersion} --no-git-tag-version`, { stdio: 'inherit' });

// 5. Commit and tag
execSync('git config user.name "github-actions[bot]"');
execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
execSync('git add package.json package-lock.json');
execSync(`git commit -m "chore(release): ${nextTag} [skip ci]"`);
execSync(`git tag ${nextTag}`);

// 6. Push to repository
execSync('git push origin main');
execSync(`git push origin ${nextTag}`);

// 7. Write GitHub Actions outputs
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${nextTag}\nversion=${nextVersion}\nshould_release=true\n`);
}
```

### 2. GitHub Actions Workflow (`.github/workflows/release.yml`)

```yaml
name: Release

on:
  push:
    branches:
      - main
    tags:
      - 'v*'

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
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Resolve or bump tag
        id: version_step
        run: |
          if [ "${{ github.ref_type }}" = "tag" ]; then
            echo "Building for pushed tag: ${{ github.ref_name }}"
            echo "tag=${{ github.ref_name }}" >> "$GITHUB_OUTPUT"
            echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
            echo "should_release=true" >> "$GITHUB_OUTPUT"
          else
            echo "Push to main detected. Bumping minor version..."
            node scripts/bump-version.js
          fi

  build:
    name: Build (${{ matrix.os }})
    needs: prepare
    if: needs.prepare.outputs.should_release == 'true'
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            build_cmd: npm run app:build:mac
            artifact_name: mac-dist
          - os: windows-latest
            build_cmd: npm run app:build:win
            artifact_name: win-dist
    runs-on: ${{ matrix.os }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.prepare.outputs.tag }}
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build application
        run: ${{ matrix.build_cmd }}
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}
          path: |
            dist/*.dmg
            dist/*.zip
            dist/*.exe
          if-no-files-found: error

  publish:
    name: Publish GitHub Release
    needs: [prepare, build]
    if: needs.prepare.outputs.should_release == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.prepare.outputs.tag }}

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: release_artifacts
          merge-multiple: true

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ needs.prepare.outputs.tag }}
          name: Release ${{ needs.prepare.outputs.tag }}
          generate_release_notes: true
          draft: false
          prerelease: false
          files: |
            release_artifacts/*.dmg
            release_artifacts/*.zip
            release_artifacts/*.exe
```

---

## 8. Critical Gotchas & Troubleshooting Guide

### ⚠️ Gotcha 1: `electron-builder` Fails in CI with `GitHub Personal Access Token is not set`
- **Symptom**: `⨯ GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"`
- **Why**: `electron-builder` detects `CI=true` and attempts an implicit publish in the build step before artifacts are even ready.
- **Fix**:
  1. Add `--publish never` to your build commands in `package.json` (`electron-builder --mac --publish never`).
  2. In GitHub Actions, pass `env: GH_TOKEN: ${{ secrets.GH_TOKEN || secrets.GITHUB_TOKEN }}` to the build steps.

### ⚠️ Gotcha 2: macOS Gatekeeper reports `"App is damaged and can't be opened. You should move it to the Bin."`
- **Symptom**: After downloading the `.dmg` from GitHub Releases, clicking the app shows the damaged warning.
- **Root Cause**:
  1. `electron-builder` modifies the Electron app bundle (injects `Info.plist`, unpacks files) without re-signing nested components when no Apple Developer certificate is present. `spctl` reports `code has no resources but signature indicates they must be present`.
  2. Browsers set the `com.apple.quarantine` attribute on downloaded files. Gatekeeper treats any quarantined app with an invalid/mismatched signature as corrupt ("damaged").
- **Fix (In Repository)**: Add an `afterPack` hook (`scripts/after-pack.js`) to apply deep ad-hoc signing before disk packaging:
  ```javascript
  // scripts/after-pack.js
  import { execSync } from 'node:child_process';
  import path from 'node:path';

  export default async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execSync(`codesign --force --deep -s - "${appPath}"`, { stdio: 'inherit' });
  }
  ```
- **Fix (For End Users of Unsigned Free Apps)**:
  Run in Terminal:
  ```bash
  xattr -cr /Applications/MyApp.app
  ```
  *(Or go to **System Settings $\rightarrow$ Privacy & Security** and click **"Open Anyway"**)*

### ⚠️ Gotcha 3: Infinite Loops with Automated Release Commits
- **Symptom**: CI pushes a version bump commit to `main`, which triggers the workflow again endlessly.
- **Fix**:
  1. Always include `[skip ci]` in the commit message: `git commit -m "chore(release): v0.2.0 [skip ci]"`.
  2. In `scripts/bump-version.js`, inspect the latest commit message and exit immediately if it contains `[skip ci]` or `chore(release):`.

### ⚠️ Gotcha 4: GitHub Token Events Do Not Trigger Workflows
- **Symptom**: Workflow 1 pushes a tag, but a separate Workflow 2 with `on: push: tags:` never executes.
- **Why**: GitHub deliberately blocks events created by `secrets.GITHUB_TOKEN` from triggering new workflow runs to avoid recursive loops.
- **Fix**: Keep the tag creation and the matrix builds inside the **same workflow** using `needs: [prepare]` dependencies.

### ⚠️ Gotcha 5: Windows CI Fails on Postinstall (`chmod: command not found`)
- **Symptom**: `npm ci` succeeds on Ubuntu/macOS but fails on `windows-latest`.
- **Fix**: Never execute bash-only commands (`chmod`, `mkdir -p`) directly in `package.json` scripts. Wrap them in a Node check:
  ```json
  "postinstall": "node -e \"if (process.platform !== 'win32') { try { require('child_process').execSync('chmod +x ...'); } catch(e){} }\""
  ```
