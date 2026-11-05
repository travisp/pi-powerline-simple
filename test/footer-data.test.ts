import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { computeSessionTokenStats, SessionTokenStatsCache, SessionUsageCache } from "../src/upstream/token-stats.ts";

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) {
  return { input, output, cacheRead, cacheWrite, cost: { total: cost } };
}

function assistant(values: ReturnType<typeof usage>, stopReason = "stop") {
  return { type: "message", message: { role: "assistant", content: [], usage: values, stopReason } };
}

function subagent(cost: number, native?: ReturnType<typeof usage>) {
  return {
    type: "message", message: {
      role: "toolResult", toolName: "subagent", usage: native,
      details: { results: [{ usage: { cost } }] },
    },
  };
}

for (const reason of ["error", "aborted"]) {
  test(`billed ${reason} usage counts without becoming the context source`, () => {
    const successful = assistant(usage(100, 20, 300, 50, 0.25));
    const failed = assistant(usage(10, 5, 30, 2, 0.5), reason);
    const totals = computeSessionTokenStats([successful, failed]);

    assert.deepEqual({
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      cost: totals.cost,
    }, { input: 110, output: 25, cacheRead: 330, cacheWrite: 52, cost: 0.75 });
    assert.equal(totals.lastAssistant, successful.message);
  });
}

test("upstream token cache notices an in-place streaming update and a billed failure", () => {
  const cache = new SessionTokenStatsCache();
  const successful = assistant(usage(1, 2));
  const tail = assistant(usage(10, 5), "pending");
  const entries = [successful, tail];
  assert.equal(cache.get(entries).output, 7);
  tail.message.usage = usage(10, 42, 0, 0, 0.5);
  tail.message.stopReason = "error";
  const totals = cache.get(entries);
  assert.equal(totals.output, 44);
  assert.equal(totals.cost, 0.5);
  assert.equal(totals.lastAssistant, successful.message);
});

for (const type of ["toolResult", "usage", "compaction", "branch_summary"]) {
  test(`${type} usage is billed and its in-place updates refresh the cache`, () => {
    const successful = assistant(usage(10, 5));
    const charge = usage(20, 7, 3, 2, 0.25);
    const tail = type === "toolResult"
      ? { type: "message", message: { role: "toolResult", toolName: "nested-model", isError: true, usage: charge } }
      : { type, usage: charge };
    const entries = [successful, tail];
    const cache = new SessionTokenStatsCache();
    const first = cache.get(entries);
    assert.equal(first.input, 30);
    assert.equal(first.output, 12);
    assert.equal(first.cacheRead, 3);
    assert.equal(first.cacheWrite, 2);
    assert.equal(first.cost, 0.25);
    assert.equal(first.lastAssistant, successful.message);
    assert.deepEqual(first, computeSessionTokenStats(entries));

    charge.output = 42;
    charge.cost.total = 0.5;
    const next = cache.get(entries);
    assert.equal(next.output, 47);
    assert.equal(next.cost, 0.5);
    assert.equal(next.lastAssistant, successful.message);
    assert.deepEqual(next, computeSessionTokenStats(entries));
  });
}

test("native subagent usage replaces legacy details even when native usage is zero", () => {
  for (const native of [usage(10, 5, 0, 0, 0.5), usage(0, 0)]) {
    const entries = [
      subagent(9, native),
      subagent(0.25),
      {
        type: "custom_message", customType: "subagent-slash-result",
        details: { result: { details: { results: [{ usage: { cost: 0.5 } }] } } },
      },
    ];
    const totals = new SessionTokenStatsCache().get(entries);
    assert.equal(totals.cost, native.cost.total);
    assert.equal(totals.subagentCost, 0.75);
    assert.deepEqual(totals, computeSessionTokenStats(entries));
  }
});

test("the same cached subagent result can gain or lose native usage", () => {
  const tail = subagent(0.5);
  const entries = [tail];
  const cache = new SessionTokenStatsCache();
  assert.equal(cache.get(entries).subagentCost, 0.5);
  tail.message.usage = usage(10, 5, 0, 0, 0.25);
  assert.equal(cache.get(entries).subagentCost, 0);
  assert.equal(cache.get(entries).cost, 0.25);
  tail.message.usage = undefined;
  assert.equal(cache.get(entries).subagentCost, 0.5);
  assert.equal(cache.get(entries).cost, 0);
});

test("full-ledger totals remain stable across branches while context and thinking change", () => {
  const a = assistant(usage(10, 5, 0, 0, 0.25));
  const b = assistant(usage(20, 7, 0, 0, 0.5));
  const high = { type: "thinking_level_change", thinkingLevel: "high" };
  const low = { type: "thinking_level_change", thinkingLevel: "low" };
  const charge = { type: "usage", usage: usage(3, 1, 0, 0, 0.125) };
  const ledger = [high, a, low, b, charge];
  let branch: unknown[] = [high, a];
  let leaf = "a";
  let ledgerReads = 0;
  const provider = {
    getLeafId: () => leaf,
    getBranch: () => branch,
    getEntries: () => { ledgerReads++; return ledger.slice(); },
    getEntryCount: () => ledger.length,
  };
  const cache = new SessionUsageCache();
  const first = cache.get(provider);
  assert.equal(first.input, 33);
  assert.equal(first.cost, 0.875);
  assert.equal(first.lastAssistant, a.message);
  assert.equal(first.thinkingLevelFromSession, "high");
  for (let i = 0; i < 20; i++) cache.get(provider);
  assert.equal(ledgerReads, 1, "unchanged renders do not copy the ledger");

  branch = [low, b];
  leaf = "b";
  const next = cache.get(provider);
  assert.equal(next.input, first.input);
  assert.equal(next.cost, first.cost);
  assert.equal(next.lastAssistant, b.message);
  assert.equal(next.thinkingLevelFromSession, "low");

  charge.usage.output = 8;
  assert.equal(cache.get(provider).output, 20);
  ledger.push({ type: "usage", usage: usage(4, 2, 0, 0, 0.25) });
  assert.equal(cache.get(provider).input, 37, "idle charges are seen even at the same leaf");
  assert.equal(cache.get(provider).cost, 1.125);
  assert.equal(cache.get(provider).lastAssistant, b.message);

  const other = assistant(usage(1, 1, 0, 0, 2));
  assert.equal(cache.get({
    getLeafId: () => "other", getBranch: () => [other],
    getEntries: () => [other], getEntryCount: () => 1,
  }).cost, 2, "switching session managers drops the previous ledger");
});

test("native SessionManager keeps branch history and usage charges in one billing ledger", () => {
  const session = SessionManager.inMemory();
  const cache = new SessionUsageCache();
  const fullUsage = (input: number, cost: number) => ({
    ...usage(input, 0, 0, 0, cost), totalTokens: input,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  });
  const message = (input: number, cost: number) => ({
    role: "assistant" as const, content: [], api: "openai-responses", provider: "test", model: "test",
    stopReason: "stop" as const, timestamp: 0, usage: fullUsage(input, cost),
  });
  const root = session.appendThinkingLevelChange("high");
  const a = session.appendMessage(message(10, 0.25));
  session.branch(root);
  session.appendThinkingLevelChange("low");
  session.appendMessage(message(20, 0.5));
  assert.equal(cache.get(session).cost, 0.75);
  assert.equal(cache.get(session).lastAssistant?.usage.input, 20);
  assert.equal(cache.get(session).thinkingLevelFromSession, "low");

  session.branch(a);
  assert.equal(cache.get(session).cost, 0.75);
  assert.equal(cache.get(session).lastAssistant?.usage.input, 10);
  assert.equal(cache.get(session).thinkingLevelFromSession, "high");
  session.appendUsage("custom-billable-operation", "test", "test", fullUsage(3, 0.125));
  session.appendCompaction("summary", a, 10, undefined, false, fullUsage(4, 0.125));
  session.branchWithSummary(a, "branch summary", undefined, false, fullUsage(5, 0.25));
  assert.equal(cache.get(session).cost, 1.25);
  assert.equal(cache.get(session).input, 42);
  assert.equal(cache.get(session).lastAssistant?.usage.input, 10);
});

test("unchanged renders do not rescan historical charges", () => {
  const head = assistant(usage(10, 5));
  const values = head.message.usage;
  let reads = 0;
  Object.defineProperty(head.message, "usage", { get: () => { reads++; return values; } });
  const entries = [head, { type: "usage", usage: usage(1, 1) }];
  const provider = {
    getLeafId: () => "tail", getBranch: () => entries,
    getEntries: () => entries.slice(), getEntryCount: () => entries.length,
  };
  const cache = new SessionUsageCache();
  assert.equal(cache.get(provider).input, 11);
  const initialReads = reads;
  for (let i = 0; i < 20; i++) cache.get(provider);
  assert.equal(reads, initialReads);
});

test("malformed native and legacy charges do not poison totals", () => {
  const entries: unknown[] = [null, [], { type: "usage", usage: null }];
  for (const bad of [NaN, Infinity, "5", undefined]) {
    entries.push({ type: "usage", usage: { ...usage(1, 2), input: bad } });
    entries.push({ type: "compaction", usage: { ...usage(1, 2), cost: { total: bad } } });
    entries.push({ type: "message", message: { role: "toolResult", toolName: "subagent", details: { results: [{ usage: { cost: bad } }] } } });
  }
  const totals = computeSessionTokenStats(entries);
  assert.equal(totals.input, 0);
  assert.equal(totals.cost, 0);
  assert.equal(totals.subagentCost, 0);
  assert.deepEqual(new SessionTokenStatsCache().get(entries), totals);
});
