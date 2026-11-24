#!/usr/bin/env node
// Repo Trace: see your local API's calls as a live waterfall.
//
//   trace [folder]            pick a project in folder (default: the one repo-trace is in), then run it
//   trace dev [args]          run `wrangler dev`, and watch what it logs
//   trace -- <command…>       run any command and watch what it logs
//   <command> | trace         watch what a command prints
//   trace demo                sample traffic, to try the viewer
//
// Options: --port <n> (default 4400), --open (open the browser), --show (keep trace lines in the terminal)

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.mjs';
import { parseLine, lineSplitter, fromWranglerLine, passThrough } from '../src/parse.mjs';
import { findProjects } from '../src/projects.mjs';
import { runDemo, DEMO_ROUTES } from '../src/demo.mjs';

// Where projects are looked for by default: the folder repo-trace sits in (~/Code), as Repo Atlas does.
const HOME_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HELP = `Repo Trace: your API's calls as a live waterfall.

  trace [folder]                   pick a project, then run it
                                   (default folder: the one repo-trace is in)
  trace dev [wrangler args]        run wrangler dev here and watch it
  trace -- <command…>              run any command and watch it
  <command> | trace                watch what a command prints
  trace demo                       sample traffic, to try the viewer

Options
  --port <n>    viewer port (default 4400)
  --open        open the viewer in the browser
  --show        keep trace lines in the terminal too

A call is one line of JSON with a "trace" key. See docs/format.md.`;

function parseArgs(argv) {
  const opt = { port: 4400, open: false, rest: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opt.rest = argv.slice(i + 1); opt.cmd = 'run'; return opt; }
    if (a === '--port') { opt.port = Number(argv[++i]); continue; }
    if (a === '--open') { opt.open = true; continue; }
    if (a === '--show') { opt.show = true; continue; }
    if (a === '-h' || a === '--help') { opt.cmd = 'help'; return opt; }
    if (!opt.cmd) { opt.cmd = a; continue; }
    opt.rest.push(a);
  }
  return opt;
}

function isDir(p) {
  try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch { /* fine */ }
}

// Run a command, show its output unchanged, and read it.
// Trace lines are kept out of the terminal (the viewer has them) unless show.
function watchProcess(command, args, { onLine, show }) {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  });
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.setEncoding('utf8');
    const copy = passThrough(out, onLine || (() => null), { show });
    stream.on('data', (chunk) => copy.push(chunk));
    stream.on('end', () => copy.end());
  }
  child.on('error', (err) => {
    console.error(`trace: couldn't run ${command}: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    console.error(`trace: ${command} stopped${signal ? ` (${signal})` : ` with code ${code}`}`);
    process.exit(code ?? 1);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  return child;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.cmd === 'help') { console.log(HELP); return; }
  // No command, or a folder: the project picker. (Piped input with no command is read as before.)
  if ((!opt.cmd && process.stdin.isTTY) || (opt.cmd && opt.cmd !== 'serve' && !['dev', 'run', 'demo'].includes(opt.cmd) && isDir(opt.cmd))) {
    opt.rest = opt.cmd ? [opt.cmd] : [];
    opt.cmd = 'serve';
  }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  let source;
  // The project in this folder, if it is one: its routes can be listed.
  const here = ['dev', 'run'].includes(opt.cmd) ? (await findProjects(process.cwd())).find((p) => p.dir === process.cwd()) ?? null : null;
  if (here) {
    const rel = relative(HOME_FOLDER, here.dir);
    if (rel && !rel.startsWith('..')) here.label = rel;
  }
  if (opt.cmd === 'serve') {
    const root = resolve(opt.rest[0] || HOME_FOLDER);
    if (!isDir(root)) { console.error(`trace: no folder at ${root}`); process.exit(1); }
    source = { mode: 'serve', root, label: root };
  } else if (opt.cmd === 'demo') source = { mode: 'demo', label: 'Sample traffic' };
  else if (opt.cmd === 'dev') source = { mode: 'local', label: `wrangler dev${opt.rest.length ? ' ' + opt.rest.join(' ') : ''}` };
  else if (opt.cmd === 'run') source = { mode: 'local', label: opt.rest.join(' ') };
  else if (!opt.cmd) source = { mode: 'local', label: 'stdin' };
  else { console.error(`trace: unknown command "${opt.cmd}"\n\n${HELP}`); process.exit(1); }

  // The demo plays a sample API: its routes come with it.
  const project = opt.cmd === 'demo' ? { id: 'demo', label: 'Sample API', routes: DEMO_ROUTES } : here;
  let viewer;
  try {
    viewer = await startServer({ port: opt.port, source, project });
  } catch (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `trace: port ${opt.port} is taken. Try --port ${opt.port + 1}`
      : `trace: ${err.message}`);
    process.exit(1);
  }
  console.error(`trace: viewer on ${viewer.url} · ${source.label}`);
  if (opt.open) openBrowser(viewer.url);

  const onLine = (line) => { const e = parseLine(line); if (e) viewer.emit(e); return e; };
  // wrangler dev's own request lines become requests too; they stay in the terminal.
  const onDevLine = (line) => { const r = fromWranglerLine(line); if (r) r.forEach(viewer.emit); return onLine(line); };

  if (opt.cmd === 'serve') {
    if (!opt.open) console.error('trace: open the viewer to pick a project (--open opens it)');
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { viewer.stopAll(); setTimeout(() => process.exit(0), 300); });
  } else if (opt.cmd === 'demo') runDemo(viewer.emit);
  else if (opt.cmd === 'dev') watchProcess(npx, ['wrangler', 'dev', '--var', 'TRACE:1', ...opt.rest], { onLine: onDevLine, show: opt.show });
  else if (opt.cmd === 'run') watchProcess(opt.rest[0], opt.rest.slice(1), { onLine, show: opt.show });
  else {
    const lines = lineSplitter((line) => { if (!onLine(line) || opt.show) process.stdout.write(line + '\n'); });
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => lines.push(c));
    process.stdin.on('end', () => { lines.end(); console.error('trace: input ended; the viewer stays open (Ctrl+C to stop)'); });
  }
}

main();
