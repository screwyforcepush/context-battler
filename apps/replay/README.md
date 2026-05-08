# Personal Replay Overseer (v0)

Browser-local app for the project's Outcome Steward to step through
completed matches turn-by-turn against their own Convex dev deployment.
Diagnostic-grade — single user, no auth, no deploy.

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
- `#/match/<matchId>` — replay view (WP-B will land the grid + stepper).

## Why this is a sub-package

Per `docs/project/phases/02-replay-overseer-v0/architecture-decisions.md`
§2, the renderer lives at `apps/replay/` as a sibling of `convex/`,
`harness/`, `maps/`, etc. — not as a workspace member. Root scripts call
into it via `npm --prefix apps/replay run <name>`.

The renderer subscribes to Convex State only; it never imports runtime
values from `convex/engine|llm|runMatch`. Type-only imports across the
slice boundary are explicitly allowed and enforced by the root ESLint
`no-restricted-imports` rule (see `eslint.config.mjs`).
