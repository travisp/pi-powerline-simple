import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import powerlineExtras, { computeExtraStatusState, formatLastResponse } from "../src/extras.ts";

test("extra status state uses the latest successful assistant response", () => {
  const firstTimestamp = "2026-08-06T12:00:00.000Z";
  const secondTimestamp = "2026-08-06T12:01:00.000Z";
  const state = computeExtraStatusState([
    {
      type: "message",
      timestamp: firstTimestamp,
      message: {
        role: "assistant",
        stopReason: "stop",
        usage: { input: 100, cacheRead: 900, cacheWrite: 0 },
      },
    },
    {
      type: "message",
      timestamp: secondTimestamp,
      message: {
        role: "assistant",
        stopReason: "stop",
        usage: { input: 250, cacheRead: 250, cacheWrite: 0 },
      },
    },
    {
      type: "message",
      timestamp: "2026-08-06T12:02:00.000Z",
      message: {
        role: "assistant",
        stopReason: "aborted",
        usage: { input: 100, cacheRead: 0, cacheWrite: 0 },
      },
    },
  ]);

  assert.deepEqual(state, {
    hasCacheUsage: true,
    latestCacheHitRate: 50,
    lastResponseEndedAt: Date.parse(secondTimestamp),
  });
});

test("formatLastResponse includes completion time and relative age", () => {
  const timestamp = new Date(2026, 7, 6, 15, 42).getTime();
  assert.equal(formatLastResponse(timestamp, timestamp + 7 * 60_000), "15:42 · 7m ago");
  assert.equal(formatLastResponse(timestamp, timestamp + 7 * 60_000, "12h"), "3:42pm · 7m ago");
});

for (const mode of ["normal", "narrow"]) {
  test(`extra producers support custom status keys in ${mode} configuration`, () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-powerline-extras-test-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const display = {
      customItems: [
        { id: "cache-hit", statusKey: "powerline-cache-hit" },
        { id: "last-response", statusKey: "powerline-last-response" },
      ],
    };
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
      powerline: mode === "narrow" ? { narrow: { belowWidth: 80, ...display } } : display,
    }));

    const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
    powerlineExtras({
      on(name: string, handler: (event: any, ctx: any) => unknown) {
        const values = handlers.get(name) ?? [];
        values.push(handler);
        handlers.set(name, values);
      },
    } as any);

    const statuses = new Map<string, string | undefined>();
    const ctx = {
      mode: "tui",
      cwd: "/tmp/project",
      sessionManager: {
        getBranch: () => [{
          type: "message",
          timestamp: new Date().toISOString(),
          message: {
            role: "assistant",
            stopReason: "stop",
            usage: { input: 100, cacheRead: 900, cacheWrite: 0 },
          },
        }],
      },
      ui: { setStatus: (key: string, value: string | undefined) => statuses.set(key, value) },
    };

    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    assert.equal(statuses.get("powerline-cache-hit"), "CH90.0%");
    assert.match(statuses.get("powerline-last-response") ?? "", /ago$/);
    for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);

    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  });
}
