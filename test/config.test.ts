import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeSegmentsWithCustomItems,
  parsePowerlineConfig,
} from "../src/upstream/powerline-config.ts";
import { PRESETS, getPreset } from "../src/upstream/presets.ts";
import type { StatusLinePreset } from "../src/upstream/types.ts";

const PRESET_NAMES = Object.keys(PRESETS) as StatusLinePreset[];

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
