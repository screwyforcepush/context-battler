# Personal Replay Overseer (v0)

Browser-local app for the project's Outcome Steward to step through
completed matches turn-by-turn against their own Convex dev deployment.
Diagnostic-grade — single user, no auth, no deploy.

## Prerequisites

The renderer is read-only against the user's own Convex dev deployment.
Before `npm run dev:replay` will produce useful results:

- **`replay:listMatches` must be exposed by the dev deployment.** Either
  run `npx convex dev` from the repo root in another terminal (keeps
  pushing schema + functions on save), or have pushed at least once so
  the dev deployment has the `convex/replay.ts` module deployed.
  Without this, the picker fails with a function-not-found error.
- **`VITE_CONVEX_URL` must be set in `apps/replay/.env`** and point at
  that same dev deployment URL (the one `npx convex dev` prints, e.g.
  `https://<slug>.convex.cloud`).

## Quick start

```bash
# 1. Install (run once after cloning the monorepo)
npm install --prefix apps/replay

# 2. Configure your Convex dev deployment URL
cp apps/replay/.env.example apps/replay/.env
# Edit `apps/replay/.env` and set VITE_CONVEX_URL to the URL `npx convex dev`
# prints in the repo root (e.g. `https://<slug>.convex.cloud`).

# 3. Start the dev server
npm run dev:replay
# → http://localhost:5173
```

## Routes

- `#/` — match picker (paginated, completed-only, reverse-chronological).
- `#/match/<matchId>` — replay view: bird's-eye SVG grid, turn stepper
  (slider + Next + arrow keys), per-turn side-panel feed with
  decisions in English, hover details on agents/crates/corpses, and a
  click-to-expand raw-pane modal with three sections: full LLM input
  (system + user role), reasoning text (when Azure surfaces it), and
  the parsed tool-call JSON. (Phase-3 collapsed the previous 5-tab
  modal to a single raw-dump pane — see
  `docs/project/phases/03-substrate-refinement/architecture-decisions.md`
  §2 for the reasoning-capture contract.)

## Why this is a sub-package

Per `docs/project/phases/02-replay-overseer-v0/architecture-decisions.md`
§2, the renderer lives at `apps/replay/` as a sibling of `convex/`,
`harness/`, `maps/`, etc. — not as a workspace member. Root scripts call
into it via `npm --prefix apps/replay run <name>`.

The renderer subscribes to Convex State only; it never imports runtime
values from `convex/engine|llm|runMatch`. Type-only imports across the
slice boundary are explicitly allowed and enforced by the root ESLint
`no-restricted-imports` rule (see `eslint.config.mjs`).
