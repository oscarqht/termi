export function normalizePath(p: string, defaultDir = ''): string {
  const normDefault = (defaultDir || '').trim().replace(/\/+$/, '');
  let s = (p || '').trim();
  if (!s) s = normDefault;
  if (normDefault && (s === '~' || s.startsWith('~/') || s.startsWith('~\\'))) {
    s = normDefault + s.slice(1);
  }
  s = s.replace(/\\/g, '/');
  s = s.replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) {
    s = s.replace(/\/+$/, '');
  }
  return s;
}

export function isSameCwd(a: string, b: string, defaultDir = ''): boolean {
  const normA = normalizePath(a, defaultDir);
  const normB = normalizePath(b, defaultDir);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  return normA.toLowerCase() === normB.toLowerCase();
}

export function formatPathDisplay(fullPath: string, homeDir = ''): { name: string; displayPath: string } {
  if (!fullPath) return { name: '', displayPath: '' };
  let displayPath = fullPath.replace(/\\/g, '/');
  if (homeDir) {
    const normHome = homeDir.replace(/\\/g, '/').replace(/\/+$/, '');
    if (displayPath === normHome) {
      displayPath = '~';
    } else if (displayPath.startsWith(normHome + '/')) {
      displayPath = '~' + displayPath.slice(normHome.length);
    }
  }
  const parts = displayPath.split('/').filter(Boolean);
  const name = displayPath === '~' ? '~' : parts[parts.length - 1] || '/';
  return { name, displayPath };
}

export function abbreviatePath(p: string, homeDir = ''): string {
  const { displayPath } = formatPathDisplay(p, homeDir);
  const parts = displayPath.split('/');
  if (parts.length > 3) {
    return `${parts[0]}/…/${parts.slice(-2).join('/')}`;
  }
  return displayPath;
}

