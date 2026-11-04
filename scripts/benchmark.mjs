// Opt-in live benchmark for the phase-3 provider paths.

import { performance } from "node:perf_hooks";
import { BOOK_SOURCES, bookDetails, resolveDownloads, searchBooks } from "../dist/providers/index.js";
import { resetMirrorCache } from "../dist/http.js";

const query = process.env.BENCH_QUERY ?? "Vidyamurthy Pairs Trading";
const sources = process.env.BENCH_SOURCES
  ? process.env.BENCH_SOURCES.split(",").map((source) => source.trim()).filter(Boolean)
  : BOOK_SOURCES;
const limit = 5;
const fallbackMd5 = process.env.BENCH_MD5 ?? "524037f395462d37b31f2b28fede24fb";
const measurements = {};

async function measure(name, operation, summarize) {
  const started = performance.now();
  try {
    const value = await operation();
    measurements[name] = {
      ms: Math.round(performance.now() - started),
      ok: true,
      ...summarize(value),
    };
    return value;
  } catch (error) {
    measurements[name] = {
      ms: Math.round(performance.now() - started),
      ok: false,
      error: String(error?.message ?? error),
    };
    return undefined;
  }
}

resetMirrorCache();
const searchSummary = (result) => ({
  resultCount: result.results.length,
  sourceErrors: result.errors.map(({ source }) => source),
});
const firstSearch = await measure(
  "search_books_cold",
  () => searchBooks(query, sources, limit),
  searchSummary
);
await measure(
  "search_books_warm",
  () => searchBooks(query, sources, limit),
  searchSummary
);

const md5 = firstSearch?.results.find((book) => book.md5)?.md5 ?? fallbackMd5;
const detailSummary = (book) => ({
  hasTitle: Boolean(book.title),
  resolvedVia: book.resolvedVia ?? null,
  sourceErrors: [book.annasUnavailable, book.libgenUnavailable].filter(Boolean).length,
});
await measure("book_details_cold", () => bookDetails(md5), detailSummary);
await measure("book_details_warm", () => bookDetails(md5), detailSummary);
await measure("get_download_links", () => resolveDownloads(md5), (links) => ({ linkCount: links.length }));

console.log(
  JSON.stringify(
    {
      query,
      sources,
      limit,
      md5,
      timeoutMs: process.env.BIBLIO_TIMEOUT_MS ?? "default",
      measurements,
    },
    null,
    2
  )
);
