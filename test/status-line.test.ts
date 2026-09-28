import assert from "node:assert/strict";
import test from "node:test";
import { parsePowerlineConfig } from "../src/upstream/powerline-config.ts";
import { PRESETS, getPreset } from "../src/upstream/presets.ts";
import type { SegmentContext, StatusLinePreset } from "../src/upstream/types.ts";
import { renderStatusLines } from "../src/status-line.ts";

const names = Object.keys(PRESETS) as StatusLinePreset[];
const previousNerdFonts = process.env.POWERLINE_NERD_FONTS;
process.env.POWERLINE_NERD_FONTS = "0";
test.after(() => {
  if (previousNerdFonts === undefined) delete process.env.POWERLINE_NERD_FONTS;
  else process.env.POWERLINE_NERD_FONTS = previousNerdFonts;
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function segmentContext(): SegmentContext {
  return {
    model: { id: "test-model", name: "Test Model", reasoning: true },
    thinkingLevel: "low",
    sessionId: "session",
    cwd: "/tmp/project",
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, subagentCost: 0 },
    contextTokens: 1_000,
    contextPercent: 10,
    contextWindow: 10_000,
    contextApproximate: false,
    autoCompactEnabled: false,
    customCompactionEnabled: false,
    usingSubscription: false,
    queueSummary: { queueCount: 0, ideaCount: 0, blockedCount: 0, compacting: false, leadingText: null, leadingIntent: null, leadingStatus: null },
    sessionStartTime: Date.now(),
    shellModeActive: false,
    shellRunning: false,
    shellName: null,
    shellCwd: null,
    git: { branch: null, staged: 0, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map([["usage", "5h 80%"]]),
    hiddenExtensionStatusKeys: new Set(["usage"]),
    customItemsById: new Map([["usage", {
      id: "usage",
      statusKey: "usage",
      position: "right",
      selfColorize: false,
      hideWhenMissing: true,
      excludeFromExtensionStatuses: true,
    }]]),
    options: { model: { showThinkingLevel: false }, path: { mode: "basename" } },
    theme: { fg: (_color, text) => text },
    colors: {},
  };
}

test("adaptive footer retains upstream group order on one line when it fits", () => {
  const config = parsePowerlineConfig({
    separator: "ascii",
    customItems: [{ id: "usage", position: "right" }],
    layout: {
      left: ["model", "thinking", "path", "context_pct"],
      right: ["custom:usage"],
      secondary: [],
    },
  }, names);
  const lines = renderStatusLines(segmentContext(), getPreset(config.preset), config, 200).map(stripAnsi);
  assert.deepEqual(lines, [" Test Model > 🧠 low > dir project > ◫ 1.0k/10k (10.0%) > 5h 80% "]);
});

test("model customization precedes styling and fitting without changing session context", () => {
  const config = parsePowerlineConfig({
    layout: { left: ["model"], right: [], secondary: [] },
  }, names);
  for (const [name, expected] of [["GPT-6 Astra", "6-Astra"], ["Claude Sonnet 4.5", "Sonnet-4.5"]]) {
    const context = segmentContext();
    context.model = { id: name, name };
    const original = structuredClone(context.model);
    const lines = renderStatusLines(context, getPreset(config.preset), config, expected.length + 2);
    assert.deepEqual(lines.map(stripAnsi), [` ${expected} `]);
    assert.deepEqual(context.model, original);
  }
});

test("adaptive footer moves non-fitting segments to an overflow line", () => {
  const config = parsePowerlineConfig({
    separator: "ascii",
    layout: { left: ["model", "thinking", "path", "context_pct"], right: [], secondary: [] },
  }, names);
  const lines = renderStatusLines(segmentContext(), getPreset(config.preset), config, 34).map(stripAnsi);
  assert.deepEqual(lines, [
    " Test Model > 🧠 low ",
    " dir project > ◫ 1.0k/10k (10.0%) ",
  ]);
});

test("slash and pipe separators have one space on each side and fit exact widths", () => {
  for (const separator of ["slash", "pipe"] as const) {
    const config = parsePowerlineConfig({
      separator,
      layout: { left: ["model", "thinking"], right: [], secondary: [] },
    }, names);
    const mark = separator === "slash" ? "/" : "|";
    const expected = ` Test Model ${mark} 🧠 low `;
    const render = (width: number) => renderStatusLines(segmentContext(), getPreset(config.preset), config, width).map(stripAnsi);
    assert.deepEqual(render(expected.length), [expected]);
    assert.deepEqual(render(expected.length - 1), [" Test Model ", " 🧠 low "]);
  }
});
