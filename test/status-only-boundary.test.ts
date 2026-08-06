import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adapter = readFileSync(new URL("../src/pi-powerline-simple.ts", import.meta.url), "utf8");

test("runtime adapter mounts only the footer and Powerline notification widget", () => {
  assert.match(adapter, /ctx\.ui\.setFooter\(/);
  assert.match(adapter, /setWidget\("powerline-simple-notifications"/);
  assert.match(adapter, /placement: "aboveEditor"/);
  assert.doesNotMatch(adapter, /setEditorComponent|setHeader|setEditorText|sendUserMessage/);
});

test("runtime adapter does not intercept input or compaction", () => {
  assert.doesNotMatch(adapter, /pi\.on\(["']input["']/);
  assert.doesNotMatch(adapter, /session_before_compact|ctx\.compact|registerShortcut/);
  assert.doesNotMatch(adapter, /registerCommand\(["']compact["']/);
});

test("powerline is the only command registered by the package", () => {
  const commands = [...adapter.matchAll(/registerCommand\(["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(commands, ["powerline"]);
});
