// --selfcheck: prove the server actually works, without an MCP client.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import { resetMirrorCache } from "./http.js";
import { MIRROR_GROUPS, probeGroup } from "./mirrors.js";
import { TOOL_NAMES } from "./toolmeta.js";
import { BOOK_SOURCES, DISABLED_BOOK_SOURCES } from "./providers/index.js";
import { errText } from "./errors.js";
import { pinnedDependency } from "./pkg.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** dist/ and scripts/ are siblings in the repo and in the published package. */
const PREFLIGHT_SCRIPT = resolve(HERE, "..", "scripts", "preflight.mjs");

/** Tools every working build must expose. A missing one means the registration
 *  changed, which is a breaking change for any agent already using it. */
const REQUIRED_TOOLS = TOOL_NAMES;

async function withInMemoryClient<T>(name: string, run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name, version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await run(client);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

interface StageResult {
  name: string;
  ok: boolean;
  summary: string;
  details?: unknown;
  problem?: string;
  fix?: string;
}

/** Run scripts/preflight.mjs as a child process. */
async function runPreflightStage(): Promise<StageResult> {
  if (!existsSync(PREFLIGHT_SCRIPT)) {
    return {
      name: "preflight",
      ok: false,
      summary: "scripts/preflight.mjs not found",
      problem: `expected it at ${PREFLIGHT_SCRIPT}`,
    };
  }
  const out = await new Promise<{ code: number; stdout: string; stderr: string }>(
    (done) => {
      const child = spawn(process.execPath, [PREFLIGHT_SCRIPT, "--json", "--require-build"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
      child.on("error", (e) => done({ code: 1, stdout, stderr: String(e) }));
    }
  );

  let report: { ok: boolean; checks?: Array<{ name: string; ok: boolean; problem?: string }> } = {
    ok: false,
  };
  try {
    report = JSON.parse(out.stdout);
  } catch {
    return {
      name: "preflight",
      ok: false,
      summary: "preflight produced no parsable output",
      problem: out.stderr.slice(0, 300) || out.stdout.slice(0, 300),
    };
  }

  const failed = (report.checks ?? []).filter((c) => !c.ok);
  return {
    name: "preflight",
    ok: !!report.ok,
    summary: `${(report.checks ?? []).length - failed.length}/${(report.checks ?? []).length} checks passed`,
    details: report.checks,
    problem: failed.map((c) => `${c.name}: ${c.problem ?? "failed"}`).join(" | ") || undefined,
  };
}

const TOOL_FIX =
  `pnpm add ${pinnedDependency("@modelcontextprotocol/sdk")} ${pinnedDependency("zod")} ` +
  "&& pnpm run build  (then re-run: pnpm preflight)";

async function runToolsStage(): Promise<StageResult> {
  try {
    return await withInMemoryClient("biblio-selfcheck", async (client) => {
      const info = client.getServerVersion();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      const missing = REQUIRED_TOOLS.filter((t) => !names.includes(t));
      const stage = {
        name: "tools", ok: false,
        summary: `${names.length} tools exposed by ${info?.name} v${info?.version}`,
        details: { names, serverInfo: info },
      };
      if (missing.length) return {
        ...stage, problem: `missing required tools: ${missing.join(", ")}`, fix: "pnpm run build",
      };
      const result = await client.callTool({ name: "book_details", arguments: { md5: "not-an-md5" } });
      const text = String((result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "");
      if (/_parse is not a function/.test(text)) throw new Error(text);
      if (!result.isError || !/"md5" must be a 32-char MD5 hash/.test(text)) return {
        ...stage,
        problem: `argument validation did not return the expected md5 error (got: ${text.slice(0, 120)})`,
        fix: TOOL_FIX,
      };
      return { ...stage, ok: true, summary: stage.summary + "; invalid-call validation passed" };
    });
  } catch (e) {
    const message = errText(e);
    const incompatible = /_parse is not a function/.test(message);
    return {
      name: "tools", ok: false, summary: "could not exercise tools",
      problem: incompatible
        ? "the argument validator is broken — @modelcontextprotocol/sdk and zod are an incompatible pair"
        : `the tool surface could not be exercised: ${message.slice(0, 200)}`,
      fix: incompatible ? TOOL_FIX : "pnpm run build",
    };
  }
}

async function runMirrorsStage(): Promise<StageResult> {
  resetMirrorCache();
  const groups = await Promise.all(MIRROR_GROUPS.map((group) => probeGroup(group)));
  const alive = groups.filter((group) => group.ok).map((group) => group.group);
  return {
    name: "mirrors",
    ok: alive.length > 0,
    summary: `reachable sources: ${alive.length ? alive.join(", ") : "none"}`,
    details: groups.map(({ group, results }) => ({ group, results })),
    problem: alive.length
      ? undefined
      : "no mirror in any group answered — this looks like a network or DNS block, not a code fault",
  };
}

async function runLiveStage(): Promise<StageResult> {
  try {
    return await withInMemoryClient("biblio-selfcheck", async (client) => {
      const result = await client.callTool(
        { name: "search_books", arguments: { query: "dune frank herbert", limit: 3 } },
        undefined,
        { timeout: 120_000 }
      );
      const text = String((result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "");
      let parsed: { total?: number; errors?: unknown[] } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* fall through with the raw text below */
      }
      return {
        name: "live",
        ok: !result.isError && (parsed.total ?? 0) > 0,
        summary: `search_books returned ${parsed.total ?? 0} results`,
        details: { isError: !!result.isError, errors: parsed.errors, sample: text.slice(0, 400) },
        problem:
          result.isError || (parsed.total ?? 0) === 0
            ? "the tool surface is reachable but a live search produced nothing"
            : undefined,
      };
    });
  } catch (e) {
    return {
      name: "live",
      ok: false,
      summary: "live search_books call failed",
      problem: errText(e),
    };
  }
}

export interface SelfcheckReport {
  ok: boolean;
  stages: StageResult[];
  defaults: { sources: string[]; disabledByDefault: string[] };
}

/** Result of the in-process check run before the server binds stdio. */
export interface StartupCheck {
  ok: boolean;
  /** What is broken, in one line. */
  problem?: string;
  /** The command that fixes it, when one is known. */
  fix?: string;
}

/** Prove the tool surface actually works, before serving a single request. */
export async function runStartupSelftest(): Promise<StartupCheck> {
  const stage = await runToolsStage();
  return stage.ok ? { ok: true } : { ok: false, problem: stage.problem, fix: stage.fix };
}

export async function runSelfcheck(opts: { live?: boolean; offline?: boolean } = {}): Promise<SelfcheckReport> {
  if (opts.offline && opts.live) throw new Error("--offline cannot be combined with --live");
  const stages: StageResult[] = [];
  stages.push(await runPreflightStage());
  stages.push(await runToolsStage());
  if (!opts.offline) stages.push(await runMirrorsStage());
  if (opts.live) stages.push(await runLiveStage());

  // A dead mirror group is degraded, not broken: report it, but only fail the
  // run when nothing at all is reachable.
  const ok = stages.every((s) => s.ok);
  return {
    ok,
    stages,
    defaults: {
      sources: BOOK_SOURCES,
      disabledByDefault: DISABLED_BOOK_SOURCES,
    },
  };
}

const ICON = (ok: boolean) => (ok ? "  ok  " : " FAIL ");

export function printSelfcheck(report: SelfcheckReport): void {
  console.log("biblio-mcp selfcheck\n");
  for (const stage of report.stages) {
    console.log(`${ICON(stage.ok)} ${stage.name.padEnd(9)} ${stage.summary}`);
    if (stage.problem) console.log(`        ↳ ${stage.problem}`);
    if (!stage.ok && stage.fix) console.log(`        fix: ${stage.fix}`);
    if (stage.name === "tools") {
      // The tool names are what a client-side "no tools appear" report is
      // diffed against, so print them rather than only their count.
      const names = (stage.details as { names?: string[] } | undefined)?.names;
      if (Array.isArray(names)) console.log(`          · ${names.join(", ")}`);
    }
    if (stage.name === "mirrors" && Array.isArray(stage.details)) {
      for (const g of stage.details as Array<{
        group: string;
        results: Array<{
          base: string;
          ok: boolean;
          status?: number;
          ms: number;
          impostor?: boolean;
        }>;
      }>) {
        for (const r of g.results) {
          // Distinguish "down" from "answers but is not the site we expect":
          // the second is worse, because it silently returns plausible garbage.
          const verdict = r.impostor
            ? `HTTP ${r.status} — NOT the expected site`
            : r.status
              ? `HTTP ${r.status}`
              : "unreachable";
          console.log(`          ${r.ok ? "·" : "✗"} ${g.group.padEnd(9)} ${r.base.padEnd(30)} ${verdict} ${r.ms}ms`);
        }
      }
    }
  }
  console.log(
    `\ndefault sources: ${report.defaults.sources.join(", ")}` +
      (report.defaults.disabledByDefault.length
        ? ` (excluded by default: ${report.defaults.disabledByDefault.join(", ")})`
        : "")
  );
  console.log(report.ok ? "\nselfcheck passed." : "\nselfcheck FAILED — see the lines above.");
}
