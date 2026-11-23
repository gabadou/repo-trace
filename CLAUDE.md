# Repo Trace

Studio G tool, one of the Repo tools (with Repo Atlas; "Repo" is the suite, 23 Nov 2026): an API's calls as a live waterfall, locally (`wrangler dev`, any command, stdin) and in production (`wrangler tail`). Owner: Alex. English only. Separate from Repo Atlas on purpose (23 Nov 2026): Atlas maps the code, Trace shows what ran; a link between the two may come later (a call names the file it ran in). Decisions and backlog live in Notion (Studio G › Repo trace). The command stays `trace`, the package is `repo-trace`.

## Layout
- `bin/trace.mjs`: the command (`dev`, `tail`, `--`, stdin, `demo`).
- `src/parse.mjs`: printed lines → events (`parseLine`), chunk splitters, `fromTail` (a `wrangler tail --format json` event → a request span plus the events it logged).
- `src/server.mjs`: the viewer page and `/events` (server-sent events). Listens on 127.0.0.1 only; keeps the last 20,000 events for a page opened late.
- `src/demo.mjs`: sample traffic shaped like learn.fm making an episode.
- `viewer/index.html`: the whole viewer, one file, no build, no framework. State is reduced from events in the page.
- `lib/trace.ts`: what an app copies in to log calls (`span`, `traceGroup`, `tracedFetch`, `traceOn`).
- `docs/format.md`: the line format. Change it there first; keep `lib/trace.ts`, the parser and the viewer in step.

## Rules
- No dependencies, no build step. Node 20+.
- Studio G design system: tokens copied by hand from `studio-g/design-system/tokens.json` into the viewer's `:root` (Light) and `[data-theme="dark"]` (After hours). No other hex values. Inter, no monospace except the JSON example. Square pixels mark state. One primary action per view.
- Services get tag colours (fixed for known names, by hash for others), category only. `danger` only for failures, always with words.
- The accent is Studio G's cobalt as a placeholder: Repo Trace's signature colour is to pick (sun or rose are free).
- Copy: few words, verbs on buttons, no exclamation marks, no emoji, no promises of things that aren't built.
- Privacy: nothing leaves the computer. Repo Trace shows what the app logs; the docs tell apps never to log user text, prompts or keys.

## Check before saying it's done
- `npm test`
- `node bin/trace.mjs demo --open`, and look at it in both themes and on a narrow window.
