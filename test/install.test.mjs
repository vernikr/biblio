// Tests for the installer and the startup self-test.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runStartupSelftest } from "../dist/selfcheck.js";
import { runInstall } from "../scripts/install.mjs";
import { readRootPackage } from "../scripts/lib/pkg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER = join(HERE, "..", "scripts", "install.mjs");

/** The installer refuses to run without pnpm (it never falls back to npm over a
 *  pnpm lockfile). Tests that exercise that path declare the prerequisite and are
 *  reported as skipped, with the reason, when it is absent from PATH. */
const PNPM_ON_PATH = (process.env.PATH ?? "")
  .split(delimiter)
  .some((dir) => dir && existsSync(join(dir, "pnpm")));
const needsPnpm = PNPM_ON_PATH ? {} : { skip: "pnpm is not on PATH; the installer requires it" };

/**
 * Run the installer in this process and capture its output. `stubPackageManager`
 * skips the ~350 ms pnpm probe for tests that are not about package-manager
 * detection; the happy path and the detection tests use the real thing.
 */
async function installHere(args, { capture = false, stubPackageManager = true } = {}) {
  let stdout = "";
  const status = await runInstall({
    argv: args,
    capture,
    write: (text) => (stdout += text),
    packageManager: stubPackageManager ? { name: "pnpm", version: "test" } : undefined,
  });
  return { status, stdout, stderr: "" };
}

/** Run the installer as if Node reported `version`. */
async function installOnNode(args, version) {
  const real = process.versions.node;
  Object.defineProperty(process.versions, "node", { value: version, configurable: true });
  try {
    return await installHere(args);
  } finally {
    Object.defineProperty(process.versions, "node", { value: real, configurable: true });
  }
}

/** Run the installer in a subprocess. Only for cases that must be isolated:
 *  the CLI entry point itself, and the two tests that really install and build. */
function runInstaller(args, cwd, env) {
  const r = spawnSync(process.execPath, [INSTALLER, ...args], {
    encoding: "utf8",
    cwd: cwd ?? join(HERE, ".."),
    env: env ?? process.env,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Swap PATH for the duration of one callback. */
function withPath(t, value, fn) {
  const saved = process.env.PATH;
  process.env.PATH = value;
  t.after(() => {
    process.env.PATH = saved;
  });
  return fn();
}

function freshCheckout(t) {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-clean-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const projectDir = join(dir, "repo");
  cpSync(join(HERE, ".."), projectDir, {
    recursive: true,
    filter: (path) => !["node_modules", "dist", ".git"].includes(basename(path)),
  });
  return { dir, projectDir };
}

// ---------------------------------------------------------------------------
// The startup self-test (item 25)
// ---------------------------------------------------------------------------

test("runStartupSelftest passes on a healthy build", async () => {
  const result = await runStartupSelftest();
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  assert.equal(result.problem, undefined);
});

test("the version flag prints the package version without starting stdio", () => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "dist", "index.js"), "--version"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^biblio-mcp v\d+\.\d+\.\d+/);
});

for (const bypass of [false, true]) {
  test(`the entry point ${bypass ? "explicitly bypasses" : "refuses"} an unhealthy startup check`, () => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      Client.prototype.callTool = async () => ({
        isError: true, content: [{ type: "text", text: "md5 backend unavailable" }],
      });
      process.argv = [process.execPath, ${JSON.stringify(join(HERE, "..", "dist", "index.js"))}];
      await import(${JSON.stringify(pathToFileURL(join(HERE, "..", "dist", "index.js")).href)});
    `], {
      encoding: "utf8", cwd: join(HERE, ".."), timeout: 10000,
      env: { ...process.env, BIBLIO_SKIP_STARTUP_CHECK: bypass ? "1" : "" },
    });
    assert.equal(r.status, bypass ? 0 : 1, r.stderr);
    assert.equal(r.stdout, "");
    if (bypass) assert.match(r.stderr, /ready on stdio/);
    else {
      assert.match(r.stderr, /refusing to start/);
      assert.match(r.stderr, /@modelcontextprotocol\/sdk/);
      assert.match(r.stderr, /BIBLIO_SKIP_STARTUP_CHECK=1/);
      assert.doesNotMatch(r.stderr, /ready on stdio/);
    }
  });
}

// ---------------------------------------------------------------------------
// The installer (item 24)
// ---------------------------------------------------------------------------

test("the installer runs end to end in dry-run mode and writes nothing", needsPnpm, async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-"));
  const r = await installHere(["--dry-run", "--dir", join(dir, "repo")], {
    stubPackageManager: false,
  });
  assert.equal(r.status, 0, `installer failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /\[1\] checking prerequisites/);
  assert.match(r.stdout, /\[7\] MCP client configuration/);
  assert.match(r.stdout, /skipping the live mirror check.*--live/);
  assert.match(r.stdout, /install complete/);
  // The snippet it prints must be usable as-is.
  const json = /(\{[\s\S]*"mcpServers"[\s\S]*\})/.exec(r.stdout);
  assert.ok(json, "must print a config snippet");
  const parsed = JSON.parse(json[1]);
  assert.ok(parsed.mcpServers.biblio.args[0].endsWith("dist/index.js"));
});

test("the installer stops at an unsupported Node prerequisite", async () => {
  const r = await installOnNode(["--dry-run"], "17.0.0");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /node 17\.0\.0 is too old/);
  assert.doesNotMatch(r.stdout, /\[2\] obtaining|ok\s+pnpm|no package manager found/);
});

test("the installer refuses npm fallback when the checkout has a pnpm lockfile", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-pm-"));
  const bin = join(dir, "bin");
  const npmMarker = join(dir, "npm-was-run");
  mkdirSync(bin, { recursive: true });
  const fakeNpm = join(bin, "npm");
  writeFileSync(fakeNpm, `#!/bin/sh\nprintf ran > ${JSON.stringify(npmMarker)}\necho 99.0.0\n`);
  chmodSync(fakeNpm, 0o755);

  const r = await withPath(t, bin, () =>
    installHere(["--dry-run", "--dir", join(dir, "repo")], { stubPackageManager: false })
  );
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no package manager found — install pnpm/);
  assert.equal(existsSync(npmMarker), false, "npm must not be probed or run over the pnpm lockfile");
  assert.doesNotMatch(r.stdout, /\$ npm install/);
  assert.doesNotMatch(r.stdout, /\[2\] obtaining/, "the installer should stop at the missing pnpm prerequisite");
});

test("the installer --live flag runs the live selfcheck", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-"));
  const r = await installHere(["--dry-run", "--live", "--dir", join(dir, "repo")]);
  assert.equal(r.status, 0, `installer failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /--selfcheck --live/);
  assert.doesNotMatch(r.stdout, /skipping the live mirror check/);
});

test("the installer rejects contradictory --live and --skip-network flags immediately", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-"));
  const r = await installHere(["--dry-run", "--live", "--skip-network", "--dir", join(dir, "repo")]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /cannot be used together/);
  assert.doesNotMatch(r.stdout, /\[1\] checking prerequisites/);
});

test("the installer refuses to overwrite a config it cannot parse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-"));
  const cfg = join(dir, "mcp.json");
  writeFileSync(cfg, "{ this is not json\n");

  const r = await installHere(["--dry-run", "--dir", join(dir, "repo"), "--write-config", cfg]);

  assert.equal(r.status, 1, "must fail rather than clobber");
  assert.match(r.stdout, /is not valid JSON, so it was left untouched/);
  assert.equal(readFileSync(cfg, "utf8"), "{ this is not json\n", "the file must be unchanged");
});

test("the installer refuses a config that is not a JSON object", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-"));
  const cfg = join(dir, "mcp.json");
  writeFileSync(cfg, "[1,2,3]\n");

  const r = await installHere(["--dry-run", "--dir", join(dir, "repo"), "--write-config", cfg]);

  assert.equal(r.status, 1);
  assert.match(r.stdout, /does not contain a JSON object/);
  assert.equal(readFileSync(cfg, "utf8"), "[1,2,3]\n");
});

for (const mcpServers of [[], null, "not an object", 42, false]) {
  test(`the installer rejects mcpServers=${JSON.stringify(mcpServers)} even in dry-run mode`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "biblio-install-shape-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const cfg = join(dir, "mcp.json");
    const original = JSON.stringify({ mcpServers, theme: "dark" });
    writeFileSync(cfg, original);
    writeFileSync(`${cfg}.bak`, "previous backup");
    const r = await installHere(["--dry-run", "--dir", join(dir, "repo"), "--write-config", cfg]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /mcpServers must be a JSON object/);
    assert.doesNotMatch(r.stdout, /install complete|would write/);
    assert.equal(readFileSync(cfg, "utf8"), original);
    assert.equal(readFileSync(`${cfg}.bak`, "utf8"), "previous backup");
    assert.equal(existsSync(`${cfg}.tmp`), false);
  });
}

test("the installer accepts a config with an absent mcpServers field", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-shape-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = join(dir, "mcp.json");
  writeFileSync(cfg, JSON.stringify({ theme: "dark" }));
  const r = await installHere(["--dry-run", "--dir", join(dir, "repo"), "--write-config", cfg]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /would write/);
  assert.equal(existsSync(`${cfg}.bak`), false);
});

test("the installer leaves a malformed config and its previous backup untouched on a real install", needsPnpm, (t) => {
  const { dir, projectDir } = freshCheckout(t);
  const cfg = join(dir, "mcp.json");
  const original = JSON.stringify({ mcpServers: [], theme: "dark" });
  writeFileSync(cfg, original);
  writeFileSync(`${cfg}.bak`, "previous backup");
  const r = runInstaller(["--skip-network", "--dir", projectDir, "--write-config", cfg], projectDir, {
    ...process.env,
    npm_config_offline: "true",
  });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /mcpServers must be a JSON object/);
  assert.doesNotMatch(r.stdout, /backed up|wrote .*mcp\.json|install complete/);
  assert.equal(readFileSync(cfg, "utf8"), original);
  assert.equal(readFileSync(`${cfg}.bak`, "utf8"), "previous backup");
  assert.equal(existsSync(`${cfg}.tmp`), false);
});

test("the installer builds a clean checkout, merges an existing config and keeps a backup", needsPnpm, (t) => {
  const { dir, projectDir } = freshCheckout(t);
  const cfg = join(dir, "mcp.json");
  const original = JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" });
  writeFileSync(cfg, original);
  const lockfile = readFileSync(join(projectDir, "pnpm-lock.yaml"), "utf8");
  assert.equal(existsSync(join(projectDir, "node_modules")), false);
  assert.equal(existsSync(join(projectDir, "dist")), false);

  // The outer install primes pnpm's store; dependency installation in this test
  // must not need the registry or live mirrors.
  const r = runInstaller(["--skip-network", "--dir", projectDir, "--write-config", cfg], projectDir, {
    ...process.env,
    npm_config_offline: "true",
  });
  assert.equal(r.status, 0, `installer failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /\$ pnpm install --frozen-lockfile/);
  assert.match(r.stdout, /the tool surface answers a real tool call/);
  assert.equal(existsSync(join(projectDir, "node_modules", "zod", "package.json")), true);
  assert.equal(existsSync(join(projectDir, "dist", "index.js")), true);
  assert.equal(readFileSync(join(projectDir, "pnpm-lock.yaml"), "utf8"), lockfile);
  assert.equal(existsSync(join(projectDir, "package-lock.json")), false);

  const after = JSON.parse(readFileSync(cfg, "utf8"));
  assert.deepEqual(after.mcpServers.other, { command: "x" });
  assert.equal(after.theme, "dark");
  assert.equal(after.mcpServers.biblio.args[0], join(projectDir, "dist", "index.js"));
  assert.equal(readFileSync(`${cfg}.bak`, "utf8"), original);
});

test("the installer rejects an incompatible pair after installation and before building", async (t) => {
  const { dir, projectDir } = freshCheckout(t);
  const bin = join(dir, "bin");
  const calls = join(dir, "pm-calls.jsonl");
  mkdirSync(bin);
  const fakePnpm = join(bin, "pnpm");
  const packages = [
    ["zod", { name: "zod", version: "4.4.3" }],
    ["@modelcontextprotocol/sdk", { name: "@modelcontextprotocol/sdk", version: "1.12.1", peerDependencies: { zod: "^3.23.8" } }],
  ];
  // Model an unhealthy installation; the installer must still run the real
  // preflight against what the package manager installed, not bypass its guard.
  writeFileSync(fakePnpm, `#!${process.execPath}
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("12.10.1"); process.exit(0); }
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
if (args[0] !== "install") process.exit(2);
for (const [name, pkg] of ${JSON.stringify(packages)}) {
  const target = join(process.cwd(), "node_modules", name);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify(pkg));
}
`);
  chmodSync(fakePnpm, 0o755);
  const r = await withPath(t, bin, () =>
    installHere(["--skip-network", "--dir", projectDir], { capture: true })
  );
  assert.equal(r.status, 1);
  assert.match(r.stdout, /preflight failed/);
  assert.match(r.stdout, /keyValidator\._parse is not a function/);
  assert.match(r.stdout, /pnpm add @modelcontextprotocol\/sdk/);
  assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)), [
    ["install", "--frozen-lockfile"],
  ]);
  assert.equal(existsSync(join(projectDir, "dist")), false);
  assert.doesNotMatch(r.stdout, /\[5\] building|install complete/);
});

test("the installer validates the path it is about to put in a config", async () => {
  // A config whose args point at a missing file produces a client that fails with
  // no useful message. The installer must not be the thing that creates it.
  const dir = mkdtempSync(join(tmpdir(), "biblio-install-"));
  const cfg = join(dir, "mcp.json");
  const r = await installHere([
    "--dry-run",
    "--dir", join(dir, "does-not-exist"),
    "--write-config", cfg,
    "--force-clone",
  ]);
  // In dry-run mode nothing is written; the point is that it does not claim
  // success while pointing at a file that was never built.
  assert.ok(!existsSync(cfg), "dry run must not write the config");
  assert.ok(
    /would write|FAIL/.test(r.stdout),
    `expected either a dry-run note or a refusal, got:\n${r.stdout}`
  );
});

test("the installer is plain JavaScript with no imports from src", () => {
  // It has to run before anything is installed, so it cannot depend on the build.
  const source = readFileSync(INSTALLER, "utf8");
  assert.ok(!/from\s+["']\.\.\/dist/.test(source), "must not import the compiled build");
  assert.ok(!/from\s+["']\.\.\/src/.test(source), "must not import TypeScript sources");
  for (const line of source.split("\n")) {
    const m = /^\s*import .* from ["'](.+)["']/.exec(line);
    if (!m) continue;
    assert.ok(
      m[1].startsWith("node:"),
      `installer may only import node builtins, found: ${m[1]}`
    );
  }
});

// ---------------------------------------------------------------------------
// Documentation drift guards
// ---------------------------------------------------------------------------

// The script names a reader is told to run live in AGENTS.md now; the README
// keeps the two a user can run without a checkout. Both are scanned, so a
// renamed script cannot leave a documented command behind in either file.
for (const doc of ["README.md", "AGENTS.md"]) {
  test(`every pnpm script ${doc} tells you to run actually exists`, async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(here, "..", doc), "utf8");
    const pkg = readRootPackage();

    const scripts = new Set(Object.keys(pkg.scripts));
    // pnpm's own builtins are not package scripts, and prose words are not
    // commands at all ("No Git, pnpm or build step").
    const BUILTINS = new Set(["install", "add", "remove", "run", "exec", "dlx", "why", "update", "list"]);
    const PROSE = new Set(["and", "or", "are", "the", "with", "only", "not", "is", "a"]);
    const referenced = new Set();
    for (const m of text.matchAll(/pnpm (?:run )?([a-z][a-z0-9:]*)/g)) {
      const name = m[1];
      if (BUILTINS.has(name) || PROSE.has(name)) continue;
      referenced.add(name);
    }
    const missing = [...referenced].filter((s) => !scripts.has(s));
    assert.deepEqual(missing, [], `${doc} references pnpm scripts that do not exist: ${missing.join(", ")}`);
  });
}

test("the consumer package ships runtime checks, not the checkout installer", () => {
  const pkg = readRootPackage();
  assert.ok(pkg.files.includes("dist"));
  assert.ok(pkg.files.includes("scripts/preflight.mjs"));
  assert.ok(!pkg.files.includes("scripts/install.mjs"));
});

test("every version in the CHANGELOG links somewhere, and the current release is listed", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const changelog = readFileSync(join(here, "..", "CHANGELOG.md"), "utf8");

  const declared = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  const linked = new Set(
    [...changelog.matchAll(/^\[(\d+\.\d+\.\d+)\]:\s+(\S+)$/gm)].map((m) => m[1])
  );

  const missing = declared.filter((v) => !linked.has(v));
  assert.deepEqual(missing, [], `CHANGELOG declares versions with no link reference: ${missing.join(", ")}`);

  const pkg = readRootPackage();
  assert.ok(declared.includes(pkg.version), `package.json version ${pkg.version} is not in the CHANGELOG`);
});

test("the installer rejects Node 21 before fetching or installing", async () => {
  const r = await installOnNode(["--dry-run"], "21.99.0");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /22\.0.*required/);
  assert.doesNotMatch(r.stdout, /\[2\] obtaining/);
});

test("docs:env builds changed source before generating the README table", needsPnpm, (t) => {
  const { projectDir } = freshCheckout(t);
  symlinkSync(join(HERE, "..", "node_modules"), join(projectDir, "node_modules"), "junction");
  const config = join(projectDir, "src", "config.ts");
  writeFileSync(config, readFileSync(config, "utf8").replace("Timeout for scraping an HTML page", "docs-env-source-marker"));
  const r = spawnSync("pnpm", ["run", "docs:env"], { cwd: projectDir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(join(projectDir, "README.md"), "utf8"), /docs-env-source-marker/);
  assert.ok(existsSync(join(projectDir, "dist", "config.js")));
});
