// Bounded process-local response-cache tests.

import test from "node:test";
import assert from "node:assert/strict";
import { AsyncTtlCache } from "../dist/cache.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("AsyncTtlCache shares in-flight work and expires successful results", async () => {
  const cache = new AsyncTtlCache(35, 4);
  let calls = 0;
  let release;
  const load = () => {
    calls += 1;
    return new Promise((resolve) => (release = resolve));
  };

  const first = cache.getOrLoad("key", load);
  const concurrent = cache.getOrLoad("key", load);
  assert.strictEqual(first, concurrent, "concurrent callers should share the same promise");
  await Promise.resolve();
  assert.equal(calls, 1);
  release("value");
  assert.deepEqual(await Promise.all([first, concurrent]), ["value", "value"]);
  assert.equal(await cache.getOrLoad("key", load), "value");
  assert.equal(calls, 1, "a fresh value should be reused");

  await wait(45);
  const refreshed = cache.getOrLoad("key", async () => {
    calls += 1;
    return "refreshed";
  });
  assert.equal(await refreshed, "refreshed");
  assert.equal(calls, 2, "an expired value should be loaded again");
});

test("AsyncTtlCache does not retain failures", async () => {
  const cache = new AsyncTtlCache(100, 4);
  let calls = 0;
  await assert.rejects(
    cache.getOrLoad("retry", async () => {
      calls += 1;
      throw new Error("temporary failure");
    }),
    /temporary failure/
  );
  assert.equal(await cache.getOrLoad("retry", async () => {
    calls += 1;
    return "recovered";
  }), "recovered");
  assert.equal(calls, 2);
});

test("AsyncTtlCache bounds entries using least-recently-used order", async () => {
  const cache = new AsyncTtlCache(1_000, 2);
  let calls = 0;
  const load = async (key) => {
    calls += 1;
    return key;
  };

  await cache.getOrLoad("a", () => load("a"));
  await cache.getOrLoad("b", () => load("b"));
  await cache.getOrLoad("a", () => load("a")); // a is now the most-recently used
  await cache.getOrLoad("c", () => load("c")); // evicts b
  assert.equal(await cache.getOrLoad("a", () => load("a")), "a");
  assert.equal(await cache.getOrLoad("b", () => load("b")), "b");
  assert.equal(calls, 4, "only the evicted b entry should need to reload");
});
