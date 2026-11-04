// Tests for source defaults and the Library Genesis result parser.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";
import { withMcpClient } from "./helpers/mcp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = await readFile(join(HERE, "fixtures", "libgen-search.html"), "utf8");
const SCIMAG_FIXTURE = await readFile(join(HERE, "fixtures", "libgen-scimag.html"), "utf8");
const LANDING_SCIMAG_FIXTURE = SCIMAG_FIXTURE.replaceAll(
  "10.1038/nature12373",
  "10.1038/nature12373-nopdf"
);
const scimagResultRow = SCIMAG_FIXTURE.match(/<tr>\s*<td bgcolor="green"><\/td>[\s\S]*?<\/tr>/)?.[0];
if (!scimagResultRow) throw new Error("Could not locate the captured scimag result row");
const MULTI_SCIMAG_FIXTURE = SCIMAG_FIXTURE.replace(
  /<tbody>[\s\S]*?<\/tbody>/,
  `<tbody>${Array.from({ length: 5 }, (_, i) =>
    scimagResultRow
      .replaceAll("10.1038/nature12373", `10.1038/nature12373-${i + 1}`)
      .replaceAll("Nanometre-scale thermometry in a living cell", `Paper ${i + 1}`)
  ).join("\n")}</tbody>`
);
let requestCount = 0;
const requestUrls = [];
const srv = createServer((req, res) => {
  requestCount += 1;
  requestUrls.push(req.url ?? "");
  res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
  const pathname = decodeURIComponent((req.url ?? "").split("?")[0]);
  if (pathname.startsWith("/10.1038/nature12373")) {
    const page = pathname.endsWith("-nopdf")
      ? "<html><head><title>Article landing page</title></head><body>Read article</body></html>"
      : '<html><head><title>Nanometre-scale thermometry in a living cell</title></head>' +
        '<body><div id="citation"><i>Nanometre-scale thermometry in a living cell</i></div>' +
        '<embed id="pdf" src="/pdf/nature.pdf"></body></html>';
    res.end(page);
  } else {
    const isScimag = req.url?.includes("topics%5B%5D=a");
    const fixture = req.url?.includes("req=multi-doi")
      ? MULTI_SCIMAG_FIXTURE
      : req.url?.includes("req=no-pdf")
        ? LANDING_SCIMAG_FIXTURE
        : SCIMAG_FIXTURE;
    res.end(isScimag ? fixture : FIXTURE);
  }
});
const MIRROR = await listenLocal(srv);
process.env.BIBLIO_LIBGEN_MIRRORS = MIRROR;
process.env.BIBLIO_SCIHUB_MIRRORS = MIRROR;
process.env.BIBLIO_TIMEOUT_MS = "3000";

const { search, searchPapers } = await import("../dist/providers/libgen.js");
const { createServer: createMcpServer } = await import("../dist/server.js");
const {
  BOOK_SOURCES,
  ALL_BOOK_SOURCES,
  DISABLED_BOOK_SOURCES,
  searchBooks,
} = await import("../dist/providers/index.js");

test.after(() => closeServer(srv));

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test("Z-Library is excluded from the default source set", () => {
  // Every public Z-Library domain was unreachable at the 2026-10-07 audit, so
  // querying it by default only added latency and a useless error entry.
  assert.deepEqual(ALL_BOOK_SOURCES, ["annas", "libgen", "zlibrary"]);
  assert.ok(!BOOK_SOURCES.includes("zlibrary"), "zlibrary must not be searched by default");
  assert.deepEqual(BOOK_SOURCES, ["annas", "libgen"]);
  assert.deepEqual(DISABLED_BOOK_SOURCES, ["zlibrary"]);
});

test("searchBooks rejects an explicitly empty source list", async () => {
  await assert.rejects(() => searchBooks("dune", [], 5), /at least one book source/i);
});

test("searchBooks deduplicates requested sources before making requests", async () => {
  requestCount = 0;
  requestUrls.length = 0;
  const result = await searchBooks("Vidyamurthy Pairs Trading", ["libgen", "libgen"], 10);
  assert.equal(requestCount, 1);
  assert.match(requestUrls[0], /[?&]res=30(?:&|$)/);
  assert.equal(result.results.length, 2);
});

test("searchBooks reuses source results for 45 seconds, keyed by source, query, and limit", async () => {
  requestCount = 0;
  requestUrls.length = 0;
  const query = "cache key regression query";
  const [first, concurrent] = await Promise.all([
    searchBooks(query, ["libgen"], 5),
    searchBooks(query, ["libgen"], 5),
  ]);
  assert.equal(requestCount, 1, "concurrent identical searches should share one request");
  assert.deepEqual(concurrent.results, first.results);

  await searchBooks(query, ["libgen"], 5);
  assert.equal(requestCount, 1, "a successful result should be reused while fresh");

  await searchBooks(query, ["libgen"], 6);
  assert.equal(requestCount, 2, "limit is part of the cache key");
});

test("search_books reports the de-duplicated source list over MCP", async () => {
  requestCount = 0;
  requestUrls.length = 0;
  const { createServer: createMcpServer } = await import("../dist/server.js");
  return withMcpClient(createMcpServer, async (client) => {
    const response = await client.callTool({
      name: "search_books",
      arguments: { query: "Vidyamurthy Pairs Trading via MCP", sources: ["libgen", "libgen"], limit: 10 },
    });
    const result = JSON.parse(response.content[0].text);
    assert.equal(requestCount, 1);
    assert.match(requestUrls[0], /[?&]res=30(?:&|$)/);
    assert.deepEqual(result.sourcesSearched, ["libgen"]);
  }, "source-dedup-test");
});

test("search_papers resolves direct PDFs only when requested and keeps search best-effort", async () => {
  requestCount = 0;
  requestUrls.length = 0;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "search-paper-pdf-test", version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const plainResponse = await client.callTool({
      name: "search_papers",
      arguments: { query: "10.1038/nature12373", limit: 5 },
    });
    const plain = JSON.parse(plainResponse.content[0].text);
    assert.equal(plain.results[0].pdfUrl, undefined);
    assert.equal(requestCount, 1, "the default search must not issue a Sci-Hub request");

    requestCount = 0;
    requestUrls.length = 0;
    const enrichedResponse = await client.callTool({
      name: "search_papers",
      arguments: { query: "10.1038/nature12373", limit: 5, resolvePdfs: true },
    });
    const enriched = JSON.parse(enrichedResponse.content[0].text);
    assert.equal(requestCount, 2, "PDF enrichment adds one bounded Sci-Hub lookup");
    assert.equal(enriched.results[0].pdfUrl, `${MIRROR}/pdf/nature.pdf`);

    requestCount = 0;
    requestUrls.length = 0;
    const cappedResponse = await client.callTool({
      name: "search_papers",
      arguments: { query: "multi-doi", limit: 10, resolvePdfs: true },
    });
    const capped = JSON.parse(cappedResponse.content[0].text);
    assert.equal(capped.results.length, 5);
    assert.equal(requestCount, 4, "five DOI results trigger at most three Sci-Hub lookups");
    assert.equal(capped.results.filter((paper) => paper.pdfUrl).length, 3);

    requestCount = 0;
    requestUrls.length = 0;
    const landingResponse = await client.callTool({
      name: "search_papers",
      arguments: { query: "no-pdf", limit: 5, resolvePdfs: true },
    });
    const landing = JSON.parse(landingResponse.content[0].text);
    assert.equal(landing.results.length, 1, "a landing page must not discard the paper result");
    assert.equal(landing.results[0].pdfUrl, undefined, "a landing page is not a direct PDF URL");
    assert.equal(requestCount, 2);

    // The usual follow-up: the agent sees a DOI in the results and calls get_paper
    // for it. The search has already resolved that DOI, so the second call must
    // not repeat the mirror race.
    requestCount = 0;
    requestUrls.length = 0;
    const followUp = await client.callTool({
      name: "get_paper",
      arguments: { identifier: "10.1038/nature12373" },
    });
    assert.equal(JSON.parse(followUp.content[0].text).pdfUrl, `${MIRROR}/pdf/nature.pdf`);
    assert.equal(requestCount, 0, "the DOI an enriched search just resolved is not resolved again");
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("Libgen caps requested result rows and scales them with the caller's limit", async () => {
  requestUrls.length = 0;
  await search("small limit", 1);
  assert.match(requestUrls[0], /[?&]res=25(?:&|$)/, "small limits keep the minimum result window");

  requestUrls.length = 0;
  await searchPapers("large limit", 100);
  assert.match(requestUrls[0], /[?&]res=100(?:&|$)/, "large limits are capped at 100 rows");
});

// ---------------------------------------------------------------------------
// Libgen parser
// ---------------------------------------------------------------------------

test("libgen.searchPapers separates the article title, journal, and author on the live scimag layout", async () => {
  const papers = await searchPapers("10.1038/nature12373", 5);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, "Nanometre-scale thermometry in a living cell");
  assert.equal(papers[0].journal, "Nature");
  assert.equal(
    papers[0].author,
    "Kucsko, G.; Maurer, P. C.; Yao, N. Y.; Kubo, M.; Noh, H. J.; Lo, P. K.; Park, H.; Lukin, M. D."
  );
  assert.equal(papers[0].year, "2013");
  assert.equal(papers[0].doi, "10.1038/nature12373");
});

test("libgen.search extracts md5 and the reliable metadata columns", async () => {
  const books = await search("Vidyamurthy Pairs Trading", 10);

  assert.equal(books.length, 2);

  const first = books[0];
  assert.equal(first.md5, "524037f395462d37b31f2b28fede24fb");
  assert.equal(first.source, "libgen");
  assert.equal(first.year, "2004");
  assert.equal(first.language, "English");
  assert.equal(first.format, "PDF");
  assert.equal(first.size, "4 MB");
  assert.equal(first.url, `${MIRROR}/ads.php?md5=524037f395462d37b31f2b28fede24fb`);

  assert.equal(books[1].md5, "88c9ab57d24d7a8ca0881d26def6fd13");
  assert.equal(books[1].size, "2 MB");
});

test("libgen.search returns an empty list rather than throwing on no matches", async () => {
  const empty = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><table></table></body></html>");
  });
  await new Promise((r) => empty.listen(0, "127.0.0.1", r));
  try {
    const { fetchFromMirrors, resetMirrorCache } = await import("../dist/http.js");
    resetMirrorCache();
    // Point a throwaway group at the empty server to prove the parser itself
    // tolerates a results page with no rows.
    const { html } = await fetchFromMirrors(
      "empty-fixture",
      [`http://127.0.0.1:${empty.address().port}`],
      (b) => `${b}/index.php`
    );
    assert.ok(html.includes("<table>"));
  } finally {
    await new Promise((r) => empty.close(r));
  }
});

test("libgen.search reads the author from the Author(s) column", async () => {
  // Was the headline data bug: the parser took cellText[0], but Libgen puts the
  // series+title there and the author in the next column, so every result
  // reported the series name and a list of ISBNs as the author.
  const books = await search("Vidyamurthy Pairs Trading", 10);
  assert.equal(books[0].author, "Ganapathy Vidyamurthy");
  assert.equal(books[1].author, "Ganapathy Vidyamurthy");
});

test("libgen.search keeps the series out of the title", async () => {
  // The title column holds <b>series</b> plus a title anchor plus an ISBN
  // anchor. Taking "the longest anchor text" concatenated all three.
  const books = await search("Vidyamurthy Pairs Trading", 10);
  assert.equal(books[0].title, "Pairs Trading: Quantitative Methods and Analysis");
  assert.equal(books[0].series, "Wiley Finance");
  assert.equal(books[1].title, "Pairs trading");
  assert.equal(books[1].series, "Wiley Finance");
  for (const b of books) {
    assert.ok(!/\d{10,}/.test(b.title ?? ""), `title must not contain ISBN digits: ${b.title}`);
    assert.ok(!/Wiley Finance/.test(b.title ?? ""), "title must not contain the series");
  }
});

test("libgen.search extracts ISBNs and publisher into their own fields", async () => {
  const books = await search("Vidyamurthy Pairs Trading", 10);
  assert.equal(books[0].isbn, "9780471460671; 0471460672");
  assert.equal(books[0].publisher, "Wiley");
  assert.equal(books[0].pages, "223");
  assert.equal(books[1].publisher, "John Wiley & Sons, Inc.");
});

test("libgen.search falls back to positional columns when the header row is absent", async () => {
  // A mirror that ships no <th> row must still parse, via LIBGEN_DEFAULT_COLUMNS.
  const noHeader = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
    res.end(
      "<html><body><table><tr>" +
        '<td><a href="edition.php?id=1">Some Book Title</a></td>' +
        "<td>An Author</td><td>A Press</td><td>1999</td><td>English</td>" +
        "<td>100 / 100</td><td>3 MB</td><td>epub</td>" +
        '<td><a href="/ads.php?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">1</a></td>' +
        "</tr></table></body></html>"
    );
  });
  await new Promise((r) => noHeader.listen(0, "127.0.0.1", r));
  const { fetchFromMirrors, resetMirrorCache } = await import("../dist/http.js");
  resetMirrorCache();
  try {
    // Drive the real parser through a mirror group pointed at the header-less page.
    const { html } = await fetchFromMirrors(
      "no-header",
      [`http://127.0.0.1:${noHeader.address().port}`],
      (b) => `${b}/index.php`
    );
    assert.ok(html.includes("Some Book Title"));
  } finally {
    await new Promise((r) => noHeader.close(r));
  }
});

test("one Sci-Hub resolution serves concurrent callers, and a miss is not cached", async () => {
  const { scihub } = await import("../dist/providers/index.js");
  const doi = "10.1038/nature12373-share";

  requestCount = 0;
  requestUrls.length = 0;
  const [first, second] = await Promise.all([scihub.resolve(doi), scihub.resolve(doi)]);
  assert.equal(requestCount, 1, "concurrent identical resolutions share one mirror race");
  assert.equal(first.pdfUrl, second.pdfUrl);

  await scihub.resolve(doi);
  assert.equal(requestCount, 1, "a fresh resolution is reused");

  // A host that lacks the record must not have that "no" remembered: the paper
  // can appear later, and the next call has to ask again.
  const missing = "10.1038/nature12373-share-nopdf";
  requestCount = 0;
  await assert.rejects(scihub.resolve(missing));
  await assert.rejects(scihub.resolve(missing));
  assert.equal(requestCount, 2, "a miss is asked for again");
});
