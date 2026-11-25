#!/usr/bin/env node
// Repo Trace: see your local API's calls, live, instead of scrolling the terminal.
//
//   trace <command…>          run your dev command and watch it (trace npm run dev, trace ./dev.sh)
//   trace dev [args]          run `wrangler dev` here, with TRACE=1, and watch it
//   <command> | trace         watch what a command prints
//   trace demo                a sample API, to try the viewer
//
// Options, before the command: --port <n> (default 4400), --open (open the browser), --show (keep trace lines in the
// terminal). The command runs in this terminal as usual; Repo Trace only reads what it prints.

import { spawn, execFileSync } from 'node:child_process';
import { basename, dirname, relative } from 'node:path';
import { startServer } from '../src/server.mjs';
import { parseLine, lineSplitter, fromWranglerLine, passThrough } from '../src/parse.mjs';
import { findProjects } from '../src/projects.mjs';
import { runDemo, DEMO_ROUTES } from '../src/demo.mjs';

const HELP = `Repo Trace: your local API's calls, live, instead of scrolling the terminal.

  trace <command…>          run your dev command and watch it:
                              trace npm run dev
                              trace ./dev.sh
  trace dev [args]          run wrangler dev here (with TRACE=1) and watch it
  <command> | trace         watch what a command prints
  trace demo                a sample API, to try the viewer

Options, before the command
  --port <n>    viewer port (default 4400)
  --open        open the viewer in the browser
  --show        keep trace lines in the terminal too

The command runs in this terminal as usual. Repo Trace reads the requests it
prints, and any line of JSON with a "trace" key (docs/format.md). Add it to a
script to keep it one word away:  "dev:trace": "trace npm run dev"`;

function parseArgs(argv) {
  const opt = { port: 4400, open: false, show: false, cmd: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') { opt.port = Number(argv[++i]); continue; }
    if (a === '--open') { opt.open = true; continue; }
    if (a === '--show') { opt.show = true; continue; }
    if (a === '-h' || a === '--help') { opt.cmd = 'help'; return opt; }
    // The command starts here: everything after it is the command's own.
    const rest = argv.slice(i);
    if (a === '--') { opt.cmd = 'run'; opt.rest = rest.slice(1); }
    else if (a === 'dev' || a === 'demo') { opt.cmd = a; opt.rest = rest.slice(1); }
    else { opt.cmd = 'run'; opt.rest = rest; }
    return opt;
  }
  return opt;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch { /* fine */ }
}

// The project this runs in, for its routes: the Worker in this folder, else the one below it (learn-fm → learn-fm/api).
// Named from its repo: learn-fm/api.
async function projectHere(cwd) {
  // Only this folder or a folder right inside it: from a home folder, don't pick up some project further down.
  const all = (await findProjects(cwd)).filter((x) => x.dir === cwd || dirname(x.dir) === cwd);
  const p = all.find((x) => x.dir === cwd) || all[0];
  if (!p) return null;
  let top = null;
  try { top = execFileSync('git', ['-C', p.dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not in git */ }
  p.label = top ? relative(dirname(top), p.dir) : basename(p.dir);
  return p;
}

// Run a command in this terminal, its output copied unchanged, and read it.
// Trace lines are kept out of the terminal (the viewer has them) unless show.
function watchProcess(command, args, { onLine, show }) {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    // TRACE=1 tells apps that log their steps (lib/trace.ts) to turn the lines on.
    env: { ...process.env, TRACE: process.env.TRACE ?? '1', FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
    shell: process.platform === 'win32',
  });
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.setEncoding('utf8');
    const copy = passThrough(out, onLine, { show });
    stream.on('data', (chunk) => copy.push(chunk));
    stream.on('end', () => copy.end());
  }
  child.on('error', (err) => {
    console.error(`trace: couldn't run ${command}: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  // Ctrl+C reaches the command too (same terminal); wait for it to stop rather than leaving it running.
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (child.exitCode === null) child.kill(sig); });
  return child;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.cmd === 'help' || (!opt.cmd && process.stdin.isTTY)) { console.log(HELP); return; }
  if (opt.cmd === 'run' && !opt.rest.length) { console.error(`trace: which command? For example: trace npm run dev\n\n${HELP}`); process.exit(1); }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const source = opt.cmd === 'demo' ? { mode: 'demo', label: 'Sample traffic' }
    : opt.cmd === 'dev' ? { mode: 'local', label: ['wrangler dev', ...opt.rest].join(' ') }
    : opt.cmd === 'run' ? { mode: 'local', label: opt.rest.join(' ') }
    : { mode: 'local', label: 'piped input' };
  // The demo plays a sample API: its routes come with it.
  const project = opt.cmd === 'demo' ? { id: 'demo', label: 'Sample API', routes: DEMO_ROUTES } : await projectHere(process.cwd());

  let viewer;
  try {
    viewer = await startServer({ port: opt.port, source, project });
  } catch (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `trace: port ${opt.port} is taken (another Repo Trace?). Try --port ${opt.port + 1}`
      : `trace: ${err.message}`);
    process.exit(1);
  }
  console.error(`trace: calls on ${viewer.url}${project && opt.cmd !== 'demo' ? ` · routes from ${project.label}` : ''}`);
  if (opt.open) openBrowser(viewer.url);

  // A trace line, or one of wrangler dev's own request lines (`GET /v1/x 200 OK (38ms)`), which stays in the terminal.
  const onLine = (line) => {
    const e = parseLine(line);
    if (e) { viewer.emit(e); return e; }
    const r = fromWranglerLine(line);
    if (r) r.forEach(viewer.emit);
    return null;
  };

  if (opt.cmd === 'demo') runDemo(viewer.emit);
  else if (opt.cmd === 'dev') watchProcess(npx, ['wrangler', 'dev', '--var', 'TRACE:1', ...opt.rest], { onLine, show: opt.show });
  else if (opt.cmd === 'run') watchProcess(opt.rest[0], opt.rest.slice(1), { onLine, show: opt.show });
  else {
    const lines = lineSplitter((line) => { if (!onLine(line) || opt.show) process.stdout.write(line + '\n'); });
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => lines.push(c));
    process.stdin.on('end', () => { lines.end(); console.error('trace: input ended; the viewer stays open (Ctrl+C to stop)'); });
  }
}

main();
