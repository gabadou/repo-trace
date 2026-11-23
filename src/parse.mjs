// Turns what a process prints into Trace events.
//
// Two inputs:
// - lines (wrangler dev, any command, stdin): a trace event is a line holding
//   one JSON object with a "trace" key, anywhere on the line (wrangler and
//   other tools may prefix or colour it).
// - wrangler tail --format json: a stream of JSON objects, one per Worker
//   invocation, possibly pretty-printed over many lines. Each gives a request
//   span for free, plus the trace events found in its console logs.

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const KINDS = new Set(['start', 'end', 'span', 'group']);

/** One printed line → a trace event, or null. */
export function parseLine(raw) {
  if (typeof raw !== 'string' || !raw.includes('"trace"')) return null;
  const line = raw.replace(ANSI, '').trim();
  for (let i = line.indexOf('{'); i !== -1; i = line.indexOf('{', i + 1)) {
    const obj = parseObjectAt(line, i);
    if (obj && KINDS.has(obj.trace)) return obj;
  }
  return null;
}

// Parse the JSON object that starts at line[i], ignoring anything after it.
function parseObjectAt(line, i) {
  const end = matchBrace(line, i);
  if (end === -1) return null;
  try {
    const obj = JSON.parse(line.slice(i, end + 1));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

// Index of the brace that closes the one at s[i], or -1. Aware of strings.
function matchBrace(s, i) {
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return -1;
}

/** Splits a chunked text stream into lines. */
export function lineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let n;
      while ((n = buf.indexOf('\n')) !== -1) {
        onLine(buf.slice(0, n).replace(/\r$/, ''));
        buf = buf.slice(n + 1);
      }
    },
    end() {
      if (buf) onLine(buf);
      buf = '';
    },
  };
}

/**
 * Copies a process's output to `out` line by line, handing each line to `onLine` (which returns the trace event it
 * found, or null). Trace lines are left out unless `show`: the viewer has them. A partial line (a prompt, a spinner) is
 * written after 50 ms without a newline.
 */
export function passThrough(out, onLine, { show = false } = {}) {
  let buf = '', timer = null;
  const flush = () => { timer = null; if (buf) { out.write(buf); buf = ''; } };
  return {
    push(chunk) {
      if (timer) { clearTimeout(timer); timer = null; }
      buf += chunk;
      let n;
      while ((n = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, n + 1);
        buf = buf.slice(n + 1);
        const e = onLine(line.replace(/\r?\n$/, ''));
        if (!e || show) out.write(line);
      }
      if (buf) timer = setTimeout(flush, 50);
    },
    end() {
      if (timer) clearTimeout(timer);
      if (buf) { const e = onLine(buf); if (!e || show) out.write(buf); buf = ''; }
    },
  };
}

/** Splits a chunked stream of (pretty-printed) JSON objects. Text between objects is ignored. */
export function objectSplitter(onObject) {
  let buf = '', depth = 0, inStr = false, esc = false, start = -1;
  return {
    push(chunk) {
      const from = buf.length;
      buf += chunk;
      for (let j = from; j < buf.length; j++) {
        const c = buf[j];
        if (start === -1) {
          if (c === '{') { start = j; depth = 1; inStr = false; esc = false; }
          continue;
        }
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          const text = buf.slice(start, j + 1);
          start = -1;
          try { onObject(JSON.parse(text)); } catch { /* not JSON: skip */ }
        }
      }
      // Drop what's been consumed.
      if (start === -1) buf = '';
      else if (start > 0) { buf = buf.slice(start); start = 0; }
    },
  };
}

let tailSeq = 0;

/** One wrangler tail event → trace events (a request span, then logged ones). */
export function fromTail(ev) {
  const out = [];
  if (!ev || typeof ev !== 'object') return out;
  const at = Number(ev.eventTimestamp) || Date.now();
  const req = ev.event && ev.event.request;
  if (req && req.url) {
    let path = req.url;
    try { path = new URL(req.url).pathname; } catch { /* keep as is */ }
    const group = `req_${at.toString(36)}_${(tailSeq++).toString(36)}`;
    const status = ev.event.response && ev.event.response.status;
    const failed = ev.outcome && ev.outcome !== 'ok';
    const exc = Array.isArray(ev.exceptions) && ev.exceptions[0];
    const ms = Number(ev.wallTime) || null;
    out.push({ trace: 'group', group, kind: 'request', label: `${req.method || 'GET'} ${path}` });
    out.push({
      trace: 'span', id: group, group, name: `${req.method || 'GET'} ${path}`, svc: 'worker', at,
      ms, ok: !(failed || (status && status >= 500)), status: status || null,
      note: exc ? `${exc.name || 'Error'}: ${String(exc.message || '').slice(0, 200)}` : (failed ? ev.outcome : undefined),
    });
  }
  for (const log of Array.isArray(ev.logs) ? ev.logs : []) {
    for (const m of Array.isArray(log.message) ? log.message : [log.message]) {
      const e = typeof m === 'string' ? parseLine(m) : (m && KINDS.has(m.trace) ? m : null);
      if (e) out.push(e);
    }
  }
  return out;
}
