// Z-Library parser tests run against a local mirror so no external network is used.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

const html = `<!doctype html><html><body>
  <z-bookcard title="A valid result" author="Ada Lovelace" year="2024" extension="pdf" filesize="4.5 MB">
    <a href="/book/one">A valid result</a>
  </z-bookcard>
  <z-bookcard title="Bad metadata" author="Grace Hopper" year="9780471460671" extension="unknown" filesize="00264mB">
    <a href="/book/two">Bad metadata</a>
  </z-bookcard>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
  res.end(html);
});
const mirror = await listenLocal(server);
process.env.BIBLIO_ZLIB_MIRRORS = mirror;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "1000";

const { search } = await import("../dist/providers/zlibrary.js");

test.after(() => closeServer(server));

test("zlibrary.search validates its parsed year, format, and size", async () => {
  const books = await search("example", 5);
  assert.equal(books.length, 2);
  assert.deepEqual(
    { year: books[0].year, format: books[0].format, size: books[0].size },
    { year: "2024", format: "PDF", size: "4.5 MB" }
  );
  assert.deepEqual(
    { year: books[1].year, format: books[1].format, size: books[1].size },
    { year: undefined, format: undefined, size: undefined }
  );
});
