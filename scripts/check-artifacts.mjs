// Consumer acceptance: actual archives, outside checkout, no build/dev tools at runtime.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import spawn from "cross-spawn";
import { unpackExtension } from "@anthropic-ai/mcpb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PROJECT_ROOT, readRootPackage } from "./lib/pkg.mjs";

const pkg = readRootPackage();
const stem = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}`;
const archive = join(PROJECT_ROOT, "artifacts", `${stem}.tgz`);
const bundle = join(PROJECT_ROOT, "artifacts", `${stem}.mcpb`);
const box = mkdtempSync(join(tmpdir(), "biblio-consumer-"));
const bytes = Buffer.concat([Buffer.from("%PDF-1.4 artifact acceptance\n"), Buffer.alloc(128, 1)]);
const md5 = createHash("md5").update(bytes).digest("hex");
const mirror = createServer((req, res) => {
  if (req.url.startsWith("/ads.php")) {
    res.writeHead(200, { "content-type": "text/html" }).end(
      `Library Genesis <a href="get.php?md5=${md5}&key=TEST">GET</a>`
    );
  } else if (req.url.startsWith("/get.php")) {
    res.writeHead(200, { "content-type": "application/pdf" }).end(bytes);
  } else res.writeHead(404).end();
});
await new Promise((resolve) => mirror.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${mirror.address().port}`;
const env = {
  BIBLIO_LIBGEN_MIRRORS: base, BIBLIO_ANNAS_MIRRORS: base,
  BIBLIO_SCIHUB_MIRRORS: base, BIBLIO_ZLIB_MIRRORS: base,
  BIBLIO_TIMEOUT_MS: "2000", BIBLIO_MIRROR_STAGGER_MS: "0", BIBLIO_ANNAS_API_KEY: "",
};
function run(command, args, cwd) {
  const r = spawn.sync(command, args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, `${command} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function noDevTools(root) {
  for (const name of ["typescript", "tsx", "@anthropic-ai/mcpb"]) {
    assert.equal(existsSync(join(root, "node_modules", name)), false, `dev tool ${name} shipped`);
  }
  assert.equal(existsSync(join(root, "src")), false);
}
async function exercise(label, command, args, cwd, extraEnv = {}) {
  const transport = new StdioClientTransport({ command, args, cwd, env: { ...extraEnv, ...env }, stderr: "pipe" });
  let stderr = "";
  transport.stderr.on("data", (data) => { stderr += data; });
  const client = new Client({ name: "artifact-test", version: "0.0.0" });
  const errors = [];
  client.onerror = (e) => { errors.push(e.message); };
  try {
    await client.connect(transport, { timeout: 120000 });
    assert.equal(client.getServerVersion().version, pkg.version);
    const { tools } = await client.listTools({}, { timeout: 5000 });
    assert.equal(tools.length, 8);
    const invalid = await client.callTool({ name: "book_details", arguments: { md5: "invalid" } }, undefined, { timeout: 5000 });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /"md5" must be a 32-char MD5 hash/);
    const outputDir = join(box, "user-books", label);
    const result = await client.callTool({ name: "download_book", arguments: { md5, output_dir: outputDir, filename: "accepted.pdf" } }, undefined, { timeout: 10000 });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const saved = JSON.parse(result.content[0].text);
    assert.equal(saved.saved, true);
    assert.equal(dirname(saved.path), outputDir, "never write under an install/cache directory");
    assert.deepEqual(readFileSync(saved.path), bytes);
    assert.deepEqual(errors, [], "package-manager stdout must not pollute MCP");
    console.log(`${label}: initialize + 8 tools + invalid call + complete download passed`);
  } catch (error) {
    throw new Error(`${label}: ${stderr}`, { cause: error });
  } finally {
    await client.close();
    await transport.close();
  }
}
try {
  for (const line of readFileSync(join(PROJECT_ROOT, "artifacts", "SHA256SUMS"), "utf8").trim().split("\n")) {
    const [expected, name] = line.split(/  /);
    assert.equal(createHash("sha256").update(readFileSync(join(PROJECT_ROOT, "artifacts", name))).digest("hex"), expected);
  }
  const consumer = join(box, "npm consumer with spaces");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  run("npm", ["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", archive], consumer);
  const installed = join(consumer, "node_modules", "@vernikr", "biblio-mcp");
  noDevTools(consumer);
  noDevTools(installed);
  assert.match(run(process.execPath, [join(installed, "dist", "index.js"), "--selfcheck", "--offline"], consumer), /selfcheck passed/);
  await exercise("npm-installed", process.execPath, [join(installed, "dist", "index.js")], consumer);
  await exercise("npx-pinned", "npx", ["--yes", "--offline", `${pkg.name}@${pkg.version}`], consumer);
  // A local tarball substitutes only the unpublished registry address, not the launcher.
  await exercise("pnpm-dlx", "pnpm", ["--silent", "dlx", archive], box);
  await exercise("pnpm-dlx-offline", "pnpm", ["--silent", "dlx", "--offline", archive], box);

  if (process.argv.includes("--registry")) {
    const prefix = join(box, "isolated-npm-prefix");
    mkdirSync(join(prefix, "lib", "node_modules"), { recursive: true });
    await exercise("npx-public-registry", "npx", ["--yes", `${pkg.name}@${pkg.version}`], box, {
      npm_config_cache: join(box, "cold-npm-registry-cache"), npm_config_prefix: prefix,
    });
    await exercise("pnpm-public-registry", "pnpm", ["--silent", "dlx", `${pkg.name}@${pkg.version}`], box);
  }

  const unpacked = join(box, "mcpb with spaces");
  assert.equal(await unpackExtension({ mcpbPath: bundle, outputDir: unpacked, silent: true }), true);
  noDevTools(unpacked);
  const manifest = JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8"));
  assert.equal(manifest.version, pkg.version);
  const config = manifest.server.mcp_config;
  assert.equal(config.command, "node");
  assert.equal(manifest.compatibility.runtimes.node, pkg.engines.node);
  assert.match(run(process.execPath, [join(unpacked, "dist", "index.js"), "--selfcheck", "--offline"], unpacked), /selfcheck passed/);
  const configuredEnv = Object.fromEntries(Object.entries(config.env).map(([key, value]) => [
    key, value.replace(/\$\{user_config\.([^}]+)\}/g, (_, name) => manifest.user_config[name].default),
  ]));
  await exercise("mcpb", process.execPath, config.args.map((arg) => arg.replaceAll("${__dirname}", unpacked)), unpacked, configuredEnv);
  for (const file of readdirSync(join(installed, "dist"), { recursive: true }).filter((p) => p.endsWith(".js"))) {
    assert.deepEqual(readFileSync(join(installed, "dist", file)), readFileSync(join(unpacked, "dist", file)), `runtime differs: ${file}`);
  }
  console.log("npm/MCPB runtime bytes match; no consumer build or dev tools used.");
} finally {
  mirror.closeAllConnections();
  await new Promise((resolve) => mirror.close(resolve));
  rmSync(box, { recursive: true, force: true });
}
