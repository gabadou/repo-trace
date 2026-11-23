#!/usr/bin/env node
// Repo Trace: see your API's calls as a live waterfall, locally and in production.
//
//   trace dev [args]          run `wrangler dev`, and watch what it logs
//   trace tail <worker> [args] watch a deployed Worker (`wrangler tail`)
//   trace -- <command…>       run any command and watch what it logs
//   <command> | trace         watch what a command prints
//   trace demo                sample traffic, to try the viewer
//
// Options: --port <n> (default 4400), --open (open the browser), --show (keep trace lines in the terminal)

import { spawn } from 'node:child_process';
import { startServer } from '../src/server.mjs';
import { parseLine, lineSplitter, objectSplitter, fromTail, passThrough } from '../src/parse.mjs';
import { runDemo } from '../src/demo.mjs';

const HELP = `Repo Trace: your API's calls as a live waterfall.

  trace dev [wrangler args]        run wrangler dev and watch it
  trace tail <worker> [args]       watch a deployed Worker (wrangler tail)
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

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch { /* fine */ }
}

// Run a command, show its output unchanged, and read it.
// Trace lines are kept out of the terminal (the viewer has them) unless show.
function watchProcess(command, args, { onLine, onObject, show }) {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  });
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.setEncoding('utf8');
    if (onObject && stream === child.stdout) {
      const read = objectSplitter(onObject);
      stream.on('data', (chunk) => read.push(chunk));
    } else {
      const copy = passThrough(out, onLine || (() => null), { show });
      stream.on('data', (chunk) => copy.push(chunk));
      stream.on('end', () => copy.end());
    }
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
  if (!opt.cmd && process.stdin.isTTY) opt.cmd = 'help';
  if (opt.cmd === 'help') { console.log(HELP); return; }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  let source;
  if (opt.cmd === 'demo') source = { mode: 'demo', label: 'Sample traffic' };
  else if (opt.cmd === 'dev') source = { mode: 'local', label: `wrangler dev${opt.rest.length ? ' ' + opt.rest.join(' ') : ''}` };
  else if (opt.cmd === 'tail') {
    if (!opt.rest[0]) { console.error('trace: which Worker? trace tail <worker>'); process.exit(1); }
    source = { mode: 'production', label: `wrangler tail ${opt.rest[0]}` };
  } else if (opt.cmd === 'run') source = { mode: 'local', label: opt.rest.join(' ') };
  else if (!opt.cmd) source = { mode: 'local', label: 'stdin' };
  else { console.error(`trace: unknown command "${opt.cmd}"\n\n${HELP}`); process.exit(1); }

  let viewer;
  try {
    viewer = await startServer({ port: opt.port, source });
  } catch (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `trace: port ${opt.port} is taken. Try --port ${opt.port + 1}`
      : `trace: ${err.message}`);
    process.exit(1);
  }
  console.error(`trace: viewer on ${viewer.url} · ${source.label}`);
  if (opt.open) openBrowser(viewer.url);

  const onLine = (line) => { const e = parseLine(line); if (e) viewer.emit(e); return e; };

  if (opt.cmd === 'demo') runDemo(viewer.emit);
  else if (opt.cmd === 'dev') watchProcess(npx, ['wrangler', 'dev', ...opt.rest], { onLine, show: opt.show });
  else if (opt.cmd === 'tail') {
    watchProcess(npx, ['wrangler', 'tail', ...opt.rest, '--format', 'json'], {
      onObject: (ev) => { for (const e of fromTail(ev)) viewer.emit(e); },
    });
  } else if (opt.cmd === 'run') watchProcess(opt.rest[0], opt.rest.slice(1), { onLine, show: opt.show });
  else {
    const lines = lineSplitter((line) => { if (!onLine(line) || opt.show) process.stdout.write(line + '\n'); });
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => lines.push(c));
    process.stdin.on('end', () => { lines.end(); console.error('trace: input ended; the viewer stays open (Ctrl+C to stop)'); });
  }
}

main();
