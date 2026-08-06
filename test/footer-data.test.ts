import assert from "node:assert/strict";
import test from "node:test";
import { computeSessionTokenStats, SessionTokenStatsCache } from "../src/upstream/token-stats.ts";

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) {
  return { input, output, cacheRead, cacheWrite, cost: { total: cost } };
}

function assistant(values: ReturnType<typeof usage>, stopReason = "stop") {
  return { type: "message", message: { role: "assistant", content: [], usage: values, stopReason } };
}

test("upstream token aggregation includes cache and cost while excluding failed responses", () => {
  const successful = assistant(usage(100, 20, 300, 50, 0.17));
  const failed = assistant(usage(999, 999, 999, 999, 10), "error");
  const totals = computeSessionTokenStats([successful, failed]);

  assert.deepEqual({
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    cost: totals.cost,
  }, {
    input: 100,
    output: 20,
    cacheRead: 300,
    cacheWrite: 50,
    cost: 0.17,
  });
  assert.equal(totals.lastAssistant, successful.message);
});

test("upstream token cache notices an in-place streaming update", () => {
  const cache = new SessionTokenStatsCache();
  const tail = assistant(usage(10, 5), "streaming");
  const entries = [tail];
  assert.equal(cache.get(entries).output, 5);
  tail.message.usage = usage(10, 42);
  tail.message.stopReason = "stop";
  assert.equal(cache.get(entries).output, 42);
});
