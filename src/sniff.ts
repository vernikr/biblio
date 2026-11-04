// File-format sniffing.

const MAGIC: ReadonlyArray<{ ext: string; match: (b: Buffer) => boolean }> = [
  { ext: "pdf", match: (b) => b.subarray(0, 4).toString("latin1") === "%PDF" },
  {
    // ZIP-based: EPUB has "mimetype" as the first archive entry naming
    // application/epub+zip; CBZ/plain ZIP will not. Cheap heuristic: scan the
    // first few KB for the EPUB mimetype string.
    ext: "epub",
    match: (b) =>
      b.subarray(0, 2).toString("latin1") === "PK" &&
      b.subarray(0, 4096).toString("latin1").includes("application/epub+zip"),
  },
  {
    ext: "zip",
    match: (b) => b.subarray(0, 2).toString("latin1") === "PK",
  },
  { ext: "rar", match: (b) => b.subarray(0, 4).toString("latin1") === "Rar!" },
  { ext: "mobi", match: (b) => b.subarray(60, 68).toString("latin1") === "BOOKMOBI" },
  { ext: "djvu", match: (b) => b.subarray(0, 8).toString("latin1") === "AT&TFORM" },
];

/** Guess a file extension from the leading bytes, then from content-type.
 *
 *  Each matcher reads only the bytes it needs, so a truncated download is
 *  classified by what is actually there rather than by its length: a two-byte
 *  "PK" is a ZIP, a three-byte header is not a PDF. */
export function sniffExt(buffer: Buffer, contentType?: string | null): string {
  for (const { ext, match } of MAGIC) {
    if (match(buffer)) return ext;
  }
  // Mirrors disagree on the case of this header.
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("epub")) return "epub";
  if (type.includes("pdf")) return "pdf";
  return "bin";
}
