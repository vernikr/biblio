import { probeMirror, type MirrorProbe } from "./http.js";

// Mirror registry: ordered candidate hosts per source. The order is a weak
// preference, not a ranking — the `healthcheck` tool measures the live picture,
// and the mirror cache prefers whichever host answered last. A host that is
// down stays listed, because these hosts come back.
function fromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Identity marker: a host is Anna's Archive only if its pages say so. */
export const ANNAS_IDENTITY = /Anna[’']s Archive/i;

/** Anna's Archive. Only hosts that pass the identity marker are listed. */
export const ANNAS_MIRRORS = fromEnv("BIBLIO_ANNAS_MIRRORS", [
  "https://annas-archive.gl",
  "https://annas-archive.gd",
  "https://annas-archive.pk",
  // Deliberately absent: annas-archive.li (hijacked, serves an ad page) and the
  // hosts that stopped serving the real site.
]);

/** Library Genesis. `.bz` is not in the upstream host list — it is added here
 *  because it served the catalogue while the `.is` family did not. */
export const LIBGEN_MIRRORS = fromEnv("BIBLIO_LIBGEN_MIRRORS", [
  "https://libgen.li",
  "https://libgen.bz",
  "https://libgen.vg",
  "https://libgen.is",
  "https://libgen.rs",
  "https://libgen.st",
  "https://libgen.gs",
]);

/** Sci-Hub. A host flips between serving the article, answering with a
 *  human-verification challenge and failing outright, so this order is a weak
 *  preference rather than a ranking. */
export const SCIHUB_MIRRORS = fromEnv("BIBLIO_SCIHUB_MIRRORS", [
  "https://sci-hub.ru",
  "https://sci-hub.ren",
  "https://sci-hub.mksa.top",
  "https://sci-hub.st",
  "https://sci-hub.hkvisa.net",
  "https://sci-hub.se",
]);

/** Z-Library. Not in the default source set; the listed hosts redirect away
 *  from search or fail. */
export const ZLIBRARY_MIRRORS = fromEnv("BIBLIO_ZLIB_MIRRORS", [
  "https://z-library.sk",
  "https://1lib.sk",
  "https://z-lib.io",
  "https://zlibrary-global.se",
]);

// Public IPFS gateways used as a last-resort download path for records that
// expose an IPFS CID (common on Anna's Archive).
export const IPFS_GATEWAYS = fromEnv("BIBLIO_IPFS_GATEWAYS", [
  "https://ipfs.io/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://gateway.pinata.cloud/ipfs",
]);

/** Every mirror group the selfcheck probe walks. */
export interface MirrorGroup {
  group: string;
  mirrors: string[];
  probePath: string;
  expect?: RegExp;
}

export interface MirrorGroupProbe {
  group: string;
  results: MirrorProbe[];
  reachable: number;
  total: number;
  ok: boolean;
  fastestMs: number | null;
  impostors: string[];
}

export const MIRROR_GROUPS: ReadonlyArray<MirrorGroup> = [
  {
    group: "annas",
    mirrors: ANNAS_MIRRORS,
    probePath: "/",
    expect: ANNAS_IDENTITY,
  },
  {
    group: "libgen",
    mirrors: LIBGEN_MIRRORS,
    probePath: "/",
    expect: /Library Genesis/i,
  },
  {
    group: "scihub",
    mirrors: SCIHUB_MIRRORS,
    probePath: "/",
    expect: /Sci-Hub/i,
  },
  {
    group: "zlibrary",
    mirrors: ZLIBRARY_MIRRORS,
    probePath: "/",
    expect: /Z[- ]Library/i,
  },
];

export async function probeGroup(
  group: MirrorGroup,
  options: { timeoutMs?: number } = {}
): Promise<MirrorGroupProbe> {
  const results = await Promise.all(
    group.mirrors.map((base) =>
      probeMirror(base, group.probePath, { timeoutMs: options.timeoutMs, expect: group.expect })
    )
  );
  const alive = results.filter((result) => result.ok);
  return {
    group: group.group,
    results,
    reachable: alive.length,
    total: group.mirrors.length,
    ok: alive.length > 0,
    fastestMs: alive.length ? Math.min(...alive.map((result) => result.ms)) : null,
    impostors: results.filter((result) => result.impostor).map((result) => result.base),
  };
}

export function toHealthcheckGroup(probe: MirrorGroupProbe) {
  const { results, ...summary } = probe;
  return {
    ...summary,
    mirrors: results.map((result) => ({
      base: result.base,
      ok: result.ok,
      status: result.status,
      ms: result.ms,
      ...(result.impostor ? { impostor: true } : {}),
      ...(result.error ? { error: result.error } : {}),
    })),
  };
}
