import { useEffect, useRef, useState } from 'react';
import { type UpdateStatusData } from '../pages/Updater';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function HeaderUpdater() {
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [status, setStatus] = useState<UpdateStatusData>({ status: 'Idle' });
  const [isOpen, setIsOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch status from backend
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/updater/status');
      if (!res.ok) return;
      const data = await res.json();
      if (data.current_version) {
        setCurrentVersion(data.current_version);
      }
      if (data.status) {
        setStatus(data.status);
      }
    } catch {
      // Backend might be offline during restart
    }
  };

  useEffect(() => {
    fetchStatus();

    const onFocus = () => {
      fetchStatus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Poll while checking, downloading, or when popover is open
  useEffect(() => {
    const isBusy = status.status === 'Checking' || status.status === 'Downloading';
    if (!isBusy && !isOpen && !isRestarting) return;

    const intervalMs = isRestarting ? 1000 : isBusy ? 1000 : 3000;
    const interval = setInterval(() => {
      if (isRestarting) {
        // Poll for server coming back up
        fetch('/api/default-cwd')
          .then((r) => {
            if (r.ok) {
              clearInterval(interval);
              window.location.reload();
            }
          })
          .catch(() => {});
      } else {
        fetchStatus();
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [status.status, isOpen, isRestarting]);

  // Click outside and escape key handling
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleCheckNow = async () => {
    setStatus({ status: 'Checking' });
    try {
      await fetch('/api/updater/check', { method: 'POST' });
      fetchStatus();
    } catch (err: any) {
      setStatus({
        status: 'Error',
        data: { message: err?.message || 'Failed to check for updates' },
      });
    }
  };

  const handleInstall = async () => {
    setIsRestarting(true);
    try {
      const res = await fetch('/api/updater/install', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start installation');
      }
    } catch (err: any) {
      setIsRestarting(false);
      setStatus({
        status: 'Error',
        data: { message: err?.message || 'Failed to install update' },
      });
    }
  };

  const hasUpdateReady = status.status === 'Downloaded';
  const isDownloading = status.status === 'Downloading';
  const isChecking = status.status === 'Checking';

  return (
    <div className="header-updater" ref={containerRef}>
      <button
        type="button"
        className={`updater-badge-btn ${hasUpdateReady ? 'update-ready' : ''} ${isDownloading ? 'downloading' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Software Update"
        aria-label="Software Update"
      >
        {isChecking ? (
          <>
            <span className="updater-badge-spinner" />
            <span className="updater-badge-text">Checking…</span>
          </>
        ) : isDownloading ? (
          <>
            <span className="updater-badge-spinner" />
            <span className="updater-badge-text">
              Updating {status.data.percent}%
            </span>
          </>
        ) : hasUpdateReady ? (
          <>
            <span className="updater-badge-dot ready" />
            <span className="updater-badge-text">
              Update v{status.data.version} ready
            </span>
          </>
        ) : (
          <>
            <span className="updater-badge-text">
              {currentVersion ? `v${currentVersion}` : 'Updates'}
            </span>
          </>
        )}
      </button>

      {isOpen && (
        <div className="updater-popover">
          <div className="updater-popover-header">
            <div className="updater-popover-title-row">
              <span className="updater-popover-title">Software Update</span>
              {currentVersion && (
                <span className="updater-popover-curr-version">
                  Current: v{currentVersion}
                </span>
              )}
            </div>
            <button
              type="button"
              className="updater-popover-close"
              onClick={() => setIsOpen(false)}
              aria-label="Close update panel"
            >
              &times;
            </button>
          </div>

          <div className="updater-popover-body">
            {isRestarting ? (
              <div className="updater-state-box">
                <div className="updater-spinner large" />
                <p className="updater-state-title">Restarting Termi…</p>
                <p className="updater-state-desc">
                  Installing update and relaunching the server. This page will reconnect automatically once Termi is back online.
                </p>
              </div>
            ) : status.status === 'Checking' ? (
              <div className="updater-state-box">
                <div className="updater-spinner" />
                <p className="updater-state-title">Checking for updates…</p>
                <p className="updater-state-desc">
                  Contacting release server for the latest version.
                </p>
              </div>
            ) : status.status === 'UpToDate' ? (
              <div className="updater-state-box">
                <div className="updater-icon-circle success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="updater-state-title">You're up to date!</p>
                <p className="updater-state-desc">
                  Termi <strong>v{status.data.current_version}</strong> is the latest version available.
                </p>
                <button
                  type="button"
                  className="secondary small updater-action-btn"
                  onClick={handleCheckNow}
                >
                  Check again
                </button>
              </div>
            ) : status.status === 'Downloading' ? (
              <div className="updater-state-box">
                <div className="updater-version-pills">
                  <span className="updater-pill current">v{status.data.current_version}</span>
                  <span className="updater-pill-arrow">→</span>
                  <span className="updater-pill new">v{status.data.version}</span>
                </div>
                <p className="updater-state-title">Downloading update…</p>
                <div className="updater-progress-track">
                  <div
                    className="updater-progress-fill"
                    style={{ width: `${Math.max(5, Math.min(status.data.percent, 100))}%` }}
                  />
                </div>
                <div className="updater-progress-stats">
                  <span>{status.data.percent}%</span>
                  <span>
                    {formatBytes(status.data.downloaded)}
                    {status.data.total ? ` / ${formatBytes(status.data.total)}` : ''}
                  </span>
                </div>
              </div>
            ) : status.status === 'Downloaded' ? (
              <div className="updater-state-box">
                <div className="updater-version-pills">
                  <span className="updater-pill current">v{status.data.current_version}</span>
                  <span className="updater-pill-arrow">→</span>
                  <span className="updater-pill new">v{status.data.version}</span>
                </div>
                <p className="updater-state-title">New version ready to install</p>
                {status.data.body ? (
                  <div className="updater-release-notes">
                    <div className="updater-release-notes-title">Release Notes:</div>
                    <div className="updater-release-notes-body">{status.data.body}</div>
                  </div>
                ) : (
                  <p className="updater-state-desc">
                    Download completed. Restart Termi now to apply the update.
                  </p>
                )}
                <div className="updater-actions-row">
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => setIsOpen(false)}
                  >
                    Later
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={handleCheckNow}
                  >
                    Check again
                  </button>
                  <button
                    type="button"
                    className="primary small updater-install-btn"
                    onClick={handleInstall}
                  >
                    Install &amp; Relaunch
                  </button>
                </div>
              </div>
            ) : status.status === 'Error' ? (
              <div className="updater-state-box">
                <div className="updater-icon-circle error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <p className="updater-state-title">Update Check Failed</p>
                <p className="updater-error-box">{status.data.message}</p>
                <button
                  type="button"
                  className="secondary small updater-action-btn"
                  onClick={handleCheckNow}
                >
                  Try again
                </button>
              </div>
            ) : (
              // Idle
              <div className="updater-state-box">
                <p className="updater-state-title">
                  Termi {currentVersion ? `v${currentVersion}` : ''}
                </p>
                <p className="updater-state-desc">
                  Check for the latest features, improvements, and fixes.
                </p>
                <button
                  type="button"
                  className="primary small updater-action-btn"
                  onClick={handleCheckNow}
                >
                  Check for updates
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
