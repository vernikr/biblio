import { z } from "zod";
import {
  appSchemas,
  appSearchBooks,
  appBookDetails,
  appDownloadLinks,
  appDownloadBook,
  appFetchBook,
  appSearchPapers,
  appGetPaper,
  appHealthcheck,
} from "./application.js";
import { BOOK_SOURCE_IDS } from "./types.js";

const HELP = `biblio-mcp — search books and papers, resolve links, and download files

Usage:
  biblio-mcp search books <query> [--source annas,libgen] [--limit 20] [--json]
  biblio-mcp book details <md5> [--json]
  biblio-mcp book links <md5> [--json]
  biblio-mcp download book <md5> [--output-dir <path>] [--filename <name>] [--json]
  biblio-mcp fetch book <query> [--format PDF] [--output-dir <path>] [--max-attempts 3] [--source annas,libgen] [--json]
  biblio-mcp search papers <query> [--limit 20] [--resolve-pdfs] [--json]
  biblio-mcp paper get <doi-or-url-or-title> [--json]
  biblio-mcp healthcheck [--timeout-ms 8000] [--json]

Options:
  --json                 Print machine-readable JSON to stdout
  --source <list>        Comma-separated book sources: annas, libgen, zlibrary
  --limit <number>       Maximum search results (1–100)
  --output-dir <path>    Directory for downloaded files
  --filename <name>      Download filename
  --format <format>      Preferred file format
  --max-attempts <n>     Download attempts (1–5)
  --resolve-pdfs         Try resolving PDF links for up to three papers
  --timeout-ms <n>       Mirror probe timeout (250–30000)
  -h, --help             Show this help

With no arguments, biblio-mcp starts the MCP stdio server.
`;

type Parsed = { positionals: string[]; options: Map<string, string | true> };

function parseArgs(args: string[]): Parsed {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!token.startsWith("--")) {
      if (token === "-h") options.set("help", true);
      else positionals.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const key = token.slice(2, equal < 0 ? undefined : equal);
    if (!key) throw new Error("Empty option name.");
    if (["json", "resolve-pdfs", "help"].includes(key)) {
      if (equal >= 0) throw new Error(`--${key} does not take a value.`);
      options.set(key, true);
      continue;
    }
    const value = equal >= 0 ? token.slice(equal + 1) : args[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value.`);
    options.set(key, value);
  }
  return { positionals, options };
}

function optionString(parsed: Parsed, key: string): string | undefined {
  const value = parsed.options.get(key);
  return typeof value === "string" ? value : undefined;
}

function optionNumber(parsed: Parsed, key: string): number | undefined {
  const raw = optionString(parsed, key);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`--${key} must be an integer.`);
  return Number(raw);
}

function optionSources(parsed: Parsed) {
  const raw = optionString(parsed, "source");
  if (raw === undefined) return undefined;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return z.array(z.enum(BOOK_SOURCE_IDS)).min(1).parse(values);
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => {
      const field = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return field + issue.message;
    }).join("; "));
  }
  return parsed.data;
}

function human(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "No results.";
    return value.map((item, index) => {
      if (!item || typeof item !== "object") return `${index + 1}. ${String(item)}`;
      const row = item as Record<string, unknown>;
      const title = row.title ?? row.label ?? row.group ?? `Item ${index + 1}`;
      const details = Object.entries(row)
        .filter(([key, val]) => key !== "title" && val !== undefined && val !== null && typeof val !== "object")
        .map(([key, val]) => `${key}: ${String(val)}`);
      return [`${index + 1}. ${String(title)}`, ...details.map((line) => `   ${line}`)].join("\n");
    }).join("\n");
  }
  const record = value as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, item] of Object.entries(record)) {
    if (item === undefined || item === null) continue;
    if (Array.isArray(item)) {
      lines.push(`${key} (${item.length}):`);
      lines.push(item.length ? human(item).split("\n").map((line) => `  ${line}`).join("\n") : "  —");
    } else if (typeof item === "object") {
      lines.push(`${key}:`);
      lines.push(human(item).split("\n").map((line) => `  ${line}`).join("\n"));
    } else {
      lines.push(`${key}: ${String(item)}`);
    }
  }
  return lines.join("\n");
}

function emit(data: unknown, json: boolean): void {
  process.stdout.write(json ? JSON.stringify(data, null, 2) + "\n" : human(data) + "\n");
}

function progress({ bytes, total }: { bytes: number; total?: number }): Promise<void> {
  const mb = (bytes / 1048576).toFixed(1);
  const end = total === undefined ? "" : ` / ${(total / 1048576).toFixed(1)} MB`;
  process.stderr.write(`\rDownloading: ${mb} MB${end}`);
  if (total !== undefined && bytes >= total) process.stderr.write("\n");
  return Promise.resolve();
}

export async function runCli(argv: string[]): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
    if (parsed.options.has("help")) {
      process.stdout.write(HELP);
      return 0;
    }
    const words = parsed.positionals;
    const command = words.slice(0, 2).join(" ");
    const rest = words.slice(2);
    const allowed: Record<string, string[]> = {
      "search books": ["json", "source", "limit"],
      "book details": ["json"], "book links": ["json"],
      "download book": ["json", "output-dir", "filename"],
      "fetch book": ["json", "format", "output-dir", "max-attempts", "source"],
      "search papers": ["json", "limit", "resolve-pdfs"],
      "paper get": ["json"], "healthcheck": ["json", "timeout-ms"],
    };
    if (allowed[command]) {
      for (const key of parsed.options.keys()) {
        if (!allowed[command]!.includes(key)) throw new Error("--" + key + ' is not supported by "' + command + '".');
      }
    }
    const requirePositionals = (min: number, max = min) => {
      if (rest.length < min || rest.length > max) throw new Error('"' + command + '" expects ' + min + (min === max ? "" : "–" + max) + " positional argument(s).");
    };
    const json = parsed.options.has("json");
    const query = (parts: string[]) => parts.join(" ").trim();
    let result;

    switch (command) {
      case "search books": {
        requirePositionals(1, Number.MAX_SAFE_INTEGER);
        const input = validate(z.object({
          query: appSchemas.searchText,
          sources: appSchemas.sources,
          limit: appSchemas.limit,
        }), { query: query(rest), sources: optionSources(parsed), limit: optionNumber(parsed, "limit") });
        result = await appSearchBooks(input);
        break;
      }
      case "book details": {
        requirePositionals(1);
        const input = validate(z.object({ md5: appSchemas.md5 }), { md5: rest[0] });
        result = await appBookDetails(input);
        break;
      }
      case "book links": {
        requirePositionals(1);
        const input = validate(z.object({ md5: appSchemas.md5 }), { md5: rest[0] });
        result = await appDownloadLinks(input);
        break;
      }
      case "download book": {
        requirePositionals(1);
        const input = validate(z.object({
          md5: appSchemas.md5,
          output_dir: appSchemas.outputDir,
          filename: appSchemas.filename,
        }), { md5: rest[0], output_dir: optionString(parsed, "output-dir"), filename: optionString(parsed, "filename") });
        result = await appDownloadBook(input, { onProgress: progress });
        break;
      }
      case "fetch book": {
        requirePositionals(1, Number.MAX_SAFE_INTEGER);
        const input = validate(z.object({
          query: appSchemas.searchText,
          format: appSchemas.format,
          output_dir: appSchemas.outputDir,
          max_attempts: appSchemas.maxAttempts,
          sources: appSchemas.sources,
        }), {
          query: query(rest), format: optionString(parsed, "format"),
          output_dir: optionString(parsed, "output-dir"),
          max_attempts: optionNumber(parsed, "max-attempts"), sources: optionSources(parsed),
        });
        result = await appFetchBook(input, { onProgress: progress });
        break;
      }
      case "search papers": {
        requirePositionals(1, Number.MAX_SAFE_INTEGER);
        const input = validate(z.object({
          query: appSchemas.searchText, limit: appSchemas.limit, resolvePdfs: appSchemas.resolvePdfs,
        }), { query: query(rest), limit: optionNumber(parsed, "limit"), resolvePdfs: parsed.options.has("resolve-pdfs") });
        result = await appSearchPapers(input);
        break;
      }
      case "paper get": {
        requirePositionals(1, Number.MAX_SAFE_INTEGER);
        const input = validate(z.object({ identifier: appSchemas.searchText }), { identifier: query(rest) });
        result = await appGetPaper(input);
        break;
      }
      case "healthcheck": {
        requirePositionals(0);
        const input = validate(z.object({ timeoutMs: appSchemas.timeoutMs }), { timeoutMs: optionNumber(parsed, "timeout-ms") });
        result = await appHealthcheck(input);
        break;
      }
      default:
        throw new Error(`Unknown command: ${words.join(" ") || "(empty)"}\nRun "biblio-mcp --help" for usage.`);
    }

    emit(result.data, json);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`biblio-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
