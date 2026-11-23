# The format

A call is one line of JSON with a `trace` key, printed by your app (with `console.log`). Trace reads it anywhere on the line, so prefixes and colours added by `wrangler dev` don't matter. Everything else your app prints is left alone.

`lib/trace.ts` writes these lines for you. This page is for writing them by hand, or from another language.

## Four kinds of line

**A call, once it's finished**

```json
{"trace":"span","group":"ep_7f3a","name":"write","svc":"claude","ms":45400,"ok":true,"usd":0.14}
```

**A call you want to see while it runs:** a start, then an end with the same `id`.

```json
{"trace":"start","id":"s7","group":"ep_7f3a","name":"scene 7","svc":"fish","parent":"voice"}
{"trace":"end","id":"s7","ok":false,"status":502,"note":"Fish answered 502"}
```

**A group:** what a set of calls is (one waterfall per group). Optional: a group with no line of its own is listed under its id.

```json
{"trace":"group","group":"ep_7f3a","kind":"episode","label":"Why octopuses have three hearts"}
```

## Fields

| Field | On | Meaning |
|---|---|---|
| `trace` | all | `span`, `start`, `end` or `group` |
| `group` | all but `end` | what the call belongs to: an episode id, a request id. One waterfall per group. An `end` finds its group from its `id`. |
| `id` | `start`, `end`; optional on `span` | joins a start to its end, and is what `parent` points to |
| `name` | `span`, `start` | a few words: `write`, `scene 7`, `POST /v1/episodes` |
| `svc` | `span`, `start` | who answers: `worker`, `d1`, `r2`, `claude`, `fish`, `elevenlabs`, `apple`, or any name. Known names get fixed colours; others get one from their name. |
| `parent` | optional | the `id` of the call this one is part of. Parents draw as a thin line over their children. |
| `at` | optional | when it happened, in milliseconds since 1970 (`Date.now()`). Missing: when Trace read the line. |
| `ms` | `span` | how long it took |
| `ok` | `span`, `end` | `false` marks a failure. Missing means it went fine. |
| `status` | optional | an HTTP status or any code |
| `usd` | optional | what the call cost, in US dollars |
| `note` | optional | a few words shown on the bar (keep it under 200 characters) |
| `meta` | optional | an object of extra facts shown in the panel: `{"tokens in": 8420}` |
| `kind`, `label` | `group` | what the group is (`episode`, `request`…, listed in the sidebar) and its name in the list |

## What not to log

In production, `wrangler tail` sends these lines to whoever runs it, and Cloudflare keeps Worker logs. Log names, timings, statuses and costs. Never what a user wrote, a prompt, a script, a key or a token. A group's `label` is shown in the list: in production, prefer an id.

## From `wrangler tail`

`trace tail <worker>` also makes a call for every request the Worker gets, without any logging: its method and path (no query string), status, how long it took (`wallTime`, when Cloudflare sends it) and the exception if it threw. Workflow steps and other events without a request show only the lines they log.
