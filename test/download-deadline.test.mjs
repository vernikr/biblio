// BIBLIO_DOWNLOAD_TIMEOUT_MS bounds how long a file server may take to answer
// with headers. Once bytes flow, only the idle watchdog applies: a slow but
// steady transfer longer than the header budget must still complete.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

process.env.BIBLIO_DOWNLOAD_TIMEOUT_MS = "150";
process.env.BIBLIO_DOWNLOAD_STALL_MS = "1000";

const { downloadToFile } = await import("../dist/http.js");

const CHUNK = Buffer.alloc(16 * 1024, 0x61);
const CHUNKS = 12;
// One gap of 250 ms, not twelve of 60 ms: the transfer still outlasts the 150 ms
// header budget, and the single gap has 4x headroom inside the 1000 ms stall
// budget. Pacing many small chunks flaked under load, when one gap overran it.
const STEADY_GAP_MS = 250;

const server = createServer((req, res) => {
  if (req.url === "/steady") {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(CHUNK.length * CHUNKS),
    });
    res.write(CHUNK);
    setTimeout(
      () => res.end(Buffer.concat(Array.from({ length: CHUNKS - 1 }, () => CHUNK))),
      STEADY_GAP_MS
    );
    return;
  }
  if (req.url === "/no-headers") {
    // Never answers: the header budget must cut this off.
    return;
  }
  if (req.url === "/stalled-body") {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.write(CHUNK);
    // Then silence: the idle watchdog must cut this off.
  }
});
const base = await listenLocal(server);
test.after(() => closeServer(server));

test("a steady transfer longer than the header budget completes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "biblio-deadline-"));
  try {
    const started = Date.now();
    const result = await downloadToFile(`${base}/steady`, join(dir, "book.bin"));
    const elapsed = Date.now() - started;
    assert.equal(result.bytes, CHUNK.length * CHUNKS);
    assert.ok(
      elapsed > 150 && elapsed < 1000,
      `the transfer must outlast the header budget and stay inside the stall budget (took ${elapsed}ms)`
    );
    assert.equal((await readFile(join(dir, "book.bin"))).length, CHUNK.length * CHUNKS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a server that never sends headers is cut off by the header budget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "biblio-deadline-"));
  try {
    const started = Date.now();
    // The reason has to name the budget that fired, not the transport's own
    // "operation was aborted": the caller acts on which silence killed it.
    await assert.rejects(downloadToFile(`${base}/no-headers`, join(dir, "book.bin")), (error) => {
      assert.match(error.message, /no response headers within 150 ms \(BIBLIO_DOWNLOAD_TIMEOUT_MS\)/);
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `header budget is 150ms, took ${elapsed}ms`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a body that goes silent is cut off by the idle watchdog, not the header budget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "biblio-deadline-"));
  try {
    const started = Date.now();
    await assert.rejects(downloadToFile(`${base}/stalled-body`, join(dir, "book.bin")), (error) => {
      assert.match(error.message, /transfer stalled for 1000 ms after \d+ bytes \(BIBLIO_DOWNLOAD_STALL_MS\)/);
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 900 && elapsed < 3000, `idle budget is 1000ms, took ${elapsed}ms`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
