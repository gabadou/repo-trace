// Repo Trace, the app side: one JSON line per call, written with console.log.
// No dependencies; works in Cloudflare Workers, Node, Deno and Bun.
// Copy this file into your app (or import it once Repo Trace is on npm).
//
// What you log is what Repo Trace shows, and in production `wrangler tail` sends it
// to whoever runs it. Log names, timings, statuses and costs; never what a
// user wrote, a prompt, a script or a key.

export type Meta = Record<string, string | number | boolean | null>;

export interface SpanOptions {
  /** What the call belongs to: an episode id, a request id. One waterfall per group. */
  group: string;
  /** A fixed id, when the same call can be logged twice (a job that runs again from the top). */
  id?: string;
  /** Who answers: worker, d1, r2, claude, fish, elevenlabs, apple… */
  svc: string;
  /** The id of the span this one is part of. */
  parent?: string;
  meta?: Meta;
}

export interface Span {
  readonly id: string;
  /** Adds to the call's cost, in US dollars. */
  cost(usd: number): void;
  /** The HTTP status, or any code worth seeing. */
  status(code: number): void;
  /** A few words shown on the bar. */
  note(text: string): void;
  meta(m: Meta): void;
  /** Marks the call failed without throwing. */
  fail(note?: string): void;
}

let on = true;

/** Turns Repo Trace's lines on or off (for example off in production unless asked). */
export function traceOn(value: boolean): void {
  on = value;
}

/** Whether lines are being written: skip work that only feeds the trace when they aren't. */
export function traceIsOn(): boolean {
  return on;
}

function emit(event: Record<string, unknown>): void {
  if (on) console.log(JSON.stringify(event));
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Names a group and says what kind it is, so the viewer can list it. */
export function traceGroup(group: string, kind: string, label?: string): void {
  emit({ trace: 'group', group, kind, label });
}

/** Times `fn` as one call. Throwing marks it failed, then rethrows. */
export async function span<T>(name: string, opts: SpanOptions, fn: (s: Span) => Promise<T> | T): Promise<T> {
  const id = opts.id ?? newId();
  const end: { ok: boolean; usd?: number; status?: number; note?: string; meta?: Meta } = { ok: true };
  const handle: Span = {
    id,
    cost: (usd) => { end.usd = (end.usd ?? 0) + usd; },
    status: (code) => { end.status = code; },
    note: (text) => { end.note = text.slice(0, 200); },
    meta: (m) => { end.meta = { ...end.meta, ...m }; },
    fail: (note) => { end.ok = false; if (note) end.note = note.slice(0, 200); },
  };
  emit({ trace: 'start', id, group: opts.group, name, svc: opts.svc, parent: opts.parent, meta: opts.meta, at: Date.now() });
  try {
    const result = await fn(handle);
    emit({ trace: 'end', id, group: opts.group, at: Date.now(), ...end });
    return result;
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    emit({ trace: 'end', id, group: opts.group, at: Date.now(), ...end, ok: false, note: end.note ?? message.slice(0, 200) });
    throw err;
  }
}

/** A fetch that is traced: the call fails when the answer isn't 2xx. */
export function tracedFetch(name: string, opts: SpanOptions) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    span(name, opts, async (s) => {
      const res = await fetch(input, init);
      s.status(res.status);
      if (!res.ok) s.fail(`${res.status} ${res.statusText}`.trim());
      return res;
    });
}
