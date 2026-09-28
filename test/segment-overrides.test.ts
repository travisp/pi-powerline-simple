import assert from "node:assert/strict";
import test from "node:test";
import { customizeModelName, customizeSegment } from "../src/segment-overrides.ts";
import { rainbow } from "../src/upstream/theme.ts";
import { getIcons } from "../src/upstream/icons.ts";

test("thinking prefix replacement preserves surrounding color", () => {
  assert.equal(customizeSegment("thinking", "think:low", {}), "🧠 low");
  assert.equal(customizeSegment("thinking", "\x1b[32mthink:low\x1b[0m", {}), "\x1b[32m🧠 low\x1b[0m");
});

for (const level of ["high", "xhigh", "max"]) {
  test(`thinking prefix replacement preserves rainbow ${level} styling`, () => {
    const original = rainbow(`think:${level}`);
    const result = customizeSegment("thinking", original, {});
    assert.equal(result.replace(/\x1b\[[0-9;]*m/g, ""), `🧠 ${level}`);
    assert.ok(result.endsWith(original.slice(original.indexOf(":") + 1)));
    assert.ok(result.startsWith(original.slice(0, original.indexOf("t"))));
  });
}

test("only GPT and Claude names are shortened", () => {
  for (const [name, expected] of [
    ["GPT-6 Astra", "6-Astra"],
    ["gpt 4.1 mini", "4.1-mini"],
    ["Claude Sonnet 4.5", "Sonnet-4.5"],
    ["CLAUDE-opus-4-20250514", "opus-4-20250514"],
    ["anthropic/claude-sonnet-4", "anthropic/sonnet-4"],
    ["openai/GPT-6 Astra", "openai/6-Astra"],
    ["Gemini 2.5 Pro", "Gemini 2.5 Pro"],
    ["DeepSeek V3", "DeepSeek V3"],
    ["o3", "o3"],
  ]) {
    assert.equal(customizeModelName(name), expected);
  }
});

test("percent context gains an icon without changing its colors or full format", () => {
  const colored = "\x1b[33m80%\x1b[0m";
  assert.equal(customizeSegment("context_pct", colored, { context: { format: "percent" } }), `${getIcons().context} ${colored}`);
  const full = `${getIcons().context} 54k/272k (20.0%) AC`;
  assert.equal(customizeSegment("context_pct", full, { context: { format: "full" } }), full);
});

test("other segments are left unchanged", () => {
  assert.equal(customizeSegment("model", "think:low", {}), "think:low");
});
