# Repo Trace

Studio G tool, one of the Repo tools (with Repo Atlas; "Repo" is the suite, 23 Nov 2026): a local API's calls as a live waterfall (`wrangler dev`, any command, stdin). Local only (24 Nov 2026): no production, no `wrangler tail`, no Cloudflare sign-in. Owner: Alex. English only. Separate from Repo Atlas on purpose (23 Nov 2026): Atlas maps the code, Trace shows what ran; a link between the two may come later (a call names the file it ran in). Decisions and backlog live in Notion (Studio G › Repo trace). The command stays `trace`, the package is `repo-trace`.

## Layout
- `bin/trace.mjs`: the command. With no command (or a folder): the project picker, over the folder repo-trace sits in (`~/Code`), as Repo Atlas does (23 Nov 2026). Also `dev`, `--`, stdin, `demo`.
- `src/projects.mjs`: projects (a Wrangler config up to two folders down, with a `main`), most recently changed first; their routes read from the code with patterns (pathname checks, segments from `pathname.split('/')`, `method !==` refusals, routers, switch cases), with file and line.
- `src/session.mjs`: one session at a time, started from the page: `wrangler dev --var TRACE:1` (projects that log their calls turn them on). Requests come from wrangler dev's own lines (`fromWranglerLine`), so a project needs no change.
- `src/parse.mjs`: printed lines → events (`parseLine`), the terminal copy without trace lines (`passThrough`, `--show` keeps them), the line splitter, `fromWranglerLine`.
- `src/server.mjs`: the viewer page, `/events` (server-sent events: calls, `session`, `output`, `reset`) and `/api/*` (projects, routes, session). Listens on 127.0.0.1 only; anything that starts a process needs the `x-repo-trace: 1` header and the page's own origin. Keeps the last 20,000 events for a page opened late.
- `src/demo.mjs`: sample traffic shaped like learn.fm making an episode.
- `viewer/index.html`: the whole viewer, one file, no build, no framework. State is reduced from events in the page.
- `lib/trace.ts`: what an app copies in to log calls (`span`, `traceGroup`, `tracedFetch`, `traceOn`).
- `docs/format.md`: the line format. Change it there first; keep `lib/trace.ts`, the parser and the viewer in step.

## Rules
- No dependencies, no build step. Node 20+.
- Studio G design system: tokens copied by hand from `studio-g/design-system/tokens.json` into the viewer's `:root` (Light) and `[data-theme="dark"]` (After hours). No other hex values. Inter, no monospace except the JSON example and the Output view (a terminal's text). Square pixels mark state. One primary action per view.
- Services get tag colours (fixed for known names, by hash for others), category only. `danger` only for failures, always with words.
- The accent is Studio G's cobalt for now; Repo Trace's signature colour is sun (24 Nov 2026), applied with the T1 redesign.
- Copy: few words, verbs on buttons, no exclamation marks, no emoji, no promises of things that aren't built.
- Privacy: nothing leaves the computer. Repo Trace shows what the app logs; the docs tell apps never to log user text, prompts or keys.

## Check before saying it's done
- `npm test`
- `node bin/trace.mjs demo --open`, and look at it in both themes and on a narrow window.
