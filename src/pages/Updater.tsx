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

function useSystemTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return theme;
}

const themeTokens = {
  dark: {
    bg: '#0f172a',
    text: '#f8fafc',
    stateTitle: '#f8fafc',
    stateDesc: '#94a3b8',
    highlightText: '#e2e8f0',
    spinnerBorder: '#334155',
    spinnerAccent: '#38bdf8',
    successBg: 'rgba(16, 185, 129, 0.12)',
    successBorder: 'rgba(16, 185, 129, 0.3)',
    successStroke: '#10b981',
    errorBg: 'rgba(239, 68, 68, 0.12)',
    errorBorder: 'rgba(239, 68, 68, 0.3)',
    errorStroke: '#ef4444',
    errorBoxBg: 'rgba(239, 68, 68, 0.1)',
    errorBoxBorder: 'rgba(239, 68, 68, 0.25)',
    errorBoxText: '#f87171',
    versionCurrentBg: '#1e293b',
    versionCurrentBorder: '#334155',
    versionCurrentText: '#94a3b8',
    arrowColor: '#64748b',
    versionNewBg: 'rgba(56, 189, 248, 0.15)',
    versionNewBorder: 'rgba(56, 189, 248, 0.3)',
    versionNewText: '#38bdf8',
    progressTrackBg: '#1e293b',
    progressTrackBorder: '#334155',
    progressFillBg: '#38bdf8',
    progressStatsText: '#64748b',
    notesBg: '#090d16',
    notesBorder: '#1e293b',
    notesTitle: '#64748b',
    notesContent: '#cbd5e1',
    footerBorder: '#1e293b',
    btnPrimaryBg: '#0284c7',
    btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#1e293b',
    btnSecondaryBorder: '#334155',
    btnSecondaryText: '#94a3b8',
  },
  light: {
    bg: '#ffffff',
    text: '#0f172a',
    stateTitle: '#0f172a',
    stateDesc: '#475569',
    highlightText: '#0f172a',
    spinnerBorder: '#e2e8f0',
    spinnerAccent: '#0284c7',
    successBg: 'rgba(16, 185, 129, 0.12)',
    successBorder: 'rgba(16, 185, 129, 0.35)',
    successStroke: '#059669',
    errorBg: 'rgba(239, 68, 68, 0.12)',
    errorBorder: 'rgba(239, 68, 68, 0.35)',
    errorStroke: '#dc2626',
    errorBoxBg: '#fef2f2',
    errorBoxBorder: '#fecaca',
    errorBoxText: '#b91c1c',
    versionCurrentBg: '#f1f5f9',
    versionCurrentBorder: '#cbd5e1',
    versionCurrentText: '#475569',
    arrowColor: '#94a3b8',
    versionNewBg: 'rgba(2, 132, 199, 0.1)',
    versionNewBorder: 'rgba(2, 132, 199, 0.25)',
    versionNewText: '#0284c7',
    progressTrackBg: '#e2e8f0',
    progressTrackBorder: '#cbd5e1',
    progressFillBg: '#0284c7',
    progressStatsText: '#64748b',
    notesBg: '#f8fafc',
    notesBorder: '#e2e8f0',
    notesTitle: '#64748b',
    notesContent: '#334155',
    footerBorder: '#e2e8f0',
    btnPrimaryBg: '#0284c7',
    btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#f1f5f9',
    btnSecondaryBorder: '#cbd5e1',
    btnSecondaryText: '#334155',
  },
};

export default function Updater() {
  const theme = useSystemTheme();
  const c = themeTokens[theme];

  const [status, setStatus] = useState<UpdateStatusData>({ status: 'Checking' });
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Fetch initial status from backend
    invoke<UpdateStatusData>('get_update_status')
      .then((res) => {
        if (!mounted) return;
        setStatus(res);
        if (res.status === 'Idle') {
          invoke('check_for_updates_manual').catch((err) => {
            console.error('Failed to trigger update check:', err);
          });
        }
      })
      .catch((err) => {
        console.error('Failed to get update status:', err);
      });

    // Listen for real-time status and download progress updates
    let unlisten: (() => void) | undefined;
    listen<UpdateStatusData>('termi://update-status', (event) => {
      if (!mounted) return;
      setStatus(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.error('Failed to listen to termi://update-status:', err);
      });

    // Refresh status when window receives focus
    const onFocus = () => {
      invoke<UpdateStatusData>('get_update_status')
        .then((res) => {
          if (mounted) setStatus(res);
        })
        .catch(console.error);
    };
    window.addEventListener('focus', onFocus);

    return () => {
      mounted = false;
      if (unlisten) unlisten();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Poll backend status while checking or downloading to prevent any desync
  useEffect(() => {
    if (status.status !== 'Checking' && status.status !== 'Downloading') {
      return;
    }

    const interval = setInterval(() => {
      invoke<UpdateStatusData>('get_update_status')
        .then((res) => {
          setStatus((prev) => {
            if (JSON.stringify(prev) !== JSON.stringify(res)) {
              return res;
            }
            return prev;
          });
        })
        .catch(console.error);
    }, 1000);

    return () => clearInterval(interval);
  }, [status.status]);

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        boxSizing: 'border-box',
        backgroundColor: c.bg,
        color: c.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        padding: '20px 24px',
        userSelect: 'none',
        transition: 'background-color 0.2s ease, color 0.2s ease',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '16px 0',
        }}
      >
        {/* State: Checking */}
        {status.status === 'Checking' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              maxWidth: '340px',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                border: `3px solid ${c.spinnerBorder}`,
                borderTop: `3px solid ${c.spinnerAccent}`,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <p style={{ fontSize: '15px', fontWeight: 600, color: c.stateTitle, margin: '14px 0 6px 0' }}>
              Checking for updates...
            </p>
            <p style={{ fontSize: '13px', color: c.stateDesc, margin: 0, lineHeight: 1.4 }}>
              Contacting release server for the latest version
            </p>
          </div>
        )}

        {/* State: UpToDate */}
        {status.status === 'UpToDate' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              maxWidth: '340px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: c.successBg,
                border: `1px solid ${c.successBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c.successStroke} strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: c.stateTitle, margin: '14px 0 6px 0' }}>
              You're up to date!
            </p>
            <p style={{ fontSize: '13px', color: c.stateDesc, margin: 0, lineHeight: 1.4 }}>
              Termi <strong style={{ color: c.highlightText }}>v{status.data.current_version}</strong> is currently the newest version available.
            </p>
          </div>
        )}

        {/* State: Downloading */}
        {status.status === 'Downloading' && (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span
                style={{
                  fontSize: '12px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: c.versionCurrentBg,
                  color: c.versionCurrentText,
                  border: `1px solid ${c.versionCurrentBorder}`,
                  fontWeight: 500,
                }}
              >
                v{status.data.current_version}
              </span>
              <span style={{ color: c.arrowColor, fontSize: '13px' }}>→</span>
              <span
                style={{
                  fontSize: '12px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: c.versionNewBg,
                  color: c.versionNewText,
                  border: `1px solid ${c.versionNewBorder}`,
                  fontWeight: 600,
                }}
              >
                v{status.data.version}
              </span>
            </div>

            <p style={{ fontSize: '15px', fontWeight: 600, color: c.stateTitle, margin: '6px 0 12px 0' }}>
              Downloading update...
            </p>

            {/* Progress bar */}
            <div
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: c.progressTrackBg,
                borderRadius: '4px',
                overflow: 'hidden',
                border: `1px solid ${c.progressTrackBorder}`,
              }}
            >
              <div
                style={{
                  height: '100%',
                  backgroundColor: c.progressFillBg,
                  borderRadius: '4px',
                  transition: 'width 0.2s ease',
                  width: `${Math.max(5, Math.min(status.data.percent, 100))}%`,
                }}
              />
            </div>

            <div
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: c.progressStatsText,
                marginTop: '6px',
              }}
            >
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
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span
                style={{
                  fontSize: '12px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: c.versionCurrentBg,
                  color: c.versionCurrentText,
                  border: `1px solid ${c.versionCurrentBorder}`,
                  fontWeight: 500,
                }}
              >
                v{status.data.current_version}
              </span>
              <span style={{ color: c.arrowColor, fontSize: '13px' }}>→</span>
              <span
                style={{
                  fontSize: '12px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: c.versionNewBg,
                  color: c.versionNewText,
                  border: `1px solid ${c.versionNewBorder}`,
                  fontWeight: 600,
                }}
              >
                v{status.data.version}
              </span>
            </div>

            <p style={{ fontSize: '15px', fontWeight: 600, color: c.stateTitle, margin: '6px 0 10px 0' }}>
              New version ready to install
            </p>

            {status.data.body ? (
              <div
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  maxHeight: '130px',
                  overflowY: 'auto',
                  backgroundColor: c.notesBg,
                  border: `1px solid ${c.notesBorder}`,
                  borderRadius: '8px',
                  padding: '10px 12px',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: c.notesTitle,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '4px',
                  }}
                >
                  Release Notes:
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: c.notesContent,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.5,
                    userSelect: 'text',
                  }}
                >
                  {status.data.body}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '13px', color: c.stateDesc, margin: 0, lineHeight: 1.4 }}>
                Download completed. Click below to install and relaunch Termi immediately.
              </p>
            )}
          </div>
        )}

        {/* State: Error */}
        {status.status === 'Error' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              maxWidth: '340px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: c.errorBg,
                border: `1px solid ${c.errorBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c.errorStroke} strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: c.stateTitle, margin: '14px 0 6px 0' }}>
              Update Check Failed
            </p>
            <p
              style={{
                fontSize: '12px',
                color: c.errorBoxText,
                backgroundColor: c.errorBoxBg,
                border: `1px solid ${c.errorBoxBorder}`,
                padding: '8px 12px',
                borderRadius: '6px',
                margin: '8px 0 0 0',
                maxWidth: '320px',
                wordBreak: 'break-word',
              }}
            >
              {status.data.message}
            </p>
          </div>
        )}

        {/* State: Idle */}
        {status.status === 'Idle' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              maxWidth: '340px',
            }}
          >
            <p style={{ fontSize: '15px', fontWeight: 600, color: c.stateTitle }}>Update Service Idle</p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          paddingTop: '14px',
          borderTop: `1px solid ${c.footerBorder}`,
          transition: 'border-color 0.2s ease',
        }}
      >
        {status.status === 'Downloaded' ? (
          <>
            <button
              onClick={handleClose}
              disabled={isInstalling}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                border: `1px solid ${c.btnSecondaryBorder}`,
                outline: 'none',
                backgroundColor: c.btnSecondaryBg,
                color: c.btnSecondaryText,
                transition: 'all 0.15s ease',
              }}
            >
              Later
            </button>
            <button
              onClick={handleInstallAndRelaunch}
              disabled={isInstalling}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                border: 'none',
                outline: 'none',
                backgroundColor: c.btnPrimaryBg,
                color: c.btnPrimaryText,
                transition: 'all 0.15s ease',
              }}
            >
              {isInstalling ? 'Restarting...' : 'Install & Relaunch'}
            </button>
          </>
        ) : status.status === 'Error' ? (
          <>
            <button
              onClick={handleClose}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                border: `1px solid ${c.btnSecondaryBorder}`,
                outline: 'none',
                backgroundColor: c.btnSecondaryBg,
                color: c.btnSecondaryText,
                transition: 'all 0.15s ease',
              }}
            >
              Close
            </button>
            <button
              onClick={handleCheckAgain}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                border: 'none',
                outline: 'none',
                backgroundColor: c.btnPrimaryBg,
                color: c.btnPrimaryText,
                transition: 'all 0.15s ease',
              }}
            >
              Check Again
            </button>
          </>
        ) : status.status === 'Downloading' ? (
          <button
            onClick={handleClose}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              border: `1px solid ${c.btnSecondaryBorder}`,
              outline: 'none',
              backgroundColor: c.btnSecondaryBg,
              color: c.btnSecondaryText,
              transition: 'all 0.15s ease',
            }}
          >
            Hide to Background
          </button>
        ) : (
          <button
            onClick={handleClose}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
              outline: 'none',
              backgroundColor: c.btnPrimaryBg,
              color: c.btnPrimaryText,
              transition: 'all 0.15s ease',
            }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
