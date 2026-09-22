import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type UpdateStatusData =
  | { status: 'Idle' }
  | { status: 'Checking' }
  | { status: 'UpToDate'; data: { current_version: string } }
  | {
      status: 'Downloading';
      data: {
        version: string;
        current_version: string;
        body: string | null;
        downloaded: number;
        total: number | null;
        percent: number;
      };
    }
  | {
      status: 'Downloaded';
      data: {
        version: string;
        current_version: string;
        body: string | null;
      };
    }
  | { status: 'Error'; data: { message: string } };

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function Updater() {
  const [status, setStatus] = useState<UpdateStatusData>({ status: 'Checking' });
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // Fetch initial status from backend
    invoke<UpdateStatusData>('get_update_status')
      .then((res) => {
        setStatus(res);
      })
      .catch((err) => {
        console.error('Failed to get update status:', err);
      });

    // Listen for real-time status and download progress updates
    const unlistenPromise = listen<UpdateStatusData>('termi://update-status', (event) => {
      setStatus(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleClose = async () => {
    try {
      await invoke('close_update_window');
    } catch (e) {
      console.error('Failed to close window:', e);
    }
  };

  const handleInstallAndRelaunch = async () => {
    setIsInstalling(true);
    try {
      await invoke('install_and_relaunch');
    } catch (err: any) {
      setIsInstalling(false);
      setStatus({
        status: 'Error',
        data: { message: typeof err === 'string' ? err : err?.message || 'Failed to install update.' },
      });
    }
  };

  const handleCheckAgain = async () => {
    setStatus({ status: 'Checking' });
    try {
      await invoke('check_for_updates_manual');
    } catch (err: any) {
      setStatus({
        status: 'Error',
        data: { message: typeof err === 'string' ? err : err?.message || 'Failed to check updates.' },
      });
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.appIconBadge}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
        </div>
        <div>
          <h1 style={styles.title}>Termi Software Update</h1>
          <span style={styles.subtitle}>Cross-platform Terminal Manager</span>
        </div>
      </div>

      <div style={styles.content}>
        {/* State: Checking */}
        {status.status === 'Checking' && (
          <div style={styles.centeredState}>
            <div style={styles.spinner}></div>
            <p style={styles.stateTitle}>Checking for updates...</p>
            <p style={styles.stateDescription}>Contacting release server for the latest version</p>
          </div>
        )}

        {/* State: UpToDate */}
        {status.status === 'UpToDate' && (
          <div style={styles.centeredState}>
            <div style={styles.iconCircleSuccess}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p style={styles.stateTitle}>You're up to date!</p>
            <p style={styles.stateDescription}>
              Termi <strong style={{ color: '#e2e8f0' }}>v{status.data.current_version}</strong> is currently the newest version available.
            </p>
          </div>
        )}

        {/* State: Downloading */}
        {status.status === 'Downloading' && (
          <div style={styles.downloadState}>
            <div style={styles.versionBadgeRow}>
              <span style={styles.versionTag}>v{status.data.current_version}</span>
              <span style={styles.arrowIcon}>→</span>
              <span style={styles.versionTagNew}>v{status.data.version}</span>
            </div>

            <p style={styles.stateTitle}>Downloading update...</p>

            {/* Progress bar */}
            <div style={styles.progressBarTrack}>
              <div
                style={{
                  ...styles.progressBarFill,
                  width: `${Math.max(5, Math.min(status.data.percent, 100))}%`,
                }}
              />
            </div>

            <div style={styles.progressStats}>
              <span>{status.data.percent}%</span>
              <span>
                {formatBytes(status.data.downloaded)}
                {status.data.total ? ` / ${formatBytes(status.data.total)}` : ''}
              </span>
            </div>
          </div>
        )}

        {/* State: Downloaded / Ready to install */}
        {status.status === 'Downloaded' && (
          <div style={styles.readyContainer}>
            <div style={styles.versionBadgeRow}>
              <span style={styles.versionTag}>v{status.data.current_version}</span>
              <span style={styles.arrowIcon}>→</span>
              <span style={styles.versionTagNew}>v{status.data.version}</span>
            </div>

            <p style={styles.stateTitle}>New version ready to install</p>

            {status.data.body ? (
              <div style={styles.releaseNotesBox}>
                <div style={styles.releaseNotesTitle}>Release Notes:</div>
                <div style={styles.releaseNotesContent}>{status.data.body}</div>
              </div>
            ) : (
              <p style={styles.stateDescription}>
                Download completed. Click below to install and relaunch Termi immediately.
              </p>
            )}
          </div>
        )}

        {/* State: Error */}
        {status.status === 'Error' && (
          <div style={styles.centeredState}>
            <div style={styles.iconCircleError}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <p style={styles.stateTitle}>Update Check Failed</p>
            <p style={styles.errorText}>{status.data.message}</p>
          </div>
        )}

        {/* State: Idle */}
        {status.status === 'Idle' && (
          <div style={styles.centeredState}>
            <p style={styles.stateTitle}>Update Service Idle</p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div style={styles.footer}>
        {status.status === 'Downloaded' ? (
          <>
            <button
              onClick={handleClose}
              disabled={isInstalling}
              style={{ ...styles.button, ...styles.buttonSecondary }}
            >
              Later
            </button>
            <button
              onClick={handleInstallAndRelaunch}
              disabled={isInstalling}
              style={{ ...styles.button, ...styles.buttonPrimary }}
            >
              {isInstalling ? 'Restarting...' : 'Install & Relaunch'}
            </button>
          </>
        ) : status.status === 'Error' ? (
          <>
            <button onClick={handleClose} style={{ ...styles.button, ...styles.buttonSecondary }}>
              Close
            </button>
            <button onClick={handleCheckAgain} style={{ ...styles.button, ...styles.buttonPrimary }}>
              Check Again
            </button>
          </>
        ) : status.status === 'Downloading' ? (
          <button onClick={handleClose} style={{ ...styles.button, ...styles.buttonSecondary }}>
            Hide to Background
          </button>
        ) : (
          <button onClick={handleClose} style={{ ...styles.button, ...styles.buttonPrimary }}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    boxSizing: 'border-box',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    padding: '20px 24px',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingBottom: '16px',
    borderBottom: '1px solid #1e293b',
  },
  appIconBadge: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#38bdf8',
  },
  title: {
    margin: 0,
    fontSize: '15px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  subtitle: {
    fontSize: '12px',
    color: '#64748b',
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '16px 0',
  },
  centeredState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: '340px',
  },
  stateTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#f8fafc',
    margin: '12px 0 6px 0',
  },
  stateDescription: {
    fontSize: '13px',
    color: '#94a3b8',
    margin: 0,
    lineHeight: 1.4,
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #334155',
    borderTop: '3px solid #38bdf8',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  iconCircleSuccess: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleError: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: '12px',
    color: '#f87171',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: '8px 12px',
    borderRadius: '6px',
    margin: '8px 0 0 0',
    maxWidth: '320px',
    wordBreak: 'break-word',
  },
  downloadState: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  versionBadgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  versionTag: {
    fontSize: '12px',
    padding: '3px 8px',
    borderRadius: '6px',
    backgroundColor: '#1e293b',
    color: '#94a3b8',
    border: '1px solid #334155',
    fontWeight: 500,
  },
  arrowIcon: {
    color: '#64748b',
    fontSize: '13px',
  },
  versionTagNew: {
    fontSize: '12px',
    padding: '3px 8px',
    borderRadius: '6px',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    color: '#38bdf8',
    border: '1px solid rgba(56, 189, 248, 0.3)',
    fontWeight: 600,
  },
  progressBarTrack: {
    width: '100%',
    height: '8px',
    backgroundColor: '#1e293b',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '16px',
    border: '1px solid #334155',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: '4px',
    transition: 'width 0.2s ease',
  },
  progressStats: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#64748b',
    marginTop: '6px',
  },
  readyContainer: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  releaseNotesBox: {
    width: '100%',
    boxSizing: 'border-box',
    maxHeight: '130px',
    overflowY: 'auto',
    backgroundColor: '#090d16',
    border: '1px solid #1e293b',
    borderRadius: '8px',
    padding: '10px 12px',
    marginTop: '10px',
    textAlign: 'left',
  },
  releaseNotesTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '4px',
  },
  releaseNotesContent: {
    fontSize: '12px',
    color: '#cbd5e1',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
    userSelect: 'text',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    paddingTop: '14px',
    borderTop: '1px solid #1e293b',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    outline: 'none',
    transition: 'all 0.15s ease',
  },
  buttonPrimary: {
    backgroundColor: '#0284c7',
    color: '#ffffff',
  },
  buttonSecondary: {
    backgroundColor: '#1e293b',
    color: '#94a3b8',
    border: '1px solid #334155',
  },
};
