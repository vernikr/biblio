import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";
import { withMcpClient } from "./helpers/mcp.mjs";

let requests = [];
const mirrorServer = createServer((req, res) => {
  requests.push(req.url);
  res.writeHead(200, { "content-type": "text/html" }).end(
    '<title>Library Genesis / Sci-Hub</title><embed id="pdf" src="/paper.pdf">'
  );
});
const mirror = await listenLocal(mirrorServer);
process.env.BIBLIO_LIBGEN_MIRRORS = mirror;
process.env.BIBLIO_ANNAS_MIRRORS = mirror;
process.env.BIBLIO_SCIHUB_MIRRORS = mirror;
process.env.BIBLIO_ZLIB_MIRRORS = mirror;
process.env.BIBLIO_TIMEOUT_MS = "1000";
delete process.env.BIBLIO_ANNAS_API_KEY;
const { createServer: createMcpServer } = await import("../dist/server.js");
test.after(() => closeServer(mirrorServer));

async function call(name, args) {
  return withMcpClient(createMcpServer, async (client) => {
    return await client.callTool({ name, arguments: args });
  }, "input-test");
}

const searches = [
  ["search_books", "query", { sources: ["libgen"] }],
  ["search_papers", "query", {}],
  ["get_paper", "identifier", {}],
];
for (const [name, field, extra] of searches) {
  for (const blank of ["", " \t\n "]) {
    test(`${name} refuses ${JSON.stringify(blank)} before any provider request`, async () => {
      requests = [];
      const result = await call(name, { ...extra, [field]: blank });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, new RegExp(field));
      assert.match(result.content[0].text, /Example:/);
      assert.doesNotMatch(result.content[0].text, /_parse is not a function/);
      assert.deepEqual(requests, []);
    });
  }
}

for (const [name, field, extra] of searches.slice(0, 2)) {
  test(`${name} trims a non-empty query without changing its contents`, async () => {
    const result = await call(name, { ...extra, [field]: "  dune frank herbert  " });
    assert.notEqual(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).query, "dune frank herbert");
  });
}
for (const identifier of ["10.1234/input-test", "https://example.test/article/input-test"]) {
  test(`get_paper preserves ${identifier} after trimming`, async () => {
    requests = [];
    const result = await call("get_paper", { identifier: ` ${identifier} ` });
    assert.notEqual(result.isError, true);
    assert.ok(requests.includes(`/${encodeURIComponent(identifier)}`));
    assert.equal(JSON.parse(result.content[0].text).pdfUrl, `${mirror}/paper.pdf`);
  });
}

// ---------------------------------------------------------------------------
// The sentence an agent reads for a bad call (iteration 2, A7)
// ---------------------------------------------------------------------------

// One extractor asks the tool's own schema, so these shapes are the whole
// contract: name the field, say what is wrong, show a call that works.
const BAD_CALLS = [
  ["book_details", {}, /^book_details: "md5" is missing\./],
  ["book_details", { md5: 123 }, /^book_details: "md5" invalid input: expected string, received number\./],
  ["book_details", { md5: "nothex" }, /^book_details: "md5" must be a 32-char MD5 hash\./],
  ["search_books", { query: "x", limit: 9999 }, /^search_books: "limit" too big: expected number to be <=100\./],
  [
    "search_books",
    { query: "x", sources: ["bogus"] },
    /^search_books: "sources\[0\]" invalid option: expected one of "annas"\|"libgen"\|"zlibrary"\./,
  ],
  ["fetch_book", { query: "  " }, /^fetch_book: "query" too small: expected string to have >=1 characters\./],
];
for (const [name, args, expected] of BAD_CALLS) {
  test(`${name} explains ${JSON.stringify(args)} without the SDK's own error text`, async () => {
    requests = [];
    const result = await call(name, args);
    assert.equal(result.isError, true);
    const text = String(result.content[0].text);
    assert.match(text, expected);
    assert.match(text, /Schema: /);
    assert.match(text, /Example: /);
    assert.doesNotMatch(text, /Input validation error/);
    assert.doesNotMatch(text, /_parse is not a function/);
    assert.deepEqual(requests, []);
  });
}

test("the sentence does not depend on how the SDK words its own failure", async () => {
  // The extractor used to parse the SDK's error string, so a reworded SDK
  // upgrade silently returned raw text to agents. The tool's own schema is what
  // answers now, whatever the SDK does with the same call.
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const original = McpServer.prototype.validateToolInput;
  McpServer.prototype.validateToolInput = async () => {
    throw new Error("validation blew up");
  };
  try {
    const result = await call("book_details", { md5: "nothex" });
    assert.equal(result.isError, true);
    assert.match(String(result.content[0].text), /^book_details: "md5" must be a 32-char MD5 hash\./);
  } finally {
    McpServer.prototype.validateToolInput = original;
  }
});
