export interface SlashMatch {
  slashIndex: number;
  query: string;
}

/**
 * Checks if the caret is currently inside a slash command trigger.
 *
 * Rules:
 * - Looks for the last '/' before cursor position.
 * - '/' must be at index 0 or preceded by whitespace (e.g. space, tab, newline).
 * - No newline character between the '/' and cursor.
 */
export function getActiveSlashQuery(text: string, cursorPos: number): SlashMatch | null {
  if (cursorPos <= 0 || cursorPos > text.length) return null;

  const textBeforeCursor = text.slice(0, cursorPos);
  const slashIndex = textBeforeCursor.lastIndexOf('/');
  if (slashIndex === -1) return null;

  // If there's a newline between slash and cursor, the command was finished by a newline
  if (textBeforeCursor.slice(slashIndex).includes('\n')) return null;

  // Must be preceded by start of string or whitespace
  if (slashIndex > 0) {
    const prevChar = textBeforeCursor[slashIndex - 1];
    if (!/\s/.test(prevChar)) {
      return null;
    }
  }

  const query = textBeforeCursor.slice(slashIndex + 1);
  return {
    slashIndex,
    query,
  };
}

/**
 * Replaces the slash trigger and query with the selected prompt content.
 */
export function applySlashPrompt(
  text: string,
  slashIndex: number,
  cursorPos: number,
  promptContent: string
): { newText: string; newCursorPos: number } {
  const before = text.slice(0, slashIndex);
  const after = text.slice(cursorPos);
  const newText = before + promptContent + after;
  const newCursorPos = before.length + promptContent.length;
  return { newText, newCursorPos };
}
