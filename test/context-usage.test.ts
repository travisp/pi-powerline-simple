import assert from "node:assert/strict";
import test from "node:test";
import {
  CoreContextUsageCache,
  estimateUnknownContextUsage,
  readCoreContextUsage,
  resolveDisplayContextUsage,
} from "../src/upstream/context-usage.ts";

const unknownUsage = { contextTokens: null, contextWindow: 10_000, contextPercent: null };

test("unknown core context stays unknown rather than reusing pre-compaction tokens", () => {
  assert.deepEqual(readCoreContextUsage({
    getContextUsage: () => ({ tokens: null, contextWindow: 10_000, percent: null }),
  }), unknownUsage);
  assert.deepEqual(resolveDisplayContextUsage({
    coreContextUsage: unknownUsage,
    unknownCoreFallback: null,
    fallbackContextTokens: 9_000,
    fallbackContextWindow: 10_000,
  }), unknownUsage);
});

test("unknown context estimation includes the prompt and active context entries", () => {
  const ctx = {
    getContextUsage: () => ({ tokens: null, contextWindow: 10_000, percent: null }),
    getSystemPrompt: () => "x".repeat(400),
    sessionManager: {
      buildContextEntries: () => [{
        type: "message",
        id: "user",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        message: { role: "user", content: "x".repeat(400), timestamp: 0 },
      }],
    },
  };
  const estimate = estimateUnknownContextUsage(ctx);
  assert.deepEqual(estimate, { contextTokens: 200, contextWindow: 10_000, contextPercent: 2 });
  const input = {
    coreContextUsage: unknownUsage,
    unknownCoreFallback: estimate,
    fallbackContextTokens: 9_000,
    fallbackContextWindow: 10_000,
  };
  assert.deepEqual(resolveDisplayContextUsage(input), estimate);
  const measured = { contextTokens: 500, contextWindow: 10_000, contextPercent: 5 };
  assert.deepEqual(resolveDisplayContextUsage({ ...input, coreContextUsage: measured }), measured);
  assert.deepEqual(resolveDisplayContextUsage({ ...input, coreContextUsage: null }), {
    contextTokens: 9_000, contextWindow: 10_000, contextPercent: 90,
  });
  assert.equal(estimateUnknownContextUsage({
    ...ctx, getContextUsage: () => ({ tokens: 500, contextWindow: 10_000, percent: 5 }),
  }), null);
});

test("core usage cache refreshes on leaf changes and explicit resets", () => {
  let leaf = "before";
  let tokens: number | null = 9_000;
  let reads = 0;
  const ctx = {
    sessionManager: { getLeafId: () => leaf },
    getContextUsage: () => {
      reads++;
      return { tokens, contextWindow: 10_000 };
    },
  };
  const cache = new CoreContextUsageCache();
  assert.equal(cache.get(ctx)?.contextTokens, 9_000);
  cache.get(ctx);
  assert.equal(reads, 1);
  leaf = "compacted";
  tokens = null;
  assert.deepEqual(cache.get(ctx), unknownUsage);
  tokens = 500;
  cache.reset();
  assert.equal(cache.get(ctx)?.contextTokens, 500);
  assert.equal(reads, 3);
});
