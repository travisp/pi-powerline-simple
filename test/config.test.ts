import assert from "node:assert/strict";
import test from "node:test";
import {
  configForWidth,
  mergeSegmentsWithCustomItems,
  parsePowerlineConfig,
} from "../src/upstream/powerline-config.ts";
import { PRESETS, getPreset } from "../src/upstream/presets.ts";
import type { StatusLinePreset } from "../src/upstream/types.ts";

const PRESET_NAMES = Object.keys(PRESETS) as StatusLinePreset[];

test("narrow overrides merge objects, replace arrays, and switch strictly below the breakpoint", () => {
  const raw = {
    customItems: [{ id: "cache-hit", statusKey: "powerline-cache-hit" }],
    disabledSegments: ["cost"],
    layout: { left: ["path", "model"], right: ["context_pct"] },
    git: { showBranch: true, showStaged: true },
    narrow: {
      belowWidth: 80,
      preset: "compact",
      customItems: [{ id: "usage", statusKey: "usage" }],
      disabledSegments: ["path"],
      layout: { left: ["custom:usage", "git"] },
      git: { showStaged: false },
      context: { format: "percent" },
      separator: "ascii",
    },
  };
  const original = structuredClone(raw);
  const config = parsePowerlineConfig(raw, PRESET_NAMES);
  const narrow = configForWidth(config, 79);
  assert.equal(narrow.preset, "compact");
  assert.equal(narrow.separator, "ascii");
  assert.deepEqual(narrow.layout, { left: ["custom:usage", "git"], right: ["context_pct"] });
  assert.deepEqual(narrow.disabledSegments, ["path"]);
  assert.deepEqual(narrow.customItems.map(item => item.id), ["usage"]);
  assert.deepEqual(narrow.segmentOptions.git, { showBranch: true, showStaged: false });
  assert.deepEqual(narrow.segmentOptions.context, { format: "percent" });
  assert.deepEqual(narrow.invalidLayoutSegments, []);
  assert.equal(configForWidth(config, 80), config);
  assert.equal(configForWidth(config, 120), config);
  assert.equal(configForWidth(config, 40), narrow);
  assert.deepEqual(raw, original);
});

test("narrow configuration requires a positive integer breakpoint", () => {
  for (const belowWidth of [undefined, 0, -1, 1.5, "80", Infinity]) {
    const config = parsePowerlineConfig({ narrow: { belowWidth, preset: "compact" } }, PRESET_NAMES);
    assert.equal(config.narrow, null);
    assert.equal(configForWidth(config, 40), config);
  }
});

test("default config matches the upstream default preset", () => {
  const config = parsePowerlineConfig(undefined, PRESET_NAMES);
  assert.equal(config.preset, "default");
  assert.deepEqual(getPreset(config.preset).leftSegments, [
    "model",
    "thinking",
    "shell_mode",
    "path",
    "git",
    "queue",
    "context_pct",
    "cache_read",
    "cost",
  ]);
  assert.deepEqual(getPreset(config.preset).secondarySegments, ["extension_statuses"]);
  assert.equal(getPreset(config.preset).separator, "powerline-thin");
});

test("custom items, layout, disabled segments, currency, and separator use upstream configuration", () => {
  const config = parsePowerlineConfig({
    preset: "default",
    separator: "chevron",
    customItems: [
      { id: "gondolin", statusKey: "gondolin-vm", position: "left", prefix: "🏰", color: "accent" },
      { id: "usage", position: "right", color: "#ffaa00" },
    ],
    disabledSegments: ["cost"],
    layout: {
      left: ["custom:gondolin", "model", "context_pct"],
      right: ["custom:usage"],
      secondary: ["extension_statuses"],
    },
    cost: { subscriptionDisplay: "both", currency: "cny" },
  }, PRESET_NAMES);

  assert.equal(config.separator, "chevron");
  assert.deepEqual(config.segmentOptions.cost, { subscriptionDisplay: "both", currency: "CNY" });
  assert.equal(config.customItems[0].statusKey, "gondolin-vm");
  assert.deepEqual(
    mergeSegmentsWithCustomItems(getPreset(config.preset), config.customItems, {
      layout: config.layout,
      disabledSegments: config.disabledSegments,
    }),
    {
      leftSegments: ["custom:gondolin", "model", "context_pct"],
      rightSegments: ["custom:usage"],
      secondarySegments: ["extension_statuses"],
    },
  );
});

test("omitted layout groups retain preset segments and append custom items", () => {
  const config = parsePowerlineConfig({
    customItems: [{ id: "usage", position: "right" }],
    layout: { secondary: [] },
  }, PRESET_NAMES);
  const layout = mergeSegmentsWithCustomItems(getPreset(config.preset), config.customItems, {
    layout: config.layout,
    disabledSegments: config.disabledSegments,
  });
  assert.deepEqual(layout.leftSegments, getPreset("default").leftSegments);
  assert.deepEqual(layout.rightSegments, ["custom:usage"]);
  assert.deepEqual(layout.secondarySegments, []);
});
