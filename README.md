# Repo Trace

Your local API's calls as a live waterfall, instead of scrolling a terminal.

Repo Trace runs your dev server, reads the calls it logs and draws them on a page on your computer: one waterfall per job, what ran in parallel, what failed and what took over, and what each call cost.

Part of Studio G's Repo tools, with [Repo Atlas](https://github.com/gabadou/repo-atlas): Atlas maps the code, Trace shows what ran. Made for Cloudflare Workers first; it reads any process.

## Try it

```sh
node bin/trace.mjs demo --open
```

Sample traffic shaped like a podcast episode being made: a writer, a fact-check, scenes voiced five at a time, one that fails and goes to another voice.

## Use it

```sh
trace                      # pick a project and run it
trace ~/Code               # the same, in another folder
trace dev                  # runs `wrangler dev` here and watches it
trace -- npm run dev       # any command
npm run dev | trace        # or pipe it
```

With no command, Repo Trace lists the projects with a Worker (a `wrangler.jsonc`, `.json` or `.toml`) in the folder it sits in, like Repo Atlas: pick one and Repo Trace runs it (`wrangler dev`): requests show up as they happen, with nothing added to the project. Local only: it never connects to your Cloudflare account. Its routes are listed too, read from the code, with how often each was called and its last status.

The viewer is on http://localhost:4400 (`--port` to change, `--open` to open it). It listens on your computer only. The process's output still shows in the terminal, minus the trace lines (`--show` keeps them).

Then log your calls. Copy `lib/trace.ts` into your app:

```ts
import { span, traceGroup, tracedFetch } from './trace';

traceGroup(episodeId, 'episode');

const script = await span('write', { group: episodeId, svc: 'claude' }, async (s) => {
  const out = await writeScript(brief);
  s.cost(out.usd);
  return out;
});

const fish = tracedFetch('scene 7', { group: episodeId, svc: 'fish', parent: voiceId });
const res = await fish('https://api.fish.audio/v1/tts', { method: 'POST', body });
```

Or print the lines yourself: the format is in [docs/format.md](docs/format.md). One finished call:

```js
console.log(JSON.stringify({ trace: 'span', group: 'ep_1', name: 'write', svc: 'claude', ms: 1200, ok: true }));
```

Requests need no logging at all: `wrangler dev` prints a line for each. Logging is for what happens inside them.

## What it doesn't do (yet)

- Keep history: the viewer holds what it has seen since it started (the last 20,000 lines).
- Watch production. Repo Trace is for the API running on your computer; Cloudflare's own logs and traces (Workers Observability) cover deployed Workers.
- Read OpenTelemetry.

## Privacy

What your app logs is what Repo Trace shows, and nothing leaves your computer. Your app's logs can still end up in production logs if tracing stays on there: turn it off in production, and log names, timings, statuses and costs, never what a user wrote, a prompt or a key.

## Develop

No dependencies. Node 20 or later.

```sh
npm test
```

MIT licence.
