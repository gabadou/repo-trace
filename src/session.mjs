// A session: one project, run locally with wrangler dev, started and stopped from the page. One at a time.

import { spawn } from 'node:child_process';
import { parseLine, lineSplitter, fromWranglerLine, plain } from './parse.mjs';

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export function createSessions(hub) {
  let current = null; // { project, child, status, message, url, startedAt }

  const view = () => current && {
    project: current.project.id, label: current.project.label, worker: current.project.worker,
    status: current.status, message: current.message, url: current.url, startedAt: current.startedAt,
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

  function start(project) {
    if (current) stop();
    hub.reset();
    current = { project, status: 'starting', message: null, url: null, startedAt: Date.now() };
    const s = current;
    // TRACE=1: projects that log their calls (learn.fm) turn the lines on; others ignore it.
    const args = ['wrangler', 'dev', '--var', 'TRACE:1'];
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
      const req = fromWranglerLine(text);
      if (req) { req.forEach(hub.emit); return; }
      if (text.trim()) hub.output(text);
      let m;
      if ((m = text.match(/Ready on (https?:\/\/\S+)/))) set({ status: 'running', url: m[1] });
      if (/\[ERROR\]|✘/.test(text)) s.lastError = text.replace(/^.*?(?:✘\s*)?\[ERROR\]\s*/, '').replace(/^.*?✘\s*/, '').trim();
    };

    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      const lines = lineSplitter(onText);
      stream.on('data', (c) => lines.push(c));
      stream.on('end', () => lines.end());
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
