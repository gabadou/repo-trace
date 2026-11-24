// The local viewer: one page, a stream of events (server-sent events) and, when Repo Trace was opened on a folder of
// projects, a small API to pick a folder and a project and start or stop it.
// Bound to 127.0.0.1 only: what a process logs never leaves this computer. Every /api request must come from the page
// itself (a custom header, the same origin, and a localhost Host, against DNS rebinding), so another site can't list
// folders or start a project.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findProjects, readProject } from './projects.mjs';
import { createSessions } from './session.mjs';
import { tilde, untilde, isDir, recentFolders, chooseFolder } from './folders.mjs';

const PAGE = fileURLToPath(new URL('../viewer/index.html', import.meta.url));
const KEEP = 20000; // events kept for a page opened late
const KEEP_OUTPUT = 400;

/**
 * source: what this run watches ({ mode, label }), or { mode: 'serve', root } for the project picker.
 * project: the project the fixed source runs in, if any, so its routes can be listed.
 */
export function startServer({ port, source, project = null, recent = recentFolders() }) {
  const log = [];
  const output = [];
  const clients = new Set();
  const send = (type, data) => {
    const msg = `${type ? `event: ${type}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };

  const hub = {
    emit(e) {
      if (!e || typeof e !== 'object') return;
      if (e.at === undefined && e.trace !== 'group') e.at = Date.now();
      log.push(e);
      if (log.length > KEEP) log.splice(0, log.length - KEEP);
      send(null, e);
    },
    output(line) {
      output.push(line);
      if (output.length > KEEP_OUTPUT) output.splice(0, output.length - KEEP_OUTPUT);
      send('output', line);
    },
    session(s) { send('session', s); },
    reset() { log.length = 0; output.length = 0; send('reset', {}); },
  };
  const sessions = source.mode === 'serve' ? createSessions(hub) : null;

  // Projects by id (their folder), from every folder listed so far: only these can be run.
  const known = new Map(project ? [[project.id, project]] : []);
  const listed = new Map(); // folder → its projects
  const projects = async (root, fresh = false) => {
    if (!listed.has(root) || fresh) listed.set(root, await findProjects(root));
    // The folder last listed is the one a project is run from (and remembered as recent).
    for (const p of listed.get(root)) known.set(p.id, p);
    return listed.get(root);
  };
  const read = new Map(); // project id → { routes, logs }
  const info = async (p, fresh = false) => {
    // A project with its routes given (the demo's sample API) isn't read from disk.
    if (!read.has(p.id) || fresh) read.set(p.id, p.routes ? { routes: p.routes, logs: true } : await readProject(p));
    return read.get(p.id);
  };

  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  const body = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/') {
        const html = await readFile(PAGE);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      }
      if (path === '/favicon.ico') return res.writeHead(204).end();
      if (path === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`retry: 1000\nevent: source\ndata: ${JSON.stringify({ ...source, project: project && { id: project.id, label: project.label } })}\n\n`);
        if (sessions?.view()) res.write(`event: session\ndata: ${JSON.stringify(sessions.view())}\n\n`);
        for (const line of output) res.write(`event: output\ndata: ${JSON.stringify(line)}\n\n`);
        for (const e of log) res.write(`data: ${JSON.stringify(e)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (!path.startsWith('/api/')) return res.writeHead(404).end('Not found');
      if (!fromPage(req)) return json(res, 403, { error: 'Only the Repo Trace page can do that' });

      if (path === '/api/projects' && req.method === 'GET') {
        if (source.mode !== 'serve') return json(res, 200, { root: null, projects: [] });
        const root = untilde(url.searchParams.get('root') || source.root);
        if (!(await isDir(root))) return json(res, 400, { error: `No folder at ${tilde(root)}` });
        const fresh = url.searchParams.has('fresh');
        const out = [];
        for (const p of await projects(root, fresh)) {
          const { routes, logs } = await info(p, fresh);
          out.push({ id: p.id, label: p.label, worker: p.worker, main: p.main, port: p.port, changed: p.changed, routes: routes.length, logs });
        }
        return json(res, 200, {
          root: tilde(root), projects: out,
          recent: (await recent.list()).map((f) => tilde(f)),
          canChoose: process.platform === 'darwin',
        });
      }
      if (path === '/api/choose-folder' && req.method === 'POST' && source.mode === 'serve') {
        const { from } = await body(req);
        const start = untilde(from || source.root);
        const got = await chooseFolder((await isDir(start)) ? start : source.root);
        return json(res, got.error ? 500 : 200, got.folder ? { folder: tilde(got.folder) } : got);
      }
      const pm = path.match(/^\/api\/projects\/([^/]+)\/routes$/);
      if (pm) {
        const p = known.get(decodeURIComponent(pm[1]));
        if (!p) return json(res, 404, { error: 'Unknown project' });
        return json(res, 200, { routes: (await info(p)).routes });
      }
      if (path === '/api/session' && sessions) {
        if (req.method === 'POST') {
          const { project: id } = await body(req);
          const p = known.get(id);
          if (!p) return json(res, 400, { error: 'Pick a project' });
          if (p.root) recent.add(p.root);
          return json(res, 200, sessions.start(p));
        }
        if (req.method === 'DELETE') { sessions.stop(); return json(res, 200, sessions.view()); }
      }
      return json(res, 404, { error: 'Not found' });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  });

  // The page itself: our header (a page elsewhere can't send it without asking first), our origin if one is sent, and
  // a Host that names this computer.
  function fromPage(req) {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    return req.headers['x-repo-trace'] === '1'
      && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      && (!origin || origin === `http://${host}`);
  }

  const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
  ping.unref();
  const stopAll = () => { try { sessions?.stop(); } catch { /* fine */ } };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ emit: hub.emit, url: `http://localhost:${server.address().port}`, server, stopAll }));
  });
}
