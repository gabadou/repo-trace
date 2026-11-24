import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tilde, untilde, recentFolders } from '../src/folders.mjs';
import { findProjects, readProject } from '../src/projects.mjs';

test('~ in and out of paths', () => {
  assert.equal(tilde('/Users/a/Code', '/Users/a'), '~/Code');
  assert.equal(tilde('/Users/a', '/Users/a'), '~');
  assert.equal(tilde('/Users/ab/Code', '/Users/a'), '/Users/ab/Code');
  assert.equal(untilde('~/Code/', { home: '/Users/a' }), '/Users/a/Code');
  assert.equal(untilde('~', { home: '/Users/a' }), '/Users/a');
  assert.equal(untilde('api', { from: '/x/y' }), '/x/y/api');
  assert.equal(untilde('/', { from: '/x' }), '/');
});

test('recent folders: newest first, no repeats, only folders that still exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trace-'));
  const a = join(dir, 'a'), b = join(dir, 'b');
  await mkdir(a); await mkdir(b);
  const recent = recentFolders(join(dir, 'conf', 'recent.json'));
  assert.deepEqual(await recent.list(), []);
  await recent.add(a); await recent.add(b); await recent.add(a); await recent.add(join(dir, 'gone'));
  assert.deepEqual(await recent.list(), [a, b]);
});

test('a project from any folder: its id is its folder, and whether it logs trace lines', async () => {
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
