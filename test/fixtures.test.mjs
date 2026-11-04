import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBibtex } from "../dist/parse.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const captures = [
  {
    file: "libgen-books.html",
    sha256: "e6c77226ddffa67b600b7ac1008ea0289c4d1e5dfb0a2da12710d3581879fc03",
  },
  {
    file: "libgen-scimag.html",
    sha256: "2c5a2a92338981d130c8b5af9f0eed20e2d46ddca02088bdff9b5e0c73213b36",
  },
  {
    file: "libgen-ads.html",
    sha256: "c57d391e7a98100b865f48ad23b1626f6804b00ac452e65fe140e2c6fbc316b2",
  },
  {
    file: "scihub-doi.html",
    sha256: "ce06165f3766a6c38b0b8c8250dc4fbb62246a7a56e46e60dd513f73830ed33f",
  },
  {
    file: "scihub-altcha.html",
    sha256: "759bdb7383cd8a656ebc2dc9d060a3bb97ab7dba7fac1515bf3fe86eaf9e3438",
  },
  {
    file: "scihub-no-pdf.html",
    sha256: "b671280f610aa8124f5826772697c1a8d76c012d3bde8e0f2b0201abfdd77566",
  },
];

const read = (file) => readFile(join(FIXTURES, file), "utf8");

for (const capture of captures) {
  test(`${capture.file} matches its captured SHA-256`, async () => {
    const html = await read(capture.file);
    assert.equal(createHash("sha256").update(html).digest("hex"), capture.sha256);
  });
}

test("the captured Libgen book page includes its title and author", async () => {
  const html = await read("libgen-books.html");
  assert.match(html, /Pairs Trading: Quantitative Methods and Analysis/);
  assert.match(html, /Ganapathy Vidyamurthy/);
  assert.match(html, /524037f395462d37b31f2b28fede24fb/);
});

test("the captured Libgen ads page yields the expected BibTeX metadata", async () => {
  const bibtex = parseBibtex(await read("libgen-ads.html"));
  assert.equal(bibtex.title, "Pairs Trading: Quantitative Methods and Analysis");
  assert.equal(bibtex.author, "Ganapathy Vidyamurthy");
  assert.equal(bibtex.publisher, "Wiley");
  assert.equal(bibtex.year, "2004");
});

test("the captured Sci-Hub page contains a PDF embed, not a challenge", async () => {
  const html = await read("scihub-doi.html");
  assert.match(html, /Nanometre-scale thermometry in a living cell/);
  assert.match(html, /<embed[^>]+application\/pdf[^>]+sci\.bban\.top\/pdf\/10\.1038\/nature12373\.pdf/i);
  assert.doesNotMatch(html, /altcha|captcha|проверка на робота/i);
});

test("the captured Sci-Hub challenge page is a human-verification page, not an article", async () => {
  const html = await read("scihub-altcha.html");
  assert.match(html, /проверка на робота/);
  assert.match(html, /altcha-widget/);
  assert.doesNotMatch(html, /<embed[^>]+application\/pdf/i);
});
