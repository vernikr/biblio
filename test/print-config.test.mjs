// --print-config emits a ready-to-paste MCP client entry that launches the
// published package through npx, with PATH set so a GUI-started client can
// still find node. It must never start the stdio server or print anything but JSON.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const PKG_SPEC = "@vernikr/biblio-mcp@latest";
// npx resolves `latest` against the registry on each start; no release-age gate
// applies to it, so no extra flags are needed.
const LAUNCH_ARGS = ["--yes", PKG_SPEC];

function fakeExecutable(dir, name) {
  const file = join(dir, name);
  writeFileSync(file, "#!/bin/sh\necho 12.10.1\n");
  chmodSync(file, 0o755);
  return file;
}

function runPrintConfig(pathValue) {
  return spawnSync(process.execPath, [entry, "--print-config"], {
    encoding: "utf8",
    input: "",
    timeout: 10_000,
    env: { PATH: pathValue, HOME: tmpdir() },
  });
}

test("buildLauncherConfig launches the latest release with a cache-free dlx and carries node's dir on PATH", async () => {
  const { buildLauncherConfig } = await import("../dist/printConfig.js");
  const cfg = buildLauncherConfig({
    execPath: "/opt/node/bin/node",
    npxPath: "/opt/local/bin/npx",
    platform: "darwin",
  });
  assert.deepEqual(cfg, {
    mcpServers: {
      biblio: {
        command: "/opt/local/bin/npx",
        args: LAUNCH_ARGS,
        env: { PATH: `/opt/node/bin:/opt/local/bin:/usr/bin:/bin` },
      },
    },
  });
});

test("buildLauncherConfig never embeds secrets or a server-start flag", async () => {
  const { buildLauncherConfig } = await import("../dist/printConfig.js");
  const text = JSON.stringify(buildLauncherConfig({
    execPath: "/opt/node/bin/node", npxPath: "npx", platform: "linux",
  }));
  assert.doesNotMatch(text, /BIBLIO_|API_KEY|--selfcheck|--print-config/);
});

test("buildLauncherConfig keeps the Windows shim name and joins PATH with ';'", async () => {
  const { buildLauncherConfig } = await import("../dist/printConfig.js");
  const cfg = buildLauncherConfig({
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    npxPath: "C:\\nodejs\\npx.cmd",
    platform: "win32",
  });
  const server = cfg.mcpServers.biblio;
  assert.equal(server.command, "C:\\nodejs\\npx.cmd");
  assert.equal(server.env.PATH, "C:\\Program Files\\nodejs;C:\\nodejs");
});

test("--print-config prints one JSON object on stdout, latest and absolute, and exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-pc-"));
  const npx = fakeExecutable(dir, "npx");
  const r = runPrintConfig(`${dir}${delimiter}/usr/bin${delimiter}/bin`);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /ready on stdio/, "must not start the stdio server");
  const parsed = JSON.parse(r.stdout);
  const server = parsed.mcpServers.biblio;
  assert.equal(server.command, npx);
  assert.deepEqual(server.args, LAUNCH_ARGS);
  assert.equal(server.env.PATH.split(delimiter)[0], dirname(process.execPath));
  assert.ok(server.env.PATH.split(delimiter).includes(dir));
});

test("--print-config warns and still prints when npx is not on PATH", () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-pc-empty-"));
  mkdirSync(join(dir, "empty"));
  const r = runPrintConfig(join(dir, "empty"));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).mcpServers.biblio.command, "npx");
  assert.match(r.stderr, /npx not found on PATH/);
});

test("ephemeralPathWarning flags per-shell and temp locations, not stable installs", async () => {
  const { ephemeralPathWarning } = await import("../dist/printConfig.js");
  assert.match(ephemeralPathWarning("/h/.local/state/fnm_multishells/1/bin/node") ?? "", /per-shell/);
  assert.match(ephemeralPathWarning("/tmp/abc/npx") ?? "", /temporary/);
  assert.equal(ephemeralPathWarning("/opt/local/bin/npx"), undefined);
});
