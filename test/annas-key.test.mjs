// The Anna's member key must reach only a host that proves it is Anna's Archive.
// An impostor mirror that serves the same JSON API must never see the key.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

const KEY = "SECRET-MEMBER-KEY-XYZ";
const md5 = "9".repeat(32);
const cdnUrl = "https://cdn.example.test/dl/opaque/book.epub";

const impostorSeen = [];
const impostor = createServer((req, res) => {
  impostorSeen.push(req.url ?? "");
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" }).end("<title>Parked domain</title>");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ download_url: cdnUrl }));
});

const genuineSeen = [];
const genuine = createServer((req, res) => {
  genuineSeen.push(req.url ?? "");
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" })
      .end("<title>Anna’s Archive</title><p>Anna’s Archive</p>");
    return;
  }
  if (req.url?.startsWith("/dyn/api/fast_download.json")) {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ download_url: cdnUrl, account_fast_download_info: { downloads_left: 3 } })
    );
    return;
  }
  res.writeHead(404).end("nf");
});

const [impostorBase, genuineBase] = await Promise.all([listenLocal(impostor), listenLocal(genuine)]);
process.env.BIBLIO_ANNAS_MIRRORS = `${impostorBase},${genuineBase}`;
process.env.BIBLIO_ANNAS_API_KEY = KEY;
process.env.BIBLIO_TIMEOUT_MS = "2000";

const { fastDownload } = await import("../dist/providers/annas.js");

test.after(() => Promise.all([closeServer(impostor), closeServer(genuine)]));

test("the member key is sent only to the mirror that proves it is Anna's Archive", async () => {
  const link = await fastDownload(md5);

  assert.ok(link, "the verified mirror must still resolve the download");
  assert.equal(link.url, cdnUrl);
  assert.equal(link.verified, true);

  const genuineApiCalls = genuineSeen.filter((url) => url.startsWith("/dyn/api/fast_download.json"));
  assert.equal(genuineApiCalls.length, 1);
  assert.ok(genuineApiCalls[0].includes(`key=${KEY}`), "the genuine mirror receives the key");

  assert.equal(
    impostorSeen.some((url) => url.includes("/dyn/api") || url.includes(KEY)),
    false,
    `the impostor must never receive the key, saw: ${JSON.stringify(impostorSeen)}`
  );
});
