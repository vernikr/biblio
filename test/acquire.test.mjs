// Choosing among copies of one book, and recovering when one copy fails.
// Network-free: the providers are injected, so these tests run offline.

import test from "node:test";
import assert from "node:assert/strict";

const { rankCandidates, findAlternatives, fetchBook, saveBook } = await import("../dist/acquire.js");

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const D = "d".repeat(32);

const book = (md5, extra = {}) => ({ source: "libgen", title: "Algorithmic Trading", md5, ...extra });

test("rankCandidates drops records without an MD5 and duplicates", () => {
  const ranked = rankCandidates([
    book(A, { format: "PDF", size: "4 MB" }),
    book(undefined, { format: "PDF", size: "9 MB" }),
    book(A, { format: "PDF", size: "4 MB" }),
    book("not-a-hash", { format: "PDF" }),
  ]);
  assert.deepEqual(ranked.map((b) => b.md5), [A]);
});

test("rankCandidates prefers the requested format, then PDF, then the larger copy", () => {
  const ranked = rankCandidates([
    book(A, { format: "EPUB", size: "20 MB" }),
    book(B, { format: "PDF", size: "2 MB" }),
    book(C, { format: "PDF", size: "9.2 MB" }),
    book(D, { format: "PDF", size: "unknown" }),
  ]);
  // PDF before EPUB; within PDF the larger known size first; unknown size last.
  assert.deepEqual(ranked.map((b) => b.md5), [C, B, D, A]);
  const epubFirst = rankCandidates(
    [book(A, { format: "PDF", size: "9 MB" }), book(B, { format: "EPUB", size: "1 MB" })],
    { format: "epub" }
  );
  assert.equal(epubFirst[0].md5, B, "an explicit format wins over PDF preference");
});

test("rankCandidates can exclude the copy that just failed", () => {
  const ranked = rankCandidates([book(A, { format: "PDF" }), book(B, { format: "PDF" })], { exclude: A });
  assert.deepEqual(ranked.map((b) => b.md5), [B]);
});

test("findAlternatives returns other copies of the same title, never the failed one", async () => {
  const seen = [];
  const alternatives = await findAlternatives(A, {
    details: async () => ({ title: "Algorithmic Trading", author: "Ernest Chan", md5: A }),
    search: async (query, sources, limit) => {
      seen.push({ query, sources, limit });
      return {
        results: [
          book(A, { format: "PDF", size: "9 MB" }),
          book(B, { format: "PDF", size: "9.2 MB", source: "annas" }),
          book(C, { format: "PDF", size: "2 MB" }),
        ],
        errors: [],
      };
    },
  });
  assert.ok(seen[0].query.includes("Algorithmic Trading"), "search by the title");
  assert.deepEqual(alternatives.map((a) => a.md5), [B, C]);
  assert.equal(alternatives[0].source, "annas");
  assert.equal(alternatives[0].title, "Algorithmic Trading");
});

test("findAlternatives is best-effort: no title or a failing search gives an empty list", async () => {
  assert.deepEqual(
    await findAlternatives(A, { details: async () => ({}), search: async () => ({ results: [], errors: [] }) }),
    []
  );
  assert.deepEqual(
    await findAlternatives(A, {
      details: async () => ({ title: "X" }),
      search: async () => {
        throw new Error("source down");
      },
    }),
    []
  );
});

test("findAlternatives caps the list so a failure response stays small", async () => {
  const many = Array.from({ length: 12 }, (_, i) => book(String(i).padStart(32, "e"), { format: "PDF", size: `${i} MB` }));
  const alternatives = await findAlternatives(A, {
    details: async () => ({ title: "Big" }),
    search: async () => ({ results: many, errors: [] }),
  });
  assert.ok(alternatives.length <= 5);
});

test("saveBook attaches alternatives and a next step when no direct link resolves", async () => {
  const outcome = await saveBook(
    A,
    { outputDir: "/tmp/biblio-acquire-unused", onProgress: async () => {} },
    {
      resolve: async () => ({ links: [], errors: [] }),
      alternatives: async () => [{ md5: B, title: "Algorithmic Trading", format: "PDF", size: "9 MB", source: "libgen" }],
    }
  );
  assert.equal(outcome.saved, false);
  assert.equal(outcome.body.alternatives[0].md5, B);
  assert.match(String(outcome.body.nextStep), new RegExp(B));
});

test("saveBook uses the copies the caller already ranked and never looks up more", async () => {
  let lookups = 0;
  const deps = {
    resolve: async () => ({ links: [], errors: [] }),
    alternatives: async () => {
      lookups += 1;
      return [{ md5: B, title: "Algorithmic Trading", source: "libgen" }];
    },
  };

  const none = await saveBook(
    A,
    { outputDir: "/tmp/biblio-acquire-unused", onProgress: async () => {}, alternatives: [] },
    deps
  );
  assert.equal(lookups, 0, "an empty list means 'there are none', not 'go and find them'");
  assert.deepEqual(none.body.alternatives, []);

  const given = await saveBook(
    A,
    {
      outputDir: "/tmp/biblio-acquire-unused",
      onProgress: async () => {},
      alternatives: [{ md5: C, title: "Algorithmic Trading", source: "libgen" }],
    },
    deps
  );
  assert.equal(lookups, 0);
  assert.equal(given.body.alternatives[0].md5, C);
});

test("fetchBook moves on to the next copy after a failure and reports every attempt", async () => {
  const calls = [];
  const result = await fetchBook(
    { query: "Algorithmic Trading", outputDir: "/tmp/biblio-acquire-unused" },
    {
      search: async () => ({
        results: [book(A, { format: "PDF", size: "9 MB" }), book(B, { format: "PDF", size: "2 MB" })],
        errors: [],
      }),
      saveBook: async (hash) => {
        calls.push(hash);
        if (hash === A) return { saved: false, body: { saved: false, reason: "Libgen HTTP 500" } };
        return { saved: true, body: { saved: true, path: "/tmp/x.pdf", md5: B, md5MatchesRequest: true } };
      },
    }
  );
  assert.deepEqual(calls, [A, B]);
  assert.equal(result.saved, true);
  assert.equal(result.md5, B);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].error, "Libgen HTTP 500");
});

test("fetchBook gives up after maxAttempts and names the copies it never reached", async () => {
  const result = await fetchBook(
    { query: "Algorithmic Trading", outputDir: "/tmp/biblio-acquire-unused", maxAttempts: 2 },
    {
      search: async () => ({
        results: [book(A, { format: "PDF" }), book(B, { format: "PDF" }), book(C, { format: "PDF" })],
        errors: [],
      }),
      saveBook: async () => ({ saved: false, body: { saved: false, reason: "down" } }),
    }
  );
  assert.equal(result.saved, false);
  assert.equal(result.attempts.length, 2, "C is never tried on its own");
  assert.deepEqual(
    (result.alternatives ?? []).map((a) => a.md5),
    [C],
    "the search already ranked C; it must be offered, not looked up again"
  );
  assert.match(String(result.nextStep), new RegExp(C));
});


test("fetchBook pays for no second lookup per copy that fails to save", async () => {
  let lookups = 0;
  const result = await fetchBook(
    { query: "Algorithmic Trading", outputDir: "/tmp/biblio-acquire-unused", maxAttempts: 2 },
    {
      search: async () => ({
        results: [book(A, { format: "PDF" }), book(B, { format: "PDF" })],
        errors: [],
      }),
      saveBook: (hash, req) =>
        saveBook(hash, req, {
          resolve: async () => ({ links: [], errors: [] }),
          alternatives: async () => {
            lookups += 1;
            return [];
          },
        }),
    }
  );
  assert.equal(result.saved, false);
  assert.equal(lookups, 0, "the ranked list is the answer; a per-copy details call plus search buys nothing");
});

test("fetchBook reports an empty search as a clear, non-retry failure", async () => {
  const result = await fetchBook(
    { query: "no such book", outputDir: "/tmp/biblio-acquire-unused" },
    { search: async () => ({ results: [], errors: [] }), saveBook: async () => assert.fail("must not download") }
  );
  assert.equal(result.saved, false);
  assert.match(String(result.reason), /no results/i);
});
