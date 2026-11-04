import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
function run(args) {
  return spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", timeout: 10000 });
}

test("CLI help documents all eight commands", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  for (const command of ["search books", "book details", "book links", "download book", "fetch book", "search papers", "paper get", "healthcheck"]) {
    assert.ok(result.stdout.includes(command), command);
  }
});

test("CLI dispatches before MCP startup and reports validation errors on stderr", () => {
  const result = run(["book", "details", "not-an-md5"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /md5.*32-char MD5 hash/);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /ready on stdio|startup self-test/);
});

test("CLI accepts JSON mode and returns a machine-readable validation error", () => {
  const result = run(["book", "details", "not-an-md5", "--json"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /md5/);
});

test("CLI rejects unknown options and extra positional arguments", () => {
  const unknown = run(["healthcheck", "--limti", "10"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /not supported/);
  const extra = run(["book", "details", "0123456789abcdef0123456789abcdef", "extra"]);
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /expects 1 positional/);
});
