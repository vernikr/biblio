// download_book must write only inside output_dir: a caller-supplied filename
// is a plain name, never a path. Driven through the real MCP tool surface
// against a local fake Libgen mirror.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, relative, isAbsolute } from "node:path";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";
import { withMcpClient } from "./helpers/mcp.mjs";

const md5 = "7".repeat(32);
const server = createServer((req, res) => {
  if (req.url?.startsWith("/ads.php")) {
    res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
    res.end(
      `<html><body>Library Genesis <a href="get.php?md5=${md5}&key=K">GET</a> ` +
        `@book{book:1, title={Plain Book}, author={Tester}}</body></html>`
    );
    return;
  }
  if (req.url?.startsWith("/get.php")) {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.concat([Buffer.from("%PDF-1.4 test"), Buffer.alloc(64, 1)]));
    return;
  }
  res.writeHead(404).end("not found");
});
const mirror = await listenLocal(server);
process.env.BIBLIO_LIBGEN_MIRRORS = mirror;
process.env.BIBLIO_ANNAS_MIRRORS = mirror;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "1000";
delete process.env.BIBLIO_ANNAS_API_KEY;

const { createServer: createMcpServer } = await import("../dist/server.js");

test.after(() => closeServer(server));

async function callDownload(args) {
  return withMcpClient(createMcpServer, async (client) => {
    return await client.callTool({ name: "download_book", arguments: { md5, ...args } });
  }, "test");
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "biblio-fname-"));
  const outDir = join(root, "books");
  return { root, outDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a filename with parent-directory segments is rejected and writes nothing", async () => {
  const box = sandbox();
  try {
    const escaped = join(box.root, "escaped.pdf");
    const result = await callDownload({ output_dir: box.outDir, filename: "../escaped.pdf" });
    assert.equal(result.isError, true, "the call must fail, not report a saved file");
    assert.equal(existsSync(escaped), false, "nothing may land outside output_dir");
    assert.equal(existsSync(join(box.outDir, `${md5}.downloading`)), false);
  } finally {
    box.cleanup();
  }
});

test("a filename containing a path separator is rejected", async () => {
  const box = sandbox();
  try {
    const result = await callDownload({ output_dir: box.outDir, filename: "sub/x.pdf" });
    assert.equal(result.isError, true);
    assert.equal(existsSync(join(box.outDir, "sub")), false);
  } finally {
    box.cleanup();
  }
});

// Windows refuses or silently rewrites these; the Desktop extension is
// Windows-first, so a name that only works elsewhere is a name to refuse.
for (const bad of ["con", "NUL.pdf", "com1", "lpt9.txt", "book.pdf."]) {
  test(`a filename Windows would reject or rewrite is refused: ${JSON.stringify(bad.slice(-24))}`, async () => {
    const box = sandbox();
    try {
      const result = await callDownload({ output_dir: box.outDir, filename: bad });
      assert.equal(result.isError, true, `${bad} must be refused, not saved under another name`);
      assert.doesNotMatch(
        result.content[0].text,
        /"saved":\s*true/,
        `${bad} must not be reported as saved`
      );
      // Refused before the directory is even created, so tolerate its absence.
      const written = existsSync(box.outDir) ? readdirSync(box.outDir) : [];
      assert.deepEqual(written, [], "nothing may be written");
    } finally {
      box.cleanup();
    }
  });
}

test("a plain filename is saved inside output_dir", async () => {
  const box = sandbox();
  try {
    const result = await callDownload({ output_dir: box.outDir, filename: "plain-book.pdf" });
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.saved, true);
    assert.equal(dirname(payload.path), box.outDir);
    assert.ok(existsSync(join(box.outDir, "plain-book.pdf")));
  } finally {
    box.cleanup();
  }
});


test("a relative output_dir is resolved from HOME and reported after a real download", async () => {
  const box = sandbox();
  try {
    const relativeDir = relative(homedir(), box.outDir);
    assert.equal(isAbsolute(relativeDir), false);
    const result = await callDownload({ output_dir: relativeDir, filename: "relative-book.pdf" });
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.saved, true);
    assert.equal(payload.outputDir, box.outDir);
    assert.equal(payload.path, join(box.outDir, "relative-book.pdf"));
    assert.match(payload.note, /was relative/);
    assert.ok(existsSync(payload.path));
  } finally {
    box.cleanup();
  }
});
