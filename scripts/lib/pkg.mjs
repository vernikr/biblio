// The checkout's own package.json, read once per caller. Tests and scripts use
// this instead of repeating the path arithmetic.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function readRootPackage() {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
}
