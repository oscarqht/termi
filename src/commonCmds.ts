export type CommonCmd = {
  id: string;
  cmd: string;
  explanation: string;
  enabled: boolean;
};

export const COMMON_CMDS_KEY = 'termi:commonCmds';

const LEGACY_CODEX_CMD = 'codex . --model gpt-5.6-terra -c model_reasoning_effort="medium"';
const DEFAULT_CODEX_CMD =
  'codex . --model gpt-5.6-terra -c model_reasoning_effort="medium" --ask-for-approval never --sandbox workspace-write';
const LEGACY_AGY_CMD = 'agy';
const DEFAULT_AGY_CMD = 'agy --dangerously-skip-permissions';

export const DEFAULT_COMMON_CMDS: CommonCmd[] = [
  {
    id: 'cmd-codex',
    cmd: DEFAULT_CODEX_CMD,
    explanation: 'Codex with GPT-5.6 Terra (medium reasoning)',
    enabled: true,
  },
  {
    id: 'cmd-claude',
    cmd: 'claude --dangerously-skip-permissions',
    explanation: 'Claude Code (bypass permission prompts)',
    enabled: true,
  },
  {
    id: 'cmd-agy',
    cmd: DEFAULT_AGY_CMD,
    explanation: 'Google Antigravity CLI (bypass permission prompts)',
    enabled: true,
  },
];

export function loadCommonCmds(): CommonCmd[] {
  try {
    const raw = localStorage.getItem(COMMON_CMDS_KEY);
    if (!raw) return DEFAULT_COMMON_CMDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COMMON_CMDS;
    return parsed
      .map((item, idx) => {
        let cmd = typeof item.cmd === 'string' ? item.cmd : '';
        let explanation = typeof item.explanation === 'string' ? item.explanation : '';
        if (item.id === 'cmd-codex' && cmd.trim() === LEGACY_CODEX_CMD) {
          cmd = DEFAULT_CODEX_CMD;
        }
        if (item.id === 'cmd-agy' && cmd.trim() === LEGACY_AGY_CMD) {
          cmd = DEFAULT_AGY_CMD;
          if (explanation === 'Google Antigravity CLI') {
            explanation = 'Google Antigravity CLI (bypass permission prompts)';
          }
        }
        return {
          id: typeof item.id === 'string' && item.id ? item.id : `cmd-${idx}`,
          cmd,
          explanation,
          enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        };
      })
      .filter((c) => c.cmd.trim().length > 0);
  } catch {
    return DEFAULT_COMMON_CMDS;
  }
}

export function saveCommonCmds(items: CommonCmd[]): void {
  try {
    localStorage.setItem(COMMON_CMDS_KEY, JSON.stringify(items));
  } catch {
    // ignore storage errors
  }
}

export function getCommonCmdExplanationMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of DEFAULT_COMMON_CMDS) {
    if (c.explanation) map[c.cmd.trim()] = c.explanation;
  }
  const loaded = loadCommonCmds();
  for (const c of loaded) {
    if (c.explanation) map[c.cmd.trim()] = c.explanation;
  }
  return map;
}
