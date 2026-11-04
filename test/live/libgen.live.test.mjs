// Optional live integration check for Libgen. Kept outside the normal test
// command because mirror availability and network policy are not deterministic.

import test from "node:test";
import assert from "node:assert/strict";

process.env.BIBLIO_TIMEOUT_MS = "5000";
const { searchBooks } = await import("../../dist/providers/index.js");

test("live Libgen search returns at least one book result", async () => {
  const result = await searchBooks("Vidyamurthy Pairs Trading", ["libgen"], 3);
  assert.ok(result.results.length > 0, `no results; errors: ${JSON.stringify(result.errors)}`);
  assert.ok(result.results.every((book) => book.md5), "live book results should include an MD5");
});
