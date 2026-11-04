// W2-6: one malformed link must not discard the others on a page.
// W2-7: a lookup that produced nothing usable is reported as a failed call.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";
import { withMcpClient } from "./helpers/mcp.mjs";

const md5 = "b".repeat(32);
const missing = "c".repeat(32);

const server = createServer((req, res) => {
  if (req.url === "/" ) {
    res.writeHead(200, { "content-type": "text/html" }).end("<title>Anna’s Archive</title>");
    return;
  }
  if (req.url === `/md5/${md5}`) {
    // The first download href is malformed (invalid IPv6 literal); the second is fine.
    res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(`
      <html><head><title>Anna’s Archive</title></head><body>
        <h1>Good Book</h1>
        <a href="http://[bad/slow_download/broken">Download now</a>
        <a href="/slow_download/${md5}/0/0">Download now</a>
      </body></html>`);
    return;
  }
  res.writeHead(404, { "content-type": "text/html" }).end("<html>Not found</html>");
});
const base = await listenLocal(server);
process.env.BIBLIO_ANNAS_MIRRORS = base;
process.env.BIBLIO_LIBGEN_MIRRORS = base;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "2000";
delete process.env.BIBLIO_ANNAS_API_KEY;

const { absoluteUrl } = await import("../dist/parse.js");
const annas = await import("../dist/providers/annas.js");
const { createServer: createMcpServer } = await import("../dist/server.js");

test.after(() => closeServer(server));

async function call(name, args) {
  return withMcpClient(createMcpServer, async (client) => {
    return await client.callTool({ name, arguments: args });
  }, "test");
}

test("absoluteUrl returns undefined for a malformed href instead of throwing", () => {
  assert.equal(absoluteUrl("http://[bad/x", base), undefined);
  assert.equal(absoluteUrl("", base), undefined);
  assert.equal(absoluteUrl("/get.php?md5=1", base), `${base}/get.php?md5=1`);
});

test("a malformed link on an Anna's detail page is skipped; the valid download survives", async () => {
  const details = await annas.details(md5);
  assert.equal(details.title, "Good Book");
  const urls = details.downloadLinks.map((link) => link.url);
  assert.deepEqual(urls, [`${base}/slow_download/${md5}/0/0`]);
});

test("download_book with no usable direct link is a failed call", async () => {
  const result = await call("download_book", {
    md5,
    output_dir: "/tmp/biblio-w27-unused",
  });
  // The page has no get.php link, so nothing is direct: the tool must say so as an error.
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /"saved": false/);
});

test("book_details for a record no source has is a failed call, not an empty book", async () => {
  const result = await call("book_details", { md5: missing });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /"title": ""/);
});
