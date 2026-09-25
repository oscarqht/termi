import test from 'node:test';
import assert from 'node:assert/strict';

function getFolderName(dirPath) {
  const trimmed = (dirPath || '').trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/[/\\]+$/, '');
  if (!stripped) return '/';
  const parts = stripped.split(/[/\\]/);
  return parts[parts.length - 1] || stripped;
}

const BARE_SHELL_REGEX = /^[-_]?(zsh|bash|sh|fish|dash|csh|tcsh|ksh|pwsh|powershell|cmd|cmd\.exe|powershell\.exe|login|wsl|wsl\.exe)$/i;
const PROMPT_USER_HOST_REGEX = /^[^@\s]+@[^:\s]+:\s*(.*)$/;

function sanitizeTerminalTitle(rawTitle, cwd = '') {
  if (!rawTitle) return '';
  let title = rawTitle.trim();
  if (!title) return '';

  title = title.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!title) return '';

  if (BARE_SHELL_REGEX.test(title)) {
    return '';
  }

  const promptMatch = title.match(PROMPT_USER_HOST_REGEX);
  if (promptMatch) {
    const remainder = (promptMatch[1] || '').trim();
    if (!remainder) return '';
    if (/^[~/\\]/.test(remainder) || remainder === '.' || remainder === '..') {
      return '';
    }
    title = remainder;
  }

  if (title === '~' || title === '~/' || title === '.' || title === '/' || title === '\\') {
    return '';
  }

  if (cwd) {
    const trimmedCwd = cwd.trim();
    const folderName = getFolderName(trimmedCwd);
    if (title === trimmedCwd || title === folderName) {
      return '';
    }
    const normTitle = title.replace(/\\/g, '/').replace(/\/+$/, '');
    const normCwd = trimmedCwd.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normTitle === normCwd) {
      return '';
    }
  }

  return title;
}

function resolveSessionTitle({ customTitle, terminalTitle, cwd = '', defaultTitle = 'termi' }) {
  const manual = (customTitle || '').trim();
  if (manual) {
    return {
      displayTitle: manual,
      documentTitle: manual,
      source: 'custom',
    };
  }

  const sanitized = sanitizeTerminalTitle(terminalTitle, cwd || '');
  if (sanitized) {
    return {
      displayTitle: sanitized,
      documentTitle: sanitized,
      source: 'terminal',
    };
  }

  const folderName = getFolderName(cwd || '');
  if (folderName) {
    return {
      displayTitle: folderName,
      documentTitle: `${defaultTitle} > ${folderName}`,
      source: 'folder',
    };
  }

  return {
    displayTitle: defaultTitle,
    documentTitle: defaultTitle,
    source: 'default',
  };
}

test('sanitizeTerminalTitle filters bare shells and idle prompt patterns', () => {
  assert.equal(sanitizeTerminalTitle('zsh'), '');
  assert.equal(sanitizeTerminalTitle('-zsh'), '');
  assert.equal(sanitizeTerminalTitle('bash'), '');
  assert.equal(sanitizeTerminalTitle('-bash'), '');
  assert.equal(sanitizeTerminalTitle('fish'), '');
  assert.equal(sanitizeTerminalTitle('powershell.exe'), '');
  assert.equal(sanitizeTerminalTitle(''), '');
  assert.equal(sanitizeTerminalTitle('   '), '');

  // Prompt user@host patterns
  assert.equal(sanitizeTerminalTitle('tangqh@MacBook: ~'), '');
  assert.equal(sanitizeTerminalTitle('user@host: ~/projects/termi'), '');
  assert.equal(sanitizeTerminalTitle('user@host: /Users/tangqh'), '');
  assert.equal(sanitizeTerminalTitle('user@host: .'), '');

  // If prompt has command, extract command
  assert.equal(sanitizeTerminalTitle('user@host: vim index.js'), 'vim index.js');

  // Paths
  assert.equal(sanitizeTerminalTitle('~'), '');
  assert.equal(sanitizeTerminalTitle('~/'), '');
  assert.equal(sanitizeTerminalTitle('/'), '');

  // Path matching cwd
  assert.equal(sanitizeTerminalTitle('/Users/tangqh/termi', '/Users/tangqh/termi'), '');
  assert.equal(sanitizeTerminalTitle('termi', '/Users/tangqh/termi'), '');

  // Legitimate active commands and titles
  assert.equal(sanitizeTerminalTitle('vim src/App.tsx'), 'vim src/App.tsx');
  assert.equal(sanitizeTerminalTitle('npm run dev'), 'npm run dev');
  assert.equal(sanitizeTerminalTitle('cargo test'), 'cargo test');
  assert.equal(sanitizeTerminalTitle('python3 app.py'), 'python3 app.py');
});

test('resolveSessionTitle follows 3-tier hierarchy and documentTitle format', () => {
  // 1. Custom title takes highest priority
  const res1 = resolveSessionTitle({
    customTitle: 'My Project Server',
    terminalTitle: 'vim App.tsx',
    cwd: '/Users/tangqh/termi',
  });
  assert.equal(res1.displayTitle, 'My Project Server');
  assert.equal(res1.documentTitle, 'My Project Server');
  assert.equal(res1.source, 'custom');

  // 2. Dynamic terminal title takes second priority (raw document title, no prefix)
  const res2 = resolveSessionTitle({
    customTitle: '',
    terminalTitle: 'vim App.tsx',
    cwd: '/Users/tangqh/termi',
  });
  assert.equal(res2.displayTitle, 'vim App.tsx');
  assert.equal(res2.documentTitle, 'vim App.tsx');
  assert.equal(res2.source, 'terminal');

  // 3. Idle shell falls back to folder name (document title has termi > prefix)
  const res3 = resolveSessionTitle({
    customTitle: '',
    terminalTitle: 'zsh',
    cwd: '/Users/tangqh/termi',
  });
  assert.equal(res3.displayTitle, 'termi');
  assert.equal(res3.documentTitle, 'termi > termi');
  assert.equal(res3.source, 'folder');

  // 4. Default fallback when no cwd
  const res4 = resolveSessionTitle({
    customTitle: '',
    terminalTitle: '',
    cwd: '',
  });
  assert.equal(res4.displayTitle, 'termi');
  assert.equal(res4.documentTitle, 'termi');
  assert.equal(res4.source, 'default');
});
