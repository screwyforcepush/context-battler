# Convex Backend — Deployment, Auth, Smoke Test

Operational reference for talking to the project's Convex deployment. **Verified working 2026-05-20 (render R&D round-3: HTTP replay contract).**

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

- Project: **active** — full Convex schema (`convex/schema.ts`), functions deployed (`matches`, `runMatch`, `turns`, `turnsDerived`, `reports`, `reports/phase7`, `reports/phase9`, `reports/phase10`, `reports/phase12`, `replay`, `cards`, `spike`), HTTP actions deployed (`convex/http.ts` — replay match-data contract, see §2a), active tables (`matches`, `characters`, `turns`, `worldState`, `worldStatic`, `prompts`, `runs`, `reports`, `cards`, `cardAccruals`).
- Current data: wiped during render R&D round-4 WP1 schemaVersion 3 deployment because historical `turns.resolution.moves[]` rows pre-dated the required `path` field. This follows the POC forward-only/schema-wipe posture. New matches should be generated fresh against the schemaVersion 3 contract; the Card pool reseeds on first `cards.seed` call.
- Schema/code changes (phase 14): `convex/engine/map.ts` now owns a single `MAP_REGISTRY` (5 descriptors: `reference`, `split-basin`, `crosswind`, `market-maze`, `faultline`), `getMapDescriptor(id)`, `MAP_IDS`, `DEFAULT_MAP_ID`. The inline expander/loader previously duplicated in `convex/matches.ts` is deleted — both `matches.start` and `matches.startFromCards` import from `./engine/map.js`. Optional `mapId` arg on both triggers (absent defaults to `"reference"`). Match row records the resolved `mapId`. No new tables; no schema change.
- HTTP replay contract (render R&D round-4): `convex/http.ts` registers an `httpRouter` with two public GET endpoints and their OPTIONS preflights. `convex/replay/reconstruct.ts` is the reconstruction source of truth (moved from `apps/replay/src/lib/`; one-line re-export shim at old path). `convex/replay/snapshot.ts` builds `MatchSnapshotJson` (schemaVersion 3) and `MatchSummary`. `convex/replay/snapshotTypes.ts` exports the contract types. `convex/replay.ts` gains `listMatchesWithCharacters` query (server-side character fan-out). See §2a for endpoint details.
- Schema additions (phase 13): `cards` table (persistent agent unit — agentName, promptHash, lineagePersonaId, progression placeholder, accumulator stats, isPreset flag); `cardAccruals` table (per-match idempotency sentinel, indexed by matchId); `characters` gains optional `cardId` + `cardPromptHash` fields for Card-triggered matches. `matches.startFromCards` is the new parallel trigger (exactly 8 Card ids).
- Schema additions (phase 12): `crateValidator` is the live loot-container validator; `resolutionValidator` gains `environmentalDeaths` array; `worldState` gains `airdrops` (dynamic airdrop state); `worldStatic` gains `airdropWaves` (immutable wave schedule); `phase12Payload` on `reports` for the 23-gate closing payload. Prior phase-11 additions remain: `prompts` table, `worldStatic` table, structured `input.status`/`narrativeLines`/`aliveCount` on turns.
- Notable query: `turns.byMatchSlim` — slim per-match trace projection that audits speech/loot/damage delivery against next-turn `narrativeLines` (via `narrativeLines.some(line => line.includes(...))`) before stripping heavy LLM text fields. Projects `selfHp`, `selfEquipment.consumable`, slide, bodyCollision, and `environmentalDeaths` evidence from structured `input.status` for diagnostics. Used by the diagnostics CLI, dashboard, and closing drivers to stay under the 16 MB per-function read budget.
- `package.json` includes `convex` as a devDependency.

## 2a. HTTP replay contract (render R&D round-4)

`convex/http.ts` exposes two read-only public endpoints. CORS is open (`Allow-Origin: *`, POC posture). No auth.

| Endpoint | Method | Returns | Error codes |
|---|---|---|---|
| `/replay/listMatches` | GET | `MatchSummary[]` — completed matches, desc by `completedAt`, max 100 | — |
| `/replay/exportMatch?matchId=<id>` | GET | `MatchSnapshotJson` (schemaVersion 3) — full match snapshot | 400 (missing/malformed id), 404 (not found), 409 (not completed) |
| `/replay/listMatches` | OPTIONS | 204 + CORS headers | — |
| `/replay/exportMatch` | OPTIONS | 204 + CORS headers | — |

schemaVersion 3 is a forward-only contract bump for renderer-truth event streams. In addition to the existing `timeline.frames`, `killFeed`, `speechLog`, and `agentTraces`, export payloads now include:

- `movements[]`: one row per engine move trace with `turn`, `characterId`, `fromTile`, `toTile`, and the engine-emitted waypoint `path` including both endpoints. Wall-blocked face-slams carry `blockedBy: "wall"`, `bodyCollisionKind: "wall"`, and `wallRectId`; character-collision charges carry `bodyCollisionKind: "character"` without `wallRectId`.
- `attacks[]`: one row per attack/overwatch/counter trace with a real target, plus exactly two rows per unique character-character `bodyCollision` pair. Rows include `weapon` (`null` for unarmed and collision damage), `kind`, `hit`, and deterministic `lethal` flags. Wall body-collisions do not emit attacks.
- `loots[]`: one row per successful item transfer from crate, airdrop, or corpse. Rows include `source`, `sourceId`, `item`, and `equipped`; `equipped: false` means the source was consumed but the item was discarded as weaker. Empty, drained, already-opened, missing, and out-of-range loot attempts are non-events.

`killFeed` remains the death summary stream; body-collision duel deaths are now attributed to the charging mover instead of falling back to `Unknown`.

Smoke test (requires a completed match in the deployment):

```bash
set -a; source .env; set +a
CONVEX_HTTP_URL="${CONVEX_URL/.cloud/.site}"

# List completed matches:
curl -sS "$CONVEX_HTTP_URL/replay/listMatches" | jq '.[0]'

# Export a specific match:
MATCH_ID=$(curl -sS "$CONVEX_HTTP_URL/replay/listMatches" | jq -r '.[0].matchId')
curl -sS "$CONVEX_HTTP_URL/replay/exportMatch?matchId=$MATCH_ID" | jq '.schemaVersion, .playback.turnCount'
```

Types: `MatchSnapshotJson` and `MatchSummary` are exported from `convex/replay/snapshotTypes.ts`. The schemaVersion 3 event streams are specified in [`round-4-spectacle-spec.md` §3.1 and §3.3](../phases/render-rnd/round-4-spectacle-spec.md).

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
