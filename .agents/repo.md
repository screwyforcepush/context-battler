
# Repository Guidelines

VALIDATE by Running required commands — all must pass without warnings or errors:
   - lint:       `npm run lint`
   - typecheck:  `npm run typecheck`
   - tests:      `npm test`
   - build:      `npm run build` (currently a typecheck-only alias; `npm run build:replay` runs the real Vite build for `apps/replay/`)


## Dev server

The replay overseer is a local Vite app at `apps/replay/`.

- Start: `npm run dev:replay` → http://localhost:5173
- Prereq: a Convex dev deployment must be reachable. Either run
  `npx convex dev` in another terminal from the repo root (keeps pushing
  schema + functions on save), or have pushed once so `convex/replay.ts`
  is deployed. `apps/replay/.env` must set `VITE_CONVEX_URL` to that
  deployment URL.
- Hash-routed: `#/` picker, `#/match/<id>` replay view.

No other long-running app process exists today. The harness
(`npm run harness`) is a finite multi-run driver, not a server.

When you do start a long-running process (dev server, watcher, simulation host) that must survive past your final response, **nohup it** so it isn't killed when the headless agent exits. Pattern:

```bash
nohup <start-command> > /tmp/<name>.log 2>&1 &
```

Before launching a new instance, check whether one is already running (e.g. `ps`, log file presence) — restarting bumps the port and orphans state.


## Documentation Protocol
Guard the doc hierarchy: specs in `docs/project/spec/` remain the source of truth (mental model, business logic, data dictionary, data flows, tech guide, industry references); guides in `docs/project/guides/` capture evolving process; phase folders (`docs/project/phases/XX-Name/`) store live work packages and notes. Update whichever doc you rely on as soon as the code diverges.


## Pre-deployment

No deploy target. This repo is local-only by design through the current
phase (per `docs/project/spec/mental-model.md` §11 — "No auth, no public
deploy"). The replay overseer runs against the user's own Convex dev
deployment; the harness runs locally. CI is not configured.

Revisit when the consumer-facing renderer phase begins.
