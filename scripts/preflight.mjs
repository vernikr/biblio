#!/usr/bin/env node
// Pre-install / pre-run health check.

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** npm/MCPB artifacts contain runtime files, not the source-checkout marker. */
const INSTALLED_PACKAGE = !existsSync(join(PROJECT_ROOT, "src", "index.ts"));

/** Minimum Node this server supports (mirrors "engines" in package.json). */
const MIN_NODE = { major: 22, minor: 0 };

/** Read a dependency manifest without importing the dependency. */
function readPkgJson(name) {
  const direct = join(PROJECT_ROOT, "node_modules", name, "package.json");
  try {
    return JSON.parse(readFileSync(direct, "utf8"));
  } catch {
    /* fall through to resolution */
  }

  let entry;
  try {
    entry = require_.resolve(name);
  } catch {
    try {
      entry = require_.resolve(`${name}/package.json`);
    } catch {
      return null;
    }
  }

  let dir = dirname(entry);
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8"));
        if (pkg.name === name) return pkg;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The version this package pins for a dependency, when its manifest is readable. */
function pinnedVersion(name) {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
    return pkg.dependencies?.[name];
  } catch {
    return undefined;
  }
}

function majorMinor(version) {
  const m = String(version ?? "").match(/^(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/** The SDK this package pins, so the advice cannot name a version it has left behind. */
function sdkSpec() {
  const version = pinnedVersion("@modelcontextprotocol/sdk");
  return version ? `@modelcontextprotocol/sdk@${version}` : "@modelcontextprotocol/sdk";
}

/** Decide whether the installed zod can satisfy the installed SDK. */
export function checkZodSdkCompat() {
  const zodPkg = readPkgJson("zod");
  const sdkPkg = readPkgJson("@modelcontextprotocol/sdk");

  if (!zodPkg) return { ok: false, reason: "zod is not installed (run pnpm install)" };
  if (!sdkPkg)
    return {
      ok: false,
      reason: "@modelcontextprotocol/sdk is not installed (run pnpm install)",
    };

  const zod = majorMinor(zodPkg.version);
  const declaredRange =
    sdkPkg.peerDependencies?.zod ?? sdkPkg.dependencies?.zod ?? "";
  const sdkAdmitsZod4 = /(?:\^|~|>=)?\s*4/.test(String(declaredRange));

  // Runtime probe: v3 schemas carry `_parse`, v4 replaced it with `_zod`.
  let zodHasV3Internals = null;
  try {
    const { z } = require_("zod");
    zodHasV3Internals = typeof z?.string?.()._parse === "function";
  } catch {
    zodHasV3Internals = null;
  }

  const detail = {
    zod: zodPkg.version,
    sdk: sdkPkg.version,
    sdkZodRange: String(declaredRange),
    sdkAdmitsZod4,
    zodHasV3Internals,
  };

  if (zod && zod.major >= 4 && !sdkAdmitsZod4) {
    return {
      ok: false,
      detail,
      reason:
        `zod ${zodPkg.version} is installed but @modelcontextprotocol/sdk ` +
        `${sdkPkg.version} only accepts "${declaredRange}". The server will ` +
        `start and then fail every tool call with ` +
        `"keyValidator._parse is not a function". ` +
        `Fix: raise the SDK to a zod-4-aware release ` +
        `(pnpm add ${sdkSpec()} --save-exact), ` +
        `or install a zod this SDK declares (pnpm add "zod@${declaredRange}").`,
    };
  }

  if (zod && zod.major < 4 && zodHasV3Internals === false) {
    return {
      ok: false,
      detail,
      reason:
        `zod ${zodPkg.version} does not expose the v3 internals this SDK needs. ` +
        `The install is inconsistent — remove node_modules and reinstall.`,
    };
  }

  return { ok: true, detail };
}

export function runPreflight({ requireBuild = false } = {}) {
  const checks = [];
  // A missing build is informational unless --require-build is requested.
  const push = (name, ok, info = {}) =>
    checks.push({ name, ok, blocking: true, ...info });

  // 1. Node version.
  const node = majorMinor(process.versions.node);
  const nodeOk = !!node && (node.major > MIN_NODE.major || (node.major === MIN_NODE.major && node.minor >= MIN_NODE.minor));
  push(
    "node",
    nodeOk,
    nodeOk
      ? { info: `v${process.versions.node}` }
      : {
          info: `v${process.versions.node}`,
          problem: `Node >= ${MIN_NODE.major}.${MIN_NODE.minor} is required`,
        }
  );

  // 2. Lockfile alignment.
  if (INSTALLED_PACKAGE) {
    push("lockfiles", true, { info: "n/a (installed package, not a source checkout)" });
  } else {
    const hasPnpmLock = existsSync(join(PROJECT_ROOT, "pnpm-lock.yaml"));
    const hasNpmLock = existsSync(join(PROJECT_ROOT, "package-lock.json"));
    push(
      "lockfiles",
      hasPnpmLock,
      hasPnpmLock
        ? {
            info: hasNpmLock ? "pnpm-lock.yaml (+ package-lock.json present)" : "pnpm-lock.yaml",
            note: hasNpmLock
              ? "package-lock.json also present; this project installs with pnpm"
              : undefined,
          }
        : { info: "none", problem: "pnpm-lock.yaml missing — dependency versions are unpinned" }
    );
  }

  // 3. Dependency installation.
  const hasNodeModules = !!readPkgJson("zod") && !!readPkgJson("@modelcontextprotocol/sdk");
  push(
    "dependencies",
    hasNodeModules,
    hasNodeModules
      ? { info: "node_modules present" }
      : { info: "missing", problem: "run `pnpm install`" }
  );

  // 4. The zod / SDK combination that actually decides whether tools work -----
  const compat = checkZodSdkCompat();
  push(
    "zod-sdk-compat",
    compat.ok,
    compat.ok
      ? {
          info: `sdk ${compat.detail?.sdk} + zod ${compat.detail?.zod} (range "${compat.detail?.sdkZodRange}")`,
        }
      : { info: compat.detail ? `sdk ${compat.detail.sdk} + zod ${compat.detail.zod}` : "n/a", problem: compat.reason }
  );

  // 5. Build artefact ---------------------------------------------------------
  const distEntry = join(PROJECT_ROOT, "dist", "index.js");
  const built = existsSync(distEntry);
  if (requireBuild || hasNodeModules) {
    checks.push({
      name: "build",
      ok: built,
      blocking: requireBuild,
      info: built ? distEntry : "dist/index.js missing",
      problem: built ? undefined : "run `pnpm build`",
    });
  }

  const ok = checks.every((c) => c.ok || c.blocking === false);
  return { ok, checks, projectRoot: PROJECT_ROOT, node: process.versions.node };
}

function printHuman(report) {
  // "note" = informational and non-blocking; "FAIL" = blocking.
  const icon = (c) => (c.ok ? "  ok  " : c.blocking === false ? " note " : " FAIL ");
  console.log(`biblio-mcp preflight — Node v${report.node}`);
  console.log(`project: ${report.projectRoot}\n`);
  for (const c of report.checks) {
    console.log(`${icon(c)} ${c.name.padEnd(15)} ${c.info ?? ""}`);
    if (c.problem) console.log(`        ↳ ${c.problem}`);
    if (c.note) console.log(`        · ${c.note}`);
  }
  const built = report.checks.find((c) => c.name === "build")?.ok;
  console.log(
    !report.ok
      ? "\nnot ready — fix the FAIL lines above, then re-run this script."
      : built
        ? "\nready to run: node dist/index.js"
        : "\ndependencies OK — run `pnpm build`, then `node dist/index.js`."
  );
}

// Run directly (not when imported by dist/index.js --selfcheck or by tests).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = runPreflight({ requireBuild: process.argv.includes("--require-build") });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  process.exit(report.ok ? 0 : 1);
}
