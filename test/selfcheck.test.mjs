import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { runSelfcheck, runStartupSelftest } from "../dist/selfcheck.js";
import { TOOL_NAMES } from "../dist/toolmeta.js";

let requests;
const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error("network disabled in selfcheck test");
  };
});
test.afterEach(() => { globalThis.fetch = originalFetch; });

function cli(args) {
  const entry = new URL("../dist/index.js", import.meta.url);
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error("network disabled"); };
    process.on("exit", () => process.stderr.write("requests=" + requests + "\\n"));
    process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(entry))}, ...${JSON.stringify(args)}];
    await import(${JSON.stringify(entry.href)});
  `], { encoding: "utf8", timeout: 10000 });
}

test("offline selfcheck verifies preflight and a real invalid call without touching mirrors", async () => {
  const report = await runSelfcheck({ offline: true });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.stages.map((s) => s.name), ["preflight", "tools"]);
  assert.deepEqual(requests, []);
});

test("startup and offline selfcheck reject an unrelated isError response", async () => {
  const originalCall = Client.prototype.callTool;
  Client.prototype.callTool = async () => ({ isError: true, content: [{ type: "text", text: "md5 backend unavailable" }] });
  try {
    const startup = await runStartupSelftest();
    assert.equal(startup.ok, false);
    assert.match(startup.problem, /validation/i);
    assert.ok(startup.fix);
    const report = await runSelfcheck({ offline: true });
    assert.equal(report.stages.find((s) => s.name === "tools").ok, false);
    assert.deepEqual(requests, []);
  } finally {
    Client.prototype.callTool = originalCall;
  }
});

test("ordinary and live selfchecks retain their mirror and search stages", async () => {
  const ordinary = await runSelfcheck();
  assert.deepEqual(ordinary.stages.map((s) => s.name), ["preflight", "tools", "mirrors"]);
  const live = await runSelfcheck({ live: true });
  assert.deepEqual(live.stages.map((s) => s.name), ["preflight", "tools", "mirrors", "live"]);
  assert.ok(requests.length > 0);
});

test("the offline CLI succeeds with all fetches disabled", () => {
  const r = cli(["--selfcheck", "--offline"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selfcheck passed/);
  assert.doesNotMatch(r.stdout, /reachable sources| mirrors /);
  assert.match(r.stderr, /requests=0/);
});

for (const args of [["--offline"], ["--selfcheck", "--offline", "--live"]]) {
  test(`the CLI rejects incompatible flags ${args.join(" ")}`, () => {
    const r = cli(args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--offline requires --selfcheck|--offline.*--live/);
    assert.match(r.stderr, /requests=0/);
  });
}

test("--selfcheck prints the tool names it verified, not only their count", () => {
  // An agent diagnosing "no tools appear in my client" diffs its own tool list
  // against this line.
  const r = cli(["--selfcheck", "--offline"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const name of TOOL_NAMES) assert.match(r.stdout, new RegExp(`\\b${name}\\b`));
});

test("the fix it prints names the dependency versions this package pins", async () => {
  // The message an agent acts on reads package.json; a hard-coded pair drifts
  // the first time either dependency is bumped.
  const { readRootPackage } = await import("../scripts/lib/pkg.mjs");
  const pkg = readRootPackage();
  const originalCall = Client.prototype.callTool;
  Client.prototype.callTool = async () => {
    throw new Error("keyValidator._parse is not a function");
  };
  try {
    const report = await runSelfcheck({ offline: true });
    const fix = report.stages.find((s) => s.name === "tools").fix;
    assert.match(fix, new RegExp(`@modelcontextprotocol/sdk@${pkg.dependencies["@modelcontextprotocol/sdk"]}`));
    assert.match(fix, new RegExp(`zod@${pkg.dependencies.zod}`));
  } finally {
    Client.prototype.callTool = originalCall;
  }
});
