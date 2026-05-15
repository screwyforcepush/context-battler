# Convex Backend — Deployment, Auth, Smoke Test

Operational reference for talking to the project's Convex deployment. **Verified working 2026-05-15 (phase-11 closure).**

> Convex is the backend-as-a-service for state, queries, mutations, and scheduled functions. Auth is via a deploy key in `.env`; the CLI picks it up automatically.

---

## 1. Credentials (in `.env`)

```
CONVEX_URL=https://calculating-meerkat-923.convex.cloud
CONVEX_DEPLOY_KEY=dev:calculating-meerkat-923|<token>
```

- The URL host (`calculating-meerkat-923`) and the deploy key's deployment slug must match.
- `dev:` prefix = **dev deployment key**. Allows deploy + invoke + read. For prod, the prefix is `prod:` and you'd typically use it only in CI.
- `.env` is gitignored. Never commit these.

## 2. Deployment state (as of 2026-05-14)

- Project: **active** — full Convex schema (`convex/schema.ts`), functions deployed (`matches`, `runMatch`, `turns`, `turnsDerived`, `reports`, `reports/phase7`, `reports/phase9`, `reports/phase10`, `replay`, `spike`), active tables (`matches`, `characters`, `turns`, `worldState`, `runs`, `reports`).
- Current data: 10 phase-11 smoke matches + associated turns/characters/runs/reports. Previous data was wiped per POC posture before the phase-11 smoke. Canonical smoke report: `jd7f82nezegb6wdy13n0h73r8x86r6w9` (`closing-10`). Phase-9 compatibility report over the same set: `jd70eegy9e668rke07a1p80jwx86r43t`.
- Schema additions (phase 11): `prompts` table keyed by `(hash, kind)` for prompt-text dedup; `worldStatic` table for immutable terrain; `worldState` now stores dynamic fields only; `turns.agentRecords[].input` stores prompt hashes plus structured `status`, `narrativeLines`, and `aliveCount` rather than prompt text or `composedUserMessage`.
- Notable query: `turns.byMatchSlim` — slim per-match trace projection that audits speech/loot/damage delivery against next-turn `narrativeLines` before stripping heavy LLM text fields. Projects `selfHp`, `selfEquipment.consumable`, slide, and bodyCollision evidence for diagnostics. Used by the diagnostics CLI, dashboard, and closing drivers to stay under the 16 MB per-function read budget.
- `package.json` includes `convex` as a devDependency.

## 3. Smoke tests (no functions required)

All three should pass on a fresh deployment with valid credentials:

```bash
set -a; source .env; set +a

# 1. Deployment is reachable
curl -sS "$CONVEX_URL/version"
# → e.g. "20260504T231427Z-f1774a00487d"

# 2. Deploy key authenticates (lists tables — empty on fresh deployment)
npx convex data
# → "There are no tables in the calculating-meerkat-923 deployment's database."

# 3. Function metadata reachable
npx convex function-spec
# → { "url": "...", "functions": [] }
```

If any of these fail, suspect: stale/rotated deploy key, deployment paused, or URL/key slug mismatch.

## 4. Developer loop

```bash
npx convex dev          # watches convex/, redeploys on change, streams logs (long-running)
npx convex dev --once   # single push + codegen, then exit
npx convex run <fn>     # invoke a deployed function from the CLI
```

`npx convex dev` (long-running) is the standard developer loop. It watches `convex/`, redeploys on change, and streams logs. Use `--typecheck=disable` when pushing schema changes that temporarily break type coherence (e.g. after a DB wipe).

## 5. Useful commands

| Command | Purpose |
|---|---|
| `npx convex data [table]` | List tables / print rows. Read-only. |
| `npx convex function-spec` | List deployed functions and their arg/return shapes. |
| `npx convex run <fn> [json-args]` | Invoke a function from the CLI. |
| `npx convex logs` | Stream deployment logs. |
| `npx convex env list` | List server-side env vars (separate from `.env`). |
| `npx convex dashboard` | Open the web dashboard. |
| `npx convex deployment` | Show which deployment the CLI is pointing at. |

## 6. Server-side env vars (`npx convex env`)

Anything a Convex function needs at runtime (e.g. `AZURE_API_KEY` for an action that calls the LLM) lives in the **deployment's** env, not `.env`. Set with:

```bash
npx convex env set AZURE_API_KEY "$AZURE_API_KEY"
```

`.env` is for the **local CLI/dev machine**. Convex functions executing in the cloud don't see it.

## 7. When this guide goes stale

- Deployment renamed or rotated: update both `CONVEX_URL` and `CONVEX_DEPLOY_KEY` in `.env`, re-run §3.
- Schema/functions change: update §2 table counts and function list after major phase closures.
- DB wipe: after a POC wipe, update §2 to reflect the new data state.
