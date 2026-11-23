import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, lineSplitter, objectSplitter, fromTail } from '../src/parse.mjs';

test('a plain trace line', () => {
  const e = parseLine('{"trace":"span","group":"ep_1","name":"write","svc":"claude","ms":1200,"ok":true}');
  assert.equal(e.name, 'write');
  assert.equal(e.ms, 1200);
});

test('a trace line with a prefix, colours and text after it', () => {
  const e = parseLine('\x1b[2m[wrangler:inf]\x1b[0m {"trace":"start","id":"a","name":"x {y}","svc":"fish"} \x1b[0m trailing');
  assert.equal(e.trace, 'start');
  assert.equal(e.name, 'x {y}');
});

test('lines that are not trace events', () => {
  assert.equal(parseLine('GET /v1/episodes 200 OK (38ms)'), null);
  assert.equal(parseLine('{"trace":"nope"}'), null);
  assert.equal(parseLine('{"other":"trace"}'), null);
  assert.equal(parseLine('{"trace": broken'), null);
  assert.equal(parseLine('["trace"]'), null);
});

test('lines split across chunks', () => {
  const got = [];
  const s = lineSplitter((l) => got.push(l));
  s.push('one\ntw');
  s.push('o\r\nthr');
  s.end('');
  s.end();
  assert.deepEqual(got, ['one', 'two', 'thr']);
});

test('pretty-printed objects split across chunks', () => {
  const got = [];
  const s = objectSplitter((o) => got.push(o));
  const a = JSON.stringify({ a: 1, s: 'brace } inside "quotes"', n: { b: [1, { c: 2 }] } }, null, 2);
  const b = JSON.stringify({ z: 'z' });
  const text = `noise ${a}\n${b}\n`;
  for (let i = 0; i < text.length; i += 7) s.push(text.slice(i, i + 7));
  assert.equal(got.length, 2);
  assert.equal(got[0].s, 'brace } inside "quotes"');
  assert.equal(got[1].z, 'z');
});

test('a wrangler tail event gives a request span and its logged calls', () => {
  const events = fromTail({
    outcome: 'ok',
    eventTimestamp: 1795410000000,
    wallTime: 2300,
    event: { request: { url: 'https://api.example.com/v1/calls/abc/turns?x=1', method: 'POST' }, response: { status: 200 } },
    logs: [
      { message: ['{"trace":"span","group":"g","name":"host turn","svc":"claude","ms":2100,"ok":true}'], level: 'log' },
      { message: ['plain log'], level: 'log' },
      { message: [{ trace: 'end', id: 'x', ok: false }], level: 'log' },
    ],
    exceptions: [],
  });
  assert.equal(events[0].trace, 'group');
  assert.equal(events[0].label, 'POST /v1/calls/abc/turns');
  assert.equal(events[1].trace, 'span');
  assert.equal(events[1].ms, 2300);
  assert.equal(events[1].ok, true);
  assert.equal(events[2].name, 'host turn');
  assert.equal(events[3].ok, false);
  assert.equal(events.length, 4);
});

test('a failed invocation is a failed span with the exception', () => {
  const [, span] = fromTail({
    outcome: 'exception',
    eventTimestamp: 1,
    event: { request: { url: 'https://x.dev/boom', method: 'GET' } },
    logs: [],
    exceptions: [{ name: 'TypeError', message: 'x is undefined' }],
  });
  assert.equal(span.ok, false);
  assert.equal(span.note, 'TypeError: x is undefined');
});

test('a Workflow or cron event without a request gives only its logged calls', () => {
  const events = fromTail({ outcome: 'ok', eventTimestamp: 1, event: { cron: '* * * * *' }, logs: [{ message: ['{"trace":"group","group":"ep","kind":"episode"}'] }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'episode');
});

test('the terminal gets every line but trace lines, partial lines after a pause', async () => {
  const { passThrough } = await import('../src/parse.mjs');
  let out = '';
  const sink = { write: (s) => { out += s; } };
  const copy = passThrough(sink, (l) => parseLine(l));
  copy.push('ready on :8787\n{"trace":"span","group":"g","name":"x","svc":"d1","ms":1}\nhalf');
  assert.equal(out, 'ready on :8787\n');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(out, 'ready on :8787\nhalf');
  copy.push(' done\n');
  copy.end();
  assert.equal(out, 'ready on :8787\nhalf done\n');
  let shown = '';
  const all = passThrough({ write: (s) => { shown += s; } }, (l) => parseLine(l), { show: true });
  all.push('{"trace":"group","group":"g"}\n');
  assert.equal(shown, '{"trace":"group","group":"g"}\n');
});
