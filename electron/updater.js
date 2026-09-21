import { app, Notification, shell } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

const GITHUB_RELEASES_URL = 'https://github.com/oscarqht/termi/releases/latest';

let onMenuUpdateCallback = () => {};
let isManualCheck = false;

const updateState = {
  status: 'idle', // 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  version: null,
  progress: 0,
  error: null,
};

function showNotification(title, body, onClick = null) {
  if (!Notification.isSupported()) return;
  const notif = new Notification({
    title,
    body,
    silent: false,
  });
  if (onClick) {
    notif.on('click', onClick);
  }
  notif.show();
}

export function getUpdateState() {
  return { ...updateState };
}

export function checkForUpdates(manual = false) {
  isManualCheck = manual;

  if (!app.isPackaged) {
    console.log('[Updater] App is not packaged; skipping check.');
    if (manual) {
      showNotification(
        'Termi Development Mode',
        `Running v${app.getVersion()} in development mode (updates disabled).`
      );
    }
    return;
  }

  updateState.status = 'checking';
  updateState.error = null;
  onMenuUpdateCallback();

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] checkForUpdates failed:', err.message);
  });
}

export function quitAndInstall() {
  if (updateState.status === 'ready') {
    autoUpdater.quitAndInstall();
  }
}

export function initUpdater(options = {}) {
  if (options.onMenuUpdate) {
    onMenuUpdateCallback = options.onMenuUpdate;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
    updateState.status = 'checking';
    onMenuUpdateCallback();
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: v${info.version}`);
    updateState.status = 'downloading';
    updateState.version = info.version;
    updateState.progress = 0;
    onMenuUpdateCallback();

    showNotification(
      'Termi Update Found',
      `Downloading version v${info.version} in background...`
    );
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] No update available.');
    updateState.status = 'idle';
    onMenuUpdateCallback();

    if (isManualCheck) {
      showNotification(
        'Termi is Up to Date',
        `You are running the latest version (v${app.getVersion()}).`
      );
      isManualCheck = false;
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent || 0);
    updateState.status = 'downloading';
    updateState.progress = percent;
    console.log(`[Updater] Download progress: ${percent}%`);
    onMenuUpdateCallback();
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Update downloaded: v${info.version}`);
    updateState.status = 'ready';
    updateState.version = info.version;
    onMenuUpdateCallback();

    showNotification(
      'Termi Update Ready',
      `Version v${info.version} is ready to install. Click to restart now.`,
      () => {
        quitAndInstall();
      }
    );
  });

  autoUpdater.on('error', (err) => {
    const errMsg = err == null ? 'unknown error' : (err.message || String(err));
    console.error('[Updater] Error:', errMsg);
    updateState.status = 'error';
    updateState.error = errMsg;
    onMenuUpdateCallback();

    // Graceful fallback on macOS for unsigned / ad-hoc signature issues
    if (process.platform === 'darwin' && errMsg.toLowerCase().includes('code signature')) {
      showNotification(
        'Termi Update Available',
        'A new version is available on GitHub. Click to open release download.',
        () => {
          shell.openExternal(GITHUB_RELEASES_URL);
        }
      );
      return;
    }

    if (isManualCheck) {
      showNotification('Update Check Error', errMsg);
      isManualCheck = false;
    }
  });

  // Schedule periodic background checks if packaged
  if (app.isPackaged) {
    // Initial check 5 seconds after startup
    setTimeout(() => {
      checkForUpdates(false);
    }, 5000);

    // Recurring check every 4 hours
    setInterval(() => {
      checkForUpdates(false);
    }, 4 * 60 * 60 * 1000);
  }
}
