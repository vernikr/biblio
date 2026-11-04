// One compiled runtime: normal npm tarball + portable MCPB with locked production deps.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import spawn from "cross-spawn";
import { packExtension } from "@anthropic-ai/mcpb";
import { PROJECT_ROOT, readRootPackage } from "./lib/pkg.mjs";

const pkg = readRootPackage();
const out = join(PROJECT_ROOT, "artifacts");
const stem = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}`;
const stage = mkdtempSync(join(tmpdir(), "biblio-mcpb-stage-"));
const run = (args) => {
  const r = spawn.sync("pnpm", args, { cwd: PROJECT_ROOT, stdio: "inherit" });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, `pnpm ${args.join(" ")} failed`);
};
try {
  assert.equal(pkg.name, "@vernikr/biblio-mcp", "never package under upstream's npm name");
  assert.ok(readFileSync(join(PROJECT_ROOT, "dist", "index.js")), "build first");
  mkdirSync(out, { recursive: true });
  run(["pack", "--out", join(out, `${stem}.tgz`)]);
  run(["--filter", pkg.name, "deploy", "--prod", "--ignore-scripts", "--node-linker=hoisted", stage]);
  for (const name of ["pnpm-lock.yaml", "pnpm-workspace.yaml"]) rmSync(join(stage, name), { force: true });
  const manifest = {
    manifest_version: "0.3", name: "vernikr-biblio-mcp", display_name: "Biblio MCP",
    version: pkg.version, description: pkg.description,
    author: { name: "vernikr", url: pkg.homepage },
    repository: { type: "git", url: pkg.homepage },
    homepage: pkg.homepage, support: pkg.bugs.url, license: pkg.license,
    server: {
      type: "node", entry_point: "dist/index.js",
      mcp_config: {
        command: "node", args: ["${__dirname}/dist/index.js"],
        env: {
          BIBLIO_ANNAS_API_KEY: "${user_config.annas_api_key}",
          BIBLIO_DISABLE_SOURCES: "${user_config.disabled_sources}",
        },
      },
    },
    tools_generated: true,
    compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: pkg.engines.node } },
    user_config: {
      annas_api_key: {
        type: "string", title: "Anna's Archive member key", required: false, sensitive: true,
        description: "Optional member key for verified fast-download hosts. Leave empty for public links.", default: "",
      },
      disabled_sources: {
        type: "string", title: "Sources excluded from default search", required: false,
        description: "Comma-separated source names: annas, libgen, zlibrary.", default: "zlibrary",
      },
    },
  };
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  assert.equal(await packExtension({ extensionPath: stage, outputPath: join(out, `${stem}.mcpb`), silent: true }), true);
  const sums = ["tgz", "mcpb"].map((ext) => {
    const name = `${stem}.${ext}`;
    return `${createHash("sha256").update(readFileSync(join(out, name))).digest("hex")}  ${name}`;
  });
  writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
  console.log(`Artifacts: ${out}/${stem}.{tgz,mcpb}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
