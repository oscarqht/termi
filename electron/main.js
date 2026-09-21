import { app, Tray, Menu, shell, clipboard, dialog, nativeImage, Notification } from 'electron';
import path from 'node:path';
import { startServer } from '../server/index.js';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[termi] Another instance is already running. Quitting.');
  app.quit();
}

// Hide dock icon on macOS (pure status bar / menu bar agent)
if (process.platform === 'darwin') {
  app.dock?.hide();
}

let tray = null;
let serverInstance = null;
let serverUrl = '';

function buildContextMenu() {
  const isLoginItem = app.getLoginItemSettings().openAtLogin;

  return Menu.buildFromTemplate([
    {
      label: 'Open in Browser',
      click: () => {
        if (serverUrl) shell.openExternal(serverUrl);
      },
    },
    {
      label: 'Copy URL',
      click: () => {
        if (serverUrl) clipboard.writeText(serverUrl);
      },
    },
    { type: 'separator' },
    {
      label: serverUrl ? `Running: ${serverUrl}` : 'Starting...',
      enabled: false,
    },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: isLoginItem,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Termi',
      click: () => {
        app.quit();
      },
    },
  ]);
}

async function chooseFolderDialog() {
  const result = await dialog.showOpenDialog({
    title: 'Select Working Directory',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

app.on('second-instance', () => {
  if (serverUrl) {
    shell.openExternal(serverUrl);
  }
});

app.whenReady().then(async () => {
  try {
    serverInstance = await startServer({
      chooseFolderHandler: chooseFolderDialog,
      autoPort: true,
      isProd: true,
    });
    serverUrl = serverInstance.url;

    // Resolve tray icons
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';
    const iconName = isWin ? 'trayIcon-16.png' : 'trayIcon.png';
    const iconPath = path.join(import.meta.dirname, '..', 'assets', iconName);

    const trayIcon = nativeImage.createFromPath(iconPath);
    if (isMac) {
      trayIcon.setTemplateImage(true);
    }

    tray = new Tray(trayIcon);
    tray.setToolTip(`Termi: ${serverUrl}\nClick to open, right-click for menu`);

    const updateMenu = () => {
      const menu = buildContextMenu();
      if (!isMac) {
        tray.setContextMenu(menu);
      }
    };

    updateMenu();

    tray.on('click', () => {
      if (serverUrl) shell.openExternal(serverUrl);
    });

    tray.on('right-click', () => {
      tray.popUpContextMenu(buildContextMenu());
    });

    // Notify user of running server
    if (Notification.isSupported()) {
      new Notification({
        title: 'Termi is running',
        body: `Accessible at ${serverUrl}`,
        icon: path.join(import.meta.dirname, '..', 'assets', 'icon.png'),
        silent: true,
      }).show();
    }
  } catch (err) {
    console.error('[termi] Failed to start:', err);
    dialog.showErrorBox('Termi Error', `Failed to start server: ${err.message}`);
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (serverInstance) {
    await serverInstance.close().catch(() => {});
  }
});

// Prevent exiting when windows are closed (headless tray app)
app.on('window-all-closed', (e) => {
  e.preventDefault();
});
