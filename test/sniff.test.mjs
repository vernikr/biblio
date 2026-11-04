// Unit tests for file-format sniffing.
//
// Run via `pnpm test` (which builds first). No network, no fixtures.

import test from "node:test";
import assert from "node:assert/strict";
import { sniffExt } from "../dist/sniff.js";

const epubHead = () => {
  // ZIP local file header whose first entry declares the EPUB mimetype.
  const b = Buffer.alloc(128);
  b.write("PK", 0, "latin1");
  b.write("mimetypeapplication/epub+zip", 30, "latin1");
  return b;
};

test("sniffExt recognises PDF by magic bytes", () => {
  assert.equal(sniffExt(Buffer.from("%PDF-1.7\nrest", "latin1")), "pdf");
});

test("sniffExt distinguishes EPUB from a plain ZIP", () => {
  assert.equal(sniffExt(epubHead()), "epub");
  assert.equal(sniffExt(Buffer.concat([Buffer.from("PK", "latin1"), Buffer.alloc(64)])), "zip");
});

test("sniffExt recognises RAR, MOBI and DjVu", () => {
  assert.equal(sniffExt(Buffer.from("Rar!\u001a\u0007\u0000", "latin1")), "rar");

  const mobi = Buffer.alloc(80);
  mobi.write("BOOKMOBI", 60, "latin1");
  assert.equal(sniffExt(mobi), "mobi");

  assert.equal(sniffExt(Buffer.from("AT&TFORM", "latin1")), "djvu");
});

test("sniffExt falls back to content-type, then to bin", () => {
  const opaque = Buffer.from("nothing recognisable here", "latin1");
  assert.equal(sniffExt(opaque, "application/epub+zip"), "epub");
  assert.equal(sniffExt(opaque, "application/pdf"), "pdf");
  assert.equal(sniffExt(opaque, "application/octet-stream"), "bin");
  assert.equal(sniffExt(opaque), "bin");
});

test("sniffExt does not crash on an empty buffer", () => {
  // Mirrors serve every format as octet-stream, so the content-type fallback is
  // the only signal for a zero-length or truncated response.
  assert.equal(sniffExt(Buffer.alloc(0), "application/pdf"), "pdf");
  assert.equal(sniffExt(Buffer.alloc(0)), "bin");
});

test("sniffExt classifies a truncated head by the bytes that are there", () => {
  // A short read is still a file: the old length gate answered "bin" for a
  // two-byte ZIP signature and hid what the mirror had already sent.
  assert.equal(sniffExt(Buffer.from("PK", "latin1")), "zip");
  assert.equal(sniffExt(Buffer.from("%PD", "latin1")), "bin");
  // The MOBI marker sits at offset 60; 67 bytes cannot hold it.
  const almostMobi = Buffer.alloc(67);
  almostMobi.write("BOOKMOB", 60, "latin1");
  assert.equal(sniffExt(almostMobi), "bin");
});

test("sniffExt reads the content-type header whatever its case", () => {
  const opaque = Buffer.from("nothing recognisable here", "latin1");
  assert.equal(sniffExt(opaque, "Application/PDF"), "pdf");
  assert.equal(sniffExt(opaque, "application/EPUB+zip"), "epub");
});

test("sniffExt falls back to ZIP when the EPUB marker is past the scanned window", () => {
  const far = Buffer.alloc(8192);
  far.write("PK", 0, "latin1");
  far.write("mimetypeapplication/epub+zip", 6000, "latin1");
  assert.equal(sniffExt(far), "zip");
});
