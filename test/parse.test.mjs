// Tests for the shared parsing helpers.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSize,
  parseYear,
  parseFormat,
  parseLanguage,
  parsePages,
  isIsbnLike,
  parseIsbns,
  columnMap,
  parseBibtex,
  LIBGEN_DEFAULT_COLUMNS,
  isUsefulLink,
} from "../dist/parse.js";

// ---------------------------------------------------------------------------
// parseSize — the "0026gB" bug
// ---------------------------------------------------------------------------

test("parseSize reads ordinary sizes", () => {
  assert.equal(parseSize("4 MB"), "4 MB");
  assert.equal(parseSize("832 kB"), "832 KB");
  assert.equal(parseSize("1.5 GB"), "1.5 GB");
  assert.equal(parseSize("2,3 MB"), "2.3 MB"); // comma decimal separator
});

test("parseSize refuses to match inside a longer digit run", () => {
  // The bug this exists for: an unbounded pattern matched "00264mB" out of
  // concatenated page text and reported it as a file size.
  assert.equal(parseSize("00264mB"), undefined);
  assert.equal(parseSize("0026gB"), undefined);
  assert.equal(parseSize("ISBN9780471460671MB"), undefined);
  assert.equal(parseSize("id 0091346036 MB"), undefined, "leading zeros are an id, not a size");
});

test("parseSize rejects implausible values", () => {
  assert.equal(parseSize("99999 MB"), undefined);
  assert.equal(parseSize("0 MB"), undefined);
  assert.equal(parseSize("no size here"), undefined);
  assert.equal(parseSize(undefined), undefined);
  assert.equal(parseSize(""), undefined);
});

test("parseSize finds a size embedded in a sentence", () => {
  assert.equal(parseSize("Dune 1965 English 4 MB pdf"), "4 MB");
});

test("parseSize applies its plausibility limit in terabytes", () => {
  assert.equal(parseSize("99 TB"), "99 TB");
  assert.equal(parseSize("100 TB"), undefined);
  assert.equal(parseSize("9999 GB"), "9999 GB");
});

// ---------------------------------------------------------------------------
// parseYear / parseFormat / parseLanguage / parsePages
// ---------------------------------------------------------------------------

test("parseYear extracts a year from a date or a bare year", () => {
  assert.equal(parseYear("2004"), "2004");
  assert.equal(parseYear("2020 April 03"), "2020");
  assert.equal(parseYear("1492"), "1492");
});

test("parseYear does not match inside an ISBN or an id", () => {
  assert.equal(parseYear("9780471460671"), undefined);
  assert.equal(parseYear("239926"), undefined);
  assert.equal(parseYear(undefined), undefined);
});

test("parseFormat normalises the Ext. column and rejects junk", () => {
  assert.equal(parseFormat("pdf"), "PDF");
  assert.equal(parseFormat(" EPUB "), "EPUB");
  assert.equal(parseFormat(".mobi"), "MOBI");
  assert.equal(parseFormat("not-a-format"), undefined);
  assert.equal(parseFormat(""), undefined);
});

test("parseLanguage accepts known languages and rejects free text", () => {
  assert.equal(parseLanguage("English"), "English");
  assert.equal(parseLanguage("  russian "), "Russian");
  // Languages outside the short list are kept, not dropped.
  assert.equal(parseLanguage("Bulgarian"), "Bulgarian");
  assert.equal(parseLanguage("ESTONIAN"), "Estonian");
  assert.equal(parseLanguage("Kazakh"), "Kazakh");
  // Format names and multi-word cell text are still not languages.
  assert.equal(parseLanguage("pdf"), undefined);
  assert.equal(parseLanguage("Wiley Finance Series"), undefined);
  assert.equal(parseLanguage("12345"), undefined);
  // Cell text that is not a language must not be reported as one.
  assert.equal(parseLanguage("Wiley Finance"), undefined);
  assert.equal(parseLanguage(""), undefined);
});

test("parsePages reduces '223 / 223' to a number and drops zero", () => {
  assert.equal(parsePages("223 / 223"), "223");
  assert.equal(parsePages("0"), undefined);
  assert.equal(parsePages(""), undefined);
});

// ---------------------------------------------------------------------------
// ISBN handling
// ---------------------------------------------------------------------------

test("isIsbnLike recognises ISBN runs and rejects titles", () => {
  assert.equal(isIsbnLike("9780471460671; 0471460672"), true);
  assert.equal(isIsbnLike("0471460672"), true);
  assert.equal(isIsbnLike("Pairs Trading: Quantitative Methods"), false);
  assert.equal(isIsbnLike("b"), false);
  assert.equal(isIsbnLike(undefined), false);
});

test("parseIsbns pulls an ISBN run out of free text", () => {
  assert.equal(parseIsbns("Some book 9780471460671; 0471460672 end"), "9780471460671; 0471460672");
  assert.equal(parseIsbns("no digits here"), undefined);
});

// ---------------------------------------------------------------------------
// columnMap — header-driven column resolution
// ---------------------------------------------------------------------------

const REAL_HEADERS = [
  "ID ↕ Time add. ↕ Title ↕ Series ↕",
  "Author(s) ↕",
  "Publisher ↕",
  "Year ↕",
  "Language",
  "Pages",
  "Size ↕",
  "Ext. ↕",
  "Mirrors",
];

test("columnMap resolves the real Libgen header row", () => {
  const map = columnMap(REAL_HEADERS);
  assert.deepEqual(map, {
    title: 0,
    author: 1,
    publisher: 2,
    year: 3,
    language: 4,
    pages: 5,
    size: 6,
    format: 7,
    mirrors: 8,
  });
});

test("columnMap survives a reordered or padded header row", () => {
  // The point of reading headers instead of positions: a mirror that inserts a
  // column must not silently shift every field.
  const map = columnMap(["Cover", "Author(s)", "Title", "Year", "Ext.", "Size"]);
  assert.equal(map.author, 1);
  assert.equal(map.title, 2);
  assert.equal(map.year, 3);
  assert.equal(map.format, 4);
  assert.equal(map.size, 5);
});

test("columnMap returns nothing usable for an empty header row", () => {
  assert.deepEqual(columnMap([]), {});
  assert.deepEqual(columnMap(["", "  "]), {});
});

test("the positional fallback matches the common .li layout", () => {
  assert.equal(LIBGEN_DEFAULT_COLUMNS.author, 1);
  assert.equal(LIBGEN_DEFAULT_COLUMNS.size, 6);
  assert.equal(LIBGEN_DEFAULT_COLUMNS.format, 7);
});

// ---------------------------------------------------------------------------
// parseBibtex — the structured metadata Libgen embeds
// ---------------------------------------------------------------------------

const REAL_BIBTEX =
  "@book{book:{91346036}, title = {Pairs Trading: Quantitative Methods and Analysis}, " +
  "author = {Ganapathy Vidyamurthy}, publisher = {Wiley}, isbn = {9780471460671; 0471460672}, " +
  "year = {2004}, series = {Wiley Finance}, " +
  "url = {libgen.li/file.php?md5=524037f395462d37b31f2b28fede24fb}}";

test("parseBibtex reads the real Libgen entry", () => {
  const p = parseBibtex(REAL_BIBTEX);
  assert.equal(p.title, "Pairs Trading: Quantitative Methods and Analysis");
  assert.equal(p.author, "Ganapathy Vidyamurthy");
  assert.equal(p.publisher, "Wiley");
  assert.equal(p.isbn, "9780471460671; 0471460672");
  assert.equal(p.year, "2004");
  assert.equal(p.series, "Wiley Finance");
  assert.equal(p.url, "libgen.li/file.php?md5=524037f395462d37b31f2b28fede24fb");
});

test("parseBibtex finds an entry embedded in surrounding page text", () => {
  const noisy = `Search in WorldCat ${REAL_BIBTEX} Some trailing advertisement text`;
  assert.equal(parseBibtex(noisy).author, "Ganapathy Vidyamurthy");
});

test("parseBibtex handles braces inside a value", () => {
  const p = parseBibtex("@book{k, title = {Sets {A} and {B}}, year = {2001}}");
  assert.equal(p.title, "Sets {A} and {B}");
  assert.equal(p.year, "2001");
});

test("parseBibtex returns an empty object rather than throwing on junk", () => {
  assert.deepEqual(parseBibtex("no bibtex here"), {});
  assert.deepEqual(parseBibtex("@book{unterminated"), {});
  assert.deepEqual(parseBibtex(""), {});
});

// ---------------------------------------------------------------------------
// isUsefulLink — junk download links (pure; moved from details.test)
// ---------------------------------------------------------------------------

test("isUsefulLink rejects links that are not about this book", () => {
  const md5 = "524037f395462d37b31f2b28fede24fb";
  assert.deepEqual(
    [
      // Real junk emitted by get_download_links: Libgen's ads.php page links the
      // Anna's Archive domain root, which downloads nothing.
      isUsefulLink("http://annas-archive.org/", md5),
      isUsefulLink("https://annas-archive.gs/", md5),
      isUsefulLink("https://libgen.li/", md5),
      // Anything not naming the hash is not a link to this book.
      isUsefulLink("https://libgen.li/ads.php?md5=deadbeef", md5),
      isUsefulLink("https://example.com/book/12345", md5),
      // Malformed input must not throw.
      isUsefulLink("not a url", md5),
    ],
    [false, false, false, false, false, false]
  );
});

test("isUsefulLink accepts the mirrors that actually serve this book", () => {
  const md5 = "524037f395462d37b31f2b28fede24fb";
  assert.deepEqual(
    [
      isUsefulLink(`https://libgen.li/get.php?md5=${md5}&key=ABC`, md5),
      isUsefulLink(`https://library.sk/download/${md5}`, md5),
      isUsefulLink(`https://z-lib.to/md5/${md5}`, md5),
      // Case-insensitive, because mirrors differ.
      isUsefulLink(`https://x.test/${md5.toUpperCase()}`, md5),
      // IPFS gateway links carry a CID, not the md5.
      isUsefulLink("https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", md5),
    ],
    [true, true, true, true, true]
  );
});
