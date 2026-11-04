// Z-Library provider — best-effort, no-auth public search.

import * as cheerio from "cheerio";
import { fetchFromMirrors } from "../http.js";
import { ZLIBRARY_MIRRORS } from "../mirrors.js";
import { absoluteUrl, parseFormat, parseSize, parseYear } from "../parse.js";
import type { Book } from "../types.js";

const GROUP = "zlibrary";

export async function search(query: string, limit: number): Promise<Book[]> {
  const { html, base } = await fetchFromMirrors(GROUP, ZLIBRARY_MIRRORS, (b) =>
    `${b}/s/${encodeURIComponent(query)}`
  );
  const $ = cheerio.load(html);
  const books: Book[] = [];

  // Z-Library result cards vary by theme; try the common selectors.
  const cards = $(
    "z-bookcard, .book-item, .resItemBox, [class*='bookRow'], .book-card"
  );

  cards.each((_i, el) => {
    if (books.length >= limit) return false;
    const $el = $(el);

    const title =
      $el.attr("title") ||
      $el.find("h3 a, .title a, [slot='title'], .bookTitle").first().text().trim() ||
      $el.find("a[href*='/book/']").first().text().trim();
    if (!title) return;

    const href =
      $el.attr("href") ||
      $el.find("a[href*='/book/']").first().attr("href") ||
      "";
    const author =
      $el.attr("author") ||
      $el.find(".author, [slot='author'], [class*='author']").first().text().trim() ||
      undefined;
    const blob = $el.text().replace(/\s+/g, " ");
    const year = parseYear($el.attr("year")) ?? parseYear(blob);
    const format =
      parseFormat($el.attr("extension")) ??
      parseFormat(blob.match(/\b(pdf|epub|mobi|djvu|azw3)\b/i)?.[1]);
    const size = parseSize($el.attr("filesize")) ?? parseSize(blob);

    books.push({
      source: "zlibrary",
      title,
      author,
      year,
      format,
      size,
      url: absoluteUrl(href, base),
    });
  });

  return books;
}
