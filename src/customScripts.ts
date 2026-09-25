export interface CustomScript {
  id: string;
  name: string;
  content: string;
  description?: string;
}

export const DEFAULT_CUSTOM_SCRIPTS: CustomScript[] = [
  {
    id: 'script-git-status-log',
    name: 'Git Status & Recent Commits',
    description: 'Inspect status and recent commit history in current directory',
    content: `#!/usr/bin/env bash
set -e

if [ -d .git ] || git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "=== Git Status ==="
  git status --short
  echo ""
  echo "=== Recent Commits ==="
  git log --oneline -n 7
else
  echo "Not a git repository."
fi
`,
  },
  {
    id: 'script-disk-usage',
    name: 'Directory Disk Usage',
    description: 'Display top disk space consumers in current folder',
    content: `#!/usr/bin/env bash
echo "=== Top items by disk usage in $(pwd) ==="
if command -v du >/dev/null 2>&1; then
  du -sh * 2>/dev/null | sort -hr | head -n 10
else
  ls -lh
fi
`,
  },
  {
    id: 'script-quick-test',
    name: 'Run Project Tests',
    description: 'Auto-detect package.json, Cargo.toml or Makefile and run test suite',
    content: `#!/usr/bin/env bash
set -e

if [ -f "package.json" ]; then
  echo "Detected package.json. Running npm test..."
  npm test
elif [ -f "Cargo.toml" ]; then
  echo "Detected Cargo.toml. Running cargo test..."
  cargo test
elif [ -f "Makefile" ]; then
  echo "Detected Makefile. Running make test..."
  make test
elif [ -f "go.mod" ]; then
  echo "Detected Go project. Running go test ./..."
  go test ./...
else
  echo "No recognized test runner found in $(pwd)"
fi
`,
  },
  {
    id: 'script-system-info',
    name: 'System & Tool Environment',
    description: 'Show OS info, tool versions, and active paths',
    content: `#!/usr/bin/env bash
echo "=== System Summary ==="
uname -a
echo ""
echo "=== PATH & Developer Tools ==="
for cmd in node npm git cargo rustc python3 go docker; do
  if command -v $cmd >/dev/null 2>&1; then
    printf "%-10s %s (%s)\n" "$cmd" "$($cmd --version 2>&1 | head -n 1)" "$(which $cmd)"
  fi
done
`,
  },
];

let cachedScripts: CustomScript[] | null = null;
type Listener = (scripts: CustomScript[]) => void;
const listeners = new Set<Listener>();

export function subscribeCustomScripts(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyListeners(scripts: CustomScript[]): void {
  for (const fn of listeners) {
    try {
      fn(scripts);
    } catch {
      // Ignore listener errors
    }
  }
}

export function parseCustomScripts(raw: unknown): CustomScript[] {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_CUSTOM_SCRIPTS;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return DEFAULT_CUSTOM_SCRIPTS;
    const items = parsed
      .map((item, idx) => ({
        id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `script-${idx}`,
        name: typeof item?.name === 'string' ? item.name.trim() : '',
        content: typeof item?.content === 'string' ? item.content : '',
        description: typeof item?.description === 'string' ? item.description.trim() : undefined,
      }))
      .filter((s) => s.name.length > 0 || s.content.trim().length > 0);
    return items.length > 0 ? items : DEFAULT_CUSTOM_SCRIPTS;
  } catch {
    return DEFAULT_CUSTOM_SCRIPTS;
  }
}

export function loadCustomScripts(): CustomScript[] {
  return cachedScripts !== null ? cachedScripts : DEFAULT_CUSTOM_SCRIPTS;
}

export async function fetchCustomScripts(): Promise<CustomScript[]> {
  try {
    const res = await fetch('/api/custom-scripts/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseCustomScripts(data);
    cachedScripts = parsed;
    notifyListeners(parsed);
    return parsed;
  } catch (err) {
    console.warn('[termi] Failed to fetch custom scripts from server:', err);
    return cachedScripts !== null ? cachedScripts : DEFAULT_CUSTOM_SCRIPTS;
  }
}

export async function saveCustomScripts(scripts: CustomScript[]): Promise<CustomScript[]> {
  const sanitized = (Array.isArray(scripts) ? scripts : [])
    .map((item, idx) => ({
      id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `script-${Date.now()}-${idx}`,
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      content: typeof item?.content === 'string' ? item.content : '',
      description: typeof item?.description === 'string' && item.description.trim() ? item.description.trim() : undefined,
    }))
    .filter((s) => s.name.length > 0 || s.content.trim().length > 0);

  // Optimistically update cache and notify
  cachedScripts = sanitized;
  notifyListeners(sanitized);

  try {
    const res = await fetch('/api/custom-scripts/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseCustomScripts(data);
    cachedScripts = parsed;
    notifyListeners(parsed);
    return parsed;
  } catch (err) {
    console.error('[termi] Failed to save custom scripts to server:', err);
    return sanitized;
  }
}

export async function resetCustomScripts(): Promise<CustomScript[]> {
  return saveCustomScripts(DEFAULT_CUSTOM_SCRIPTS);
}
