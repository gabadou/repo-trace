# Repo Trace

Studio G tool, one of the Repo tools (with Repo Atlas; "Repo" is the suite, 23 Nov 2026): a local API's calls as a live waterfall (`wrangler dev`, any command, stdin). Local only (24 Nov 2026): no production, no `wrangler tail`, no Cloudflare sign-in. Owner: Alex. English only. Separate from Repo Atlas on purpose (23 Nov 2026): Atlas maps the code, Trace shows what ran; a link between the two may come later (a call names the file it ran in). Decisions and backlog live in Notion (Studio G › Repo trace). The command stays `trace`, the package is `repo-trace`.

## Layout
- `bin/trace.mjs`: the command. With no command (or a folder): the start screen, opened on the folder repo-trace sits in (`~/Code`), as Repo Atlas does (23 Nov 2026). Also `dev`, `--`, stdin, `demo`.
- The start screen (24 Nov 2026, BL-316): a folder (typed, the Mac's folder dialog, or a recent one), then its projects, most recent first; the selected one shows its routes as chips and the one primary Run it. Sun marks it (the spark, the selected row) ahead of the T1 redesign.
- `src/projects.mjs`: projects (a Wrangler config up to two folders down, with a `main`), most recently changed first, each with its folder as its id (so any folder can be listed); whether its code logs Repo Trace's lines (`readProject`, `logs`); their routes read from the code with patterns (pathname checks, segments from `pathname.split('/')`, `method !==` refusals, routers, switch cases), with file and line.
- `src/session.mjs`: one session at a time, started from the page: `wrangler dev --var TRACE:1` (projects that log their calls turn them on). Requests come from wrangler dev's own lines (`fromWranglerLine`), so a project needs no change.
- `src/parse.mjs`: printed lines → events (`parseLine`), the terminal copy without trace lines (`passThrough`, `--show` keeps them), the line splitter, `fromWranglerLine`.
- `src/folders.mjs`: `~` in paths, recent folders (`~/.config/repo-trace/recent.json`: a folder is kept when a project is run from it, six at most) and the Mac's folder dialog (`osascript` `choose folder`, the folder passed as an argument).
- `src/server.mjs`: the viewer page, `/events` (server-sent events: calls, `session`, `output`, `reset`) and `/api/*` (projects of a folder, choose-folder, routes, session). Listens on 127.0.0.1 only; every `/api` request needs the `x-repo-trace: 1` header, the page's own origin and a localhost Host (it can list any folder). Keeps the last 20,000 events for a page opened late.
- `src/demo.mjs`: a sample API (its routes, `DEMO_ROUTES`) with traffic shaped like learn.fm: requests (a 404 now and then, a rare 500), episodes being made, a few minutes of history so the pulse isn't empty.
- `viewer/index.html`: the whole viewer, one file, no build, no framework. State is reduced from events in the page. The running view is T1 (24 Nov 2026, mock: the TraceMap board on the canvas): left, the project (its name opens the start screen; Stop, Restart, Output) and its routes as a tree by path, each with its methods, call counts and a heat pixel (calls in the last five minutes); middle, the pulse (one square per request over the last five minutes, grey 2xx, outlined 4xx, red 5xx, sun selected), the jobs (groups that aren't requests: an episode, a host turn) and the selected request's waterfall with Previous / Next / Latest; right, What went wrong (the latest failure, always shown) and the selected call; bottom, Pause. Clicking a route filters the pulse and the requests. What went wrong shows the failing call's note and the route's file:line; pairing it with wrangler's own exception lines is still to do (BL-315).
- `lib/trace.ts`: what an app copies in to log calls (`span`, `traceGroup`, `tracedFetch`, `traceOn`).
- `docs/format.md`: the line format. Change it there first; keep `lib/trace.ts`, the parser and the viewer in step.

## Rules
- No dependencies, no build step. Node 20+.
- Studio G design system: tokens copied by hand from `studio-g/design-system/tokens.json` into the viewer's `:root` (Light) and `[data-theme="dark"]` (After hours). No other hex values. Inter, no monospace except the JSON example and the Output view (a terminal's text). Square pixels mark state. One primary action per view.
- Services get tag colours (fixed for known names, by hash for others), category only. `danger` only for failures, always with words.
- Sun is the accent (24 Nov 2026): `spark-sun` for pixels and the selected square, `tag-sun` for selected rows, `tag-sun-ink` for links and accent text (`--accent`). Services and methods keep tag colours as categories, never sun (ElevenLabs is vermilion, PUT and PATCH too).
- Copy: few words, verbs on buttons, no exclamation marks, no emoji, no promises of things that aren't built.
- Privacy: nothing leaves the computer. Repo Trace shows what the app logs; the docs tell apps never to log user text, prompts or keys.

## Check before saying it's done
- `npm test`
- `node bin/trace.mjs demo --open`, and look at it in both themes and on a narrow window.
