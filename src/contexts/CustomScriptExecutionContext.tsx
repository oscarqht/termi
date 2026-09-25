import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { CustomScript } from '../customScripts';

export type ScriptExecutionStatus = 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'canceled';

export interface ScriptExecutionItem {
  id: string;
  cwd: string;
  scriptName: string;
  scriptContent: string;
  status: ScriptExecutionStatus;
  output: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  isCanceling: boolean;
  isForceCanceling: boolean;
  isModalOpen: boolean;
  dismissOnStop?: boolean;
}

interface CustomScriptExecutionContextType {
  executions: ScriptExecutionItem[];
  activeModalExecution: ScriptExecutionItem | null;
  startScript: (params: { cwd: string; script: CustomScript }) => Promise<string>;
  rerunScript: (executionId: string) => Promise<string | null>;
  cancelScript: (executionId: string, force?: boolean, autoDismiss?: boolean) => Promise<void>;
  openModal: (executionId: string) => void;
  minimizeModal: () => void;
  dismissExecution: (executionId: string) => void;
}

const CustomScriptExecutionContext = createContext<CustomScriptExecutionContextType | null>(null);

export function CustomScriptExecutionProvider({ children }: { children: React.ReactNode }) {
  const [executions, setExecutions] = useState<ScriptExecutionItem[]>([]);
  const executionsRef = useRef(executions);
  executionsRef.current = executions;

  // Load active and undismissed executions from server on initial mount
  useEffect(() => {
    let isMounted = true;

    async function loadInitialExecutions() {
      try {
        const res = await fetch('/api/custom-scripts');
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted || !data.success || !Array.isArray(data.executions)) return;

        const serverExecutions: ScriptExecutionItem[] = data.executions.map((e: {
          executionId: string;
          cwd: string;
          scriptName: string;
          scriptContent?: string;
          status: ScriptExecutionStatus;
          output?: string;
          startedAt: string;
          finishedAt?: string | null;
        }) => ({
          id: e.executionId,
          cwd: e.cwd,
          scriptName: e.scriptName,
          scriptContent: e.scriptContent || '',
          status: e.status,
          output: e.output || '',
          error: null,
          startedAt: e.startedAt,
          finishedAt: e.finishedAt || null,
          isCanceling: false,
          isForceCanceling: false,
          isModalOpen: false, // Default to dock on reload
        }));

        setExecutions((prev) => {
          const localOnly = prev.filter((item) => item.id.startsWith('temp-'));
          const existingMap = new Map(prev.map((item) => [item.id, item]));
          const merged = serverExecutions.map((se) => {
            const local = existingMap.get(se.id);
            if (local) {
              return {
                ...se,
                isModalOpen: local.isModalOpen,
                isCanceling: local.isCanceling,
                isForceCanceling: local.isForceCanceling,
                dismissOnStop: local.dismissOnStop,
              };
            }
            return se;
          });
          return [...localOnly, ...merged];
        });
      } catch {
        // Ignore fetch errors during initial load
      }
    }

    void loadInitialExecutions();

    return () => {
      isMounted = false;
    };
  }, []);

  const startScript = useCallback(async ({
    cwd,
    script,
  }: {
    cwd: string;
    script: CustomScript;
  }): Promise<string> => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newExecution: ScriptExecutionItem = {
      id: tempId,
      cwd,
      scriptName: script.name,
      scriptContent: script.content,
      status: 'starting',
      output: '',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      isCanceling: false,
      isForceCanceling: false,
      isModalOpen: true,
    };

    // Close any currently open modal so newly launched one takes focus
    setExecutions((prev) => [
      ...prev.map((item) => (item.isModalOpen ? { ...item, isModalOpen: false } : item)),
      newExecution,
    ]);

    try {
      const response = await fetch('/api/custom-scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'start',
          cwd,
          scriptName: script.name,
          script_name: script.name,
          scriptContent: script.content,
          script_content: script.content,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to start script execution');
      }

      setExecutions((prev) =>
        prev.map((item) => {
          if (item.id === tempId) {
            return {
              ...item,
              id: result.executionId,
              output: result.output || '',
              status: result.status as ScriptExecutionStatus,
              error: null,
            };
          }
          return item;
        })
      );

      return result.executionId;
    } catch (error) {
      const errorMessage = (error as Error).message || 'Failed to start script';
      setExecutions((prev) =>
        prev.map((item) => {
          if (item.id === tempId) {
            return {
              ...item,
              status: 'failed',
              error: errorMessage,
              output: item.output ? `${item.output}\n[error] ${errorMessage}` : `[error] ${errorMessage}`,
              finishedAt: new Date().toISOString(),
            };
          }
          return item;
        })
      );
      return tempId;
    }
  }, []);

  const rerunScript = useCallback(
    async (executionId: string): Promise<string | null> => {
      const item = executionsRef.current.find((e) => e.id === executionId);
      if (!item) return null;

      const scriptContent = item.scriptContent;
      if (!scriptContent) {
        setExecutions((prev) =>
          prev.map((e) => {
            if (e.id === executionId) {
              return {
                ...e,
                error: `Could not find script content for "${item.scriptName}".`,
              };
            }
            return e;
          })
        );
        return null;
      }

      // If old execution is on server, dismiss it cleanly
      if (!item.id.startsWith('temp-')) {
        void fetch('/api/custom-scripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'dismiss',
            executionId: item.id,
            execution_id: item.id,
          }),
        }).catch(() => {});
      }

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // Clear output and reset status in-place so modal stays open with fresh state
      setExecutions((prev) =>
        prev.map((e) => {
          if (e.id === executionId) {
            return {
              ...e,
              id: tempId,
              scriptContent,
              status: 'starting',
              output: '',
              error: null,
              startedAt: new Date().toISOString(),
              finishedAt: null,
              isCanceling: false,
              isForceCanceling: false,
              isModalOpen: true,
            };
          }
          return e;
        })
      );

      try {
        const response = await fetch('/api/custom-scripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'start',
            cwd: item.cwd,
            scriptName: item.scriptName,
            script_name: item.scriptName,
            scriptContent,
            script_content: scriptContent,
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Failed to re-run script execution');
        }

        let wasDismissed = false;
        setExecutions((prev) => {
          const exists = prev.some((e) => e.id === tempId);
          if (!exists) {
            wasDismissed = true;
            return prev;
          }
          return prev.map((e) => {
            if (e.id === tempId) {
              return {
                ...e,
                id: result.executionId,
                output: result.output || '',
                status: result.status as ScriptExecutionStatus,
                error: null,
              };
            }
            return e;
          });
        });

        if (wasDismissed) {
          void fetch('/api/custom-scripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: 'cancel',
              executionId: result.executionId,
              execution_id: result.executionId,
              force: true,
            }),
          }).catch(() => {});
        }

        return result.executionId;
      } catch (error) {
        const errorMessage = (error as Error).message || 'Failed to re-run script';
        setExecutions((prev) =>
          prev.map((e) => {
            if (e.id === tempId) {
              return {
                ...e,
                status: 'failed',
                error: errorMessage,
                output: `[error] ${errorMessage}`,
                finishedAt: new Date().toISOString(),
              };
            }
            return e;
          })
        );
        return tempId;
      }
    },
    []
  );

  const dismissExecution = useCallback((executionId: string) => {
    setExecutions((prev) => prev.filter((e) => e.id !== executionId));
    if (!executionId.startsWith('temp-')) {
      void fetch('/api/custom-scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'dismiss',
          executionId,
          execution_id: executionId,
        }),
      }).catch(() => {});
    }
  }, []);

  const cancelScript = useCallback(
    async (executionId: string, force?: boolean, autoDismiss?: boolean) => {
      const item = executionsRef.current.find((e) => e.id === executionId);
      if (!item) return;

      const shouldDismissOnStop = autoDismiss ?? item.dismissOnStop ?? false;

      if (executionId.startsWith('temp-')) {
        dismissExecution(executionId);
        return;
      }

      setExecutions((prev) =>
        prev.map((e) => {
          if (e.id === executionId) {
            return {
              ...e,
              isCanceling: true,
              isForceCanceling: force ? true : e.isForceCanceling,
              dismissOnStop: shouldDismissOnStop,
            };
          }
          return e;
        })
      );

      try {
        const response = await fetch('/api/custom-scripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'cancel',
            executionId,
            execution_id: executionId,
            force: !!force,
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Failed to cancel script');
        }

        const nextStatus = result.status as ScriptExecutionStatus;
        const isStopped = nextStatus !== 'running' && nextStatus !== 'starting';

        if (isStopped && shouldDismissOnStop) {
          const currentItem = executionsRef.current.find((e) => e.id === executionId);
          if (!currentItem?.isModalOpen) {
            dismissExecution(executionId);
            return;
          }
        }

        setExecutions((prev) =>
          prev.map((e) => {
            if (e.id === executionId) {
              return {
                ...e,
                output: result.output || e.output,
                status: nextStatus,
                isCanceling: nextStatus === 'running' || nextStatus === 'starting',
                isForceCanceling: false,
                finishedAt: result.finishedAt || e.finishedAt,
                dismissOnStop: shouldDismissOnStop,
              };
            }
            return e;
          })
        );
      } catch (error) {
        setExecutions((prev) =>
          prev.map((e) => {
            if (e.id === executionId) {
              return {
                ...e,
                isCanceling: false,
                isForceCanceling: false,
                output: `${e.output}\n[error] ${(error as Error).message}`,
              };
            }
            return e;
          })
        );
      }
    },
    [dismissExecution]
  );

  const openModal = useCallback((executionId: string) => {
    setExecutions((prev) =>
      prev.map((e) => ({
        ...e,
        isModalOpen: e.id === executionId,
        dismissOnStop: e.id === executionId ? false : e.dismissOnStop,
      }))
    );
  }, []);

  const minimizeModal = useCallback(() => {
    setExecutions((prev) =>
      prev.map((e) => (e.isModalOpen ? { ...e, isModalOpen: false } : e))
    );
  }, []);

  // Polling loop for active executions
  useEffect(() => {
    const runningExecutions = executions.filter((e) => e.status === 'running' || e.status === 'starting');
    if (runningExecutions.length === 0) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollAll = async () => {
      const currentRunning = executionsRef.current.filter((e) => e.status === 'running' && !e.id.startsWith('temp-'));
      if (currentRunning.length === 0) return;

      await Promise.all(
        currentRunning.map(async (exec) => {
          try {
            const res = await fetch('/api/custom-scripts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                command: 'status',
                executionId: exec.id,
                execution_id: exec.id,
              }),
            });
            if (disposed) return;

            if (res.status === 404) {
              setExecutions((prev) =>
                prev.map((item) => {
                  if (item.id === exec.id) {
                    return {
                      ...item,
                      status: 'failed',
                      error: 'Execution not found on server',
                      finishedAt: item.finishedAt || new Date().toISOString(),
                      isCanceling: false,
                    };
                  }
                  return item;
                })
              );
              return;
            }

            if (!res.ok) return;
            const data = await res.json();

            const nextStatus = data.status as ScriptExecutionStatus;
            const isStopped = nextStatus !== 'running' && nextStatus !== 'starting';

            if (isStopped && exec.dismissOnStop) {
              const currentItem = executionsRef.current.find((e) => e.id === exec.id);
              if (!currentItem?.isModalOpen) {
                dismissExecution(exec.id);
                return;
              }
            }

            setExecutions((prev) =>
              prev.map((item) => {
                if (item.id === exec.id) {
                  return {
                    ...item,
                    scriptContent: (data as { scriptContent?: string }).scriptContent || item.scriptContent,
                    output: data.output || '',
                    status: nextStatus,
                    finishedAt: data.finishedAt || item.finishedAt,
                    isCanceling: nextStatus === 'running' ? item.isCanceling : false,
                  };
                }
                return item;
              })
            );
          } catch {
            // ignore fetch errors during polling
          }
        })
      );

      if (!disposed) {
        timer = setTimeout(pollAll, 500);
      }
    };

    timer = setTimeout(pollAll, 500);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [executions, dismissExecution]);

  const activeModalExecution = useMemo(
    () => executions.find((e) => e.isModalOpen) || null,
    [executions]
  );

  return (
    <CustomScriptExecutionContext.Provider
      value={{
        executions,
        activeModalExecution,
        startScript,
        rerunScript,
        cancelScript,
        openModal,
        minimizeModal,
        dismissExecution,
      }}
    >
      {children}
    </CustomScriptExecutionContext.Provider>
  );
}

export function useCustomScriptExecution() {
  const context = useContext(CustomScriptExecutionContext);
  if (!context) {
    throw new Error('useCustomScriptExecution must be used within a CustomScriptExecutionProvider');
  }
  return context;
}
