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

function request(group, kind) {
  if (kind === 'list') {
    return [
      [0, { trace: 'group', group, kind: 'request', label: 'GET /v1/episodes' }],
      [0, { trace: 'span', id: group, group, name: 'GET /v1/episodes', svc: 'worker', ms: 38, ok: true, status: 200 }],
      [0.01, { trace: 'span', id: `${group}.q`, parent: group, group, name: 'SELECT episodes', svc: 'd1', ms: 4, ok: true }],
    ];
  }
  return [
    [0, { trace: 'group', group, kind: 'request', label: 'POST /v1/calls/…/turns' }],
    [0, { trace: 'start', id: group, group, name: 'POST /v1/calls/…/turns', svc: 'worker' }],
    [0.05, { trace: 'start', id: `${group}.h`, parent: group, group, name: 'host turn', svc: 'claude' }],
    [0.05, { trace: 'start', id: `${group}.s`, parent: group, group, name: 'safety check', svc: 'claude' }],
    [0.9, { trace: 'end', id: `${group}.s`, group, ok: true, usd: 0.001, note: 'ok' }],
    [2.2, { trace: 'end', id: `${group}.h`, group, ok: true, usd: 0.004 }],
    [2.25, { trace: 'span', id: `${group}.d`, parent: group, group, name: 'INSERT turns', svc: 'd1', ms: 5, ok: true }],
    [2.3, { trace: 'end', id: group, group, ok: true, status: 200 }],
  ];
}

export function runDemo(emit, { speed = 4 } = {}) {
  const now = Date.now();
  // Two episodes already made: one ready, one failed.
  const past = (evs, t0) => evs.forEach(([t, e]) => emit({ ...e, at: t0 + t * 1000 }));
  past(episode('ep_2b91', 'The Marshall Plan'), now - 22 * 60e3);
  past(episode('ep_9c04', 'How money is created', { fails: true }), now - 9 * 60e3);

  // Then live traffic.
  const play = (evs) => evs.forEach(([t, e]) => setTimeout(() => emit({ ...e, at: Date.now() }), (t * 1000) / speed));
  let n = 0;
  const nextEpisode = () => {
    const group = `ep_${(0x7f3a + n * 97).toString(16)}`;
    play(episode(group, TOPICS[n % TOPICS.length]));
    n++;
    setTimeout(nextEpisode, ((194 + 40) * 1000) / speed);
  };
  nextEpisode();

  let r = 0;
  const nextRequest = () => {
    play(request(`req_${(r++).toString(36)}`, Math.random() < 0.6 ? 'list' : 'turn'));
    setTimeout(nextRequest, 1500 + Math.random() * 4000);
  };
  setTimeout(nextRequest, 800);
}
