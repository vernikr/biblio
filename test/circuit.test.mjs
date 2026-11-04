// Provider circuit-breaker tests against a local mirror.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeServer, listenLocal } from "./helpers/mirror-server.mjs";

const paths = [];
const server = createServer((req, res) => {
  paths.push(req.url ?? "");
  res.writeHead(403, { "content-type": "text/plain; charset=UTF-8" });
  res.end("DDoS-Guard challenge");
});
const mirror = await listenLocal(server);
process.env.BIBLIO_ANNAS_MIRRORS = mirror;
process.env.BIBLIO_LIBGEN_MIRRORS = mirror;
process.env.BIBLIO_SCIHUB_MIRRORS = mirror;
process.env.BIBLIO_MIRROR_STAGGER_MS = "0";
process.env.BIBLIO_TIMEOUT_MS = "1000";
process.env.BIBLIO_MIRROR_DEAD_TTL_MS = "60000";

const { searchBooks, bookDetails, resolveDownloads } = await import("../dist/providers/index.js");

test.after(() => closeServer(server));

test("Anna's Archive is summarized, skipped while all mirrors are cooling down, and circuit-broken after three failures", async () => {
  const first = await searchBooks("dune attempt 1", ["annas"], 5);
  assert.equal(first.errors.length, 1);
  assert.equal(first.errors[0].source, "annas");
  assert.match(first.errors[0].error, /DDoS-Guard challenge/i);
  assert.doesNotMatch(first.errors[0].error, /127\.0\.0\.1|HTTP 403/);
  assert.ok(first.errors[0].error.length < 180, first.errors[0].error);
  assert.equal(paths.filter((path) => path.startsWith("/search?")).length, 1);
  const cachedFailure = await searchBooks("dune attempt 1", ["annas"], 5);
  assert.equal(cachedFailure.errors[0].error, first.errors[0].error);
  assert.equal(paths.filter((path) => path.startsWith("/search?")).length, 1);

  // The failed search put the sole Anna's mirror in negative cache. Resolving
  // downloads must not immediately spend another request on the known-dead
  // HTML detail page (the optional member JSON API remains independent).
  await resolveDownloads("a".repeat(32));
  assert.equal(paths.filter((path) => path.startsWith("/md5/")).length, 0);

  const annasDetailPagesBefore = paths.filter((path) => path.startsWith("/md5/")).length;
  const details = await bookDetails("a".repeat(32));
  assert.equal(
    paths.filter((path) => path.startsWith("/md5/")).length,
    annasDetailPagesBefore,
    "book_details should also skip Anna's HTML while every mirror is cooling down"
  );
  assert.match(details.annasUnavailable ?? "", /cooling down/i);

  const second = await searchBooks("dune attempt 2", ["annas"], 5);
  const third = await searchBooks("dune attempt 3", ["annas"], 5);
  assert.equal(second.errors.length, 1);
  assert.equal(third.errors.length, 1);
  assert.match(third.errors[0].error, /DDoS-Guard challenge/i);
  assert.equal(paths.filter((path) => path.startsWith("/search?")).length, 3);

  const fourth = await searchBooks("dune attempt 4", ["annas"], 5);
  assert.equal(fourth.errors.length, 1);
  assert.match(fourth.errors[0].error, /disabled for this process|circuit/i);
  assert.equal(paths.filter((path) => path.startsWith("/search?")).length, 3);
});

test("get_paper opens the source circuit after three full failures", async () => {
  const { createServer: createMcpServer } = await import("../dist/server.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "scihub-circuit-test", version: "0.0.0" });
  const before = paths.length;

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    for (let i = 0; i < 3; i++) {
      const response = await client.callTool({
        name: "get_paper",
        arguments: { identifier: "10.1038/nature12373" },
      });
      assert.equal(response.isError, true);
    }
    assert.equal(paths.length - before, 3);

    const fourth = await client.callTool({
      name: "get_paper",
      arguments: { identifier: "10.1038/nature12373" },
    });
    assert.equal(fourth.isError, true);
    assert.match(fourth.content[0].text, /circuit open/i);
    assert.equal(paths.length - before, 3, "an open circuit must not make another provider request");
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("a late in-flight success cannot close a circuit that has already opened", async () => {
  const { sourceCircuitMessage, withSourceCircuit } = await import("../dist/providers/circuit.js");
  const isSourceCircuitOpen = (source) => sourceCircuitMessage(source) !== undefined;
  let release;
  const slowSuccess = withSourceCircuit(
    "zlibrary",
    () => new Promise((resolve) => (release = resolve))
  );

  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      withSourceCircuit("zlibrary", async () => {
        throw new Error("mirror failed");
      }),
      /mirror failed/
    );
  }
  assert.equal(isSourceCircuitOpen("zlibrary"), true);

  release("late success");
  await slowSuccess;
  assert.equal(isSourceCircuitOpen("zlibrary"), true);
});
