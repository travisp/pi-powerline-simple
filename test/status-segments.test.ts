import assert from "node:assert/strict";
import test from "node:test";
import { __resetCurrencyRatesForTest, __setCurrencyRatesForTest } from "../src/upstream/currency-rates.ts";
import { renderSegment } from "../src/upstream/segments.ts";
import type { SegmentContext } from "../src/upstream/types.ts";

const previousNerdFonts = process.env.POWERLINE_NERD_FONTS;
process.env.POWERLINE_NERD_FONTS = "0";
test.after(() => {
  if (previousNerdFonts === undefined) delete process.env.POWERLINE_NERD_FONTS;
  else process.env.POWERLINE_NERD_FONTS = previousNerdFonts;
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function context(overrides: Partial<SegmentContext> = {}): SegmentContext {
  return {
    model: { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai-codex", reasoning: true },
    thinkingLevel: "high",
    sessionId: "session-id",
    cwd: "/tmp/project",
    usageStats: { input: 100, output: 20, cacheRead: 900, cacheWrite: 10, cost: 1, subagentCost: 0.25 },
    contextTokens: 12_300,
    contextPercent: 6.15,
    contextWindow: 200_000,
    autoCompactEnabled: true,
    customCompactionEnabled: false,
    usingSubscription: false,
    queueSummary: { queueCount: 0, ideaCount: 0, blockedCount: 0, compacting: false, leadingText: null, leadingIntent: null, leadingStatus: null },
    sessionStartTime: Date.now() - 60_000,
    shellModeActive: false,
    shellRunning: false,
    shellName: null,
    shellCwd: null,
    git: { branch: "main", staged: 1, unstaged: 2, untracked: 3 },
    extensionStatuses: new Map(),
    hiddenExtensionStatusKeys: new Set(),
    customItemsById: new Map(),
    options: {},
    theme: { fg: (_color, text) => text },
    colors: {},
    ...overrides,
  };
}

test("context and cache segments retain upstream presentation options", () => {
  assert.equal(stripAnsi(renderSegment("context_pct", context()).content), "◫ 12k/200k (6.2%) AC");
  assert.equal(stripAnsi(renderSegment("cache_read", context({ options: { cache_read: { format: "both" } } })).content), "cache in: 900 (90%)");
});

test("cost segment includes subagent cost and currency conversion", () => {
  __setCurrencyRatesForTest({ CNY: 7.2 });
  const rendered = renderSegment("cost", context({ options: { cost: { currency: "CNY" } } }));
  __resetCurrencyRatesForTest();
  assert.deepEqual(rendered, { content: "¥9.00", visible: true });
});

test("custom items retain upstream prefix, color, and extension-status behavior", () => {
  const item = {
    id: "gondolin",
    statusKey: "gondolin-vm",
    position: "left" as const,
    prefix: "🏰",
    color: "accent" as const,
    hideWhenMissing: true,
    excludeFromExtensionStatuses: true,
  };
  const rendered = renderSegment("custom:gondolin", context({
    extensionStatuses: new Map([["gondolin-vm", "network:restricted"]]),
    customItemsById: new Map([[item.id, item]]),
  }));
  assert.equal(rendered.content, "🏰 · network:restricted");
});
