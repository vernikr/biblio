// HTML response deadlines must cover the body, not only the response headers.
// All routes are local and deliberately leave their response open after a byte.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

process.env.BIBLIO_TIMEOUT_MS = "200";
process.env.BIBLIO_DOWNLOAD_TIMEOUT_MS = "200";
process.env.BIBLIO_DOWNLOAD_STALL_MS = "200";
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";

const { fetchFromMirrors, downloadToFile } = await import("../dist/http.js");
const server = createServer((req, res) => {
  const html = req.url?.startsWith("/html");
  res.writeHead(200, {
    "content-type": html ? "text/html; charset=UTF-8" : "application/octet-stream",
  });
  res.write(html ? "<html>" : "x");
  // Intentionally do not finish the body. Client-side timeout must abort it.
});
const base = await listenLocal(server);

test.after(() => closeServer(server));

async function assertFastRejection(operation, label) {
  const started = Date.now();
  await assert.rejects(operation);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1500, `${label} took ${elapsed}ms despite a 200ms deadline`);
}

test("fetchFromMirrors times out while reading a stalled response body", async () => {
  await assertFastRejection(
    () => fetchFromMirrors("timeout", [base], (mirror) => `${mirror}/text`),
    "fetchFromMirrors"
  );
});

test("downloadToFile rejects an HTML interstitial without waiting for its unfinished body", async () => {
  const dir = await mkdtemp(join(tmpdir(), "biblio-timeout-"));
  try {
    await assertFastRejection(
      () => downloadToFile(`${base}/html`, join(dir, "book.pdf")),
      "downloadToFile"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
