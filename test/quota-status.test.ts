import assert from "node:assert/strict";
import test from "node:test";
import { compactQuotaStatus } from "../src/quota-status.ts";

const compact = (value: string) => compactQuotaStatus("pi-quotas-usage", value);

test("quota status removes single-window labels and healthy spend caps", () => {
  assert.equal(compact("7d:98% left (↺in 6d 22h 49m) cap:OK"), "98% ↺ 6d22h");
});

test("reset durations show minutes only below one day", () => {
  for (const [duration, expected] of [
    ["1d 0h 5m", "1d0h"], ["22h 49m", "22h49m"], ["49m", "49m"], ["now", "now"],
  ]) {
    assert.equal(compact(`7d:98% left (↺${duration === "now" ? "" : "in "}${duration})`), `98% ↺ ${expected}`);
  }
});

test("multiple percentage windows retain labels and cap warnings remain visible", () => {
  assert.equal(compact("5h:90% left (↺in 2h 19m) 7d:98% left (↺in 6d 22h 49m) cap:REACHED !"),
    "5h:90% ↺ 2h19m 7d:98% ↺ 6d22h cap:REACHED !");
});

test("quota compaction preserves count and currency values", () => {
  assert.equal(compact("premium:293/300 (↺in 6d 22h 49m)"), "premium:293/300 ↺ 6d22h");
  assert.equal(compact("budget:$1.00/$10.00 (↺in 2h 19m)"), "budget:$1.00/$10.00 ↺ 2h19m");
  assert.equal(compact("7d:0% left ! cap:REACHED !"), "0% ! cap:REACHED !");
});

test("quota compaction preserves ANSI codes and leaves other extensions alone", () => {
  const value = "\x1b[2m7d:\x1b[32m98% left\x1b[0m\x1b[2m (↺in 6d 22h 49m)\x1b[0m cap:OK";
  assert.equal(compact(value), "\x1b[2m\x1b[32m98%\x1b[0m\x1b[2m ↺ 6d22h\x1b[0m");
  assert.equal(compactQuotaStatus("other", value), value);
  assert.equal(compact("usage unavailable"), "usage unavailable");
});
