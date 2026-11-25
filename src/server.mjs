// The local viewer: one page, a stream of events (server-sent events), and the routes of the project the command runs
// in. It starts nothing: the command runs in the developer's terminal.
// Bound to 127.0.0.1 only: what a process logs never leaves this computer. /api requests must come from the page
// itself (a custom header, the same origin, and a localhost Host, against DNS rebinding).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readProject } from './projects.mjs';

const PAGE = fileURLToPath(new URL('../viewer/index.html', import.meta.url));
const KEEP = 20000; // events kept for a page opened late

/**
 * source: what this run watches ({ mode, label }): the command, piped input or the demo.
 * project: the project it runs in, if any, so its routes can be listed.
 */
export function startServer({ port, source, project = null }) {
  const log = [];
  const clients = new Set();
  const send = (data) => {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  const emit = (e) => {
    if (!e || typeof e !== 'object') return;
    if (e.at === undefined && e.trace !== 'group') e.at = Date.now();
    log.push(e);
    if (log.length > KEEP) log.splice(0, log.length - KEEP);
    send(e);
  };

  let routes = null;
  // A project with its routes given (the demo's sample API) isn't read from disk.
  const readRoutes = async () => {
    if (!routes) routes = project.routes || (await readProject(project)).routes;
    return routes;
  };

  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };

  // The page itself: our header (a page elsewhere can't send it without asking first), our origin if one is sent, and
  // a Host that names this computer.
  function fromPage(req) {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    return req.headers['x-repo-trace'] === '1'
      && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      && (!origin || origin === `http://${host}`);
  }

  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
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
        for (const e of log) res.write(`data: ${JSON.stringify(e)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (!path.startsWith('/api/')) return res.writeHead(404).end('Not found');
      if (!fromPage(req)) return json(res, 403, { error: 'Only the Repo Trace page can do that' });
      if (path === '/api/routes' && req.method === 'GET') return json(res, 200, { routes: project ? await readRoutes() : null });
      return json(res, 404, { error: 'Not found' });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  });

  const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
  ping.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ emit, url: `http://localhost:${server.address().port}`, server }));
  });
}
