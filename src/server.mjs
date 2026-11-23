// The local viewer: one page, and a stream of events (server-sent events).
// Bound to 127.0.0.1 only: what a process logs never leaves this computer.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PAGE = fileURLToPath(new URL('../viewer/index.html', import.meta.url));
const KEEP = 20000; // events kept for a page opened late

export function startServer({ port, source }) {
  const log = [];
  const clients = new Set();

  function emit(e) {
    if (!e || typeof e !== 'object') return;
    if (e.at === undefined && e.trace !== 'group') e.at = Date.now();
    log.push(e);
    if (log.length > KEEP) log.splice(0, log.length - KEEP);
    const msg = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      try {
        const html = await readFile(PAGE);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
      } catch {
        res.writeHead(500).end('Viewer missing');
      }
      return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`retry: 1000\nevent: source\ndata: ${JSON.stringify(source)}\n\n`);
      for (const e of log) res.write(`data: ${JSON.stringify(e)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404).end('Not found');
  });

  // Keep idle connections alive through proxies and sleeping tabs.
  const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
  ping.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ emit, url: `http://localhost:${server.address().port}`, server }));
  });
}
