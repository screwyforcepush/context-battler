# Convex Backend — Deployment, Auth, Smoke Test

Operational reference for talking to the project's Convex deployment. **Verified working 2026-05-19 (phase-14 map pool).**

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

## 2. Deployment state (as of 2026-05-19)

- Project: **active** — full Convex schema (`convex/schema.ts`), functions deployed (`matches`, `runMatch`, `turns`, `turnsDerived`, `reports`, `reports/phase7`, `reports/phase9`, `reports/phase10`, `reports/phase12`, `replay`, `cards`, `spike`), active tables (`matches`, `characters`, `turns`, `worldState`, `worldStatic`, `prompts`, `runs`, `reports`, `cards`, `cardAccruals`).
- Current data: 20 phase-12 closing matches + 20 telefrag-frequency experiment matches + 5 phase-14 map-matrix canary matches + associated turns/characters/runs/reports. Previous data was wiped per POC posture before the phase-12 closing. Canonical closing report: `jd75980xfbda1d19pynjgyb88186ramv` (`phase-12-closing-20`). Card pool: seeded on first `cards.seed` call (8 presets from the locked persona union); additional Cards addable via `cards.create`.
- Schema/code changes (phase 14): `convex/engine/map.ts` now owns a single `MAP_REGISTRY` (5 descriptors: `reference`, `split-basin`, `crosswind`, `market-maze`, `faultline`), `getMapDescriptor(id)`, `MAP_IDS`, `DEFAULT_MAP_ID`. The inline expander/loader previously duplicated in `convex/matches.ts` is deleted — both `matches.start` and `matches.startFromCards` import from `./engine/map.js`. Optional `mapId` arg on both triggers (absent defaults to `"reference"`). Match row records the resolved `mapId`. No new tables; no schema change.
- Schema additions (phase 13): `cards` table (persistent agent unit — agentName, promptHash, lineagePersonaId, progression placeholder, accumulator stats, isPreset flag); `cardAccruals` table (per-match idempotency sentinel, indexed by matchId); `characters` gains optional `cardId` + `cardPromptHash` fields for Card-triggered matches. `matches.startFromCards` is the new parallel trigger (exactly 8 Card ids).
- Schema additions (phase 12): `crateValidator` is the live loot-container validator; `resolutionValidator` gains `environmentalDeaths` array; `worldState` gains `airdrops` (dynamic airdrop state); `worldStatic` gains `airdropWaves` (immutable wave schedule); `phase12Payload` on `reports` for the 23-gate closing payload. Prior phase-11 additions remain: `prompts` table, `worldStatic` table, structured `input.status`/`narrativeLines`/`aliveCount` on turns.
- Notable query: `turns.byMatchSlim` — slim per-match trace projection that audits speech/loot/damage delivery against next-turn `narrativeLines` (via `narrativeLines.some(line => line.includes(...))`) before stripping heavy LLM text fields. Projects `selfHp`, `selfEquipment.consumable`, slide, bodyCollision, and `environmentalDeaths` evidence from structured `input.status` for diagnostics. Used by the diagnostics CLI, dashboard, and closing drivers to stay under the 16 MB per-function read budget.
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
