// Concurrent and repeated downloads must not corrupt each other's files, and a
// filename the caller chose must never be silently overwritten.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";
import { withMcpClient } from "./helpers/mcp.mjs";

const md5 = "d".repeat(32);
const body = Buffer.concat([Buffer.from("%PDF-1.4 race test "), Buffer.alloc(256 * 1024, 7)]);
let downloadRequests = 0;
let beforeDownload = () => {};

const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/ads.php")) {
    res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(
      `<html><body>Library Genesis <a href="get.php?md5=${md5}&key=K">GET</a> ` +
        `<a href="get.php?md5=${md5}&key=SECOND">GET</a> ` +
        `@book{book:1, title={Race Book}, author={Tester}}</body></html>`
    );
    return;
  }
  if (req.url?.startsWith("/get.php")) {
    downloadRequests += 1;
    await beforeDownload();
    // Slow enough that two calls overlap on disk.
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": body.length });
    res.write(body.subarray(0, body.length / 2));
    setTimeout(() => res.end(body.subarray(body.length / 2)), 150);
    return;
  }
  res.writeHead(404).end("not found");
});
const mirror = await listenLocal(server);
process.env.BIBLIO_LIBGEN_MIRRORS = mirror;
process.env.BIBLIO_ANNAS_MIRRORS = mirror;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "2000";
process.env.BIBLIO_DOWNLOAD_TIMEOUT_MS = "3000";
delete process.env.BIBLIO_ANNAS_API_KEY;

const { createServer: createMcpServer } = await import("../dist/server.js");

test.beforeEach(() => {
  downloadRequests = 0;
  beforeDownload = () => {};
});
test.after(() => closeServer(server));

async function download(args) {
  return withMcpClient(createMcpServer, async (client) => {
    const result = await client.callTool({ name: "download_book", arguments: { md5, ...args } });
    return { isError: result.isError === true, payload: JSON.parse(result.content[0].text) };
  }, "test");
}

test("two concurrent downloads of the same md5 into one directory both succeed intact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-race-"));
  try {
    const [a, b] = await Promise.all([
      download({ output_dir: dir }),
      download({ output_dir: dir }),
    ]);
    assert.equal(a.payload.saved, true, JSON.stringify(a.payload));
    assert.equal(b.payload.saved, true, JSON.stringify(b.payload));
    assert.equal(a.payload.md5MatchesRequest, false, "the fake bytes differ from the catalog md5");
    const written = readFileSync(join(dir, `${md5}.pdf`));
    assert.equal(written.equals(body), true, "the final file is the complete download");
    const leftovers = readdirSync(dir).filter((name) => name.endsWith(".downloading"));
    assert.deepEqual(leftovers, [], "no staging file may be left behind");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a filename that already exists is refused, and the existing file is untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-race-"));
  try {
    const keep = join(dir, "mine.pdf");
    writeFileSync(keep, "my notes, not a book");
    const result = await download({ output_dir: dir, filename: "mine.pdf" });
    assert.equal(result.isError, true);
    assert.match(result.payload.reason, /already exists/);
    assert.equal(readFileSync(keep, "utf8"), "my notes, not a book");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a filename created after the precheck is preserved without retrying the download", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-race-"));
  const keep = join(dir, "mine.pdf");
  beforeDownload = () => writeFileSync(keep, "created while the download was running");
  try {
    const result = await download({ output_dir: dir, filename: "mine.pdf" });
    assert.equal(result.isError, true);
    assert.equal(result.payload.saved, false);
    assert.match(result.payload.reason, /already exists.*choose another filename/);
    assert.equal(readFileSync(keep, "utf8"), "created while the download was running");
    assert.equal(downloadRequests, 1, "a local filename conflict must not try the second link");
    assert.deepEqual(readdirSync(dir), ["mine.pdf"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two concurrent downloads to the same caller filename have exactly one winner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-race-"));
  let release;
  const bothStarted = new Promise((resolve) => { release = resolve; });
  beforeDownload = async () => {
    if (downloadRequests === 2) release();
    await bothStarted;
  };
  try {
    const results = await Promise.all([
      download({ output_dir: dir, filename: "mine.pdf" }),
      download({ output_dir: dir, filename: "mine.pdf" }),
    ]);
    assert.equal(results.filter((r) => r.payload.saved === true).length, 1);
    const loser = results.find((r) => r.isError);
    assert.ok(loser, "the other call must report a conflict");
    assert.equal(loser.payload.saved, false);
    assert.match(loser.payload.reason, /already exists/);
    assert.equal(readFileSync(join(dir, "mine.pdf")).equals(body), true);
    assert.equal(downloadRequests, 2, "neither call may re-download after publication");
    assert.deepEqual(readdirSync(dir), ["mine.pdf"]);
  } finally {
    release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a filesystem without hard-link support fails safely instead of falling back to rename", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-race-"));
  const originalLink = fs.link;
  fs.link = async () => { throw Object.assign(new Error("hard links unsupported"), { code: "ENOTSUP" }); };
  syncBuiltinESMExports();
  try {
    const result = await download({ output_dir: dir, filename: "mine.pdf" });
    assert.equal(result.isError, true);
    assert.equal(result.payload.saved, false);
    assert.match(result.payload.reason, /hard links unsupported/);
    assert.equal(downloadRequests, 1, "publication failure must not try the second download link");
    assert.deepEqual(readdirSync(dir), [], "no destination or temporary file may remain");
  } finally {
    fs.link = originalLink;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});
