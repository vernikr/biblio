import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as cheerio from "cheerio";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

const md5 = "a".repeat(32);
const repeatMd5 = "b".repeat(32);
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://fixture");
  const pages = {
    "/search": `<html><title>Anna's Archive</title><a href="/md5/${md5}"><h3>Relative book</h3><img src="//images.example/cover.jpg"></a></html>`,
    [`/md5/${md5}`]: `<html><title>Anna's Archive</title><h1>Relative book</h1><a href="//cdn.example/download/book.pdf">Download PDF</a></html>`,
    [`/md5/${repeatMd5}`]:
      `<html><title>Anna's Archive</title><h1>Repeated</h1>` +
      `<a href="/download/one">Download now</a>` +
      `<a href="/download/one"></a>` +
      `<a href="/about">About this record</a></html>`,
    "/relative-paper": `<html><title>Test paper</title><div id="article"><embed id="pdf" src="//files.example/paper.pdf#page=1"></div></html>`,
    "/s/relative-url-test": `<z-bookcard title="Z book" href="//books.example/book/1" author="A. N. Author"></z-bookcard>`,
  };
  const body = pages[pathname];
  if (!body) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" }).end(body);
});
const mirror = await listenLocal(server);
process.env.BIBLIO_ANNAS_MIRRORS = mirror;
process.env.BIBLIO_LIBGEN_MIRRORS = mirror;
process.env.BIBLIO_SCIHUB_MIRRORS = mirror;
process.env.BIBLIO_ZLIB_MIRRORS = mirror;
process.env.BIBLIO_TIMEOUT_MS = "1000";
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";

const [annas, libgen, scihub, zlibrary] = await Promise.all([
  import("../dist/providers/annas.js"),
  import("../dist/providers/libgen.js"),
  import("../dist/providers/scihub.js"),
  import("../dist/providers/zlibrary.js"),
]);

test.after(() => closeServer(server));

test("Anna's Archive resolves protocol-relative image and download URLs", async () => {
  const [book] = await annas.search("relative", 1);
  assert.equal(book.coverUrl, "http://images.example/cover.jpg");

  const details = await annas.details(md5);
  assert.equal(details.downloadLinks[0].url, "http://cdn.example/download/book.pdf");
});

test("Libgen resolves protocol-relative and path-relative download URLs", async () => {
  const links = libgen.extractDownloadLinks(
    cheerio.load(
      `<a href="//cdn.example/download/book.epub">Download EPUB</a>` +
        `<a href="get.php?md5=${md5}">get.php</a>`
    ),
    mirror
  );
  assert.equal(links[0].url, "http://cdn.example/download/book.epub");
  assert.equal(links[1].url, `${mirror}/get.php?md5=${md5}`);
});

test("Sci-Hub resolves a protocol-relative PDF URL and strips its fragment", async () => {
  const paper = await scihub.resolve("relative-paper");
  assert.equal(paper.pdfUrl, "http://files.example/paper.pdf");
});

test("Z-Library resolves protocol-relative book URLs", async () => {
  const [book] = await zlibrary.search("relative-url-test", 1);
  assert.equal(book.url, "http://books.example/book/1");
});

test("the shared anchor pass keeps each provider's own rule for repeated links", async () => {
  // Anna's Archive lists what the page lists: two anchors to one URL are two
  // links, and an anchor without text still gets a label.
  const repeat = await annas.details(repeatMd5);
  assert.deepEqual(
    repeat.downloadLinks.map((l) => [l.label, l.url]),
    [
      ["Download now", `${mirror}/download/one`],
      ["download", `${mirror}/download/one`],
    ]
  );

  // Libgen names the same URL once, in the order the page gives it.
  const heap = cheerio.load(
    `<a href="get.php?md5=${md5}">get.php</a><a href="get.php?md5=${md5}">get.php</a>` +
      `<a href="about">About</a>`
  );
  assert.deepEqual(
    libgen.extractDownloadLinks(heap, mirror).map((l) => l.url),
    [`${mirror}/get.php?md5=${md5}`]
  );
});
