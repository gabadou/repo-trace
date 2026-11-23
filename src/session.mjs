// A session: one project, run locally (wrangler dev) or watched in production (wrangler tail), started and stopped
// from the page. One at a time.

import { spawn, execFile } from 'node:child_process';
import { parseLine, lineSplitter, objectSplitter, fromTail, fromWranglerLine, plain } from './parse.mjs';

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export function createSessions(hub) {
  let current = null; // { project, mode, child, status, message, url, startedAt }

  const view = () => current && {
    project: current.project.id, label: current.project.label, worker: current.project.worker,
    mode: current.mode, status: current.status, message: current.message, url: current.url, startedAt: current.startedAt,
  };
  const set = (patch) => { Object.assign(current, patch); hub.session(view()); };

  function stop() {
    const s = current;
    if (!s) return;
    if (s.child && s.child.exitCode === null) {
      s.stopping = true;
      killTree(s.child, 'SIGINT');
      setTimeout(() => { if (s.child.exitCode === null) killTree(s.child, 'SIGKILL'); }, 4000).unref();
    }
    set({ status: 'stopped', message: null });
  }

  function start(project, mode) {
    if (current) stop();
    hub.reset();
    current = { project, mode, status: 'starting', message: null, url: null, startedAt: Date.now() };
    const s = current;
    const args = mode === 'production'
      ? ['wrangler', 'tail', '--format', 'json']
      // TRACE=1: projects that log their calls (learn.fm) turn the lines on; others ignore it.
      : ['wrangler', 'dev', '--var', 'TRACE:1'];
    hub.output(`$ npx ${args.join(' ')}   (in ${project.label})`);
    const child = spawn(NPX, args, {
      cwd: project.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: '0', WRANGLER_SEND_METRICS: 'false' },
    });
    s.child = child;
    hub.session(view());

    const onText = (line) => {
      const text = plain(line);
      if (s !== current) return;
      const e = parseLine(text);
      if (e) { hub.emit(e); return; }
      const req = mode === 'local' && fromWranglerLine(text);
      if (req) { req.forEach(hub.emit); return; }
      if (text.trim()) hub.output(text);
      let m;
      if (mode === 'local' && (m = text.match(/Ready on (https?:\/\/\S+)/))) set({ status: 'running', url: m[1] });
      if (mode === 'production' && /Connected to|waiting for logs/i.test(text)) set({ status: 'running' });
      if (/\[ERROR\]|✘/.test(text)) s.lastError = text.replace(/^.*?(?:✘\s*)?\[ERROR\]\s*/, '').replace(/^.*?✘\s*/, '').trim();
    };

    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      if (mode === 'production' && stream === child.stdout) {
        const read = objectSplitter((ev) => { if (s === current) fromTail(ev).forEach(hub.emit); });
        stream.on('data', (c) => read.push(c));
      } else {
        const lines = lineSplitter(onText);
        stream.on('data', (c) => lines.push(c));
        stream.on('end', () => lines.end());
      }
    }
    child.on('error', (err) => { if (s === current) set({ status: 'failed', message: `Couldn't run npx: ${err.message}` }); });
    child.on('exit', (code) => {
      if (s !== current || s.stopping) return;
      set({ status: code === 0 ? 'stopped' : 'failed', message: code === 0 ? null : (s.lastError || `wrangler stopped (code ${code}). See Output.`) });
    });
    return view();
  }

  return { start, stop, view, get current() { return current; } };
}

function killTree(child, sig) {
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, sig);
    else child.kill(sig);
  } catch { /* already gone */ }
}

/** Who wrangler is signed in as, in that project's folder: { signedIn, email }. */
export function whoami(dir) {
  return new Promise((resolve) => {
    execFile(NPX, ['wrangler', 'whoami'], { cwd: dir, timeout: 30000, env: { ...process.env, FORCE_COLOR: '0', WRANGLER_SEND_METRICS: 'false' } }, (err, out, errOut) => {
      const text = plain(`${out}\n${errOut}`);
      if (/not authenticated|wrangler login/i.test(text)) return resolve({ signedIn: false });
      const email = (text.match(/associated with the email\s+(\S+?)[.!]?\s/i) || [])[1] || null;
      if (/logged in|associated with/i.test(text)) return resolve({ signedIn: true, email });
      resolve({ signedIn: false, error: err ? 'Couldn\'t run wrangler whoami' : null });
    });
  });
}

/** Opens Cloudflare's sign-in page in the browser (wrangler login) and waits for it. */
export function login(dir) {
  return new Promise((resolve) => {
    const child = spawn(NPX, ['wrangler', 'login'], { cwd: dir, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
