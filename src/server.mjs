// The local viewer: one page, a stream of events (server-sent events) and, when Repo Trace was opened on a folder of
// projects, a small API to pick one and start or stop it.
// Bound to 127.0.0.1 only: what a process logs never leaves this computer. Requests that start anything must come
// from the page itself (a custom header and the same origin), so another site can't start a project.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findProjects, findRoutes } from './projects.mjs';
import { createSessions, whoami, login } from './session.mjs';

const PAGE = fileURLToPath(new URL('../viewer/index.html', import.meta.url));
const KEEP = 20000; // events kept for a page opened late
const KEEP_OUTPUT = 400;

/**
 * source: what this run watches ({ mode, label }), or { mode: 'serve', root } for the project picker.
 * project: the project the fixed source runs in, if any, so its routes can be listed.
 */
export function startServer({ port, source, project = null }) {
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

  let projectsCache = null;
  const projects = async (fresh = false) => {
    if (source.mode !== 'serve') return project ? [project] : [];
    if (!projectsCache || fresh) projectsCache = await findProjects(source.root);
    return projectsCache;
  };
  const routesCache = new Map();
  const routes = async (p) => {
    if (!routesCache.has(p.id)) routesCache.set(p.id, await findRoutes(p));
    return routesCache.get(p.id);
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
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (req.headers['x-repo-trace'] !== '1' || (origin && origin !== `http://${host}`)) return json(res, 403, { error: 'Only the Repo Trace page can do that' });
      }

      if (path === '/api/projects' && req.method === 'GET') {
        const list = await projects(url.searchParams.has('fresh'));
        const out = [];
        for (const p of list) out.push({ id: p.id, label: p.label, worker: p.worker, main: p.main, changed: p.changed, routes: (await routes(p)).length });
        return json(res, 200, { root: source.root ?? null, projects: out });
      }
      const pm = path.match(/^\/api\/projects\/([^/]+)\/(routes|whoami)$/);
      if (pm) {
        const p = (await projects()).find((x) => x.id === decodeURIComponent(pm[1]));
        if (!p) return json(res, 404, { error: 'Unknown project' });
        if (pm[2] === 'routes') return json(res, 200, { routes: await routes(p) });
        return json(res, 200, await whoami(p.dir));
      }
      if (path === '/api/login' && req.method === 'POST') {
        const { project: id } = await body(req);
        const p = (await projects()).find((x) => x.id === id);
        if (!p) return json(res, 404, { error: 'Unknown project' });
        const ok = await login(p.dir);
        return json(res, 200, ok ? await whoami(p.dir) : { signedIn: false, error: 'Sign-in didn\'t finish' });
      }
      if (path === '/api/session' && sessions) {
        if (req.method === 'POST') {
          const { project: id, mode } = await body(req);
          const p = (await projects()).find((x) => x.id === id);
          if (!p || !['local', 'production'].includes(mode)) return json(res, 400, { error: 'Pick a project and a mode' });
          return json(res, 200, sessions.start(p, mode));
        }
        if (req.method === 'DELETE') { sessions.stop(); return json(res, 200, sessions.view()); }
      }
      return json(res, 404, { error: 'Not found' });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  });

  const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
  ping.unref();
  const stopAll = () => { try { sessions?.stop(); } catch { /* fine */ } };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ emit: hub.emit, url: `http://localhost:${server.address().port}`, server, stopAll }));
  });
}
