// The projects Repo Trace can open, and the routes each one answers, read from its code.
//
// A project is a folder with a Wrangler config (wrangler.jsonc, wrangler.json or wrangler.toml), found up to two
// levels under the root (so ~/Code/learn-fm/api counts). Routes are found with patterns, not a compiler, like
// Repo Atlas: pathname checks, path segments read from pathname.split('/'), router calls (app.get('/x')), switch cases.

import { readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, join, relative } from 'node:path';

const CONFIGS = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.wrangler', '.astro', '.next', 'out', 'ios', 'android', '.expo']);
const CODE = /\.(m?[jt]sx?|cjs)$/;

/** JSON with comments and trailing commas (wrangler.jsonc) → a value. */
export function parseJsonc(text) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** The few settings Repo Trace needs from a Wrangler config. */
export function readConfig(text, file) {
  if (file.endsWith('.toml')) {
    const top = text.split(/^\s*\[/m)[0];
    const get = (k) => (top.match(new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']+)["']`, 'm')) || [])[1];
    return { name: get('name'), main: get('main'), assets: /^\s*\[assets\]/m.test(text), port: Number((text.match(/^\s*port\s*=\s*(\d+)/m) || [])[1]) || null };
  }
  const c = parseJsonc(text);
  return { name: c.name, main: c.main, assets: !!c.assets, port: (c.dev && c.dev.port) || null };
}

function git(dir, args) {
  return new Promise((resolve) => execFile('git', ['-C', dir, ...args], { timeout: 3000 }, (err, out) => resolve(err ? '' : String(out).trim())));
}

/** Projects under `root`, most recently changed first. */
export async function findProjects(root) {
  const found = [];
  async function look(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    const config = CONFIGS.find((c) => entries.some((e) => e.isFile() && e.name === c));
    if (config) found.push({ dir, config });
    if (depth >= 2) return;
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) await look(join(dir, e.name), depth + 1);
    }
  }
  await look(root, 0);

  const projects = [];
  for (const { dir, config } of found) {
    let cfg;
    try { cfg = readConfig(await readFile(join(dir, config), 'utf8'), config); } catch { continue; }
    if (!cfg.main) continue; // assets only: no API
    const rel = relative(root, dir) || basename(dir);
    const last = Number(await git(dir, ['log', '-1', '--format=%ct'])) * 1000 || (await stat(dir)).mtimeMs;
    projects.push({
      id: rel.split('/').join('~'),
      label: rel,
      dir,
      config,
      worker: cfg.name || basename(dir),
      main: cfg.main,
      assets: cfg.assets,
      port: cfg.port,
      changed: last,
    });
  }
  return projects.sort((a, b) => b.changed - a.changed);
}

// ---------- routes ----------

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';

// What one line says about a route.
function readLine(code, splitVars) {
  const info = { path: null, prefix: false, segs: {}, len: null, methods: [] };
  for (const m of code.matchAll(new RegExp(`method\\s*===?\\s*(['"\`])(${METHODS})\\1`, 'g'))) info.methods.push(m[2]);
  // `method !== "POST"` near a path: only POST is answered
  for (const m of code.matchAll(new RegExp(`method\\s*!==?\\s*(['"\`])(${METHODS})\\1`, 'g'))) info.methods.push(m[2]);
  let m;
  if ((m = code.match(/pathname\s*===?\s*(['"`])(\/[^'"`]*)\1/))) info.path = m[2];
  else if ((m = code.match(/pathname\.startsWith\(\s*(['"`])(\/[^'"`]*)\1/))) { info.path = m[2]; info.prefix = true; }
  else if ((m = code.match(new RegExp(`\\.(get|post|put|patch|delete|all|options|head)\\(\\s*(['"\`])(\\/[^'"\`]*)\\2`, 'i')))) {
    info.path = m[3];
    if (m[1].toLowerCase() !== 'all') info.methods.push(m[1].toUpperCase());
  } else if ((m = code.match(/\bcase\s+(['"`])(\/[^'"`]*)\1\s*:/))) info.path = m[2];
  else if ((m = code.match(/\bpathname:\s*(['"`])(\/[^'"`]*)\1/))) info.path = m[2];
  for (const v of splitVars) {
    for (const s of code.matchAll(new RegExp(`\\b${v}\\[(\\d+)\\]\\s*===?\\s*(['"\`])([^'"\`]+)\\2`, 'g'))) info.segs[s[1]] = s[3];
    const l = code.match(new RegExp(`\\b${v}\\.length\\s*===?\\s*(\\d+)`));
    if (l) info.len = Number(l[1]);
  }
  return info;
}

function pathOf(info) {
  if (info.path) return info.prefix ? info.path.replace(/\/?$/, '/*') : info.path;
  const keys = Object.keys(info.segs).map(Number);
  if (!keys.length || !(0 in info.segs)) return null;
  const n = info.len ?? Math.max(...keys) + 1;
  const parts = Array.from({ length: n }, (_, i) => info.segs[i] ?? ':id');
  return '/' + parts.join('/') + (info.len == null ? '/*' : '');
}

const hasRoute = (i) => i.path || Object.keys(i.segs).length > 0;

function braces(code) {
  // Braces outside strings, roughly: enough to follow `if (…) {` blocks.
  let n = 0, q = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '{') n++;
    else if (c === '}') n--;
  }
  return n;
}

/** Routes in one file's text: [{ method, path, line }]. */
export function routesIn(text) {
  const splitVars = [...text.matchAll(/(\w+)\s*=\s*[\w.]*pathname\s*\.split\(\s*(['"])\/\2\s*\)/g)].map((m) => m[1]);
  const found = [];
  const stack = []; // blocks opened by a line that names a route
  let depth = 0;
  text.split('\n').forEach((raw, i) => {
    const code = raw.replace(/(^|[^:])\/\/.*$/, '$1');
    const info = readLine(code, splitVars);
    const ctx = stack.length ? stack[stack.length - 1].info : null;
    let merged = null;
    if (hasRoute(info) || (ctx && (info.methods.length || info.len != null))) {
      merged = {
        path: info.path ?? (Object.keys(info.segs).length ? null : ctx?.path ?? null),
        prefix: info.path ? info.prefix : ctx?.prefix ?? false,
        segs: { ...(ctx?.segs || {}), ...info.segs },
        len: info.len ?? ctx?.len ?? null,
        methods: info.methods.length ? info.methods : ctx?.methods ?? [],
      };
      const path = pathOf(merged);
      if (path) found.push({ methods: merged.methods, path, line: i + 1, inBlock: !hasRoute(info) });
    }
    const open = braces(code);
    if (merged && hasRoute(info) && open > 0) stack.push({ depth: depth + open, info: merged });
    depth += open;
    while (stack.length && depth < stack[stack.length - 1].depth) stack.pop();
  });

  // One route per method; a path answered with some methods doesn't also show as "any".
  const out = new Map();
  for (const r of found) {
    const methods = r.methods.length ? [...new Set(r.methods)] : ['ANY'];
    for (const method of methods) {
      const key = `${method} ${r.path}`;
      if (!out.has(key)) out.set(key, { method, path: r.path, line: r.line });
    }
  }
  const byPath = new Map();
  for (const r of out.values()) {
    if (!byPath.has(r.path)) byPath.set(r.path, []);
    byPath.get(r.path).push(r);
  }
  const result = [];
  for (const list of byPath.values()) {
    const specific = list.filter((r) => r.method !== 'ANY');
    result.push(...(specific.length ? specific : list));
  }
  // A block that opens on a path prefix (`/v1/calls/:id/turns/*`) and names its routes inside isn't a route itself.
  const paths = new Set(result.map((r) => r.path));
  return result.filter((r) => !(r.method === 'ANY' && r.path.endsWith('/*') && paths.has(r.path.slice(0, -2)))).sort((a, b) => a.line - b.line);
}

/** Every route of a project, with the file and line it's in. */
export async function findRoutes(project) {
  const start = dirname(join(project.dir, project.main));
  const files = [];
  async function walk(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4 && !SKIP.has(e.name) && !e.name.startsWith('.') && e.name !== 'test' && e.name !== '__tests__') await walk(p, depth + 1); }
      else if (CODE.test(e.name) && !/\.(test|spec|d)\.[^.]+$/.test(e.name)) files.push(p);
    }
  }
  await walk(start, 0);
  const routes = [];
  for (const f of files.slice(0, 400)) {
    let text;
    try { text = await readFile(f, 'utf8'); } catch { continue; }
    if (text.length > 400_000 || !/pathname|\.(get|post|put|patch|delete)\(/.test(text)) continue;
    for (const r of routesIn(text)) routes.push({ ...r, file: relative(project.dir, f) });
  }
  if (project.assets) routes.push({ method: 'GET', path: '/*', file: null, line: null, assets: true });
  return routes;
}

/** A route's path → a pattern that matches request paths, and how specific it is. */
export function routeMatcher(path) {
  const src = path.split('/').map((s) => (s === '*' ? '.*' : s.startsWith(':') ? '[^/]+' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('/');
  const literal = path.split('/').filter((s) => s && s !== '*' && !s.startsWith(':')).length;
  return { re: new RegExp(`^${src}/?$`), score: literal * 10 - (path.includes('*') ? 5 : 0) };
}
