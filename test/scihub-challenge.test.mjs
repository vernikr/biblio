// A16: Sci-Hub can answer HTTP 200 with a human-verification (ALTCHA) page.
// That page must never count as an article: the resolver moves on to a mirror
// that serves the paper, and says why when every mirror challenges.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const challengePage = await readFile(join(FIXTURES, "scihub-altcha.html"), "utf8");
const articlePage = await readFile(join(FIXTURES, "scihub-doi.html"), "utf8");

const noPdfPage = await readFile(join(FIXTURES, "scihub-no-pdf.html"), "utf8");

let mode = "mixed"; // "mixed" | "all-challenge" | "no-pdf"
const challengeMirror = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(challengePage);
});
const articleMirror = createServer((_req, res) => {
  const body = { "all-challenge": challengePage, "no-pdf": noPdfPage }[mode] ?? articlePage;
  res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(body);
});
await Promise.all([
  new Promise((resolve) => challengeMirror.listen(0, "127.0.0.1", resolve)),
  new Promise((resolve) => articleMirror.listen(0, "127.0.0.1", resolve)),
]);
const challengeBase = `http://127.0.0.1:${challengeMirror.address().port}`;
const articleBase = `http://127.0.0.1:${articleMirror.address().port}`;

process.env.BIBLIO_SCIHUB_MIRRORS = `${challengeBase},${articleBase}`;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "2000";

const { scihub } = await import("../dist/providers/index.js");
const { resetMirrorCache } = await import("../dist/http.js");

test.after(() => {
  challengeMirror.close();
  articleMirror.close();
});

test("a challenge page on one mirror is skipped in favour of a mirror that serves the article", async () => {
  resetMirrorCache();
  const paper = await scihub.resolve("10.1038/nature12373");
  assert.ok(paper.url?.startsWith(articleBase), `served by the article mirror, got ${paper.url}`);
  assert.match(paper.pdfUrl ?? "", /\.pdf/, "the article's PDF must be returned");
  assert.equal(paper.title.includes("Nanometre-scale thermometry"), true);
});

test("when every mirror answers with a challenge, the error says so instead of returning an empty paper", async () => {
  resetMirrorCache();
  mode = "all-challenge";
  try {
    // A fresh identifier: a resolution is memoized for the short agent loop, so
    // the DOI the previous test resolved would answer from that memory.
    await assert.rejects(
      scihub.resolve("10.1038/nature12373-challenge-only"),
      (error) => {
        assert.match(String(error.message), /human-verification challenge/i);
        return true;
      }
    );
  } finally {
    mode = "mixed";
  }
});

test("a no-PDF page is never returned as a paper, even beside a challenged mirror", async () => {
  // The challenged mirror could not be checked, so "no PDF" is not proven:
  // that is an unavailable outcome, reported as a failure, not a paper.
  const { ResourceNotFoundError } = await import("../dist/http.js");
  resetMirrorCache();
  mode = "no-pdf";
  try {
    await assert.rejects(scihub.resolve("10.1126/science.1243094"), (error) => {
      assert.ok(!(error instanceof ResourceNotFoundError), "an unchecked mirror prevents a not-found claim");
      assert.match(String(error.message), /mirror\(s\) failed|human-verification/i);
      return true;
    });
  } finally {
    mode = "mixed";
  }
});
