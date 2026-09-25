import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useCustomScriptExecution, ScriptExecutionStatus } from '../contexts/CustomScriptExecutionContext';

export const ScriptModal: React.FC = () => {
  const {
    activeModalExecution,
    minimizeModal,
    rerunScript,
    cancelScript,
    dismissExecution,
  } = useCustomScriptExecution();

  const [copied, setCopied] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const execution = activeModalExecution;

  // Auto-scroll logic: scroll to bottom unless user has scrolled up
  useEffect(() => {
    if (!execution?.output) return;

    const container = outputContainerRef.current;
    if (!container) return;

    if (!userScrolledUpRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [execution?.output]);

  // Track if user scrolled up
  const handleScroll = () => {
    const container = outputContainerRef.current;
    if (!container) return;

    const threshold = 40;
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;

    userScrolledUpRef.current = !isAtBottom;
  };

  const handleCopyLogs = async () => {
    if (!execution?.output) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(execution.output);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = execution.output;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleRerun = async () => {
    if (!execution || isRerunning) return;
    setIsRerunning(true);
    userScrolledUpRef.current = false;
    try {
      await rerunScript(execution.id);
    } finally {
      setIsRerunning(false);
    }
  };

  const handleStop = async (force: boolean) => {
    if (!execution) return;
    await cancelScript(execution.id, force);
  };

  if (!execution) return null;

  const isRunning = execution.status === 'running' || execution.status === 'starting';
  const isFinished = execution.status === 'completed' || execution.status === 'failed' || execution.status === 'canceled';

  const getStatusBadge = () => {
    if (execution.isCanceling) {
      return (
        <span className="script-badge script-badge-warning">
          <span className="script-spinner" />
          {execution.isForceCanceling ? 'Force stopping...' : 'Stopping...'}
        </span>
      );
    }

    switch (execution.status) {
      case 'starting':
      case 'running':
        return (
          <span className="script-badge script-badge-info">
            <span className="script-spinner" />
            Running
          </span>
        );
      case 'completed':
        return (
          <span className="script-badge script-badge-success">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="script-badge script-badge-error">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Failed
          </span>
        );
      case 'canceled':
        return (
          <span className="script-badge script-badge-warning">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            Canceled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="modal-backdrop script-modal-backdrop" onClick={minimizeModal}>
      <div className="script-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="script-modal-header">
          <div className="script-modal-title-row">
            <div className="script-modal-title-group">
              <div className="script-modal-headline">
                <span className="script-modal-name">{execution.scriptName}</span>
                {getStatusBadge()}
              </div>
              <div className="script-modal-cwd" title={execution.cwd}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>{execution.cwd}</span>
              </div>
            </div>

            {/* Action controls */}
            <div className="script-modal-actions">
              <button
                type="button"
                className="script-btn script-btn-secondary"
                onClick={handleCopyLogs}
                disabled={!execution.output}
                title="Copy Terminal Logs"
              >
                {copied ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Copy</span>
                  </>
                )}
              </button>

              {isFinished && (
                <button
                  type="button"
                  className="script-btn script-btn-primary"
                  onClick={handleRerun}
                  disabled={isRerunning}
                  title="Re-run Script"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 4v6h6" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  <span>Re-run</span>
                </button>
              )}

              {isRunning && (
                <>
                  {!execution.isCanceling ? (
                    <button
                      type="button"
                      className="script-btn script-btn-danger"
                      onClick={() => handleStop(false)}
                      title="Stop Execution (SIGTERM)"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="script-btn script-btn-danger"
                      onClick={() => handleStop(true)}
                      title="Force Kill Process Immediately (SIGKILL)"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      <span>Force Kill</span>
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                className="script-btn script-btn-icon"
                onClick={minimizeModal}
                title="Minimize to Dock"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <button
                type="button"
                className="script-btn script-btn-icon"
                onClick={() => {
                  if (isRunning) {
                    minimizeModal();
                  } else {
                    dismissExecution(execution.id);
                  }
                }}
                title={isRunning ? 'Minimize' : 'Close and Dismiss'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Terminal Body */}
        <div
          ref={outputContainerRef}
          onScroll={handleScroll}
          className="script-modal-body"
        >
          {execution.output ? (
            <pre className="script-terminal-output">{execution.output}</pre>
          ) : (
            <div className="script-terminal-empty">
              <span className="script-spinner" />
              <span>Starting process and waiting for output...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
