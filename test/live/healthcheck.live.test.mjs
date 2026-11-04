// Optional live probe of configured mirror identities. This is intentionally
// not part of the default offline suite; network access varies by runner.

import test from "node:test";
import assert from "node:assert/strict";

process.env.BIBLIO_TIMEOUT_MS = "3000";
const [{ MIRROR_GROUPS }, { probeMirror }] = await Promise.all([
  import("../../dist/mirrors.js"),
  import("../../dist/http.js"),
]);

test("live mirrors include at least one reachable source", async () => {
  const groups = await Promise.all(
    MIRROR_GROUPS.map(async ({ group, mirrors, probePath, expect }) => {
      const results = await Promise.all(
        mirrors.map((base) => probeMirror(base, probePath, { timeoutMs: 3000, expect }))
      );
      return { group, results };
    })
  );
  const reachable = groups.flatMap(({ group, results }) =>
    results.filter((result) => result.ok).map((result) => ({ group, base: result.base, ms: result.ms }))
  );
  console.log("live mirror reachability:", JSON.stringify(reachable));
  assert.ok(reachable.length > 0, "no configured mirror passed its live identity check");
});
