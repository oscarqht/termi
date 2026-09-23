import {
  useState,
  useEffect,
  useRef,
  type FC,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import {
  type SavedPrompt,
  loadSavedPrompts,
  saveSavedPrompts,
  resetSavedPrompts,
} from '../savedPrompts';

interface SavedPromptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt?: (content: string) => void;
  initialManageMode?: boolean;
}

export const SavedPromptsModal: FC<SavedPromptsModalProps> = ({
  isOpen,
  onClose,
  onSelectPrompt,
  initialManageMode = false,
}) => {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'choose' | 'manage'>('choose');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPrompts(loadSavedPrompts());
      setActiveTab(initialManageMode || !onSelectPrompt ? 'manage' : 'choose');
      setSearch('');
      setEditingId(null);
      setNewTitle('');
      setNewContent('');

      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen, initialManageMode, onSelectPrompt]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const filteredPrompts = prompts.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q);
  });

  const handleSelect = (content: string) => {
    if (onSelectPrompt) {
      onSelectPrompt(content);
      onClose();
    }
  };

  const handleCopy = async (id: string, content: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedId(id);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedId(null);
        copyTimeoutRef.current = null;
      }, 1500);
    } catch {
      // ignore copy errors
    }
  };

  const handleCreatePrompt = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const titleTrim = newTitle.trim();
    const contentTrim = newContent.trim();
    if (!titleTrim && !contentTrim) return;

    const newPrompt: SavedPrompt = {
      id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: titleTrim || 'Untitled Prompt',
      content: newContent,
    };

    const next = [newPrompt, ...prompts];
    setPrompts(next);
    saveSavedPrompts(next);
    setNewTitle('');
    setNewContent('');
  };

  const handleStartEdit = (p: SavedPrompt) => {
    setEditingId(p.id);
    setEditTitle(p.title);
    setEditContent(p.content);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  };

  const handleSaveEdit = (id: string) => {
    const titleTrim = editTitle.trim();
    const contentTrim = editContent.trim();
    if (!titleTrim && !contentTrim) return;

    const next = prompts.map((p) =>
      p.id === id
        ? {
            ...p,
            title: titleTrim || 'Untitled Prompt',
            content: editContent,
          }
        : p,
    );
    setPrompts(next);
    saveSavedPrompts(next);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    const next = prompts.filter((p) => p.id !== id);
    setPrompts(next);
    saveSavedPrompts(next);
    if (editingId === id) {
      setEditingId(null);
    }
  };

  const handleResetDefaults = () => {
    if (window.confirm('Reset all saved prompts to default starter prompts? Any custom prompts will be replaced.')) {
      const defaults = resetSavedPrompts();
      setPrompts(defaults);
      setEditingId(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="modal-dialog saved-prompts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-prompts-title"
      >
        <div className="modal-header">
          <div className="saved-prompts-header-tabs">
            <h2 id="saved-prompts-title" className="saved-prompts-title">
              Saved Prompts
            </h2>
            {onSelectPrompt && (
              <div className="modal-tab-group" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'choose'}
                  className={`modal-tab-btn${activeTab === 'choose' ? ' active' : ''}`}
                  onClick={() => setActiveTab('choose')}
                >
                  Choose
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'manage'}
                  className={`modal-tab-btn${activeTab === 'manage' ? ' active' : ''}`}
                  onClick={() => setActiveTab('manage')}
                >
                  Manage ({prompts.length})
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {activeTab === 'choose' && (
          <div className="saved-prompts-choose-view">
            <div className="saved-prompts-search-bar">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="search-icon">
                <circle cx="9" cy="9" r="6" />
                <line x1="13.5" y1="13.5" x2="18" y2="18" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search prompts by title or keywords..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="saved-prompts-search-input"
              />
              {search && (
                <button
                  type="button"
                  className="saved-prompts-clear-search"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  &times;
                </button>
              )}
            </div>

            <div className="saved-prompts-list">
              {filteredPrompts.length === 0 ? (
                <div className="saved-prompts-empty">
                  <p className="muted">
                    {search ? 'No prompts matching your search.' : 'No saved prompts yet.'}
                  </p>
                  {!search && (
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => setActiveTab('manage')}
                    >
                      + Create a Prompt
                    </button>
                  )}
                </div>
              ) : (
                filteredPrompts.map((p) => (
                  <div
                    key={p.id}
                    className="saved-prompt-card"
                    onClick={() => handleSelect(p.content)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSelect(p.content);
                      }
                    }}
                  >
                    <div className="saved-prompt-card-header">
                      <span className="saved-prompt-card-title">{p.title}</span>
                      <div className="saved-prompt-card-actions">
                        <button
                          type="button"
                          className={`icon-button small${copiedId === p.id ? ' copied' : ''}`}
                          onClick={(e) => handleCopy(p.id, p.content, e)}
                          title={copiedId === p.id ? 'Copied!' : 'Copy prompt text'}
                          aria-label={copiedId === p.id ? 'Copied' : 'Copy prompt text'}
                        >
                          {copiedId === p.id ? (
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="5" y="5" width="8" height="8" rx="1.5" />
                              <path d="M3 11V3a1.5 1.5 0 0 1 1.5-1.5H11" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="saved-prompt-insert-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelect(p.content);
                          }}
                        >
                          Insert
                        </button>
                      </div>
                    </div>
                    <div className="saved-prompt-card-preview">
                      {p.content}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="saved-prompts-footer-bar">
              <span className="muted text-small">
                Clicking a prompt inserts it into the terminal without executing.
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => setActiveTab('manage')}
              >
                Manage / Add Prompts
              </button>
            </div>
          </div>
        )}

        {activeTab === 'manage' && (
          <div className="saved-prompts-manage-view">
            <form className="saved-prompt-form" onSubmit={handleCreatePrompt}>
              <h3 className="saved-prompt-form-heading">Create New Saved Prompt</h3>
              <div className="form-group">
                <label htmlFor="new-prompt-title">Prompt Title</label>
                <input
                  id="new-prompt-title"
                  type="text"
                  placeholder="e.g. Code Review, Bug Investigation..."
                  value={newTitle}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
                  className="saved-prompt-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-prompt-content">Prompt Content</label>
                <textarea
                  id="new-prompt-content"
                  rows={4}
                  placeholder="Enter the prompt instructions or template..."
                  value={newContent}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNewContent(e.target.value)}
                  className="saved-prompt-textarea"
                />
              </div>
              <div className="saved-prompt-form-actions">
                <button
                  type="submit"
                  disabled={!newTitle.trim() && !newContent.trim()}
                >
                  + Add Prompt
                </button>
              </div>
            </form>

            <div className="saved-prompts-manage-list-section">
              <div className="saved-prompts-manage-list-header">
                <h3>Existing Prompts ({prompts.length})</h3>
                <button
                  type="button"
                  className="link-button muted"
                  onClick={handleResetDefaults}
                >
                  Reset to defaults
                </button>
              </div>

              <div className="saved-prompts-manage-list">
                {prompts.length === 0 ? (
                  <p className="muted">No saved prompts yet.</p>
                ) : (
                  prompts.map((p) => (
                    <div key={p.id} className="saved-prompt-manage-item">
                      {editingId === p.id ? (
                        <div className="saved-prompt-edit-box">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Title"
                            className="saved-prompt-input"
                          />
                          <textarea
                            rows={4}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            placeholder="Prompt Content"
                            className="saved-prompt-textarea"
                          />
                          <div className="saved-prompt-edit-actions">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(p.id)}
                              disabled={!editTitle.trim() && !editContent.trim()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleCancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="saved-prompt-manage-item-content">
                          <div className="saved-prompt-manage-item-header">
                            <span className="saved-prompt-manage-title">{p.title}</span>
                            <div className="saved-prompt-manage-actions">
                              <button
                                type="button"
                                className="secondary small"
                                onClick={() => handleStartEdit(p)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="danger small"
                                onClick={() => handleDelete(p.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="saved-prompt-manage-preview">{p.content}</div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
