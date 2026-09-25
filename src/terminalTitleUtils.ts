import { getFolderName } from './pathUtils';

// Common shells and process names that should be treated as idle
const BARE_SHELL_REGEX = /^[-_]?(zsh|bash|sh|fish|dash|csh|tcsh|ksh|pwsh|powershell|cmd|cmd\.exe|powershell\.exe|login|wsl|wsl\.exe)$/i;

// Detects "user@host: path" or "user@host: command" prompt titles
const PROMPT_USER_HOST_REGEX = /^[^@\s]+@[^:\s]+:\s*(.*)$/;

/**
 * Sanitizes and filters dynamic terminal titles emitted via OSC 0/2 escape sequences.
 * Returns an empty string if the title is deemed "idle" (e.g. generic shell name,
 * directory path, prompt pattern), allowing fallback to the folder name.
 */
export function sanitizeTerminalTitle(rawTitle: string | null | undefined, cwd = ''): string {
  if (!rawTitle) return '';
  let title = rawTitle.trim();
  if (!title) return '';

  // Strip non-printable or control characters
  title = title.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!title) return '';

  // Check for bare shell names
  if (BARE_SHELL_REGEX.test(title)) {
    return '';
  }

  // Check for prompt user@host pattern: e.g. "tangqh@MacBook: ~/project"
  const promptMatch = title.match(PROMPT_USER_HOST_REGEX);
  if (promptMatch) {
    const remainder = (promptMatch[1] || '').trim();
    if (!remainder) return '';
    // If remainder is just a path (starts with ~, /, \, or .)
    if (/^[~/\\]/.test(remainder) || remainder === '.' || remainder === '..') {
      return '';
    }
    // If it's a command like "user@host: vim file.txt", extract the command part
    title = remainder;
  }

  // Check if title is just a path indicator or equals cwd
  if (title === '~' || title === '~/' || title === '.' || title === '/' || title === '\\') {
    return '';
  }

  if (cwd) {
    const trimmedCwd = cwd.trim();
    const folderName = getFolderName(trimmedCwd);
    if (title === trimmedCwd || title === folderName) {
      return '';
    }
    // Also check normalized forward slashes
    const normTitle = title.replace(/\\/g, '/').replace(/\/+$/, '');
    const normCwd = trimmedCwd.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normTitle === normCwd) {
      return '';
    }
  }

  return title;
}

export type TitleSource = 'custom' | 'terminal' | 'folder' | 'default';

export interface ResolvedTitle {
  displayTitle: string;
  documentTitle: string;
  source: TitleSource;
}

/**
 * Resolves the active title across the 3-tier hierarchy:
 * 1. User custom title (if set)
 * 2. Dynamic terminal title (if active and not filtered)
 * 3. Folder name (from cwd)
 * 4. Default ('termi')
 */
export function resolveSessionTitle({
  customTitle,
  terminalTitle,
  cwd = '',
  defaultTitle = 'termi',
}: {
  customTitle?: string | null;
  terminalTitle?: string | null;
  cwd?: string | null;
  defaultTitle?: string;
}): ResolvedTitle {
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
