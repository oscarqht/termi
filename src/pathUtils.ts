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
