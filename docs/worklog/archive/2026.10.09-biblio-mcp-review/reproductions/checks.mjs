// Audit probes for snapshot e9b30ca. Uses only local HTTP servers and built files.
// Run after installing dependencies and building ../repo.
import { createServer as httpServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../repo/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../repo/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';

const here = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const servers = [];
const directories = [];
const print = (data) => console.log(JSON.stringify({ check: mode, ...data }, null, 2));
async function serve(handler) {
  const server = httpServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function tempDir() {
  const dir = await mkdtemp(join(here, 'probe-'));
  directories.push(dir);
  return dir;
}
function mirrorEnv(base) {
  process.env.BIBLIO_LIBGEN_MIRRORS = base;
  process.env.BIBLIO_ANNAS_MIRRORS = base;
  process.env.BIBLIO_ZLIB_MIRRORS = base;
  process.env.BIBLIO_SCIHUB_MIRRORS = base;
  process.env.BIBLIO_TIMEOUT_MS = '1000';
  process.env.BIBLIO_MIRROR_STAGGER_MS = '0';
  delete process.env.BIBLIO_ANNAS_API_KEY;
}
async function call(name, args) {
  const { createServer } = await import('../repo/dist/server.js');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'audit', version: '1' });
  try {
    await Promise.all([server.connect(st), client.connect(ct)]);
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    return { isError: result.isError === true, payload: JSON.parse(text) };
  } finally {
    await client.close();
    await server.close();
  }
}
try {
  if (mode === 'settings') {
    process.env.BIBLIO_MIRROR_STAGGER_MS = '0';
    const { readNumber, NUMBER_SETTINGS } = await import('../repo/dist/config.js');
    const { fetchFromMirrors } = await import('../repo/dist/http.js');
    let emptyMirrorError;
    try { await fetchFromMirrors('zlibrary', [], () => ''); }
    catch (error) { emptyMirrorError = error.message; }
    print({ requestedStaggerMs: 0, effectiveStaggerMs: readNumber(NUMBER_SETTINGS.mirrorStaggerMs), emptyMirrorError });
  } else if (mode === 'download-timeout') {
    process.env.BIBLIO_DOWNLOAD_TIMEOUT_MS = '150';
    process.env.BIBLIO_DOWNLOAD_STALL_MS = '1000';
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.write('%PDF-1.7\n');
      let sent = 0;
      const timer = setInterval(() => {
        res.write('data\n');
        if (++sent === 10) { clearInterval(timer); res.end(); }
      }, 60);
      res.on('close', () => clearInterval(timer));
    });
    const dir = await tempDir();
    const { downloadToFile } = await import('../repo/dist/http.js');
    const started = Date.now();
    try {
      const result = await downloadToFile(base + '/book', join(dir, 'book.pdf'), { timeoutMs: 150 });
      print({ budgetMs: 150, elapsedMs: Date.now() - started, saved: true, bytes: result.bytes });
    } catch (error) {
      print({ budgetMs: 150, elapsedMs: Date.now() - started, saved: false, error: error.message });
    }
  } else if (mode === 'no-overwrite') {
    const dir = await tempDir();
    const destination = join(dir, 'mine.pdf');
    const hash = 'd'.repeat(32);
    const body = Buffer.from('%PDF-1.7\nDownloaded bytes\n');
    let fileCreatedDuringDownload = false;
    const base = await serve((req, res) => {
      if (req.url.startsWith('/ads.php')) {
        return res.writeHead(200, { 'content-type': 'text/html' }).end(`<a href="get.php?md5=${hash}&key=K">GET</a>`);
      }
      if (req.url.startsWith('/get.php')) {
        // This runs only after the MCP handler's access() precheck has passed.
        writeFileSync(destination, 'USER FILE CREATED AFTER PRECHECK');
        fileCreatedDuringDownload = true;
        return res.writeHead(200, { 'content-type': 'application/pdf' }).end(body);
      }
      res.writeHead(404).end('not found');
    });
    mirrorEnv(base);
    const result = await call('download_book', { md5: hash, output_dir: dir, filename: 'mine.pdf' });
    const final = await readFile(destination);
    print({ fileCreatedDuringDownload, saved: result.payload.saved, isError: result.isError, userFilePreserved: final.toString() === 'USER FILE CREATED AFTER PRECHECK', replacedWithDownload: final.equals(body) });
  } else if (mode === 'links-outage') {
    let status = 503;
    const base = await serve((_req, res) => res.writeHead(status).end(status === 503 ? 'down' : 'not found'));
    mirrorEnv(base);
    const args = { md5: 'c'.repeat(32) };
    const down = await call('get_download_links', args);
    status = 404;
    const missing = await call('get_download_links', args);
    print({ allSourcesUnavailable: down, recordMissing: missing, indistinguishable: JSON.stringify(down) === JSON.stringify(missing) });
  } else if (mode === 'scihub-miss') {
    let workingMirrorHits = 0;
    const missing = await serve((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Sci-Hub</title><p>No article here</p>'));
    const working = await serve((_req, res) => {
      workingMirrorHits++;
      res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Sci-Hub paper</title><embed id="pdf" src="/article.pdf">');
    });
    mirrorEnv(missing);
    process.env.BIBLIO_SCIHUB_MIRRORS = `${missing},${working}`;
    const { resolve } = await import('../repo/dist/providers/scihub.js');
    try { print({ result: await resolve('10.1038/example'), workingMirrorHits }); }
    catch (error) { print({ error: error.message, errorName: error.name, workingMirrorHits, workingMirrorHasPdf: true }); }
  } else if (mode === 'empty-input') {
    let requests = 0;
    const base = await serve((_req, res) => {
      requests++;
      res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Library Genesis</title><p>Empty results</p>');
    });
    mirrorEnv(base);
    const result = await call('search_books', { query: '   ', sources: ['libgen'] });
    print({ result, providerRequests: requests });
  } else {
    throw new Error('Unknown probe mode');
  }
} finally {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const dir of directories) await rm(dir, { recursive: true, force: true });
}
