import { getIcons } from "./upstream/icons.ts";
import type { StatusLineSegmentId, StatusLineSegmentOptions } from "./upstream/types.ts";

// Rainbow styling inserts ANSI color codes between letters in the prefix.
const thinkingPrefix = new RegExp("think:".split("").join("(?:\\x1b\\[[0-9;]*m)*"));

// Keep provider qualifiers, versions, and variants; leave other families untouched.
export function customizeModelName(name: string): string {
  const qualifierEnd = name.lastIndexOf("/") + 1;
  const qualifier = name.slice(0, qualifierEnd);
  const model = name.slice(qualifierEnd);
  if (!/^(gpt|claude)[ -]/i.test(model)) return name;
  return qualifier + model.replace(/^(gpt|claude)[ -]+/i, "").replace(/\s+/g, "-");
}

export function customizeSegment(id: StatusLineSegmentId, content: string, options: StatusLineSegmentOptions): string {
  if (id === "thinking") return content.replace(thinkingPrefix, "🧠 ");
  if (id === "context_pct" && options.context?.format === "percent") {
    return `${getIcons().context} ${content}`;
  }
  return content;
}
