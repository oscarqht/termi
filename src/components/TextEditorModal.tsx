import { useEffect, useRef, useState, type FC, type KeyboardEvent } from 'react';

interface TextEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (text: string, execute: boolean) => void;
  sessionId: string | null;
}

function getDraftKey(sessionId: string | null): string {
  return `termi:draft:${sessionId || 'default'}`;
}

export const TextEditorModal: FC<TextEditorModalProps> = ({
  isOpen,
  onClose,
  onSend,
  sessionId,
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftKey = getDraftKey(sessionId);

  // Load draft on open or sessionId change
  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen, draftKey]);

  const handleTextChange = (val: string) => {
    setText(val);
    try {
      window.localStorage.setItem(draftKey, val);
    } catch {}
  };

  const handleClear = () => {
    setText('');
    try {
      window.localStorage.removeItem(draftKey);
    } catch {}
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
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  if (!isOpen) return null;

  const linesCount = text ? text.split('\n').length : 0;
  const charsCount = text.length;

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

        <div className="modal-body text-editor-body">
          <textarea
            ref={textareaRef}
            className="text-editor-textarea"
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type or paste long text, scripts, or commands here..."
            spellCheck={false}
          />
        </div>

        <div className="modal-footer text-editor-footer">
          <div className="text-editor-footer-left">
            <span className="text-editor-stats">
              {linesCount} {linesCount === 1 ? 'line' : 'lines'}, {charsCount} {charsCount === 1 ? 'char' : 'chars'}
            </span>
            {text.length > 0 && (
              <button
                type="button"
                className="secondary small text-editor-clear-btn"
                onClick={handleClear}
                title="Clear editor contents"
              >
                Clear
              </button>
            )}
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
    </div>
  );
};
