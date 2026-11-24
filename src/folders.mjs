// Folders on this computer: ~ in paths, the recent folders (kept between runs), and the Mac's folder dialog.

import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const HOME = homedir();
const KEEP = 6;

/** /Users/alex/Code → ~/Code, for showing. */
export function tilde(p, home = HOME) {
  if (p === home) return '~';
  return p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

/** ~/Code → /Users/alex/Code; relative paths resolve from `from`. Trailing slashes go. */
export function untilde(p, { home = HOME, from = process.cwd() } = {}) {
  let s = String(p || '').trim();
  if (s === '~') s = home;
  else if (s.startsWith('~/')) s = join(home, s.slice(2));
  s = resolve(from, s);
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

export async function isDir(p) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

/** The folders projects were last run from, newest first. `file` is ~/.config/repo-trace/recent.json. */
export function recentFolders(file = join(HOME, '.config', 'repo-trace', 'recent.json')) {
  async function read() {
    try {
      const list = JSON.parse(await readFile(file, 'utf8'));
      return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    } catch { return []; }
  }
  return {
    async list() {
      const out = [];
      for (const p of await read()) if (await isDir(p)) out.push(p);
      return out;
    },
    async add(folder) {
      const list = [folder, ...(await read()).filter((p) => p !== folder)].slice(0, KEEP);
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(list, null, 2) + '\n');
      } catch { /* not kept: fine */ }
      return list;
    },
  };
}

/** The Mac's folder dialog, opened on `from`. → { folder } or { cancelled } or { error }. Macs only. */
export function chooseFolder(from) {
  if (process.platform !== 'darwin') return Promise.resolve({ error: 'Type the folder\'s path: the folder dialog is on Macs only' });
  const script = [
    'on run argv',
    '  try',
    '    return POSIX path of (choose folder with prompt "Pick a folder of projects" default location (POSIX file (item 1 of argv)))',
    '  on error msg number n',
    '    if n is -128 then return ""',
    '    error msg number n',
    '  end try',
    'end run',
  ];
  // The folder is passed as an argument, never written into the script.
  return new Promise((done) => {
    execFile('osascript', [...script.flatMap((l) => ['-e', l]), from], { timeout: 10 * 60 * 1000 }, (err, out) => {
      if (err) return done({ error: 'Couldn\'t open the folder dialog' });
      const folder = String(out).trim();
      done(folder ? { folder: untilde(folder) } : { cancelled: true });
    });
  });
}
