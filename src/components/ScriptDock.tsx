import React from 'react';
import { useCustomScriptExecution, ScriptExecutionItem } from '../contexts/CustomScriptExecutionContext';

export const ScriptDock: React.FC = () => {
  const { executions, openModal, cancelScript, dismissExecution } = useCustomScriptExecution();

  // Only show executions that are minimized (i.e. modal is closed)
  const dockedExecutions = executions.filter((e) => !e.isModalOpen);

  if (dockedExecutions.length === 0) return null;

  return (
    <div className="script-dock-container">
      {dockedExecutions.map((exec) => (
        <ScriptDockCard
          key={exec.id}
          execution={exec}
          onOpenModal={() => openModal(exec.id)}
          onCancel={() => cancelScript(exec.id, exec.isCanceling)}
          onDismiss={() => dismissExecution(exec.id)}
        />
      ))}
    </div>
  );
};

interface ScriptDockCardProps {
  execution: ScriptExecutionItem;
  onOpenModal: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

const ScriptDockCard: React.FC<ScriptDockCardProps> = ({
  execution,
  onOpenModal,
  onCancel,
  onDismiss,
}) => {
  const isRunning = execution.status === 'running' || execution.status === 'starting';

  const getStatusIcon = () => {
    if (execution.isCanceling) {
      return <span className="script-spinner script-spinner-warning" />;
    }
    switch (execution.status) {
      case 'starting':
      case 'running':
        return <span className="script-spinner script-spinner-info" />;
      case 'completed':
        return (
          <span className="script-dock-icon script-dock-icon-success">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </span>
        );
      case 'failed':
        return (
          <span className="script-dock-icon script-dock-icon-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        );
      case 'canceled':
        return (
          <span className="script-dock-icon script-dock-icon-warning">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </span>
        );
      default:
        return null;
    }
  };

  const formatCwd = (cwd: string) => {
    const parts = cwd.split(/[/\\]/).filter(Boolean);
    if (parts.length === 0) return cwd;
    return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : parts.join('/');
  };

  return (
    <div className={`script-dock-card ${isRunning ? 'script-dock-card-running' : ''}`}>
      <div className="script-dock-content" onClick={onOpenModal} title="Click to view full output">
        <div className="script-dock-icon-wrapper">{getStatusIcon()}</div>
        <div className="script-dock-text">
          <div className="script-dock-name">{execution.scriptName}</div>
          <div className="script-dock-sub">
            {execution.isCanceling
              ? 'Stopping...'
              : isRunning
              ? 'Running in background'
              : execution.status}
            {' • '}
            <span className="script-dock-cwd">{formatCwd(execution.cwd)}</span>
          </div>
        </div>
      </div>

      <div className="script-dock-actions">
        <button
          type="button"
          className="script-btn-icon-sm"
          onClick={onOpenModal}
          title="Open logs modal"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>

        {isRunning && (
          <button
            type="button"
            className="script-btn-icon-sm script-btn-icon-danger"
            onClick={onCancel}
            title={execution.isCanceling ? 'Force stop' : 'Stop'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        )}

        {!isRunning && (
          <button
            type="button"
            className="script-btn-icon-sm"
            onClick={onDismiss}
            title="Dismiss"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
