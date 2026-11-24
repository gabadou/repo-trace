// Sample traffic, shaped like learn.fm making an episode, so the viewer can be
// tried without instrumenting anything. Played faster than real time.

const TOPICS = [
  'Why octopuses have three hearts',
  'How tides work',
  'The first map of the internet',
  'Why the sky is dark at night',
];

// An episode as [seconds from its start, event] pairs.
function episode(group, label, { fails = false } = {}) {
  const ev = [];
  const id = (s) => `${group}.${s}`;
  const start = (t, s, name, svc, parent, meta) =>
    ev.push([t, { trace: 'start', id: id(s), group, name, svc, parent: parent && id(parent), meta }]);
  const end = (t, s, extra = {}) => ev.push([t, { trace: 'end', id: id(s), group, ok: true, ...extra }]);

  ev.push([0, { trace: 'group', group, kind: 'episode', label }]);
  start(0, 'req', 'POST /v1/episodes', 'worker');
  end(0.3, 'req', { status: 202 });
  start(0.3, 'load', 'load', 'd1');
  end(0.6, 'load');
  start(0.6, 'write', 'write', 'claude');
  if (fails) {
    end(120.6, 'write', { ok: false, note: 'Timed out after 120 s' });
    return ev;
  }
  end(46, 'write', { usd: 0.14, meta: { 'tokens in': 8420, 'tokens out': 3960 } });
  start(46, 'check', 'fact-check', 'claude');
  end(68, 'check', { usd: 0.06, note: '3 lines fixed' });
  start(68, 'mark', 'mark voice', 'd1');
  end(68.4, 'mark');
  start(68, 'voice', 'voice', 'fish', null, { scenes: 8, 'at once': 5 });
  const scenes = [[68, 112], [68, 118], [68, 109], [68, 121], [68, 115], [109, 150], null, [115, 192]];
  scenes.forEach((s, i) => {
    if (!s) return;
    start(s[0], `s${i + 1}`, `scene ${i + 1}`, 'fish', 'voice');
    end(s[1], `s${i + 1}`, { usd: +(0.0013 * (s[1] - s[0])).toFixed(3), ...(i === 2 ? { note: '2 lines re-voiced alone' } : {}) });
  });
  start(112, 's7', 'scene 7', 'fish', 'voice');
  end(131, 's7', { ok: false, status: 502, note: 'Fish answered 502: sent to ElevenLabs' });
  start(131, 's7b', 'scene 7, again', 'elevenlabs', 'voice');
  end(170, 's7b', { usd: 0.11, meta: { characters: 1842 } });
  end(192, 'voice');
  start(192, 'store', 'store', 'r2');
  end(193.5, 'store', { meta: { size: '9.4 MB' } });
  start(193.5, 'notify', 'notify ready', 'apple');
  end(194, 'notify', { status: 200 });
  return ev;
}

// The sample API's routes, as Repo Trace would read them from its code.
export const DEMO_ROUTES = [
  ['POST', '/v1/devices', 67], ['GET', '/v1/devices/me', 75], ['PATCH', '/v1/devices/me', 76], ['DELETE', '/v1/devices/me', 77],
  ['POST', '/v1/auth/apple', 79], ['GET', '/v1/suggestions', 80], ['GET', '/v1/guests', 81], ['GET', '/v1/memories', 82],
  ['DELETE', '/v1/memories/:id', 83], ['GET', '/v1/episodes', 84], ['POST', '/v1/episodes', 85], ['GET', '/v1/episodes/:id', 86],
  ['DELETE', '/v1/episodes/:id', 87], ['GET', '/v1/episodes/:id/audio', 88], ['POST', '/v1/episodes/:id/listen', 89],
  ['PUT', '/v1/episodes/:id/rating', 90], ['POST', '/v1/calls', 92], ['POST', '/v1/calls/:id/turns', 101],
  ['POST', '/v1/feedback', 104], ['ANY', '/v1/admin/*', 68],
].map(([method, path, line]) => ({ method, path, file: 'src/index.ts', line }));

const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');

// One request as [seconds from its start, event] pairs: a group and its span, like wrangler dev's own line, plus what
// the app logs inside it.
function request(group, kind) {
  const req = (method, path, ms, status, inside = [], extra = {}) => [
    [0, { trace: 'group', group, kind: 'request', label: `${method} ${path}` }],
    [0, { trace: 'start', id: group, group, name: `${method} ${path}`, svc: 'worker' }],
    ...inside.map(([t, e]) => [t, { group, parent: group, ...e }]),
    [ms / 1000, { trace: 'end', id: group, group, ok: status < 500, status, ...extra }],
  ];
  const q = (name, ms, t = 0.002) => [t, { trace: 'span', id: `${group}.${name}`, name, svc: 'd1', ms, ok: true }];
  switch (kind) {
    case 'list': return req('GET', '/v1/episodes', 38, 200, [q('SELECT episodes', 4)]);
    case 'audio': return req('GET', `/v1/episodes/ep_${hex()}/audio`, 140, 200, [[0.01, { trace: 'span', id: `${group}.r2`, name: 'GET audio', svc: 'r2', ms: 120, ok: true }]]);
    case 'me': return req('GET', '/v1/devices/me', 22, 200, [q('SELECT devices', 3)]);
    case 'listen': return req('POST', `/v1/episodes/ep_${hex()}/listen`, 30, 204, [q('INSERT listens', 5)]);
    case 'missing': return req('GET', `/v1/episodes/ep_${hex()}`, 12, 404, [q('SELECT episodes', 3)]);
    case 'boom': return req('PATCH', '/v1/devices/me', 9, 500, [], { note: "TypeError: Cannot read properties of undefined (reading 'name')" });
    case 'create': return req('POST', '/v1/episodes', 260, 202, [q('INSERT episodes', 6), [0.01, { trace: 'span', id: `${group}.wf`, name: 'start the episode job', svc: 'workflow', ms: 230, ok: true }]]);
    default: return req('POST', `/v1/calls/c${hex()}/turns`, 2300, 200, [
      [0.05, { trace: 'span', id: `${group}.h`, name: 'host turn', svc: 'claude', ms: 2150, ok: true, usd: 0.004, meta: { model: 'claude-haiku-4-5', 'tokens in': 2140, 'tokens out': 310 } }],
      [0.05, { trace: 'span', id: `${group}.s`, name: 'safety check', svc: 'claude', ms: 850, ok: true, usd: 0.001, note: 'ok' }],
      [2.25, { trace: 'span', id: `${group}.d`, name: 'INSERT turns', svc: 'd1', ms: 5, ok: true }],
    ]);
  }
}
const KINDS = [['list', 30], ['audio', 22], ['me', 14], ['turn', 14], ['listen', 10], ['missing', 6], ['boom', 2]];
function someKind() {
  let x = Math.random() * KINDS.reduce((a, k) => a + k[1], 0);
  for (const [k, w] of KINDS) if ((x -= w) < 0) return k;
  return 'list';
}

export function runDemo(emit, { speed = 4 } = {}) {
  const now = Date.now();
  // Two episodes already made: one ready, one failed.
  const past = (evs, t0) => evs.forEach(([t, e]) => emit({ ...e, at: t0 + t * 1000 }));
  past(episode('ep_2b91', 'The Marshall Plan'), now - 22 * 60e3);
  past(episode('ep_9c04', 'How money is created', { fails: true }), now - 9 * 60e3);
  // And the last few minutes of requests (spans need their start time: a start/end pair is replayed with `at`).
  let r = 0;
  for (let i = 0; i < 70; i++) past(request(`req_p${(r++).toString(36)}`, someKind()), now - Math.random() * 4.5 * 60e3);

  // Then live traffic.
  const play = (evs) => evs.forEach(([t, e]) => setTimeout(() => emit({ ...e, at: Date.now() }), (t * 1000) / speed));
  let n = 0;
  const nextEpisode = () => {
    const group = `ep_${(0x7f3a + n * 97).toString(16)}`;
    play(request(`req_c${n.toString(36)}`, 'create'));
    play(episode(group, TOPICS[n % TOPICS.length]));
    n++;
    setTimeout(nextEpisode, ((194 + 40) * 1000) / speed);
  };
  nextEpisode();

  const nextRequest = () => {
    play(request(`req_${(r++).toString(36)}`, someKind()));
    setTimeout(nextRequest, 600 + Math.random() * 2500);
  };
  setTimeout(nextRequest, 800);
}
