#!/usr/bin/env node
// Refresh the small set of provider pages kept as offline regression fixtures.
// Anna's Archive and Z-Library are deliberately not included: they were not
// reachable from the audit environment, and fabricated HTML would hide drift.

import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "test", "fixtures");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const targets = [
  {
    file: "libgen-books.html",
    url: "https://libgen.li/index.php?req=Vidyamurthy%20Pairs%20Trading&res=100",
    markers: ["Pairs Trading: Quantitative Methods and Analysis", "Ganapathy Vidyamurthy"],
  },
  {
    file: "libgen-scimag.html",
    url: "https://libgen.li/index.php?req=10.1038%2Fnature12373&topics%5B%5D=a&res=100",
    markers: ["Nanometre-scale thermometry in a living cell", "10.1038/nature12373"],
  },
  {
    file: "libgen-ads.html",
    url: "https://libgen.li/ads.php?md5=524037f395462d37b31f2b28fede24fb",
    markers: ["@book{", "get.php?md5=524037f395462d37b31f2b28fede24fb"],
  },
  {
    file: "scihub-doi.html",
    url: "https://sci-hub.ren/10.1038/nature12373",
    markers: ["Nanometre-scale thermometry in a living cell", "<embed type=\"application/pdf\""],
    reject: [/altcha|captcha|проверка на робота/i],
  },
];

let failures = 0;
await mkdir(OUT, { recursive: true });

for (const target of targets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(target.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const responseHtml = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${response.url}`);
    if (responseHtml.length > 2_000_000) {
      throw new Error(`unexpectedly large response (${responseHtml.length} chars)`);
    }
    // Keep snapshots reviewable and platform-independent while preserving all
    // markup and text that the parsers consume.
    const html = responseHtml
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, "  ")
      .replace(/[ ]+$/gm, "");
    if (!target.markers.every((marker) => html.includes(marker))) {
      throw new Error(`response did not contain the expected fixture markers (${response.url})`);
    }
    if (target.reject?.some((pattern) => pattern.test(html))) {
      throw new Error(`response looks like a challenge page (${response.url})`);
    }

    const destination = join(OUT, target.file);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, html, "utf8");
    await rename(temporary, destination);
    const sha256 = createHash("sha256").update(html).digest("hex");
    console.log(`captured ${target.file} (${Buffer.byteLength(html)} bytes, sha256 ${sha256})`);
  } catch (error) {
    failures += 1;
    console.error(`failed ${target.file}: ${error instanceof Error ? error.message : error}`);
  } finally {
    clearTimeout(timer);
  }
}

if (failures) {
  console.error(`${failures} fixture(s) were not refreshed; existing files were left untouched.`);
  process.exitCode = 1;
}
