// Tests for the mirror-rotation and download layer.

process.env.BIBLIO_MIRROR_DEAD_TTL_MS = "400"; // keep the cache tests quick
process.env.BIBLIO_MIRROR_STAGGER_MS = "0"; // no head start; order is explicit
process.env.BIBLIO_DOWNLOAD_STALL_MS = "700";
process.env.BIBLIO_TIMEOUT_MS = "2000";

const {
  fetchFromMirrors,
  downloadToFile,
  HtmlInsteadOfFileError,
  resetMirrorCache,
  resetDeadCache,
  mirrorCacheSnapshot,
  probeMirror,
} = await import("../dist/http.js");
const { probeGroup, toHealthcheckGroup } = await import("../dist/mirrors.js");

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

/** Start a local HTTP server from a route table. Returns url + hit counters. */
async function serve(routes) {
  const hits = new Map();
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const handler = routes[path];
    if (!handler) {
      res.writeHead(404).end("nope");
      return;
    }
    handler(req, res);
  });
  const url = await listenLocal(server);
  return {
    url,
    hits: (p) => hits.get(p) ?? 0,
    close: () => closeServer(server),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Mirror rotation
// ---------------------------------------------------------------------------

test("fetchFromMirrors falls through a failing mirror to a working one", async () => {
  resetMirrorCache();
  const bad = await serve({ "/x": (_q, res) => res.writeHead(500).end("boom") });
  const good = await serve({ "/x": (_q, res) => res.writeHead(200).end("<html>ok</html>") });

  try {
    const result = await fetchFromMirrors(
      "rotation",
      [bad.url, good.url],
      (b) => `${b}/x`
    );
    assert.equal(result.base, good.url);
    assert.equal(result.html, "<html>ok</html>");
    assert.match(result.attempts.join("; "), /HTTP 500/);
  } finally {
    await bad.close();
    await good.close();
  }
});

test("fetchFromMirrors hands the validator's parse back instead of making the caller redo it", async () => {
  resetMirrorCache();
  let loads = 0;
  const server = await serve({ "/x": (_q, res) => res.writeHead(200).end("<html>page</html>") });

  try {
    const result = await fetchFromMirrors(
      "validator-value",
      [server.url],
      (b) => `${b}/x`,
      undefined,
      (html) => {
        loads += 1;
        return { value: { length: html.length } };
      }
    );
    assert.deepEqual(result.parsed, { length: "<html>page</html>".length });
    assert.equal(loads, 1, "the page is parsed once, by the validator, not again by the caller");
    assert.equal(server.hits("/x"), 1);
  } finally {
    await server.close();
  }
});

test("a validator that returns false still reports the generic reason", async () => {
  resetMirrorCache();
  const server = await serve({ "/x": (_q, res) => res.writeHead(200).end("<html>page</html>") });

  try {
    await assert.rejects(
      fetchFromMirrors("validator-false", [server.url], (b) => `${b}/x`, undefined, () => false),
      /validator-false.*is not the expected site|is not the expected site/
    );
  } finally {
    await server.close();
  }
});

test("fetchFromMirrors tries a route fallback on the same mirror after HTTP 404", async () => {
  resetMirrorCache();
  const server = await serve({
    "/index.php": (_req, res) => res.writeHead(404).end("route missing"),
    "/search.php": (_req, res) => res.writeHead(200).end("legacy route works"),
  });

  try {
    const result = await fetchFromMirrors("route-fallback", [server.url], (base) => [
      `${base}/index.php`,
      `${base}/search.php`,
    ]);
    assert.equal(result.html, "legacy route works");
    assert.equal(result.finalUrl, `${server.url}/search.php`);
    assert.equal(server.hits("/index.php"), 1);
    assert.equal(server.hits("/search.php"), 1);
  } finally {
    await server.close();
  }
});

test("an empty mirror group rejects immediately with its configuration variable", async () => {
  resetMirrorCache();
  const started = Date.now();
  await assert.rejects(
    () => fetchFromMirrors("zlibrary", [], (base) => `${base}/search`),
    /No zlibrary mirrors configured; set BIBLIO_ZLIB_MIRRORS/
  );
  assert.ok(Date.now() - started < 100, "an empty group should not leave a pending promise");
});

test("a failed mirror is skipped on the next request (negative cache)", async () => {
  resetMirrorCache();
  // `flaky` answers 500 the first time and 200 afterwards. If the negative
  // cache works, the second request goes straight to `stable` and never
  // re-hits `flaky`.
  let flakyCalls = 0;
  const flaky = await serve({
    "/x": (_q, res) => {
      flakyCalls += 1;
      if (flakyCalls === 1) return res.writeHead(500).end("boom");
      res.writeHead(200).end("recovered");
    },
  });
  const stable = await serve({ "/x": (_q, res) => res.writeHead(200).end("stable") });

  try {
    await fetchFromMirrors("negcache", [flaky.url, stable.url], (b) => `${b}/x`);
    const second = await fetchFromMirrors("negcache", [flaky.url, stable.url], (b) => `${b}/x`);
    assert.equal(second.base, stable.url);
    assert.equal(flakyCalls, 1, "the dead mirror should not have been retried");
  } finally {
    await flaky.close();
    await stable.close();
  }
});

test("the mirror cache is half-open: once everything is dead, all are retried", async () => {
  resetMirrorCache();
  const a = await serve({ "/x": (_q, res) => res.writeHead(500).end("a") });
  const b = await serve({ "/x": (_q, res) => res.writeHead(500).end("b") });

  try {
    await assert.rejects(
      () => fetchFromMirrors("halfopen", [a.url, b.url], (x) => `${x}/x`),
      /All 2 halfopen mirror\(s\) failed/
    );
    // Both are now in cooldown. Waiting out the TTL must make the next request
    // try them again rather than failing without contacting anyone.
    await wait(500);
    await assert.rejects(() => fetchFromMirrors("halfopen", [a.url, b.url], (x) => `${x}/x`));
    assert.equal(a.hits("/x"), 2, "mirror A should have been probed twice");
    assert.equal(b.hits("/x"), 2, "mirror B should have been probed twice");
  } finally {
    await a.close();
    await b.close();
  }
});

test("a mirror that succeeds becomes the preferred one", async () => {
  resetMirrorCache();
  const slow = await serve({ "/x": (_q, res) => res.writeHead(200).end("slow") });
  const fast = await serve({ "/x": (_q, res) => res.writeHead(200).end("fast") });

  try {
    const first = await fetchFromMirrors("sticky", [slow.url, fast.url], (b) => `${b}/x`);
    const second = await fetchFromMirrors("sticky", [slow.url, fast.url], (b) => `${b}/x`);
    assert.equal(second.base, first.base, "the winner should be reused");
  } finally {
    await slow.close();
    await fast.close();
  }
});

test("resetDeadCache clears cooldowns but preserves the last-known-good mirror", async () => {
  resetMirrorCache();
  const broken = await serve({ "/x": (_q, res) => res.writeHead(500).end("broken") });
  const good = await serve({ "/x": (_q, res) => res.writeHead(200).end("good") });

  try {
    const result = await fetchFromMirrors("selective-reset", [broken.url, good.url], (b) => `${b}/x`);
    assert.equal(result.base, good.url);
    const before = mirrorCacheSnapshot();
    assert.ok(before.dead.includes(broken.url));
    assert.equal(before.preferred["selective-reset"], good.url);

    resetDeadCache();
    const after = mirrorCacheSnapshot();
    assert.deepEqual(after.dead, []);
    assert.equal(after.preferred["selective-reset"], good.url);
  } finally {
    await broken.close();
    await good.close();
  }
});

// ---------------------------------------------------------------------------
// Identity: a 200 from a domain that is no longer the site we asked for
// ---------------------------------------------------------------------------

test("fetchFromMirrors rejects a mirror that answers 200 but is not the expected site", async () => {
  resetMirrorCache();
  // This is the annas-archive.li situation: a re-registered domain answering
  // fast with a parked/ad page. It must not be parsed as catalogue data.
  const impostor = await serve({
    "/x": (_q, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html>ads</html>"),
  });
  const real = await serve({
    "/x": (_q, res) =>
      res.writeHead(200, { "content-type": "text/html" }).end("<html>Real Site</html>"),
  });

  try {
    const result = await fetchFromMirrors(
      "identity",
      [impostor.url, real.url],
      (b) => `${b}/x`,
      undefined,
      (html) => /Real Site/.test(html) || "answered but is not the expected site"
    );
    assert.equal(result.base, real.url, "the impostor must be skipped even though it answered 200");
    assert.match(result.attempts.join("; "), /not the expected site/);
  } finally {
    await impostor.close();
    await real.close();
  }
});

test("a mirror failing the identity check is cooled down like any other failure", async () => {
  resetMirrorCache();
  let impostorCalls = 0;
  const impostor = await serve({
    "/x": (_q, res) => {
      impostorCalls += 1;
      res.writeHead(200, { "content-type": "text/html" }).end("<html>ads</html>");
    },
  });
  const real = await serve({
    "/x": (_q, res) => res.writeHead(200).end("<html>Real Site</html>"),
  });

  try {
    const validate = (html) => /Real Site/.test(html);
    const call = () =>
      fetchFromMirrors("identity-cache", [impostor.url, real.url], (b) => `${b}/x`, undefined, validate);
    await call();
    await call();
    assert.equal(impostorCalls, 1, "a known impostor should not be retried within the TTL");
  } finally {
    await impostor.close();
    await real.close();
  }
});

test("probeMirror cancels an unread body when no identity marker is requested", async () => {
  let notifyClosed;
  const bodyClosed = new Promise((resolve) => (notifyClosed = resolve));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("alive");
    res.on("close", notifyClosed);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const result = await probeMirror(base, "/", { timeoutMs: 500 });
    assert.equal(result.ok, true);
    assert.equal(
      await Promise.race([bodyClosed.then(() => true), wait(200).then(() => false)]),
      true,
      "the response stream should be released without reading its body"
    );
  } finally {
    await closeServer(server);
  }
});

test("probeMirror flags an answering host that is not the expected site", async () => {
  const impostor = await serve({ "/": (_q, res) => res.writeHead(200).end("<html>ads</html>") });
  const real = await serve({ "/": (_q, res) => res.writeHead(200).end("<html>Real Site</html>") });

  try {
    const expect = /Real Site/;
    const bad = await probeMirror(impostor.url, "/", { expect });
    assert.equal(bad.ok, false);
    assert.equal(bad.impostor, true);
    assert.equal(bad.status, 200, "it did answer — the problem is identity, not reachability");

    const good = await probeMirror(real.url, "/", { expect });
    assert.equal(good.ok, true);
    assert.notEqual(good.impostor, true);
  } finally {
    await impostor.close();
    await real.close();
  }
});

test("probeGroup shares reachability and identity summaries", async () => {
  const impostor = await serve({ "/": (_q, res) => res.writeHead(200).end("parked domain") });
  const real = await serve({ "/": (_q, res) => res.writeHead(200).end("Expected site") });

  try {
    const group = await probeGroup(
      {
        group: "local-test",
        mirrors: [impostor.url, real.url],
        probePath: "/",
        expect: /Expected site/,
      },
      { timeoutMs: 500 }
    );
    assert.equal(group.reachable, 1);
    assert.equal(group.total, 2);
    assert.equal(group.ok, true);
    assert.deepEqual(group.impostors, [impostor.url]);
    assert.ok(group.fastestMs >= 0);

    const healthcheck = toHealthcheckGroup(group);
    assert.equal(healthcheck.fastestMs, group.fastestMs);
    assert.equal(healthcheck.mirrors.length, 2);
    assert.equal(healthcheck.mirrors[0].impostor, true);
    assert.equal("results" in healthcheck, false);
  } finally {
    await impostor.close();
    await real.close();
  }
});

// ---------------------------------------------------------------------------
// Streaming downloads
// ---------------------------------------------------------------------------

const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.6\n", "latin1"), Buffer.alloc(4096, 0x41)]);

test("downloadToFile streams to disk and reports the true byte count and md5", async () => {
  const payload = Buffer.concat([Buffer.from("%PDF-1.6\n", "latin1"), Buffer.alloc(20480, 0x5a)]);
  const srv = await serve({
    "/book": (_q, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(payload);
    },
  });
  const dir = await mkdtemp(join(tmpdir(), "biblio-dl-"));

  try {
    const dest = join(dir, "book.pdf");
    const seen = [];
    const result = await downloadToFile(`${srv.url}/book`, dest, {
      onProgress: (p) => seen.push(p),
    });

    assert.equal(result.bytes, payload.length);
    assert.equal(result.md5, createHash("md5").update(payload).digest("hex"));
    assert.deepEqual(await readFile(dest), payload);
    assert.ok(seen.length > 0, "progress should have been reported at least once");
  } finally {
    await srv.close();
  }
});

test("downloadToFile rejects an HTML interstitial instead of saving it as a book", async () => {
  const srv = await serve({
    "/book": (_q, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
      res.end("<html><body>Your download will begin shortly</body></html>");
    },
  });
  const dir = await mkdtemp(join(tmpdir(), "biblio-dl-"));

  try {
    await assert.rejects(
      () => downloadToFile(`${srv.url}/book`, join(dir, "book.pdf")),
      (err) => {
        assert.ok(err instanceof HtmlInsteadOfFileError);
        assert.match(err.message, /HTML page/);
        return true;
      }
    );
    // Nothing should be left behind — not even a .part file.
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await srv.close();
  }
});

test("downloadToFile surfaces a non-2xx status as an error", async () => {
  const srv = await serve({ "/book": (_q, res) => res.writeHead(404).end("gone") });
  const dir = await mkdtemp(join(tmpdir(), "biblio-dl-"));

  try {
    await assert.rejects(
      () => downloadToFile(`${srv.url}/book`, join(dir, "book.pdf")),
      /HTTP 404/
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await srv.close();
  }
});

test("downloadToFile reports progress repeatedly during a slow transfer", async () => {
  // A throttled transfer must emit progress repeatedly until completion.
  const chunk = Buffer.alloc(64 * 1024, 0x62);
  const total = chunk.length * 4;
  const srv = await serve({
    "/slow": (_q, res) => {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(total),
      });
      let sent = 0;
      const tick = setInterval(() => {
        res.write(chunk);
        sent += chunk.length;
        if (sent >= total) {
          clearInterval(tick);
          res.end();
        }
      }, 60);
    },
  });
  const dir = await mkdtemp(join(tmpdir(), "biblio-dl-"));

  try {
    const seen = [];
    const result = await downloadToFile(`${srv.url}/slow`, join(dir, "slow.bin"), {
      onProgress: (p) => seen.push({ ...p }),
    });

    assert.equal(result.bytes, total);
    assert.ok(seen.length >= 3, `expected repeated progress, got ${seen.length}`);
    // Bytes must be monotonically increasing, and `total` must be advertised
    // when the server sent content-length — clients render a bar from it.
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i].bytes >= seen[i - 1].bytes, "progress must not go backwards");
    }
    assert.equal(seen[seen.length - 1].total, total);
    assert.equal(seen[seen.length - 1].bytes, total);
  } finally {
    await srv.close();
  }
});

test("downloadToFile aborts a connection that stops sending bytes", async () => {
  const srv = await serve({
    "/stall": (_q, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(Buffer.from("%PDF", "latin1"));
      // Never end the response: the stall watchdog must cut it off.
    },
  });
  const dir = await mkdtemp(join(tmpdir(), "biblio-dl-"));

  try {
    const started = Date.now();
    await assert.rejects(
      () => downloadToFile(`${srv.url}/stall`, join(dir, "book.pdf")),
      /stalled|aborted/i
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `should give up quickly, took ${elapsed}ms`);
    assert.deepEqual(await readdir(dir), [], "the .part file must be cleaned up");
  } finally {
    await srv.close();
  }
});

test("a mirror that declares an oversized page is dropped before its body is read", async () => {
  // A catalogue page is a few hundred kilobytes. A host promising more than the
  // budget must not get to allocate it, and the reason must name the budget
  // rather than surfacing later as a timeout.
  const huge = await serve({
    "/": (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-length": String(30 * 1024 * 1024),
      });
      res.write("<html><title>Huge</title>");
      // Deliberately never ends: giving up must come from the declared length.
    },
  });
  try {
    await assert.rejects(
      fetchFromMirrors("huge-test", [huge.url], (base) => `${base}/`),
      /page is larger than the 20 MB budget/
    );
  } finally {
    await huge.close();
  }
});

test("a mirror that streams past the budget is cut off mid-body", async () => {
  const streamed = await serve({
    "/": (_req, res) => {
      res.on("error", () => {});
      res.writeHead(200, { "content-type": "text/html" }); // chunked: no declared length
      const chunk = Buffer.alloc(1024 * 1024, "a");
      for (let sent = 0; sent < 21; sent++) {
        if (res.writableEnded) break;
        res.write(chunk);
      }
      res.end();
    },
  });
  try {
    await assert.rejects(
      fetchFromMirrors("stream-test", [streamed.url], (base) => `${base}/`),
      /page is larger than the 20 MB budget/
    );
  } finally {
    await streamed.close();
  }
});

test("probeMirror reports an oversized identity-check page instead of holding it", async () => {
  const huge = await serve({
    "/": (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-length": String(30 * 1024 * 1024),
      });
      res.write("<html><title>Huge</title>");
    },
  });
  try {
    const probe = await probeMirror(huge.url, "/", { expect: /expected-site/ });
    assert.equal(probe.ok, false);
    assert.match(probe.error ?? "", /20 MB budget/);
  } finally {
    await huge.close();
  }
});
