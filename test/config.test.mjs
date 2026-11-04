// The settings registry: every numeric budget is listed in --help, and the
// parser falls back on anything that is not a positive number.

import test from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { NUMBER_SETTINGS, ENV_SETTINGS, readNumber, environmentHelp, environmentTable, ENV_TABLE_START, ENV_TABLE_END } =
  await import("../dist/config.js");

test("every numeric setting is listed in --help with its real default", () => {
  const names = new Set(ENV_SETTINGS.map((s) => s.name));
  const help = environmentHelp();
  for (const setting of Object.values(NUMBER_SETTINGS)) {
    assert.ok(names.has(setting.name), `${setting.name} missing from ENV_SETTINGS`);
    assert.match(help, new RegExp(`${setting.name} .*\\(default: ${setting.fallback}\\)`));
  }
});

test("readNumber takes a positive number from the environment and falls back otherwise", () => {
  const setting = { name: "BIBLIO_TEST_NUMBER_SETTING", fallback: 42 };
  const saved = process.env[setting.name];
  try {
    delete process.env[setting.name];
    assert.equal(readNumber(setting), 42, "unset");
    process.env[setting.name] = "1500";
    assert.equal(readNumber(setting), 1500, "valid");
    for (const bad of ["", "abc", "0", "-5", "Infinity"]) {
      process.env[setting.name] = bad;
      assert.equal(readNumber(setting), 42, `"${bad}" must fall back`);
    }
  } finally {
    if (saved === undefined) delete process.env[setting.name];
    else process.env[setting.name] = saved;
  }
});

test("every BIBLIO_* setting the code reads is registered in the registry", () => {
  // An unregistered switch is invisible: it never reaches --help or the README
  // table, because both are generated from ENV_SETTINGS.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const names = new Set(ENV_SETTINGS.map((s) => s.name));
  const unregistered = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|mjs)$/.test(entry.name)) {
        for (const m of readFileSync(path, "utf8").matchAll(/BIBLIO_[A-Z_]+/g)) {
          if (!names.has(m[0])) unregistered.add(m[0]);
        }
      }
    }
  };
  walk(join(root, "src"));
  walk(join(root, "scripts"));
  assert.deepEqual([...unregistered], [], "read but not listed in ENV_SETTINGS");
});

test("the README environment table is generated from the registry", () => {
  const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "README.md"), "utf8");
  const start = readme.indexOf(ENV_TABLE_START);
  const end = readme.indexOf(ENV_TABLE_END);
  assert.ok(start !== -1 && end > start, "README must keep the env-table markers");
  const block = readme.slice(start + ENV_TABLE_START.length, end).trim();
  assert.equal(
    block,
    environmentTable(),
    "README table is stale; run `pnpm run docs:env`"
  );
});

test("a silent file server is not waited on longer than a client will listen", () => {
  // A default MCP client gives up on a request after 60 s. An attempt that fails
  // later than that has already failed for the caller, who sees a client timeout
  // instead of "no headers from this link, try the next copy".
  assert.ok(
    NUMBER_SETTINGS.downloadTimeoutMs.fallback <= 60_000,
    `BIBLIO_DOWNLOAD_TIMEOUT_MS defaults to ${NUMBER_SETTINGS.downloadTimeoutMs.fallback} ms`
  );
});

test("zero disables only mirror staggering, not timeout or TTL budgets", () => {
  for (const [key, setting] of Object.entries(NUMBER_SETTINGS)) {
    const saved = process.env[setting.name];
    try {
      process.env[setting.name] = "0";
      assert.equal(readNumber(setting), key === "mirrorStaggerMs" ? 0 : setting.fallback, key);
      for (const bad of ["-1", "NaN", "Infinity", " ", ""]) {
        process.env[setting.name] = bad;
        assert.equal(readNumber(setting), setting.fallback, `${key}: ${JSON.stringify(bad)}`);
      }
    } finally {
      if (saved === undefined) delete process.env[setting.name];
      else process.env[setting.name] = saved;
    }
  }
});

test("empty mirror groups name their real documented configuration variables", async () => {
  const { fetchFromMirrors } = await import("../dist/http.js");
  for (const [group, envName] of [
    ["annas", "BIBLIO_ANNAS_MIRRORS"], ["libgen", "BIBLIO_LIBGEN_MIRRORS"],
    ["scihub", "BIBLIO_SCIHUB_MIRRORS"], ["zlibrary", "BIBLIO_ZLIB_MIRRORS"],
  ]) {
    assert.ok(ENV_SETTINGS.some((s) => s.name === envName));
    await assert.rejects(fetchFromMirrors(group, [], () => "/"), new RegExp(`set ${envName} to`));
  }
});
