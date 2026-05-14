# Eval Pipeline — Step-by-Step

> Practical recipe: tweak a prompt / value / config → 10 runs → metric +
> verbose-failure report. Reflects the actual state of harness + Convex
> aggregators as of phase 9 (rect-grained vision, wall-slide substrate,
> slim per-match query, behavioural diagnostics CLI + dashboard). Keep
> this current; future shifts in the report contract belong here.

---

## TL;DR — the minimum loop

```bash
# 1. Make your prompt / value / config change.
#    Restart `npx convex dev` if it isn't already running so Convex picks up
#    backend changes.

# 2. Fire 10 matches, parallel, persisted, tagged with a seed prefix for
#    reproducibility:
npm run harness -- --runs 10 --concurrency 10 --reasoning low \
  --seed-prefix <tag> \
  > /tmp/run.jsonl 2> /tmp/run.err

# 3. Grab the matchIds + the closing-10 reportId from stdout JSONL:
grep '"event":"run_aggregate"' /tmp/run.jsonl | jq -r '.matchId'
grep '"event":"report_created"' /tmp/run.jsonl | jq -r '.reportId'

# 4. Persist the Phase-6 metrics row (iter-2 mechanics gates + phase-1
#    carry-overs). Requires local computation for large sets — see §3a.
npx convex run reports/phase6:persistComputedPhase6Report \
  --json '{"matchIds": ["matchId1", "matchId2", ...], "payload": <computed>, "overwrite": true}'

# 5. Read the per-match validator clusters + failure taxonomy:
for m in <matchId>...; do
  tsx harness/cluster-failures.ts "$m"
done

# 6. Step through any run visually:
npm run dev:replay
# → open http://localhost:5173 → pick the match → step.
```

The harness command (step 2) is the only one that's a single
ergonomic verb. Step 4 uses `convex/reports/phase6.ts` which
computes the full iter-2 mechanics gate set (no-op rate, action+
overwatch combos, counter retaliations, compass coverage, etc.)
plus all phase-1 carry-over thresholds. For phase-7 closing runs,
use the phase-7 closing driver instead — see §4.5.

---

## 1. The harness call (what `npm run harness` actually does)

`harness/run.ts` is the entry point. Behaviour:

| Flag | Default | Meaning |
|---|---|---|
| `--runs N` | 1 | Number of matches to fire. |
| `--concurrency C` | 1 | Max matches in flight at once. Use `C === N` for max parallelism (Azure rate limits allow ~10 concurrent). |
| `--reasoning low\|medium\|high` | low | Plumbed end-to-end to Azure `reasoning.effort`. `none` is rejected. |
| `--seed-prefix tag` | — | Prepended to each match's seed name (`tag-01`, `tag-02`, …). Re-running with the same prefix and same Convex deployment reproduces the same map/spawn conditions per match — load-bearing for cohort comparisons. |

Lifecycle per match:
1. `matches.start` mutation creates the row (seed pinned, `reasoningEffort` field set).
2. `runMatch.advanceTurn` is called in a loop (Convex action; one LLM call per living agent per turn, parallel; engine resolves; persists `turns` row).
3. On `match.status === "completed"`, the scheduler fires `runs.aggregate(matchId)` which writes a per-match summary row.
4. After all matches finish, the harness calls `reports.create({matchIds, reportType: "closing-${runs}"})` which inserts the `reports` row (idempotent — re-firing the same set is a no-op).

Output to stdout (JSONL — grep-friendly):
- `run_start`, `poll`, `run_end` — lifecycle per match.
- `run_aggregate` — per-match summary (matchId + kills/extractions/equips/speech + per-persona breakdown).
- `multi_run_summary` — final tally summed across matches.
- `report_created` — `{reportId, reportType, runCount, meetsAllThresholds, meetsXThreshold:…}`.
- `harness_error` / `fatal` — failure paths.

Exit code: `0` on full success; `1` if any match failed OR any aggregate row was missing.

**The `closing-N` report payload is phase-1 metrics only:** extraction, kill, equip, speech rates + persona spread + per-persona breakdown. It does NOT contain `fallbackRate`, schema-validity metrics, no-op rate, validator clusters, or rawArguments==decision. Those need separate invocations.

---

## 2. Phase-1 inspection scripts (which ones still work)

All located in `harness/`. All take a single `matchId` as argv.

| Script | Phase | Status | What it prints |
|---|---|---|---|
| `analyze-match.ts` | 1 (extended phase 6) | ✅ Works | Per-match fallback rate; failureReason histogram; field-error histograms; use/position/action kind histograms; move direction kind histogram; per-persona fallback breakdown; sample raw rawArguments per persona. **This is the right tool for a quick per-match sanity check after a prompt tweak.** |
| `cluster-failures.ts` | 1 (extended WP10.5 B.3) | ✅ Works | Schema-validation samples; validator-rejection cluster grouped by `validatorReason` text (top reasons + 3 raw samples each); HTTP-failure per-turn distribution. **This is the tool that produced D1's "510 already-opened-chest re-loots" clusters.** Run it per-match; aggregate by hand for cohort views. |
| `inspect-attacks.ts` | 1 | ✅ Works | Attack/overwatch result histograms; per-persona attack counts; damage distribution. Useful when combat outcomes look off. |
| `inspect-http.ts` | 1 | ✅ Works | HTTP failure bucket counts + retried-call rate + per-persona HTTP error rate. Useful when you suspect transient Azure rate-limiting. |
| `inspect-equipped.ts` | 1 | ⚠️ **INCOMPATIBLE** | Greps `/Equipped:\s*([^\n]+)/` out of `visibleStateDigest`. The phase-3 digest dropped the literal `Equipped:` label; loadout is now in the `You: at (X,Y), HP/maxHP, weapon / armour / consumable` line. The regex never matches → the script silently produces an empty report. Either skip it or rewrite the regex against the new digest shape. |
| `probe-reasoning.ts` | 3 | ✅ Works (probe) | One-off Azure call with `reasoning.summary: "auto"`; writes `harness/probe-reasoning-output.json`. Useful for re-checking that reasoning capture works on a fresh deployment / model change. Not for cohort eval. |

Compatibility caveat for all five: they read from the live Convex
deployment. If you've wiped Convex between phase-1 / phase-3 / phase-4,
old matchIds won't resolve. Always use matchIds from the current
deployment.

---

## 3. Phase-3 metric aggregators (what's beyond `closing-N`)

Lives in `convex/reports/phase3.ts`. Two surfaces:

### 3a. The pure function — for programmatic use

```ts
import { computePhase3Metrics } from "./convex/reports/phase3";
// runs: Phase3RunInput[]  ← turns + characters rows for each match
const payload = computePhase3Metrics(runs);
// payload contains:
//   fallbackRate, fallbackCount, totalAgentRecords
//   wallBlockedMoveRate, drainedRepeatRate, corpseLootSuccessRate
//   defensiveCounterFires, offensiveOverwatchFires
//   outcomeAttributionRate, reasoningCaptureRate
//   + phase-1 carry-over (extraction/kill/equip/speech, persona spread)
//   + meetsXThreshold flags
```

### 3b. The Convex action — for one-shot CLI use

```bash
# Compute + return only (does NOT persist):
npx convex run reports/phase3:computePhase3Report \
  --json '{"matchIds": ["j97..a","j97..b",...]}'

# Compute AND persist as a `phase-3-closing-10` row (idempotent by
# matchIds-hash + reportType; pass overwrite:true to force a fresh row
# if you've already persisted one for this set):
npx convex run reports/phase3:computeAndPersistPhase3Report \
  --json '{"matchIds": [...], "overwrite": true}'
```

The persisted row is queryable via `reports.byMatchIdsHash` or by `_id`. The D1 artifact's "Phase-3 metrics reportId" column is exactly these rows.

**This is what gives you `fallbackRate`** — the phase-1 `closing-N` row doesn't carry it; this aggregator does.

---

## 4. Phase-6 metric aggregator

Lives in `convex/reports/phase6.ts`. Supersedes the ad-hoc phase-4 metrics.

### 4a. The pure function — for programmatic use

```ts
import { computePhase6Metrics } from "./convex/reports/phase6";
// runs: Phase6RunInput[]  ← turns + characters rows for each match
const payload = computePhase6Metrics(runs);
// payload contains (iter-2 mechanics gates):
//   noOpRate, noOpCount, totalAgentRecords
//   actionOverwatchCombos, overwatchTriggerFires, counterRetaliations
//   compassBearings[], targetRelativeKinds[]
//   nullOnlyUseViolations, validatorFieldErrors, wholeTurnZeroedValidatorRecords
//   perFieldRejectionRate, playerNLiteralCount
//   damageFeedEvents, damageFeedMissing, damageFeedAuditSamples[]
//   + phase-1 carry-over (extraction/kill/equip/speech, persona spread)
//   + meetsXThreshold flags for all 17 gates
```

### 4b. The Convex mutation — for persisting a pre-computed report

The phase-6 payload is computed locally (the full data set exceeds
Convex's 16 MB per-function read limit). Persist with:

```bash
npx convex run reports/phase6:persistComputedPhase6Report \
  --json '{"matchIds": [...], "payload": <computed-payload>, "overwrite": true}'
```

The persisted row has `reportType: "phase-6-closing-20"` and is
queryable via `reports:byId` by `_id`.

### 4c. No-op rate (iter-2 definition — superseded by phase-7 split)

`use:null` AND `say:null` AND `action.kind:"none"` AND stationary
position resolution (`move` with `dist:0`, or `overwatch`/`counter`
with no action). Overwatch/counter with `action.attack` or
`action.loot` are NOT no-ops. Computed by `computePhase6Metrics`.

**Phase 7 replaced `noOpRate` with two separate distributions:**

- `armedStancePauseRate` — `position:{overwatch|counter}` + `action:none`. Models deliberately priming reactive fires; not a behaviour-policy gap.
- `trueStationaryRate` — `position:{move, dist:0}` + `action:none`. Genuinely idle turns.

Both are DATA-only (not gated) in the phase-7-closing-20 report. The
phase-6 `noOpRate < 5%` gate is intentionally absent from `computePhase7Metrics`.

### 4d. Truncation rate (≥95% of `max_output_tokens`)

The replay UI's TurnFeed renders this per turn. To get a cohort number ad-hoc, iterate `r.llm.raw.usage.output_tokens` per record and compare to `MAX_OUTPUT_TOKENS = 1200`.

---

## 4.5. Phase-7 closing driver and diagnostics CLI

Phase 7 introduced two new harness tools plus a dashboard tab. All three
read via `turns.byMatchSlim` — a slim per-match Convex query that strips
heavy LLM text fields, keeping each response well under the 16 MB
per-function read budget.

### 4.5a. Closing driver (`harness/closing/phase7.ts`)

Runs the full Phase-7 gate evaluation over a set of matches and persists
a small computed payload via `reports/phase7:persistComputedPhase7Report`.
This is the "Path 2" pipeline: fan out one `byMatchSlim` call per match,
compute metrics locally, persist only the result.

```bash
# Close over the last 20 matches (auto-selects from Convex):
npx tsx harness/closing/phase7.ts --last 20

# Close over explicit match ids (prevents stale-row contamination):
npx tsx harness/closing/phase7.ts --matchIds "id1,id2,..."

# Overwrite an existing report for the same match set:
npx tsx harness/closing/phase7.ts --matchIds "id1,id2,..." --overwrite
```

The persisted row has `reportType: "phase-7-closing-20"` and is
queryable via `npx convex run reports:byId '{"id":"<reportId>"}'`.

### 4.5b. Diagnostics CLI (`harness/diagnostics.ts`)

Computes three metric families over the last N ≤ 20 matches, with no
persisted aggregate rows (recompute on demand).

```bash
# Markdown summary to stdout:
npx tsx harness/diagnostics.ts --last 20

# JSON output:
npx tsx harness/diagnostics.ts --last 20 --format json

# Write to file:
npx tsx harness/diagnostics.ts --last 20 --format json --out /tmp/diag.json
```

| Flag | Default | Meaning |
|---|---|---|
| `--last N` | 20 | Number of recent matches (clamped to ≤ 20). |
| `--format json\|markdown` | markdown | Output format. |
| `--out <path>` | — | Write to file instead of stdout. |

Three metric families:

1. **Critical fails** — fallback rate by `failureReason`, retry recovery,
   `output_tokens` proximity to cap, per-field validator-rejection
   breakdown, persona × failure-reason cross-tab.
2. **Game-mechanic sanity** — attack outcomes, overwatch fires split by
   `triggeredByMovement`, counter retaliations, chest/corpse loot funnels,
   consume waste (including `consume:heal at full HP`), speech metrics,
   damage-feed delivery audit (evidence-backed: audits next-turn
   `composedUserMessage` before projection), wall-blocked moves,
   declared-vs-actual move distance.
3. **Behavioural distribution** — totals by persona × turn-phase,
   contextual combos (`counter + attack`, `overwatch + loot`,
   `move:dist=0 + action≠none`, `consume:heal at full HP`, etc.),
   cross-cuts by persona × turn-phase × visibility × equipment
   (including consumable-present state).

### 4.5c. Phase-9 closing driver (`harness/closing/phase9.ts`)

Runs the Phase-9 gate evaluation (preserved phase-7 thresholds plus
slice-specific counters: rect-keyed walls/cover/evac, wall-slide
outcomes, wall-on-wall occlusion, evac-out-of-Chebyshev-20,
inside-bearing-here, single-tile-key-for-multi-tile-rect zero-check).
Same Path-2 architecture as the phase-7 driver.

```bash
# Close over explicit match ids:
npx tsx harness/closing/phase9.ts --matchIds "id1,id2,..."

# Close over the last 20 matches:
npx tsx harness/closing/phase9.ts --last 20

# Overwrite an existing report:
npx tsx harness/closing/phase9.ts --matchIds "id1,id2,..." --overwrite
```

The persisted row has `reportType: "phase-9-closing-20"` and is
queryable via `npx convex run reports:byId '{"id":"<reportId>"}'`.

### 4.5d. Diagnostics dashboard (`#/diagnostics`)

The replay app (`npm run dev:replay`) has a top-level **Diagnostics** tab
at `#/diagnostics?last=N`. It uses the same `byMatchSlim` fan-out and
diagnostic computation as the CLI. Aggregate rows are clickable and
deep-link to the existing replay turn-detail modal (no new modal) at the
appropriate `#/match/<id>?turn=T&character=Persona` route.

---

## 5. Visual inspection (the replay UI)

```bash
npm run dev:replay
# → http://localhost:5173
```

The replay app reads from the live Convex deployment (same `.env`). Two top-level tabs: **Matches** (per-match replay) and **Diagnostics** (cohort view — see §4.5c). Every turn-feed row shows:

- The agent's decision in English (`decisionEnglish.ts` — iter-2 shape: use/position/action/say/scratchpad with overwatch/counter/move arms, compass+dist, toward/away targetId).
- A 🧠 indicator when reasoning text is captured.
- Per-field `validatorFieldErrors` badges (field name + reason text) when individual fields were zeroed.
- A usage-tokens bar with a truncation badge at ≥ 95% of cap.
- An expand-modal showing:
  - Full LLM Input (system role + user role + per-turn tool schema variant).
  - Reasoning text (separate pane).
  - Tool call (`rawArguments` vs `decision`, matched/diverged indicator).
  - Per-turn tool schema variant (shows the actual schema shipped for that agent+turn, including `use` field narrowing).

Vintage (pre-phase-6) matches are detected and gated with a notice rather than rendered through compatibility shims.

This is the right tool for "I want to understand WHY this prompt failed on this turn." For cohort-level metrics across multiple matches, use the Diagnostics tab (`#/diagnostics?last=N`) — see §4.5c — or the CLI (§4.5b).

---

## 6. Recipe — full eval cycle for a single prompt tweak

```bash
# Setup (once per session)
nohup npx convex dev > /tmp/convex.log 2>&1 &

# 0. Capture a tag for the cohort
TAG="eval-$(date +%s)"

# 1. Make the prompt change (edit convex/llm/systemPrompt.ts or whatever)

# 2. Fire 10 matches
npm run harness -- --runs 10 --concurrency 10 --reasoning low \
  --seed-prefix "$TAG" > /tmp/$TAG.jsonl 2> /tmp/$TAG.err

# 3. Extract matchIds
MATCHIDS=$(grep '"event":"run_aggregate"' /tmp/$TAG.jsonl \
  | jq -r '.matchId' | paste -sd, -)
echo "matchIds: $MATCHIDS"

# 4. Phase-6 metrics (compute locally, persist to Convex — see §4b).
#    For phase-3 carry-over metrics only:
MATCHIDS_JSON=$(echo "[$MATCHIDS]" | sed 's/,/","/g; s/\[/["/; s/\]/"]/')
npx convex run reports/phase3:computeAndPersistPhase3Report \
  --json "{\"matchIds\": $MATCHIDS_JSON, \"overwrite\": true}"

# 5. Failure clusters per match (concatenate or grep)
for m in $(echo "$MATCHIDS" | tr ',' ' '); do
  echo "=== $m ==="
  npx tsx harness/cluster-failures.ts "$m"
done > /tmp/$TAG.clusters.txt

# 6. Eyeball one match in the UI
echo "open http://localhost:5173 and pick one of: $MATCHIDS"
```

If you ask me to run this, I'll do steps 1–6 and write up a markdown
report mirroring the D1 artifact's shape (cohorts table → metrics table
→ validator clusters → diagnosis). It's ~10 minutes wall-clock for a
10-run cohort (Azure latency dominates) plus a few minutes to aggregate.

---

## 7. Compatibility matrix (TL;DR)

| Surface | Phase 1 | Phase 3 | Phase 6 | Phase 7 | Phase 9 (current) |
|---|---|---|---|---|---|
| `harness/run.ts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `harness/analyze-match.ts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `harness/cluster-failures.ts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `harness/inspect-attacks.ts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `harness/inspect-http.ts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `harness/inspect-equipped.ts` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `harness/diagnostics.ts` | — | — | — | ✅ | ✅ (3-family CLI, slim fan-out) |
| `harness/closing/phase7.ts` | — | — | — | ✅ | ✅ (Path 2 local compute + thin persist) |
| `harness/closing/phase9.ts` | — | — | — | — | ✅ (Path 2; rect/slide/occlusion counters) |
| `closing-N` report (phase-1 metrics) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `computePhase3Report` action | — | ✅ | ✅ | ✅ | ✅ |
| `computePhase6Metrics` + persist | — | — | ✅ | ✅ | ✅ |
| `computePhase7Metrics` + persist | — | — | — | ✅ | ✅ |
| `computePhase9Metrics` + persist | — | — | — | — | ✅ (local compute + Convex persist) |
| `phase-7-closing-20` persisted row | — | — | — | ✅ | wiped (POC posture) |
| `phase-9-closing-20` persisted row | — | — | — | — | ✅ |
| `turns.byMatchSlim` query | — | — | — | ✅ | ✅ (extended with slide evidence) |
| no-op rate aggregator | — | — | ✅ | superseded | superseded (→ armedStancePause / trueStationary) |
| Replay UI — Matches tab | — | ✅ | ✅ | ✅ | ✅ (rect-keyed Vision; vintage data gated) |
| Replay UI — Diagnostics tab | — | — | — | ✅ | ✅ (`#/diagnostics?last=N`) |

Phase-9 data only lives in the current Convex deployment. Pre-phase-9
match data was wiped per POC posture; old matchIds will not resolve.
