// get_download_links and download_book must tell three cases apart:
//   - links found (possibly alongside a failed source),
//   - the record is absent from every source that answered,
//   - the sources were unavailable, so the empty result proves nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";
import { withMcpClient } from "./helpers/mcp.mjs";

// One md5 per scenario: provider caches are keyed by md5.
const SCENARIOS = {
  outage: { md5: "1".repeat(32), libgen: 503, annas: 503 },
  missing: { md5: "2".repeat(32), libgen: 404, annas: 404 },
  partial: { md5: "3".repeat(32), libgen: "link", annas: 503 },
  mixed: { md5: "4".repeat(32), libgen: 404, annas: 503 },
};

const byMd5 = new Map(Object.values(SCENARIOS).map((s) => [s.md5, s]));

const server = createServer((req, res) => {
  const hash = req.url?.match(/md5=([a-f0-9]{32})|\/md5\/([a-f0-9]{32})/);
  const scenario = byMd5.get(hash?.[1] ?? hash?.[2]);
  if (!scenario) return res.writeHead(404).end("unknown");

  if (req.url?.startsWith("/ads.php")) {
    if (scenario.libgen === "link") {
      return res.writeHead(200, { "content-type": "text/html; charset=UTF-8" }).end(
        `<html><body>Library Genesis <a href="get.php?md5=${scenario.md5}&key=K">GET</a> ` +
          `@book{book:1, title={Outcome Book}, author={Tester}}</body></html>`
      );
    }
    return res.writeHead(scenario.libgen).end("libgen says no");
  }
  // Anna's detail pages: no scenario needs a successful Anna's HTML body.
  return res.writeHead(scenario.annas).end("annas says no");
});
const mirror = await listenLocal(server);
process.env.BIBLIO_LIBGEN_MIRRORS = mirror;
process.env.BIBLIO_ANNAS_MIRRORS = mirror;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "2000";
delete process.env.BIBLIO_ANNAS_API_KEY;

const { createServer: createMcpServer } = await import("../dist/server.js");
const { resetMirrorCache } = await import("../dist/http.js");
const { resetSourceCircuits } = await import("../dist/providers/circuit.js");

test.beforeEach(() => {
  // Earlier failures must not leak into this scenario through cooldowns or circuits.
  resetMirrorCache();
  resetSourceCircuits();
});
test.after(() => closeServer(server));

async function callTool(name, args) {
  return withMcpClient(createMcpServer, async (client) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, payload: JSON.parse(result.content[0].text) };
  }, "test");
}

const sourcesOf = (list = []) => list.map((e) => e.source).sort();

test("unavailable sources are reported as an error, not as an empty success", async () => {
  const { isError, payload } = await callTool("get_download_links", { md5: SCENARIOS.outage.md5 });
  assert.equal(isError, true, JSON.stringify(payload));
  assert.equal(payload.count, 0);
  assert.deepEqual(sourcesOf(payload.errors), ["annas", "libgen"]);
  assert.equal(payload.notFound, undefined, "an outage is not a missing record");
});

test("a record that every source answers as absent is an empty success, not an outage", async () => {
  const { isError, payload } = await callTool("get_download_links", { md5: SCENARIOS.missing.md5 });
  assert.equal(isError, false, JSON.stringify(payload));
  assert.equal(payload.count, 0);
  assert.equal(payload.errors, undefined);
  assert.deepEqual([...payload.notFound].sort(), ["annas", "libgen"]);
});

test("links found from one source are kept, and the failed source is still reported", async () => {
  const { isError, payload } = await callTool("get_download_links", { md5: SCENARIOS.partial.md5 });
  assert.equal(isError, false, JSON.stringify(payload));
  assert.ok(payload.count >= 1, "the libgen link must be returned");
  assert.ok(payload.links.some((l) => l.url.includes("get.php")));
  assert.deepEqual(sourcesOf(payload.errors), ["annas"]);
});

test("one absent source plus one unavailable source is not conclusive, so it is an error", async () => {
  const { isError, payload } = await callTool("get_download_links", { md5: SCENARIOS.mixed.md5 });
  assert.equal(isError, true, JSON.stringify(payload));
  assert.deepEqual([...payload.notFound].sort(), ["libgen"]);
  assert.deepEqual(sourcesOf(payload.errors), ["annas"]);
});

test("download_book reports source outages with the reason, and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biblio-outcome-"));
  try {
    const { isError, payload } = await callTool("download_book", {
      md5: SCENARIOS.outage.md5,
      output_dir: dir,
    });
    assert.equal(isError, true);
    assert.equal(payload.saved, false);
    assert.match(payload.reason, /unavailable/i);
    assert.deepEqual(sourcesOf(payload.sourceErrors), ["annas", "libgen"]);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("source diagnostics never expose mirror URLs or query strings", async () => {
  const { payload } = await callTool("get_download_links", { md5: SCENARIOS.outage.md5 });
  assert.doesNotMatch(JSON.stringify(payload.errors), /https?:\/\/|\?md5=|key=/);
});
