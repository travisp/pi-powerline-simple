import assert from "node:assert/strict";
import test from "node:test";
import { hasNerdFonts } from "../src/upstream/icons.ts";

test("Nerd Font heuristics recognize TERM and Kaku while respecting overrides", (t) => {
  const keys = ["POWERLINE_NERD_FONTS", "GHOSTTY_RESOURCES_DIR", "TERM_PROGRAM", "TERM"];
  const saved = keys.map((key) => [key, process.env[key]] as const);
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of keys) delete process.env[key];
  process.env.TERM = "xterm-kitty";
  assert.equal(hasNerdFonts(), true);
  process.env.TERM_PROGRAM = "unknown";
  assert.equal(hasNerdFonts(), false);
  process.env.TERM_PROGRAM = "Kaku";
  assert.equal(hasNerdFonts(), true);
  process.env.POWERLINE_NERD_FONTS = "0";
  assert.equal(hasNerdFonts(), false);
  process.env.TERM_PROGRAM = "unknown";
  process.env.POWERLINE_NERD_FONTS = "1";
  assert.equal(hasNerdFonts(), true);
});
