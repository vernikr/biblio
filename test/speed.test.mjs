// Speed-path guarantees, each measured with a slow mirror that records whether
// the client cancelled it. A cancelled request is the real cost we are removing.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const articlePage = await readFile(join(FIXTURES, "scihub-doi.html"), "utf8");

const md5 = "e".repeat(32);
const cdnUrl = "https://cdn.example.test/dl/fast/book.epub";
const identity = "<title>Anna’s Archive</title>";

/** A route that answers after `ms`, and remembers whether the client gave up first. */
function slowRoute(ms, body) {
  const state = { requests: 0, cancelled: 0 };
  const handler = (req, res) => {
    state.requests += 1;
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      if (!res.writableEnded) res.writeHead(200, { "content-type": "application/json" }).end(body);
    }, ms);
    req.on("close", () => {
      if (!done) {
        state.cancelled += 1;
        clearTimeout(timer);
      }
    });
  };
  return { state, handler };
}

const slowDetails = slowRoute(3000, "<html>slow details</html>");
const slowApiS1 = slowRoute(3000, "{}");

const s1 = createServer((req, res) => {
  const url = req.url ?? "";
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(identity);
  if (url.startsWith(`/md5/${md5}`)) return slowDetails.handler(req, res);
  if (url.startsWith("/dyn/api/fast_download.json")) return slowApiS1.handler(req, res);
  if (url.startsWith(`/ads.php?md5=${md5}`)) {
    return res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(
      `<html><body>Library Genesis <a href="get.php?md5=${md5}&key=K">GET</a> ` +
        `@book{book:1, title={Fast Libgen Book}, author={Tester}}</body></html>`
    );
  }
  res.writeHead(404).end("nf");
});

const s2 = createServer((req, res) => {
  const url = req.url ?? "";
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(identity);
  if (url.startsWith(`/md5/${md5}`)) return slowDetails.handler(req, res);
  if (url.startsWith("/dyn/api/fast_download.json")) {
    return res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ download_url: cdnUrl, account_fast_download_info: { downloads_left: 1 } })
    );
  }
  res.writeHead(404).end("nf");
});

let scihubHits = 0;
const s3 = createServer((_req, res) => {
  scihubHits += 1;
  setTimeout(() => {
    if (!res.writableEnded) res.writeHead(200, { "content-type": "text/html" }).end(articlePage);
  }, 400);
});

await Promise.all([s1, s2, s3].map((s) => new Promise((resolve) => s.listen(0, "127.0.0.1", resolve))));
const b1 = `http://127.0.0.1:${s1.address().port}`;
const b2 = `http://127.0.0.1:${s2.address().port}`;
const b3 = `http://127.0.0.1:${s3.address().port}`;
process.env.BIBLIO_ANNAS_MIRRORS = `${b1},${b2}`;
process.env.BIBLIO_LIBGEN_MIRRORS = b1;
process.env.BIBLIO_SCIHUB_MIRRORS = b3;
process.env.BIBLIO_ANNAS_API_KEY = "speed-test-key";
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "5000";

const annas = await import("../dist/providers/annas.js");
const providers = await import("../dist/providers/index.js");
const circuit = await import("../dist/providers/circuit.js");
const { resolvePaperPdfs } = await import("../dist/server.js");

test.after(() => {
  for (const s of [s1, s2, s3]) {
    s.closeAllConnections();
    s.close();
  }
});

const waitFor = async (check, ms = 1500) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
};

test("book_details returns as soon as Libgen answers, and cancels the slower Anna's request", async () => {
  const started = Date.now();
  const details = await providers.bookDetails(md5);
  const elapsed = Date.now() - started;

  assert.equal(details.resolvedVia, "libgen");
  assert.equal(details.title, "Fast Libgen Book");
  assert.ok(elapsed < 1500, `returned in ${elapsed} ms; it should not wait for Anna's`);
  assert.equal(
    await waitFor(() => slowDetails.state.cancelled >= 1),
    true,
    "the losing Anna's detail request must be cancelled, not left running"
  );
  assert.equal(circuit.sourceCircuitMessage("annas"), undefined, "a cancellation is not a source failure");
});

test("the member fast-download races verified mirrors and cancels the rest", async () => {
  const started = Date.now();
  const link = await annas.fastDownload(md5);
  const elapsed = Date.now() - started;

  assert.ok(link, "a verified mirror must answer");
  assert.equal(link.url, cdnUrl);
  assert.ok(elapsed < 1500, `answered in ${elapsed} ms; sequential tries would wait for the slow mirror`);
  assert.equal(
    await waitFor(() => slowApiS1.state.cancelled >= 1),
    true,
    "the slower member request must be cancelled once a link is found"
  );
});

test("Sci-Hub enrichment runs its three lookups in parallel, not one after another", async () => {
  const papers = ["10.1038/a", "10.1038/b", "10.1038/c"].map((doi, i) => ({
    source: "libgen",
    title: `Paper ${i}`,
    doi,
  }));
  const before = scihubHits;
  const started = Date.now();
  const enriched = await resolvePaperPdfs(papers);
  const elapsed = Date.now() - started;

  assert.equal(scihubHits - before, 3, "exactly the capped number of lookups");
  assert.ok(elapsed < 900, `took ${elapsed} ms; three 400 ms lookups in series would take 1200 ms`);
  assert.ok(enriched.every((paper) => paper.pdfUrl), "each paper gets its PDF");
});
