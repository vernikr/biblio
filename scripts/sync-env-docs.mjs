// Rewrites the environment-variable table in README.md from src/config.ts.
// Run after changing ENV_SETTINGS: `pnpm run docs:env`.
// config.test.mjs fails when README.md and the registry disagree.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { environmentTable, ENV_TABLE_START, ENV_TABLE_END } = await import(
  pathToFileURL(join(root, "dist", "config.js")).href
);

const readmePath = join(root, "README.md");
const readme = readFileSync(readmePath, "utf8");
const start = readme.indexOf(ENV_TABLE_START);
const end = readme.indexOf(ENV_TABLE_END);
if (start === -1 || end === -1 || end < start) {
  console.error(`README.md needs the markers ${ENV_TABLE_START} and ${ENV_TABLE_END}`);
  process.exitCode = 1;
} else {
  const block = `${ENV_TABLE_START}\n${environmentTable()}\n`;
  const next = readme.slice(0, start) + block + readme.slice(end);
  if (next !== readme) writeFileSync(readmePath, next);
  console.log(next === readme ? "README.md already up to date" : "README.md environment table updated");
}
