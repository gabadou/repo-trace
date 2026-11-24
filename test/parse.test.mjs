import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, lineSplitter } from '../src/parse.mjs';

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

test('wrangler dev request lines become request calls', async () => {
  const { fromWranglerLine } = await import('../src/parse.mjs');
  const evs = fromWranglerLine('\x1b[2m[wrangler:info]\x1b[0m \x1b[1mPOST\x1b[22m /v1/calls/abc/turns \x1b[32m\x1b[1m200\x1b[22m OK \x1b[39m\x1b[90m(2412ms)\x1b[39m');
  assert.equal(evs[0].label, 'POST /v1/calls/abc/turns');
  assert.equal(evs[1].status, 200);
  assert.equal(evs[1].ms, 2412);
  assert.equal(evs[1].ok, true);
  assert.equal(fromWranglerLine('GET /x 503 Service Unavailable (5ms)')[1].ok, false);
  assert.equal(fromWranglerLine('Ready on http://localhost:8787'), null);
  assert.equal(fromWranglerLine('took (5ms)'), null);
});
