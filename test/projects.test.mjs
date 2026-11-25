import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routesIn, parseJsonc, readConfig, routeMatcher, findProjects, readProject } from '../src/projects.mjs';

const list = (text) => routesIn(text).map((r) => `${r.method} ${r.path}`);

test('pathname checks, with the method on the line or in the block', () => {
  const code = `
const url = new URL(req.url);
const parts = url.pathname.split('/').filter(Boolean);
if (method === 'POST' && url.pathname === '/v1/devices') return a();
if (url.pathname === '/v1/devices/me') {
  if (method === 'GET') return b();
  if (method === 'DELETE') return c();
}
if (parts[0] === 'v1' && parts[1] === 'admin') return admin(parts);
if (method === 'GET' && parts[0] === 'v1' && parts[1] === 'episodes' && parts.length === 4 && parts[3] === 'audio') return d();
if (parts[0] === 'v1' && parts[1] === 'calls' && parts[3] === 'turns') {
  if (method === 'POST' && parts.length === 4) return e();
}
// if (url.pathname === '/commented') no
`;
  assert.deepEqual(list(code), [
    'POST /v1/devices', 'GET /v1/devices/me', 'DELETE /v1/devices/me', 'ANY /v1/admin/*',
    'GET /v1/episodes/:id/audio', 'POST /v1/calls/:id/turns',
  ]);
});

test('a method refused in the block means only that method', () => {
  const code = `if (url.pathname === "/api/contact") {\n  if (request.method !== "POST") return json(405);\n}\nif (!url.pathname.startsWith("/audio/")) return env.ASSETS.fetch(request);`;
  assert.deepEqual(list(code), ['POST /api/contact', 'ANY /audio/*']);
});

test('routers and switch cases', () => {
  const code = `app.get('/health', h);\napp.post("/v1/items/:id", h);\nrouter.all('/proxy/*', h);\nswitch (url.pathname) {\n  case '/a':\n}`;
  assert.deepEqual(list(code), ['GET /health', 'POST /v1/items/:id', 'ANY /proxy/*', 'ANY /a']);
});

test('wrangler configs', () => {
  const c = parseJsonc('{\n // a comment with "quotes"\n "name": "learn-fm-api", /* block */ "main": "src/index.ts",\n "url": "http://x//y",\n "dev": { "port": 8787 },\n}');
  assert.equal(c.name, 'learn-fm-api');
  assert.equal(c.url, 'http://x//y');
  assert.deepEqual(readConfig('name = "w"\nmain = "src/index.ts"\n[assets]\ndirectory = "public"\n', 'wrangler.toml'), { name: 'w', main: 'src/index.ts', assets: true, port: null });
});

test('a request path finds its route', () => {
  assert.ok(routeMatcher('/v1/episodes/:id/audio').re.test('/v1/episodes/e12/audio'));
  assert.ok(!routeMatcher('/v1/episodes/:id').re.test('/v1/episodes/e12/audio'));
  assert.ok(routeMatcher('/audio/*').re.test('/audio/x/y.mp3'));
  assert.ok(routeMatcher('/v1/episodes').score > routeMatcher('/v1/*').score);
});

test('a project: its id is its folder, its routes, and whether it logs trace lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-'));
  const api = join(root, 'shop', 'api');
  await mkdir(join(api, 'src'), { recursive: true });
  await writeFile(join(api, 'wrangler.jsonc'), '{ "name": "shop-api", "main": "src/index.ts", // comment\n }');
  await writeFile(join(api, 'src', 'index.ts'), "if (url.pathname === '/v1/cart') return cart();\n");
  const [p] = await findProjects(root);
  assert.equal(p.id, api);
  assert.equal(p.label, 'shop/api');
  assert.equal(p.root, root);
  let read = await readProject(p);
  assert.deepEqual(read.routes.map((r) => r.path), ['/v1/cart']);
  assert.equal(read.logs, false);
  await writeFile(join(api, 'src', 'trace.ts'), "console.log(JSON.stringify({ trace: 'span', group: g }));\n");
  read = await readProject(p);
  assert.equal(read.logs, true);
});
