import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectGitHost, getCurrentBranch, getGitRemoteHost, getGitStatus,
  invalidateGitStatus, readOnlyGitEnv, subscribeGitUpdates, waitForGitUpdates,
} from "../src/upstream/git-status.ts";

test("upstream git host detection handles common and self-hosted remotes", () => {
  assert.equal(detectGitHost("git@github.com:owner/repo.git"), "github");
  assert.equal(detectGitHost("ssh://git@gitlab.com/owner/repo.git"), "gitlab");
  assert.equal(detectGitHost("https://bitbucket.org/owner/repo"), "bitbucket");
  assert.equal(detectGitHost("git@git.example.com:owner/repo.git"), "other");
  assert.equal(detectGitHost(null), null);
});

test("read-only Git environment disables optional locks without mutating its input", () => {
  const env = { PATH: "/bin", GIT_OPTIONAL_LOCKS: "1" };
  assert.deepEqual(readOnlyGitEnv(env), { PATH: "/bin", GIT_OPTIONAL_LOCKS: "0" });
  assert.equal(env.GIT_OPTIONAL_LOCKS, "1");
});

test("Git refreshes retain counts, publish only changes, and isolate directories", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "powerline-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = join(root, "first");
  const second = join(root, "second");
  const plain = join(root, "plain");
  for (const cwd of [first, second, plain]) mkdirSync(cwd);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  for (const cwd of [first, second]) git(cwd, "init", "-b", "main");
  git(first, "remote", "add", "origin", "https://github.com/example/first.git");
  git(second, "remote", "add", "origin", "https://gitlab.com/example/second.git");
  writeFileSync(join(first, "tracked"), "initial");
  git(first, "add", "tracked");
  git(first, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  writeFileSync(join(first, "tracked"), "modified");
  writeFileSync(join(first, "untracked"), "new");

  let updates = 0;
  const unsubscribe = subscribeGitUpdates(() => updates++);
  t.after(unsubscribe);
  getGitStatus("main", "full", first);
  await waitForGitUpdates();
  const dirty = { branch: "main", staged: 0, unstaged: 1, untracked: 1 };
  assert.deepEqual(getGitStatus("main", "full", first), dirty);
  assert.equal(updates, 1);

  invalidateGitStatus();
  assert.deepEqual(getGitStatus("main", "full", first), dirty);
  await waitForGitUpdates();
  assert.equal(updates, 1, "unchanged counts should not schedule another render");
  git(first, "add", ".");
  invalidateGitStatus();
  assert.deepEqual(getGitStatus("main", "full", first), dirty);
  await waitForGitUpdates();
  assert.deepEqual(getGitStatus("main", "full", first), {
    branch: "main", staged: 2, unstaged: 0, untracked: 0,
  });
  assert.equal(updates, 2);

  getGitRemoteHost(first);
  await waitForGitUpdates();
  assert.equal(getGitRemoteHost(first), "github");
  // Switch while reads are in flight: the old cwd must not publish into the new one.
  invalidateGitStatus();
  getGitStatus("main", "full", first);
  const oldReads = waitForGitUpdates();
  assert.deepEqual(getGitStatus("main", "full", second), {
    branch: "main", staged: 0, unstaged: 0, untracked: 0,
  });
  assert.equal(getGitRemoteHost(second), null);
  await Promise.all([oldReads, waitForGitUpdates()]);
  assert.equal(getGitRemoteHost(second), "gitlab");
  assert.equal(getGitStatus("main", "full", second).staged, 0);

  git(first, "checkout", "--detach");
  getCurrentBranch("detached", first);
  await waitForGitUpdates();
  assert.match(getCurrentBranch("detached", first)!, /^[a-f0-9]+ \(detached\)$/);
  getCurrentBranch(null, plain);
  await waitForGitUpdates();
  assert.equal(getCurrentBranch(null, plain), null);
});

test("synchronous Git spawn failures resolve without rejecting background reads", async () => {
  getGitStatus(null, "full", "/invalid\0cwd");
  await waitForGitUpdates();
  assert.deepEqual(getGitStatus(null, "full", "/invalid\0cwd"), {
    branch: null, staged: 0, unstaged: 0, untracked: 0,
  });
});
