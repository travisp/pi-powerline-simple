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
  assert.deepEqual(lines, [" Test Model > think:low > dir project > ◫ 1.0k/10k (10.0%) > 5h 80% "]);
});

test("adaptive footer moves non-fitting segments to an overflow line", () => {
  const config = parsePowerlineConfig({
    separator: "ascii",
    layout: { left: ["model", "thinking", "path", "context_pct"], right: [], secondary: [] },
  }, names);
  const lines = renderStatusLines(segmentContext(), getPreset(config.preset), config, 34).map(stripAnsi);
  assert.deepEqual(lines, [
    " Test Model > think:low ",
    " dir project > ◫ 1.0k/10k (10.0%) ",
  ]);
});
