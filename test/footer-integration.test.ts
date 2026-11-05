import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import piPowerlineSimple from "../src/pi-powerline-simple.ts";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

test("extension mounts the upstream footer and notification-status widget", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-powerline-simple-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousNerdFonts = process.env.POWERLINE_NERD_FONTS;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.POWERLINE_NERD_FONTS = "0";
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    powerline: {
      separator: "ascii",
      narrow: {
        belowWidth: 80,
        layout: { left: ["context_pct", "custom:review"], right: [], secondary: [] },
        customItems: [{ id: "review", statusKey: "review" }],
        context: { format: "percent" },
      },
      layout: { left: ["model", "thinking", "path", "context_pct"], right: [], secondary: [] },
    },
  }));

  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  let footerFactory: any;
  let notificationFactory: any;
  let notificationOptions: any;
  const api = {
    on(name: string, handler: (event: any, ctx: any) => unknown) {
      const values = handlers.get(name) ?? [];
      values.push(handler);
      handlers.set(name, values);
    },
    registerCommand() {},
  };
  piPowerlineSimple(api as any);

  let contextTokens: number | null = 1_000;
  const ctx = {
    mode: "tui",
    cwd: "/tmp/project",
    model: { id: "test-model", name: "Test Model", reasoning: true, contextWindow: 10_000 },
    thinkingLevel: "low",
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getLeafId: () => "leaf",
      getBranch: () => [],
      getEntries: () => [],
      getEntryCount: () => 0,
      getSessionId: () => "session",
      getSessionName: () => undefined,
      buildContextEntries: () => [],
    },
    getSystemPrompt: () => "x".repeat(400),
    getContextUsage: () => ({ tokens: contextTokens, contextWindow: 10_000 }),
    ui: {
      setFooter(factory: any) { footerFactory = factory; },
      setWidget(id: string, factory: any, options: any) {
        if (id === "powerline-simple-notifications") {
          notificationFactory = factory;
          notificationOptions = options;
        }
      },
      notify() {},
    },
  };

  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
  assert.equal(typeof footerFactory, "function");
  assert.equal(typeof notificationFactory, "function");
  assert.deepEqual(notificationOptions, { placement: "aboveEditor" });

  const statuses = new Map([
    ["review", "[review] waiting"],
    ["plain", "connected"],
  ]);
  const footerData = {
    getGitBranch: () => { throw new Error("hidden Git segment must not collect branch data"); },
    getExtensionStatuses: () => statuses,
    onBranchChange: () => () => {},
  };
  const component = footerFactory(
    { requestRender() {} },
    { fg: (_color: string, text: string) => text },
    footerData,
  );
  const lines = component.render(120).map(stripAnsi);

  assert.equal(lines.length, 1);
  assert.equal(lines[0], " Test Model > 🧠 low > dir project > ◫ 1.0k/10k (10.0%) AC ");

  const notificationComponent = notificationFactory();
  assert.deepEqual(notificationComponent.render(120), [" [review] waiting"]);
  assert.deepEqual(notificationComponent.render(10), []);
  assert.deepEqual(component.render(79).map(stripAnsi), [" ◫10%>[review] waiting "]);
  assert.deepEqual(notificationComponent.render(79), []);
  assert.deepEqual(component.render(80).map(stripAnsi), lines);
  assert.deepEqual(notificationComponent.render(80), [" [review] waiting"]);
  assert.deepEqual(component.render(120).map(stripAnsi), lines);
  contextTokens = null;
  for (const handler of handlers.get("session_compact") ?? []) handler({}, ctx);
  assert.deepEqual(component.render(79).map(stripAnsi), [" ◫~1%>[review] waiting "]);
  assert.match(stripAnsi(component.render(120)[0]), /~100\/10k \(1\.0%\)/);
  contextTokens = 2_500;
  for (const handler of handlers.get("message_end") ?? []) handler({}, ctx);
  assert.deepEqual(component.render(79).map(stripAnsi), [" ◫25%>[review] waiting "]);
  notificationComponent.dispose();
  component.dispose();

  contextTokens = null;
  for (const handler of handlers.get("session_start") ?? []) handler({ reason: "reload" }, ctx);
  const reloaded = footerFactory(
    { requestRender() {} },
    { fg: (_color: string, text: string) => text },
    footerData,
  );
  assert.deepEqual(reloaded.render(79).map(stripAnsi), [" ◫~1%>[review] waiting "]);
  for (const handler of handlers.get("session_tree") ?? []) handler({}, ctx);
  assert.deepEqual(reloaded.render(79).map(stripAnsi), [" ◫?>[review] waiting "]);
  reloaded.dispose();
  for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);

  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousNerdFonts === undefined) delete process.env.POWERLINE_NERD_FONTS;
  else process.env.POWERLINE_NERD_FONTS = previousNerdFonts;
  rmSync(agentDir, { recursive: true, force: true });
});

test("rendered billing covers the full ledger while context and thinking follow tree navigation", (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-powerline-simple-billing-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousNerdFonts = process.env.POWERLINE_NERD_FONTS;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.POWERLINE_NERD_FONTS = "0";
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousNerdFonts === undefined) delete process.env.POWERLINE_NERD_FONTS;
    else process.env.POWERLINE_NERD_FONTS = previousNerdFonts;
    rmSync(agentDir, { recursive: true, force: true });
  });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    powerline: {
      separator: "ascii",
      layout: { left: ["cost", "context_pct", "thinking"], right: [], secondary: [] },
    },
  }));
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  let footerFactory: any;
  piPowerlineSimple({
    on(name: string, handler: (event: any, ctx: any) => unknown) { handlers.set(name, handler); },
    registerCommand() {},
  } as any);

  const usage = (input: number, cost: number) => ({ input, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: cost } });
  const a = { type: "message", message: { role: "assistant", stopReason: "stop", usage: usage(100, 0.25) } };
  const b = { type: "message", message: { role: "assistant", stopReason: "stop", usage: usage(2_000, 0.5) } };
  const high = { type: "thinking_level_change", thinkingLevel: "high" };
  const low = { type: "thinking_level_change", thinkingLevel: "low" };
  const ledger: unknown[] = [
    high, a, low, b,
    { type: "compaction", usage: usage(10, 0.125) },
    { type: "message", message: { role: "toolResult", usage: usage(20, 0.125) } },
    { type: "message", message: { role: "assistant", stopReason: "error", usage: usage(30, 0.5) } },
  ];
  let branch: unknown[] = [high, a];
  let leaf = "a";
  const ctx = {
    mode: "tui", cwd: "/tmp/project",
    model: { id: "model", name: "Model", reasoning: true, contextWindow: 10_000 },
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getLeafId: () => leaf, getBranch: () => branch, getEntries: () => ledger.slice(),
      getEntryCount: () => ledger.length, getSessionId: () => "session", getSessionName: () => undefined,
    },
    // Exercise the branch-local assistant fallback, independent of measured host usage.
    getContextUsage: () => undefined,
    ui: {
      setFooter(factory: any) { footerFactory = factory; },
      setWidget() {}, notify() {},
    },
  };
  handlers.get("session_start")!({}, ctx);
  const component = footerFactory({ requestRender() {} }, { fg: (_color: string, text: string) => text }, {
    getExtensionStatuses: () => new Map(), onBranchChange: () => () => {},
  });
  t.after(() => { component.dispose(); handlers.get("session_shutdown")!({}, ctx); });
  assert.equal(stripAnsi(component.render(120)[0]), " $1.50 > ◫ 100/10k (1.0%) AC > 🧠 high ");

  branch = [low, b];
  leaf = "b";
  handlers.get("session_tree")!({}, ctx);
  assert.equal(stripAnsi(component.render(120)[0]), " $1.50 > ◫ 2.0k/10k (20.0%) AC > 🧠 low ");
  ledger.push({ type: "usage", usage: usage(10, 0.25) });
  assert.equal(stripAnsi(component.render(120)[0]), " $1.75 > ◫ 2.0k/10k (20.0%) AC > 🧠 low ");
});
