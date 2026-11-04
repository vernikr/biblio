// Parser integration tests against HTML captured from live providers. All
// requests are served by the loopback fixture server; this test never uses the
// external network.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(join(HERE, "fixtures", name), "utf8");
const [booksHtml, scimagHtml, adsHtml, scihubHtml] = await Promise.all([
  fixture("libgen-books.html"),
  fixture("libgen-scimag.html"),
  fixture("libgen-ads.html"),
  fixture("scihub-doi.html"),
]);

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://fixture").pathname);
  let html;
  if (path === "/index.php" && req.url?.includes("topics%5B%5D=a")) html = scimagHtml;
  else if (path === "/index.php" && req.url?.includes("Vidyamurthy")) html = booksHtml;
  else if (path === "/ads.php") html = adsHtml;
  else if (path.startsWith("/10.1038/nature12373")) html = scihubHtml;

  if (!html) {
    res.writeHead(404, { "content-type": "text/plain" }).end("fixture not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(html);
});
const mirror = await listenLocal(server);
process.env.BIBLIO_LIBGEN_MIRRORS = mirror;
process.env.BIBLIO_SCIHUB_MIRRORS = mirror;
process.env.BIBLIO_TIMEOUT_MS = "1500";
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";

const libgen = await import("../dist/providers/libgen.js");
const scihub = await import("../dist/providers/scihub.js");

test.after(() => closeServer(server));

test("Libgen book search parses the captured live table", async () => {
  const books = await libgen.search("Vidyamurthy Pairs Trading", 10);
  const book = books.find((item) => item.md5 === "524037f395462d37b31f2b28fede24fb");
  assert.ok(book);
  assert.equal(book.title, "Pairs Trading: Quantitative Methods and Analysis");
  assert.equal(book.author, "Ganapathy Vidyamurthy");
  assert.equal(book.publisher, "Wiley");
  assert.equal(book.year, "2004");
});

test("Libgen article search parses the captured live scimag table", async () => {
  const papers = await libgen.searchPapers("10.1038/nature12373", 5);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, "Nanometre-scale thermometry in a living cell");
  assert.equal(papers[0].journal, "Nature");
  assert.equal(papers[0].author, "Kucsko, G.; Maurer, P. C.; Yao, N. Y.; Kubo, M.; Noh, H. J.; Lo, P. K.; Park, H.; Lukin, M. D.");
  assert.equal(papers[0].year, "2013");
  assert.equal(papers[0].doi, "10.1038/nature12373");
});

test("Libgen details parses the captured ads.php BibTeX and download URL", async () => {
  const book = await libgen.details("524037f395462d37b31f2b28fede24fb");
  assert.equal(book.title, "Pairs Trading: Quantitative Methods and Analysis");
  assert.equal(book.series, "Wiley Finance");
  assert.equal(book.author, "Ganapathy Vidyamurthy");
  assert.equal(book.publisher, "Wiley");
  assert.equal(book.year, "2004");
  assert.ok(book.downloadLinks.some((link) => link.url.includes("get.php?md5=524037f395462d37b31f2b28fede24fb")));
});

test("Sci-Hub resolves the PDF from the captured DOI page", async () => {
  const paper = await scihub.resolve("10.1038/nature12373");
  assert.match(paper.title, /Nanometre-scale thermometry in a living cell/);
  assert.equal(paper.doi, "10.1038/nature12373");
  assert.equal(paper.pdfUrl, "https://sci.bban.top/pdf/10.1038/nature12373.pdf");
});
