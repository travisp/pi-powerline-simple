const ANSI_SGR = /\x1b\[[0-9;]*m/g;

type TextEdit = { start: number; end: number; text: string };

/** Apply visible-text edits while leaving severity colors in their original order. */
function applyVisibleEdits(value: string, edits: TextEdit[]): string {
  let position = 0;
  let result = "";
  for (const [token] of value.matchAll(/\x1b\[[0-9;]*m|[^]/g)) {
    if (token.startsWith("\x1b[")) {
      result += token;
      continue;
    }

    const edit = edits.find(({ start, end }) => position >= start && position < end);
    if (!edit) result += token;
    else if (position === edit.start) result += edit.text;
    position++;
  }
  return result;
}

/** Compact only pi-quotas statuses, leaving warnings and other extensions untouched. */
export function compactQuotaStatus(statusKey: string, value: string): string {
  if (statusKey !== "pi-quotas-usage") return value;

  // Match visible text so ANSI codes between labels and values cannot interrupt parsing.
  const plain = value.replace(ANSI_SGR, "");
  const windows = [...plain.matchAll(/([^\s:]+):\d+%(?: left)?/g)];
  const edits: TextEdit[] = [];
  for (const match of windows) {
    const start = match.index;
    if (windows.length === 1) {
      edits.push({ start, end: start + match[1].length + 1, text: "" });
    }
    if (match[0].endsWith(" left")) {
      const end = start + match[0].length;
      edits.push({ start: end - 5, end, text: "" });
    }
  }
  for (const match of plain.matchAll(/\s*cap:OK\b/g)) {
    edits.push({ start: match.index, end: match.index + match[0].length, text: "" });
  }
  for (const match of plain.matchAll(/\(↺(?:in )?([^)]*)\)/g)) {
    let duration = match[1].replace(/\s+/g, "");
    if (duration.includes("d")) duration = duration.replace(/\d+m/g, "");
    edits.push({ start: match.index, end: match.index + match[0].length, text: `↺ ${duration}` });
  }

  return applyVisibleEdits(value, edits);
}
