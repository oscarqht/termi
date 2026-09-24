export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
}

export const DEFAULT_SAVED_PROMPTS: SavedPrompt[] = [
  {
    id: 'prompt-code-review',
    title: 'Code Review',
    content:
      'Review the recent git changes for potential bugs, security vulnerabilities, edge cases, and performance regressions. Provide prioritized, actionable feedback.',
  },
  {
    id: 'prompt-explain-error',
    title: 'Explain Error',
    content:
      'Analyze the error above in detail: explain why it occurred, identify the root cause, and provide the exact steps or code fix required to resolve it.',
  },
  {
    id: 'prompt-git-summary',
    title: 'Git Diff & Commit Message',
    content:
      'Inspect git status and staged diffs. Summarize the key changes made and propose a clean, conventional commit message with a short description.',
  },
  {
    id: 'prompt-plan-next-steps',
    title: 'Plan Next Steps',
    content:
      'Evaluate our current progress against requirements, list any remaining work or risks, and propose a concise step-by-step plan for what to tackle next.',
  },
];

let cachedPrompts: SavedPrompt[] | null = null;
type Listener = (prompts: SavedPrompt[]) => void;
const listeners = new Set<Listener>();

export function subscribeSavedPrompts(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyListeners(prompts: SavedPrompt[]): void {
  for (const fn of listeners) {
    try {
      fn(prompts);
    } catch {
      // Ignore listener error
    }
  }
}

export function parseSavedPrompts(raw: unknown): SavedPrompt[] {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_SAVED_PROMPTS;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return DEFAULT_SAVED_PROMPTS;
    return parsed
      .map((item, idx) => ({
        id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `prompt-${idx}`,
        title: typeof item?.title === 'string' ? item.title.trim() : '',
        content: typeof item?.content === 'string' ? item.content : '',
      }))
      .filter((p) => p.title.length > 0 || p.content.trim().length > 0);
  } catch {
    return DEFAULT_SAVED_PROMPTS;
  }
}

export function loadSavedPrompts(): SavedPrompt[] {
  return cachedPrompts !== null ? cachedPrompts : DEFAULT_SAVED_PROMPTS;
}

export async function fetchSavedPrompts(): Promise<SavedPrompt[]> {
  try {
    const res = await fetch('/api/prompts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseSavedPrompts(data);
    cachedPrompts = parsed;
    notifyListeners(parsed);
    return parsed;
  } catch (err) {
    console.warn('[termi] Failed to fetch prompts from server:', err);
    return cachedPrompts !== null ? cachedPrompts : DEFAULT_SAVED_PROMPTS;
  }
}

export async function saveSavedPrompts(prompts: SavedPrompt[]): Promise<SavedPrompt[]> {
  const sanitized = (Array.isArray(prompts) ? prompts : [])
    .map((item, idx) => ({
      id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `prompt-${Date.now()}-${idx}`,
      title: typeof item?.title === 'string' ? item.title.trim() : '',
      content: typeof item?.content === 'string' ? item.content : '',
    }))
    .filter((p) => p.title.length > 0 || p.content.trim().length > 0);

  // Optimistically update cache and notify
  cachedPrompts = sanitized;
  notifyListeners(sanitized);

  try {
    const res = await fetch('/api/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseSavedPrompts(data);
    cachedPrompts = parsed;
    notifyListeners(parsed);
    return parsed;
  } catch (err) {
    console.warn('[termi] Failed to persist prompts to server:', err);
    return sanitized;
  }
}

export async function resetSavedPrompts(): Promise<SavedPrompt[]> {
  return await saveSavedPrompts(DEFAULT_SAVED_PROMPTS);
}
