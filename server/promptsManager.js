import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const DEFAULT_SAVED_PROMPTS = [
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

export function getPromptsFilePath() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'termi', 'prompts.json');
  }
  const home = os.homedir();
  return path.join(home, '.config', 'termi', 'prompts.json');
}

export async function loadSavedPrompts() {
  const filePath = getPromptsFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      await saveSavedPrompts(DEFAULT_SAVED_PROMPTS);
      return DEFAULT_SAVED_PROMPTS;
    }
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `prompt-${idx}`,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        content: typeof item.content === 'string' ? item.content : '',
      }));
    }
    return DEFAULT_SAVED_PROMPTS;
  } catch (err) {
    console.warn('[termi] Error reading prompts file:', err.message);
    return DEFAULT_SAVED_PROMPTS;
  }
}

export async function saveSavedPrompts(prompts) {
  const filePath = getPromptsFilePath();
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });

  const valid = (Array.isArray(prompts) ? prompts : []).map((item, idx) => ({
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `prompt-${Date.now()}-${idx}`,
    title: typeof item.title === 'string' ? item.title.trim() : '',
    content: typeof item.content === 'string' ? item.content : '',
  }));

  const json = JSON.stringify(valid, null, 2);
  const tempPath = path.join(dir, `prompts.tmp.${crypto.randomUUID()}`);
  await fsp.writeFile(tempPath, json, 'utf8');
  await fsp.rename(tempPath, filePath);
  return valid;
}
