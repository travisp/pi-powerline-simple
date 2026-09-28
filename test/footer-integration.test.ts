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
  assert.equal(lines[0], " Test Model > think:low > dir project > ◫ 1.0k/10k (10.0%) AC ");

  const notificationComponent = notificationFactory();
  assert.deepEqual(notificationComponent.render(120), [" [review] waiting"]);
  assert.deepEqual(notificationComponent.render(10), []);
  assert.deepEqual(component.render(79).map(stripAnsi), [" 10% > [review] waiting "]);
  assert.deepEqual(notificationComponent.render(79), []);
  assert.deepEqual(component.render(80).map(stripAnsi), lines);
  assert.deepEqual(notificationComponent.render(80), [" [review] waiting"]);
  assert.deepEqual(component.render(120).map(stripAnsi), lines);
  contextTokens = null;
  for (const handler of handlers.get("session_compact") ?? []) handler({}, ctx);
  assert.deepEqual(component.render(79).map(stripAnsi), [" ~1% > [review] waiting "]);
  assert.match(stripAnsi(component.render(120)[0]), /~100\/10k \(1\.0%\)/);
  contextTokens = 2_500;
  for (const handler of handlers.get("message_end") ?? []) handler({}, ctx);
  assert.deepEqual(component.render(79).map(stripAnsi), [" 25% > [review] waiting "]);
  notificationComponent.dispose();
  component.dispose();

  contextTokens = null;
  for (const handler of handlers.get("session_start") ?? []) handler({ reason: "reload" }, ctx);
  const reloaded = footerFactory(
    { requestRender() {} },
    { fg: (_color: string, text: string) => text },
    footerData,
  );
  assert.deepEqual(reloaded.render(79).map(stripAnsi), [" ~1% > [review] waiting "]);
  for (const handler of handlers.get("session_tree") ?? []) handler({}, ctx);
  assert.deepEqual(reloaded.render(79).map(stripAnsi), [" ? > [review] waiting "]);
  reloaded.dispose();
  for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);

  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousNerdFonts === undefined) delete process.env.POWERLINE_NERD_FONTS;
  else process.env.POWERLINE_NERD_FONTS = previousNerdFonts;
  rmSync(agentDir, { recursive: true, force: true });
});
