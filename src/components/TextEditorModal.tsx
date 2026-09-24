import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  type KeyboardEvent,
  type DragEvent,
  type ClipboardEvent,
  type ChangeEvent,
} from 'react';
import { uploadSessionFiles, shellQuote } from '../uploadUtils';
import { SavedPromptsModal } from './SavedPromptsModal';
import {
  loadSavedPrompts,
  fetchSavedPrompts,
  subscribeSavedPrompts,
  type SavedPrompt,
} from '../savedPrompts';
import { getCaretCoordinates } from '../caretPosition';
import { getActiveSlashQuery, applySlashPrompt } from '../slashCommandUtils';

export interface TextEditorModalHandle {
  focus: () => void;
}

export interface TextEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (text: string, execute: boolean) => void;
  sessionId: string | null;
}

function getDraftKey(sessionId: string | null): string {
  return `termi:draft:${sessionId || 'default'}`;
}

export const TextEditorModal = forwardRef<TextEditorModalHandle, TextEditorModalProps>(({
  isOpen,
  onClose,
  onSend,
  sessionId,
}, ref) => {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptsManageMode, setPromptsManageMode] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(() => loadSavedPrompts());

  const [slashActive, setSlashActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashCoords, setSlashCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorTimeoutRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const dismissedSlashIndexRef = useRef<number | null>(null);

  const draftKey = getDraftKey(sessionId);

  // Load draft on open or sessionId change
  useEffect(() => {
    if (isOpen) {
      fetchSavedPrompts().then(setSavedPrompts);
      try {
        const saved = window.localStorage.getItem(draftKey);
        if (saved !== null) {
          setText(saved);
        }
      } catch {}
      // Auto-focus the textarea
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } else {
      setDragActive(false);
      setUploadError(null);
      setSlashActive(false);
      dismissedSlashIndexRef.current = null;
    }
  }, [isOpen, draftKey]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (!promptsOpen) {
          textareaRef.current?.focus();
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        }
      },
    }),
    [promptsOpen],
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleWindowFocus = () => {
      if (document.visibilityState !== 'hidden' && !promptsOpen) {
        textareaRef.current?.focus();
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
    };
  }, [isOpen, promptsOpen]);

  useEffect(() => {
    return subscribeSavedPrompts(setSavedPrompts);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current !== null) {
        window.clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  const showError = (msg: string) => {
    setUploadError(msg);
    if (errorTimeoutRef.current !== null) {
      window.clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = window.setTimeout(() => {
      setUploadError(null);
      errorTimeoutRef.current = null;
    }, 4000);
  };

  const filteredPrompts = useMemo(() => {
    if (!slashActive) return [];
    if (!slashQuery.trim()) return savedPrompts;
    const q = slashQuery.toLowerCase();
    return savedPrompts.filter(
      (p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
    );
  }, [slashActive, slashQuery, savedPrompts]);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (slashActive && slashListRef.current) {
      const activeEl = slashListRef.current.querySelector<HTMLElement>(
        '.text-editor-slash-item.active'
      );
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [slashSelectedIndex, slashActive]);

  const updateSlashPosition = (idx: number) => {
    const textarea = textareaRef.current;
    const bodyEl = bodyRef.current;
    if (!textarea || !bodyEl) return;

    const coords = getCaretCoordinates(textarea, idx);
    const textareaTop = textarea.offsetTop;
    const textareaLeft = textarea.offsetLeft;

    let top = textareaTop + coords.top - textarea.scrollTop + coords.lineHeight + 6;
    let left = textareaLeft + coords.left - textarea.scrollLeft;

    const bodyWidth = bodyEl.clientWidth;
    const bodyHeight = bodyEl.clientHeight;
    const menuWidth = Math.min(420, bodyWidth - 24);
    const menuHeight = 240;

    // If it would overflow the bottom of the editor body, show above caret
    if (top + menuHeight > bodyHeight && textareaTop + coords.top - textarea.scrollTop - menuHeight - 6 > 0) {
      top = textareaTop + coords.top - textarea.scrollTop - menuHeight - 6;
    }

    left = Math.max(12, Math.min(left, bodyWidth - menuWidth - 12));
    setSlashCoords({ top, left });
  };

  const checkSlashCommand = (currentText?: string, cursorOverride?: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const val = currentText ?? textarea.value;
    const cursor = cursorOverride ?? textarea.selectionStart;

    if (textarea.selectionStart !== textarea.selectionEnd) {
      setSlashActive(false);
      return;
    }

    const match = getActiveSlashQuery(val, cursor);
    if (!match) {
      setSlashActive(false);
      dismissedSlashIndexRef.current = null;
      return;
    }

    if (dismissedSlashIndexRef.current === match.slashIndex) {
      setSlashActive(false);
      return;
    }

    setSlashIndex(match.slashIndex);
    setSlashQuery(match.query);
    updateSlashPosition(match.slashIndex);
    setSlashActive(true);
  };

  const handleApplyPrompt = (prompt: SavedPrompt) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const currentVal = textarea.value;
    const cursor = textarea.selectionStart;

    const { newText, newCursorPos } = applySlashPrompt(
      currentVal,
      slashIndex,
      cursor,
      prompt.content
    );

    setText(newText);
    try {
      window.localStorage.setItem(draftKey, newText);
    } catch {}

    setSlashActive(false);
    dismissedSlashIndexRef.current = null;

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = newCursorPos;
      textarea.selectionEnd = newCursorPos;
    });
  };

  const handleTextChange = (val: string) => {
    setText(val);
    try {
      window.localStorage.setItem(draftKey, val);
    } catch {}
    requestAnimationFrame(() => {
      checkSlashCommand(val);
    });
  };

  const insertTextAtCursor = (insertedText: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      const next = text ? `${text} ${insertedText}` : insertedText;
      handleTextChange(next);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;
    const before = currentVal.slice(0, start);
    const after = currentVal.slice(end);

    const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
    const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
    const prefix = needsSpaceBefore ? ' ' : '';
    const suffix = needsSpaceAfter ? ' ' : '';
    const toInsert = `${prefix}${insertedText}${suffix}`;

    const updated = before + toInsert + after;
    handleTextChange(updated);

    setSlashActive(false);
    dismissedSlashIndexRef.current = null;

    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + toInsert.length;
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;
    });
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!sessionId) {
      showError('No active terminal session');
      return;
    }
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const paths = await uploadSessionFiles(sessionId, files);
      const inserted = paths.map(shellQuote).join(' ');
      insertTextAtCursor(inserted);
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    setText('');
    try {
      window.localStorage.removeItem(draftKey);
    } catch {}
    setSlashActive(false);
    dismissedSlashIndexRef.current = null;
    textareaRef.current?.focus();
  };

  const handleSend = (execute: boolean) => {
    if (!text) return;
    onSend(text, execute);
    // Clear draft after sending
    try {
      window.localStorage.removeItem(draftKey);
    } catch {}
    setText('');
    setSlashActive(false);
    dismissedSlashIndexRef.current = null;
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredPrompts.length > 0) {
          setSlashSelectedIndex((prev) => (prev + 1) % filteredPrompts.length);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredPrompts.length > 0) {
          setSlashSelectedIndex((prev) => (prev - 1 + filteredPrompts.length) % filteredPrompts.length);
        }
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!e.metaKey && !e.ctrlKey && filteredPrompts.length > 0) {
          e.preventDefault();
          handleApplyPrompt(filteredPrompts[slashSelectedIndex]);
          return;
        }
        if (e.key === 'Tab' && filteredPrompts.length === 0) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismissedSlashIndexRef.current = slashIndex;
        setSlashActive(false);
        return;
      }
    }

    // Cmd+Enter (Mac) or Ctrl+Enter: Send & Execute
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend(true);
      return;
    }

    // Escape: close modal
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    // Cmd+Shift+P (Mac) or Ctrl+Shift+P: Saved Prompts
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      setPromptsOpen(true);
      return;
    }

    // Tab key handling
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { selectionStart, selectionEnd, value } = textarea;

      if (!e.shiftKey) {
        // Tab pressed
        if (selectionStart === selectionEnd) {
          // Single cursor: insert 2 spaces
          const updated = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd);
          handleTextChange(updated);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
          });
        } else {
          // Multiline selection: indent each line
          const startLineIndex = value.lastIndexOf('\n', selectionStart - 1) + 1;
          const endLineIndex = value.indexOf('\n', selectionEnd);
          const endPos = endLineIndex === -1 ? value.length : endLineIndex;

          const selectedBlock = value.slice(startLineIndex, endPos);
          const lines = selectedBlock.split('\n');
          const indented = lines.map((l) => '  ' + l).join('\n');

          const updated = value.slice(0, startLineIndex) + indented + value.slice(endPos);
          handleTextChange(updated);

          requestAnimationFrame(() => {
            textarea.selectionStart = selectionStart + 2;
            textarea.selectionEnd = selectionEnd + 2 * lines.length;
          });
        }
      } else {
        // Shift+Tab pressed: unindent
        const startLineIndex = value.lastIndexOf('\n', selectionStart - 1) + 1;
        const endLineIndex = value.indexOf('\n', selectionEnd);
        const endPos = endLineIndex === -1 ? value.length : endLineIndex;

        const selectedBlock = value.slice(startLineIndex, endPos);
        const lines = selectedBlock.split('\n');
        let removedCharsTotal = 0;
        let firstLineRemoved = 0;

        const unindented = lines
          .map((l, i) => {
            let removed = 0;
            if (l.startsWith('  ')) {
              removed = 2;
            } else if (l.startsWith(' ') || l.startsWith('\t')) {
              removed = 1;
            }
            if (i === 0) firstLineRemoved = removed;
            removedCharsTotal += removed;
            return l.slice(removed);
          })
          .join('\n');

        const updated = value.slice(0, startLineIndex) + unindented + value.slice(endPos);
        handleTextChange(updated);

        requestAnimationFrame(() => {
          textarea.selectionStart = Math.max(startLineIndex, selectionStart - firstLineRemoved);
          textarea.selectionEnd = Math.max(startLineIndex, selectionEnd - removedCharsTotal);
        });
      }
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length > 0) {
      handleUploadFiles(files);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = [...(e.clipboardData?.items ?? [])];
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      handleUploadFiles(files);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length > 0) {
      handleUploadFiles(files);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop text-editor-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog text-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-editor-title"
      >
        <div className="modal-header">
          <div className="text-editor-header-left">
            <h2 id="text-editor-title">Text Editor</h2>
            <span className="text-editor-shortcut-hint">
              {navigator.platform.toUpperCase().includes('MAC') ? '⌘⇧E' : 'Ctrl+Shift+E'}
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close text editor"
          >
            &times;
          </button>
        </div>

        <div
          ref={bodyRef}
          className={`modal-body text-editor-body${dragActive ? ' drag-active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <textarea
            ref={textareaRef}
            className={`text-editor-textarea${dragActive ? ' drag-active' : ''}`}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onKeyUp={() => checkSlashCommand()}
            onClick={() => checkSlashCommand()}
            onScroll={() => {
              if (slashActive) {
                updateSlashPosition(slashIndex);
              }
            }}
            onPaste={handlePaste}
            placeholder="Type or paste long text, scripts, or commands here... (Type / for saved prompts)"
            spellCheck={false}
          />
          {dragActive && (
            <div className="text-editor-dropzone-overlay">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
                <path
                  d="M17.5 9.5 9.75 17.25a3.5 3.5 0 1 1-4.95-4.95l8.4-8.4a2.5 2.5 0 1 1 3.54 3.54l-8.13 8.13a1.5 1.5 0 1 1-2.12-2.12l6.72-6.72"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Drop files here to attach</span>
            </div>
          )}

          {slashActive && (
            <div
              className="text-editor-slash-menu"
              style={{ top: `${slashCoords.top}px`, left: `${slashCoords.left}px` }}
              role="listbox"
              aria-label="Saved Prompts"
            >
              <div className="text-editor-slash-header">
                <span className="text-editor-slash-header-title">Saved Prompts</span>
                {slashQuery ? (
                  <span className="text-editor-slash-header-query">/{slashQuery}</span>
                ) : null}
              </div>

              {filteredPrompts.length === 0 ? (
                <div className="text-editor-slash-empty">
                  <p className="text-editor-slash-empty-text">No matching prompts</p>
                  <button
                    type="button"
                    className="link-button small text-editor-slash-open-prompts"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSlashActive(false);
                      setPromptsManageMode(true);
                      setPromptsOpen(true);
                    }}
                  >
                    Manage saved prompts
                  </button>
                </div>
              ) : (
                <div className="text-editor-slash-list" ref={slashListRef}>
                  {filteredPrompts.map((p, idx) => (
                    <div
                      key={p.id}
                      role="option"
                      aria-selected={idx === slashSelectedIndex}
                      className={`text-editor-slash-item${idx === slashSelectedIndex ? ' active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleApplyPrompt(p);
                      }}
                      onMouseEnter={() => setSlashSelectedIndex(idx)}
                    >
                      <div className="text-editor-slash-item-header">
                        <span className="text-editor-slash-item-badge">/</span>
                        <span className="text-editor-slash-item-title">{p.title}</span>
                      </div>
                      <div className="text-editor-slash-item-preview">{p.content}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-editor-slash-footer">
                <span className="text-editor-slash-hint">↑↓ navigate · Enter insert · Esc dismiss</span>
                <button
                  type="button"
                  className="link-button text-editor-slash-manage-link"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSlashActive(false);
                    setPromptsManageMode(true);
                    setPromptsOpen(true);
                  }}
                >
                  Manage prompts
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer text-editor-footer">
          <div className="text-editor-footer-left">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              multiple
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="secondary text-editor-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !sessionId}
              title={sessionId ? 'Attach files or images' : 'No active terminal session'}
              aria-label="Attach files or images"
            >
              {uploading ? (
                <svg viewBox="0 0 24 24" width="16" height="16" className="spin" aria-hidden="true">
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="42"
                    strokeDashoffset="14"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                  <path
                    d="M17.5 9.5 9.75 17.25a3.5 3.5 0 1 1-4.95-4.95l8.4-8.4a2.5 2.5 0 1 1 3.54 3.54l-8.13 8.13a1.5 1.5 0 1 1-2.12-2.12l6.72-6.72"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              <span>{uploading ? 'Uploading...' : 'Attach'}</span>
            </button>
            <button
              type="button"
              className="secondary text-editor-prompts-btn"
              onClick={() => {
                setPromptsManageMode(false);
                setPromptsOpen(true);
              }}
              title={`Saved Prompts (${navigator.platform.toUpperCase().includes('MAC') ? '⌘⇧P' : 'Ctrl+Shift+P'})`}
              aria-label="Saved Prompts"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <span>Prompts</span>
            </button>
            {text.length > 0 && (
              <button
                type="button"
                className="secondary text-editor-clear-btn"
                onClick={handleClear}
                title="Clear editor contents"
              >
                Clear
              </button>
            )}
            {uploadError && <span className="text-editor-upload-error">{uploadError}</span>}
          </div>
          <div className="text-editor-footer-right">
            <button
              type="button"
              className="secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => handleSend(false)}
              disabled={!text}
              title="Paste text into terminal without pressing Enter"
            >
              Send without Enter
            </button>
            <button
              type="button"
              onClick={() => handleSend(true)}
              disabled={!text}
              title={`Send text and execute with Enter (${navigator.platform.toUpperCase().includes('MAC') ? '⌘+Enter' : 'Ctrl+Enter'})`}
            >
              Send &amp; Execute
            </button>
          </div>
        </div>
      </div>
      <SavedPromptsModal
        isOpen={promptsOpen}
        onClose={() => {
          setPromptsOpen(false);
          setPromptsManageMode(false);
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        }}
        onSelectPrompt={(content) => insertTextAtCursor(content)}
        initialManageMode={promptsManageMode}
      />
    </div>
  );
});

TextEditorModal.displayName = 'TextEditorModal';
