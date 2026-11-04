#!/usr/bin/env node
// One-command installer for biblio-mcp.
//
// Imported by name in tests (runInstall); the CLI wrapper is at the bottom, so
// importing this file never installs anything.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = "https://github.com/vernikr/biblio-mcp.git";
const NODE_MIN = { major: 22, minor: 0 };

/** Flags the installer accepts. */
function parseInstallArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  return {
    repoUrl: valueOf("--repo") ?? DEFAULT_REPO,
    target: valueOf("--dir") ?? join(homedir(), "Tools", "biblio-mcp"),
    configPath: valueOf("--write-config"),
    dryRun: has("--dry-run"),
    skipNetwork: has("--skip-network"),
    live: has("--live"),
    forceClone: has("--force-clone"),
  };
}

/** One run's output sink and its running failure count. */
function createRun({ dryRun, write, capture }) {
  let failures = 0;
  return {
    dryRun,
    capture,
    write,
    step: (n, msg) => write(`\n[${n}] ${msg}\n`),
    ok: (msg) => write(`  ok   ${msg}\n`),
    note: (msg) => write(`  ·    ${msg}\n`),
    bad: (msg) => {
      write(`  FAIL ${msg}\n`);
      failures += 1;
    },
    finish: () => {
      write(
        failures > 0
          ? `\ninstall FAILED — ${failures} problem(s) above. Nothing further was attempted.\n`
          : "\ninstall complete.\n"
      );
      return failures > 0 ? 1 : 0;
    },
  };
}

/** Run a command, forwarding its output. Returns the exit code. */
function run(ctx, cmd, args, opts = {}) {
  const write = ctx.write;
  write(`  $ ${cmd} ${args.join(" ")}\n`);
  if (ctx.dryRun) return 0;
  const r = spawnSync(cmd, args, {
    // A captured run pipes children so their output lands in the caller's sink
    // instead of interleaving with it on the terminal.
    stdio: ctx.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
    ...opts,
  });
  if (r.error) {
    ctx.bad(`${cmd} could not be started: ${r.error.message}`);
    return 1;
  }
  if (ctx.capture) {
    if (r.stdout) write(r.stdout.toString());
    if (r.stderr) write(r.stderr.toString());
  }
  return r.status ?? 1;
}

/** Locate a package manager without replacing a pnpm-locked tree with npm. */
function findPackageManager() {
  const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (pnpm.status === 0) return { name: "pnpm", version: (pnpm.stdout || "").trim() };

  // This repository deliberately pins dependency resolution with pnpm. Falling
  // back to npm here can create a different tree or fail inside npm's resolver.
  if (existsSync(join(HERE, "..", "pnpm-lock.yaml"))) return null;

  const npm = spawnSync("npm", ["--version"], { encoding: "utf8" });
  if (npm.status === 0) return { name: "npm", version: (npm.stdout || "").trim() };
  return null;
}

/** Merge one server entry into an existing MCP config file. */
function writeConfig(ctx, configPath, entry, entryPath) {
  const abs = isAbsolute(configPath) ? configPath : resolvePath(process.cwd(), configPath);

  // Validate before writing: a path in `args` that does not exist produces a
  // client that fails with no useful message, which is the failure mode this
  // installer is meant to remove.
  if (!ctx.dryRun && !existsSync(entryPath)) {
    ctx.bad(`refusing to write a config pointing at a missing file: ${entryPath}`);
    return;
  }

  let existing = {};
  const hadConfig = existsSync(abs);
  if (hadConfig) {
    let raw;
    try {
      raw = readFileSync(abs, "utf8");
    } catch (e) {
      ctx.bad(`cannot read ${abs}: ${String(e?.message ?? e)}`);
      return;
    }
    try {
      existing = JSON.parse(raw);
    } catch (e) {
      ctx.bad(`${abs} is not valid JSON, so it was left untouched: ${String(e?.message ?? e)}`);
      ctx.note("add the snippet above by hand, or fix the file and re-run");
      return;
    }
  }

  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    ctx.bad(`${abs} does not contain a JSON object, so it was left untouched`);
    return;
  }
  if (
    existing.mcpServers !== undefined &&
    (!existing.mcpServers || typeof existing.mcpServers !== "object" || Array.isArray(existing.mcpServers))
  ) {
    ctx.bad(`${abs}: mcpServers must be a JSON object, so the file was left untouched`);
    return;
  }
  if (hadConfig && !ctx.dryRun) {
    copyFileSync(abs, `${abs}.bak`);
    ctx.note(`backed up the existing config to ${abs}.bak`);
  }
  existing.mcpServers ??= {};
  if (existing.mcpServers.biblio) ctx.note(`replacing the existing "biblio" entry`);
  existing.mcpServers.biblio = entry;

  if (ctx.dryRun) {
    ctx.note(`would write ${abs}`);
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(existing, null, 2)}\n`);
  renameSync(tmp, abs);
  ctx.ok(`wrote ${abs}`);
  ctx.note(`verify the path it points at: ${entryPath}`);
}

/**
 * Install biblio-mcp. Returns the exit code.
 *
 * `write` receives every line of output, so a caller can capture it instead of
 * spawning a process; `capture` additionally pipes child commands into it.
 * `packageManager` skips the pnpm/npm probe, which costs ~350 ms a call.
 */
export async function runInstall({
  argv = [],
  write = (text) => process.stdout.write(text),
  capture = false,
  packageManager,
} = {}) {
  const opts = parseInstallArgs(argv);
  const ctx = createRun({ dryRun: opts.dryRun, write, capture });

  write(`biblio-mcp installer${opts.dryRun ? " (dry run — nothing is written)" : ""}\n`);

  if (opts.live && opts.skipNetwork) {
    ctx.bad("--live and --skip-network cannot be used together");
    return ctx.finish();
  }

  // ---------------------------------------------------------------- 1. check
  ctx.step(1, "checking prerequisites");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > NODE_MIN.major || (major === NODE_MIN.major && minor >= NODE_MIN.minor)) {
    ctx.ok(`node ${process.versions.node}`);
  } else {
    ctx.bad(`node ${process.versions.node} is too old — ${NODE_MIN.major}.${NODE_MIN.minor} or newer is required`);
    return ctx.finish();
  }

  const pm = packageManager ?? findPackageManager();
  if (!pm) {
    ctx.bad("no package manager found — install pnpm: npm install -g pnpm");
    return ctx.finish();
  }
  ctx.ok(`${pm.name} ${pm.version}`);

  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (git.status === 0) ctx.ok((git.stdout || "").trim());
  else ctx.note("git not found — needed only if the target directory does not exist yet");

  // ---------------------------------------------------------------- 2. fetch
  ctx.step(2, `obtaining the source into ${opts.target}`);
  let projectDir = opts.target;
  if (existsSync(join(opts.target, "package.json"))) {
    ctx.ok("already present — reusing it (run `git pull` yourself to update)");
  } else if (existsSync(join(HERE, "..", "package.json")) && !opts.forceClone) {
    // We are being run from inside a checkout; use it rather than cloning.
    projectDir = resolvePath(HERE, "..");
    ctx.ok(`running from the existing checkout at ${projectDir}`);
  } else if (opts.dryRun) {
    ctx.note(`would clone ${opts.repoUrl}`);
  } else {
    mkdirSync(dirname(opts.target), { recursive: true });
    if (run(ctx, "git", ["clone", opts.repoUrl, opts.target]) !== 0) {
      ctx.bad(`could not clone ${opts.repoUrl}`);
      return ctx.finish();
    }
  }

  const preflight = join(projectDir, "scripts", "preflight.mjs");
  if (!existsSync(preflight)) {
    ctx.bad(`scripts/preflight.mjs not found in ${projectDir}`);
    return ctx.finish();
  }

  // ------------------------------------------------------------- 3. install
  ctx.step(3, "installing dependencies");
  const installArgs =
    pm.name === "pnpm" && existsSync(join(projectDir, "pnpm-lock.yaml"))
      ? ["install", "--frozen-lockfile"]
      : ["install"];
  if (run(ctx, pm.name, installArgs, { cwd: projectDir }) !== 0) {
    ctx.bad(`${pm.name} install failed`);
    return ctx.finish();
  }

  // ----------------------------------------------------------- 4. preflight
  ctx.step(4, "preflight — the dependency guard");
  // Validate the installed SDK/Zod pair before building; a clean checkout has
  // neither dependencies nor dist yet.
  if (run(ctx, process.execPath, [preflight], { cwd: projectDir }) !== 0) {
    ctx.bad("preflight failed — the messages above include the exact fix command");
    return ctx.finish();
  }

  // --------------------------------------------------------------- 5. build
  ctx.step(5, "building");
  if (run(ctx, pm.name, ["run", "build"], { cwd: projectDir }) !== 0) {
    ctx.bad("build failed");
    return ctx.finish();
  }
  const entry = join(projectDir, "dist", "index.js");
  if (opts.dryRun) ctx.note(`would expect ${entry}`);
  else if (existsSync(entry)) ctx.ok(entry);
  else ctx.bad(`${entry} does not exist after a successful build`);

  // -------------------------------------------------------------- 6. verify
  ctx.step(6, "verifying the tool surface");
  if (run(ctx, process.execPath, [entry, "--selfcheck", "--offline"], { cwd: projectDir }) !== 0) {
    ctx.bad("offline selfcheck failed");
    return ctx.finish();
  }
  ctx.ok("the tool surface answers a real tool call");

  if (opts.live) {
    ctx.step("6a", "checking live mirror health");
    if (run(ctx, process.execPath, [entry, "--selfcheck", "--live"], { cwd: projectDir }) !== 0) {
      ctx.bad("live mirror check failed");
      return ctx.finish();
    }
  } else {
    ctx.note(
      opts.skipNetwork
        ? "skipping the live mirror check (--skip-network)"
        : "skipping the live mirror check (pass --live to run `--selfcheck --live`)"
    );
  }

  // -------------------------------------------------------------- 7. config
  ctx.step(7, "MCP client configuration");
  const text = JSON.stringify({ mcpServers: { biblio: { command: process.execPath, args: [entry] } } }, null, 2);

  if (!opts.configPath) {
    ctx.ok("add this to your MCP client config (Claude Desktop, Cline, Cursor, …):");
    write(`\n${text}\n\n`);
    ctx.note("this entry runs the checkout above, not the published release");
    ctx.note(`or re-run with --write-config <path> to merge it in for you`);
  } else {
    writeConfig(ctx, opts.configPath, { command: process.execPath, args: [entry] }, entry);
  }

  return ctx.finish();
}

const invokedDirectly = process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await runInstall({ argv: process.argv.slice(2) });
}
