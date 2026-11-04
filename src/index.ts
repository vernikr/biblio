#!/usr/bin/env node
// biblio-mcp stdio entry point; keep diagnostics on stderr so stdout stays valid JSON-RPC.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { runSelfcheck, printSelfcheck, runStartupSelftest } from "./selfcheck.js";
import { environmentHelp } from "./config.js";
import {
  buildLauncherConfig,
  ephemeralPathWarning,
  findOnPath,
  PACKAGE_NAME,
  stableExecPath,
} from "./printConfig.js";

const USAGE = `${SERVER_NAME} v${SERVER_VERSION}

Usage:
  node dist/index.js                     start the MCP server on stdio
  node dist/index.js --selfcheck --offline  verify install and a real tool call, no mirrors
  node dist/index.js --selfcheck         verify install, tool surface, mirrors
  node dist/index.js --selfcheck --live  ...and perform one real search
  node dist/index.js --print-config      print an MCP client entry that runs the newest release via npx
  node dist/index.js --version           print the version
  node dist/index.js --help              show this help

Install / update (from a source checkout):
  node scripts/install.mjs               check, build, verify, print MCP config
  node scripts/install.mjs --dry-run     show every step without writing
  node scripts/install.mjs --write-config <path>
                                         merge the MCP entry into a config file

Environment:
${environmentHelp()}`

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${SERVER_NAME} v${SERVER_VERSION}\n`);
    return 0;
  }

  if (argv.includes("--print-config")) {
    // Pure output: no server, no startup check, no network. stdout is JSON only.
    const npxPath = findOnPath("npx", process.env.PATH);
    if (!npxPath) {
      process.stderr.write(
        "npx not found on PATH: install Node 22+ (it includes npx), or replace \"command\" with its absolute path\n"
      );
    }
    const execPath = stableExecPath(process.execPath);
    for (const p of [execPath, npxPath]) {
      const warning = p ? ephemeralPathWarning(p) : undefined;
      if (warning) process.stderr.write(`warning: ${warning}\n`);
    }
    const config = buildLauncherConfig({
      execPath,
      npxPath: npxPath ?? "npx",
      platform: process.platform,
    });
    process.stdout.write(JSON.stringify(config, null, 2) + "\n");
    process.stderr.write(
      `Paste under your client's MCP config (key "mcpServers"). It launches the newest ${PACKAGE_NAME} release on each start.\n` +
        "Put API keys in the client's env block, not in this output. Enable the server in the client UI.\n"
    );
    return 0;
  }

  if (argv.includes("--offline") && (!argv.includes("--selfcheck") || argv.includes("--live"))) {
    process.stderr.write("--offline requires --selfcheck and cannot be combined with --live\n");
    return 1;
  }
  if (argv.includes("--selfcheck")) {
    const report = await runSelfcheck({ live: argv.includes("--live"), offline: argv.includes("--offline") });
    printSelfcheck(report);
    return report.ok ? 0 : 1;
  }

  // Validate one tool call before binding stdio, so incompatible installs fail early.
  if (!process.env.BIBLIO_SKIP_STARTUP_CHECK) {
    const startup = await runStartupSelftest();
    if (!startup.ok) {
      process.stderr.write(
        `${SERVER_NAME}: refusing to start — ${startup.problem}\n` +
          (startup.fix ? `  fix: ${startup.fix}\n` : "") +
          `  (bypass with BIBLIO_SKIP_STARTUP_CHECK=1 if you need a broken server)\n`
      );
      return 1;
    }
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr, never stdout — see the note at the top of this file.
  process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    // Preserve the failure exit code for clients and shell scripts.
    if (code !== 0) process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`${SERVER_NAME}: fatal: ${String((err as Error)?.stack ?? err)}\n`);
    process.exitCode = 1;
  }
);
