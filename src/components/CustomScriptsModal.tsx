import React, { useState, useEffect, useRef } from 'react';
import {
  CustomScript,
  loadCustomScripts,
  fetchCustomScripts,
  saveCustomScripts,
  resetCustomScripts,
  subscribeCustomScripts,
} from '../customScripts';
import { useCustomScriptExecution } from '../contexts/CustomScriptExecutionContext';

interface CustomScriptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCwd: string;
  initialManageMode?: boolean;
}

export const CustomScriptsModal: React.FC<CustomScriptsModalProps> = ({
  isOpen,
  onClose,
  currentCwd,
  initialManageMode = false,
}) => {
  const { startScript } = useCustomScriptExecution();

  const [scripts, setScripts] = useState<CustomScript[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'run' | 'manage'>('run');

  // Edit states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContent, setEditContent] = useState('');

  // New script states
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newContent, setNewContent] = useState('');

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setScripts(loadCustomScripts());
      fetchCustomScripts().then(setScripts);
      setActiveTab(initialManageMode ? 'manage' : 'run');
      setSearch('');
      setEditingId(null);
      setNewName('');
      setNewDescription('');
      setNewContent('');

      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen, initialManageMode]);

  useEffect(() => {
    const unsub = subscribeCustomScripts(setScripts);
    return () => unsub();
  }, []);

  if (!isOpen) return null;

  const filteredScripts = scripts.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q)) ||
      s.content.toLowerCase().includes(q)
    );
  });

  const handleRunScript = async (script: CustomScript) => {
    await startScript({ cwd: currentCwd, script });
    onClose();
  };

  const handleStartEdit = (script: CustomScript) => {
    setEditingId(script.id);
    setEditName(script.name);
    setEditDescription(script.description || '');
    setEditContent(script.content);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditDescription('');
    setEditContent('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim() || !editContent.trim()) return;
    const updated = scripts.map((s) =>
      s.id === editingId
        ? {
            ...s,
            name: editName.trim(),
            description: editDescription.trim() || undefined,
            content: editContent,
          }
        : s
    );
    const saved = await saveCustomScripts(updated);
    setScripts(saved);
    handleCancelEdit();
  };

  const handleDelete = async (id: string) => {
    const updated = scripts.filter((s) => s.id !== id);
    const saved = await saveCustomScripts(updated);
    setScripts(saved);
    if (editingId === id) handleCancelEdit();
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newContent.trim()) return;

    const newScript: CustomScript = {
      id: `script-${Date.now()}`,
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      content: newContent,
    };

    const updated = [newScript, ...scripts];
    const saved = await saveCustomScripts(updated);
    setScripts(saved);
    setNewName('');
    setNewDescription('');
    setNewContent('');
  };

  const handleResetDefaults = async () => {
    if (window.confirm('Reset all custom scripts to default templates?')) {
      const defaults = await resetCustomScripts();
      setScripts(defaults);
      handleCancelEdit();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="custom-scripts-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="custom-scripts-header">
          <div>
            <h2 className="custom-scripts-title">Custom Scripts</h2>
            <div className="custom-scripts-target-cwd" title={currentCwd}>
              Target CWD: <code>{currentCwd}</code>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs & Search */}
        <div className="custom-scripts-nav">
          <div className="custom-scripts-tabs">
            <button
              type="button"
              className={`custom-scripts-tab ${activeTab === 'run' ? 'active' : ''}`}
              onClick={() => setActiveTab('run')}
            >
              Run Scripts ({scripts.length})
            </button>
            <button
              type="button"
              className={`custom-scripts-tab ${activeTab === 'manage' ? 'active' : ''}`}
              onClick={() => setActiveTab('manage')}
            >
              Manage & Create
            </button>
          </div>

          <div className="custom-scripts-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search scripts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearch('')}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="custom-scripts-body">
          {activeTab === 'run' && (
            <div className="custom-scripts-list">
              {filteredScripts.length === 0 ? (
                <div className="empty-state">
                  {scripts.length === 0 ? (
                    <>
                      No custom scripts yet. Switch to the{' '}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setActiveTab('manage')}
                        style={{ color: 'var(--link-color)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      >
                        Manage & Create
                      </button>{' '}
                      tab to add one or reset defaults!
                    </>
                  ) : (
                    <>No scripts match your search. Switch to the <strong>Manage & Create</strong> tab to add one!</>
                  )}
                </div>
              ) : (
                filteredScripts.map((script) => (
                  <div key={script.id} className="custom-script-card">
                    <div className="custom-script-card-main">
                      <div className="custom-script-name-row">
                        <span className="custom-script-name">{script.name}</span>
                      </div>
                      {script.description && (
                        <div className="custom-script-desc">{script.description}</div>
                      )}
                      <div className="custom-script-code-preview">
                        <code>{script.content.trim().split('\n').slice(0, 3).join('\n')}</code>
                      </div>
                    </div>
                    <div className="custom-script-card-actions">
                      <button
                        type="button"
                        className="script-btn script-btn-primary"
                        onClick={() => handleRunScript(script)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        <span>Run</span>
                      </button>
                      <button
                        type="button"
                        className="script-btn script-btn-secondary"
                        onClick={() => {
                          setActiveTab('manage');
                          handleStartEdit(script);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="custom-scripts-manage">
              {/* Form to create a new script */}
              <div className="custom-script-create-box">
                <h3 className="custom-scripts-subheading">Create New Custom Script</h3>
                <form onSubmit={handleAdd} className="custom-script-form">
                  <div className="form-group">
                    <label>Script Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Run Integration Tests"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Description (optional)</label>
                    <input
                      type="text"
                      placeholder="Brief note on what this script does"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Bash Script Content</label>
                    <textarea
                      placeholder="#!/usr/bin/env bash&#10;echo 'Hello World'"
                      rows={5}
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      required
                      className="script-textarea"
                    />
                  </div>

                  <button
                    type="submit"
                    className="script-btn script-btn-primary"
                    disabled={!newName.trim() || !newContent.trim()}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>Save Script</span>
                  </button>
                </form>
              </div>

              {/* Manage list */}
              <div className="custom-script-manage-list">
                <div className="custom-scripts-subheading-row">
                  <h3 className="custom-scripts-subheading">Existing Custom Scripts ({filteredScripts.length})</h3>
                  <button
                    type="button"
                    className="script-btn script-btn-secondary script-btn-sm"
                    onClick={handleResetDefaults}
                  >
                    Reset Defaults
                  </button>
                </div>

                {filteredScripts.length === 0 ? (
                  <p className="muted" style={{ padding: '8px 0', fontSize: '0.84rem' }}>
                    {scripts.length === 0
                      ? 'No custom scripts yet. Add one above or click Reset Defaults.'
                      : 'No scripts match your search.'}
                  </p>
                ) : filteredScripts.map((script) => {
                  const isEditing = editingId === script.id;

                  if (isEditing) {
                    return (
                      <div key={script.id} className="custom-script-edit-box">
                        <div className="form-group">
                          <label>Script Name</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            required
                          />
                        </div>

                        <div className="form-group">
                          <label>Description</label>
                          <input
                            type="text"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                          />
                        </div>

                        <div className="form-group">
                          <label>Bash Script Content</label>
                          <textarea
                            rows={6}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            required
                            className="script-textarea"
                          />
                        </div>

                        <div className="script-edit-actions">
                          <button
                            type="button"
                            className="script-btn script-btn-primary"
                            onClick={handleSaveEdit}
                            disabled={!editName.trim() || !editContent.trim()}
                          >
                            Save Changes
                          </button>
                          <button
                            type="button"
                            className="script-btn script-btn-secondary"
                            onClick={handleCancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={script.id} className="custom-script-manage-card">
                      <div className="custom-script-manage-info">
                        <div className="custom-script-name">{script.name}</div>
                        {script.description && (
                          <div className="custom-script-desc">{script.description}</div>
                        )}
                        <pre className="custom-script-snippet">
                          {script.content.trim().slice(0, 150)}
                          {script.content.trim().length > 150 ? '...' : ''}
                        </pre>
                      </div>

                      <div className="custom-script-manage-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => handleStartEdit(script)}
                          title="Edit Script"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="icon-button delete"
                          onClick={() => handleDelete(script.id)}
                          title="Delete Script"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
