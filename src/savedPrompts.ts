export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
}

export const SAVED_PROMPTS_KEY = 'termi:savedPrompts';

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

export function loadSavedPrompts(): SavedPrompt[] {
  try {
    const raw = localStorage.getItem(SAVED_PROMPTS_KEY);
    if (!raw) return DEFAULT_SAVED_PROMPTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SAVED_PROMPTS;
    const valid = parsed
      .map((item, idx) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `prompt-${idx}`,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        content: typeof item.content === 'string' ? item.content : '',
      }))
      .filter((p) => p.title.length > 0 || p.content.trim().length > 0);
    return valid.length > 0 ? valid : DEFAULT_SAVED_PROMPTS;
  } catch {
    return DEFAULT_SAVED_PROMPTS;
  }
}

export function saveSavedPrompts(prompts: SavedPrompt[]): void {
  try {
    localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));
  } catch {
    // Ignore storage quota or disabled localStorage errors
  }
}

export function resetSavedPrompts(): SavedPrompt[] {
  saveSavedPrompts(DEFAULT_SAVED_PROMPTS);
  return DEFAULT_SAVED_PROMPTS;
}
