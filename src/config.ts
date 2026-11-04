// The single list of environment settings the server reads.
//
// --help and the README table are generated from ENV_SETTINGS, and the numeric
// settings read their defaults from NUMBER_SETTINGS, so a default is written in
// exactly one place. A test fails if README.md drifts from these tables.

export interface NumberSetting {
  name: string;
  fallback: number;
  allowZero?: boolean;
}

/** Numeric budgets, in milliseconds. Invalid input falls back; only mirror staggering permits zero. */
export const NUMBER_SETTINGS = {
  timeoutMs: { name: "BIBLIO_TIMEOUT_MS", fallback: 8000 },
  downloadTimeoutMs: { name: "BIBLIO_DOWNLOAD_TIMEOUT_MS", fallback: 30_000 },
  downloadStallMs: { name: "BIBLIO_DOWNLOAD_STALL_MS", fallback: 30_000 },
  mirrorDeadTtlMs: { name: "BIBLIO_MIRROR_DEAD_TTL_MS", fallback: 300_000 },
  mirrorStaggerMs: { name: "BIBLIO_MIRROR_STAGGER_MS", fallback: 120, allowZero: true },
} as const satisfies Record<string, NumberSetting>;

export function readNumber(setting: NumberSetting): number {
  const raw = process.env[setting.name]?.trim();
  if (!raw) return setting.fallback;
  const n = Number(raw);
  return Number.isFinite(n) && (n > 0 || (setting.allowZero && n === 0)) ? n : setting.fallback;
}

export interface EnvSetting {
  name: string;
  help: string;
  /** Plain-text default, shown in --help and the README table. */
  defaultText: string;
}

/** Lists whose real defaults live in src/mirrors.ts; pointing there avoids a second copy. */
const MIRROR_DEFAULT = "built-in list (src/mirrors.ts)";

/** Everything the user can set, in the order --help and README list it. */
export const ENV_SETTINGS: readonly EnvSetting[] = [
  {
    name: NUMBER_SETTINGS.timeoutMs.name,
    help: "Timeout for scraping an HTML page, including reading its response body",
    defaultText: `${NUMBER_SETTINGS.timeoutMs.fallback}`,
  },
  {
    name: NUMBER_SETTINGS.downloadTimeoutMs.name,
    help: "Fail a download attempt that sends no response headers for this long",
    defaultText: `${NUMBER_SETTINGS.downloadTimeoutMs.fallback}`,
  },
  {
    name: NUMBER_SETTINGS.downloadStallMs.name,
    help: "Abort a download idle for this long",
    defaultText: `${NUMBER_SETTINGS.downloadStallMs.fallback}`,
  },
  {
    name: NUMBER_SETTINGS.mirrorDeadTtlMs.name,
    help: "How long a failed mirror is skipped",
    defaultText: `${NUMBER_SETTINGS.mirrorDeadTtlMs.fallback}`,
  },
  {
    name: NUMBER_SETTINGS.mirrorStaggerMs.name,
    help: "Head start between concurrent mirror attempts; 0 starts all at once",
    defaultText: `${NUMBER_SETTINGS.mirrorStaggerMs.fallback}`,
  },
  {
    name: "BIBLIO_ANNAS_API_KEY",
    help: "Anna's Archive member key; enables the fast-download JSON API, which is not behind the DDoS-Guard challenge",
    defaultText: "unset",
  },
  {
    name: "BIBLIO_DISABLE_SOURCES",
    help: "Sources excluded from the default search set",
    defaultText: "zlibrary",
  },
  { name: "BIBLIO_ANNAS_MIRRORS", help: "Comma-separated Anna's Archive base URLs", defaultText: MIRROR_DEFAULT },
  { name: "BIBLIO_LIBGEN_MIRRORS", help: "Comma-separated Libgen base URLs", defaultText: MIRROR_DEFAULT },
  { name: "BIBLIO_SCIHUB_MIRRORS", help: "Comma-separated Sci-Hub base URLs", defaultText: MIRROR_DEFAULT },
  { name: "BIBLIO_ZLIB_MIRRORS", help: "Comma-separated Z-Library domains", defaultText: MIRROR_DEFAULT },
  { name: "BIBLIO_IPFS_GATEWAYS", help: "IPFS gateway bases for CID fallback", defaultText: MIRROR_DEFAULT },
  {
    name: "BIBLIO_SKIP_STARTUP_CHECK",
    help: "Set to any value to skip the startup tool-surface check and serve even if it is broken",
    defaultText: "unset",
  },
];

/** The "Environment:" block of --help, aligned in two columns. */
export function environmentHelp(): string {
  const width = Math.max(...ENV_SETTINGS.map((s) => s.name.length)) + 2;
  return ENV_SETTINGS.map(
    (s) => `  ${s.name.padEnd(width)}${s.help} (default: ${s.defaultText})`
  ).join("\n");
}

/** The markdown table README.md carries between its env-table markers. */
export function environmentTable(): string {
  const rows = ENV_SETTINGS.map((s) => `| \`${s.name}\` | ${s.help} | ${s.defaultText} |`);
  return ["| Variable | Purpose | Default |", "|---|---|---|", ...rows].join("\n");
}

export const ENV_TABLE_START = "<!-- env-table:start (generated from src/config.ts) -->";
export const ENV_TABLE_END = "<!-- env-table:end -->";
