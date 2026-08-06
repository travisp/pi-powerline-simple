import assert from "node:assert/strict";
import test from "node:test";
import { detectGitHost } from "../src/upstream/git-status.ts";

test("upstream git host detection handles common and self-hosted remotes", () => {
  assert.equal(detectGitHost("git@github.com:owner/repo.git"), "github");
  assert.equal(detectGitHost("ssh://git@gitlab.com/owner/repo.git"), "gitlab");
  assert.equal(detectGitHost("https://bitbucket.org/owner/repo"), "bitbucket");
  assert.equal(detectGitHost("git@git.example.com:owner/repo.git"), "other");
  assert.equal(detectGitHost(null), null);
});
