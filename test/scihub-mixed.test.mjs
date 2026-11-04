// A Sci-Hub mirror that answers 200 without a PDF is a miss for this record,
// not a dead host. A healthy mirror that does have the PDF must still win.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const articlePage = await readFile(join(FIXTURES, "scihub-doi.html"), "utf8");
const noPdfPage = await readFile(join(FIXTURES, "scihub-no-pdf.html"), "utf8");

// Mutable per test: how long the article mirror waits, and what the second mirror serves.
const state = { articleDelayMs: 250, secondServes: "no-pdf" };
const emptyMirror = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(noPdfPage);
});
const articleMirror = createServer((_req, res) => {
  const body = state.secondServes === "article" ? articlePage : noPdfPage;
  setTimeout(() => {
    res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(body);
  }, state.articleDelayMs);
});
const emptyBase = await listenLocal(emptyMirror);
const articleBase = await listenLocal(articleMirror);

process.env.BIBLIO_SCIHUB_MIRRORS = `${emptyBase},${articleBase}`;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "2000";

const { scihub } = await import("../dist/providers/index.js");
const { resetMirrorCache, mirrorCacheSnapshot, ResourceNotFoundError } = await import("../dist/http.js");
const { resetSourceCircuits } = await import("../dist/providers/circuit.js");

test.beforeEach(() => {
  resetMirrorCache();
  resetSourceCircuits();
  state.articleDelayMs = 250;
  state.secondServes = "article";
});
test.after(async () => {
  await Promise.all([closeServer(emptyMirror), closeServer(articleMirror)]);
});

test("a no-PDF mirror that answers first does not stop the mirror that has the PDF", async () => {
  const paper = await scihub.resolve("10.1038/nature12373");
  assert.ok(paper.url?.startsWith(articleBase), `served by the article mirror, got ${paper.url}`);
  assert.match(paper.pdfUrl ?? "", /\.pdf/);
});

test("a no-PDF answer is a record miss: its host is not put into cooldown", async () => {
  await scihub.resolve("10.1038/nature12373");
  assert.equal(
    mirrorCacheSnapshot().dead.includes(emptyBase),
    false,
    "a healthy host that lacks one record must stay available"
  );
});

test("when every mirror lacks the PDF, the result is a missing record, not a paper", async () => {
  state.articleDelayMs = 0;
  state.secondServes = "no-pdf";
  await assert.rejects(scihub.resolve("10.1126/science.1243094"), (error) => {
    assert.ok(error instanceof ResourceNotFoundError, `got ${error?.name}: ${error?.message}`);
    assert.match(error.message, /no PDF/);
    return true;
  });
  assert.deepEqual(mirrorCacheSnapshot().dead, [], "record misses cool no host down");
});
