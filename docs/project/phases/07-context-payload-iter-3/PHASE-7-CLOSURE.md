# Phase 7 - Closure Record

> Single-file handoff for Phase 8 planning. Records what the
> context-payload iter-3 and diagnostics closeout produced, what proves it,
> and which North Star thresholds are met.
> Closure date: 2026-05-13. Source worktree at close: post-implementation
> closure batch.
>
> This is a closure RECORD, not a retrospective and not a phase-8 plan.

---

## 1. What we set out to build

Phase 7 shipped three connected workstreams:

- Context Payload Iter-3: slim `Vision:`, masked opponent equipment,
  in-range speech restored, own speech split from the mechanical outcome,
  loot outcomes made explicit, coord-encoded chest ids, Inside/Outside Evac
  status, and the two-phase evac/extraction countdown.
- Convex 16 MB unblock: a slim per-match trace query with client-side fan-out
  for closing reports and diagnostics. Full LLM input remains available only
  through drill-down.
- Behavioural diagnostics: a CLI and replay-app dashboard over the last
  N <= 20 matches, with critical-fail, mechanic-sanity, and behavioural
  distribution families.

The proof target was a persisted fresh 20-match `phase-7-closing-20` report,
plus replay/dashboard evidence that aggregate rows deep-link to the existing
turn-detail modal.

---

## 2. Canonical Source

- `reportId` = `jd73vy815k7rdq6y7935hjagn186n9ga`
- `reportType` = `phase-7-closing-20`
- `runCount` = 20
- `metBar` / `phase7Payload.meetsAllThresholds` = `true`
- `missingRunsForMatchIds` = `[]`
- `phase7Payload.failedMatches` = 0

The canonical report is queryable with:

```bash
npx convex run reports:byId '{"id":"jd73vy815k7rdq6y7935hjagn186n9ga"}'
```

The canonical metric payload is `phase7Payload`. The legacy top-level
`payload` field remains populated for report table compatibility, but Phase 7
gate values are read from `phase7Payload`.

The closing driver invocation used explicit match ids rather than `--last 20`
so the report could not mix in unrelated rows:

```bash
npx tsx harness/closing/phase7.ts --matchIds "$MATCH_IDS" --overwrite
```

### 2.1 OCC Substitution Policy

**Policy:** The canonical closing-run set excludes Convex
optimistic-concurrency storage-layer failures, not engine invalid states.
Excluded matches are replaced 1-for-1 with completed live Azure matches run at
concurrency 1. This preserves the phase-6 precedent and keeps the canonical
set at 20 completed matches with zero failed matches.

**Provenance:** the original WP-D2 handoff had a 19-run high-concurrency
harness job in flight:

```bash
npm run harness -- --runs 19 --concurrency 10 --reasoning low \
  --seed-prefix p7-closing-1778654276
```

That job completed 18 matches and produced one Convex OCC storage-layer
failure:

- Excluded match `j977k3ht15zb0jgs0tydjkjcd586m4wq`
- Failed at turn 1
- Error code `OptimisticConcurrencyControlFailure`
- Log: `/tmp/phase7-closing19.jsonl:67`

The run also had a launch discrepancy: it was `--runs 19`, while the phase
requires a 20-run close. WP-D2 reconciled that honestly by adding two
fresh-substrate concurrency-1 replacement matches:

```bash
npm run harness -- --runs 2 --concurrency 1 --reasoning low \
  --seed-prefix p7-closing-1778654276-replacement
```

Those replacements are `j9728435kfmmt09h1jnf56tcjn86mpnq` and
`j975pf4g3bvz71zgeaj7b58gpx86m8xn`.

### 2.2 Match Ids

1. `j973qgwdmcrghg3s4gbg4zg54986m75r`
2. `j9774cd43pbexab7pqxed2erh186m47e`
3. `j977ehemwcaa1swfdsqg38zvzn86nc44`
4. `j970qf3ya407yahfcwj3yj3krx86mn18`
5. `j97a6rjbp2ge1h7rwmvd3afnn186m24n`
6. `j97fzt5ygd6wh17ezjwccy0q3n86mvv0`
7. `j978zhwmsw76azqnm0js1eysch86n1pj`
8. `j97fvc2pgrnyqfwe9ev1j3a9qh86nchg`
9. `j97d0amjk6abb23mg22vnsyqs186mj84`
10. `j9733xtb1skh1epxspjts6xqk586mcg3`
11. `j97aj6h2wb8tczmt86b1zzfez586njmw`
12. `j97d0c616z8kw6xxgcerh1578986m3pq`
13. `j97e8bfaaevpzhncahkbbcqmkd86mc26`
14. `j97eveknqq4eyas28xpjtt0fms86mx9d`
15. `j978j2h32df4qpvjfkb64z8cmh86mej7`
16. `j973eqh3nnhrx1ytn5n87vpnwd86n3dj`
17. `j971bv27qy6nkwq9qbne4dhcws86mc1v`
18. `j9727f4nanqbg2fcjm09pgx75986ngmg`
19. `j9728435kfmmt09h1jnf56tcjn86mpnq`
20. `j975pf4g3bvz71zgeaj7b58gpx86m8xn`

---

## 3. Threshold Verdict

| Gate | Threshold | Measured | Verdict |
|---|---:|---:|---|
| Runs with extraction | >= 30% | 100% (20 / 20) | PASS |
| Runs with kill | >= 80% | 90% (18 / 20) | PASS |
| Runs with equip | >= 80% | 100% (20 / 20) | PASS |
| Runs with speech | >= 50% | 100% (20 / 20) | PASS |
| Persona extraction spread | >= 15 pp | 50 pp | PASS |
| Failed matches in canonical set | 0 | 0 | PASS |
| `null_only` raw `use:"consumable"` emissions | 0 | 0 | PASS |
| Action+overwatch combos | >= 10 | 33 | PASS |
| Movement-triggered overwatch fires | >= 5 | 48 | PASS |
| Counter retaliations | >= 5 | 78 | PASS |
| Compass bearings | all 8 | E, N, NE, NW, S, SE, SW, W | PASS |
| Target-relative movement | toward and away | away, toward | PASS |
| Personal damage feed missing lines | 0 | 0 / 265 | PASS |
| Whole-turn validator zeroes | 0 | 0 | PASS |
| Per-field rejection rate | <= 10% | 0.119% (43 / 36,060 fields) | PASS |
| `Player_N` surfaced literals | 0 | 0 | PASS |
| In-range inbound speech feed events delivered | > 0 | 2,239 | PASS |
| Loot-outcome line carries item name on success | 100% of successful loots | 100% (160 / 160) | PASS |
| Loot-outcome line marks `empty` on failure | 100% of empty/repeat loots | 100% (1,035 / 1,035) | PASS |
| Chest target id literals coord-encoded | zero `chest_NNN` literals | 0 | PASS |
| `armedStancePauseRate` | DATA ONLY | 31.767% (2,291 / 7,212) | DATA |
| `trueStationaryRate` | DATA ONLY | 3.910% (282 / 7,212) | DATA |
| `retryRecoveryRate` | DATA ONLY | 0% (0 / 0) | DATA |

**20 / 20 gated checks pass.** There are no documented-why-not gate misses in
the canonical Phase 7 report. The phase-6 `noOpRate < 5%` gate is not present
because Phase 7 intentionally replaces it with the two data-only distributions
above.

---

## 4. Schema Wipe and Report Pipeline

The schema break for coord-encoded chest ids was exercised earlier in Phase 7
under the POC posture `project_poc_schema_wipe_acceptable`. WP-D2 did not run
another wipe; it used the fresh post-wipe phase-7 deployment and excluded the
single high-concurrency OCC failed match from the canonical set.

The report pipeline used Path 2:

1. Harness completed live matches at `--reasoning low`.
2. `harness/closing/phase7.ts` fanned out one `turns.byMatchSlim` read per
   explicit match id.
3. The CLI computed metrics locally via `computePhase7Metrics`.
4. The CLI persisted only the small computed payload through
   `reports/phase7:persistComputedPhase7Report`.

This path avoids the Convex 16 MB per-function read budget because no single
server function reads full per-turn LLM input across the cohort.

---

## 5. Audit Samples and Event Scopes

The persisted damage-feed note states the report boundary:

> Phase 7 closing uses byMatchSlim damageFeedAudit delivery counters computed
> from next-turn composed user messages before heavy text is stripped;
> final-turn damage and victims without next-turn records are outside the
> audit window.

The closing payload reports 265 audited incoming damage-feed events and
`damageFeedMissing = 0`.

The diagnostics CLI smoke run:

```bash
npx tsx harness/diagnostics.ts --last 20 --format json
```

returned 20 matches, 1,000 turns, and 7,212 agent records from the slim
fan-out path. It also reported the same behavioural split used by the closing
payload: 2,291 armed-stance pauses and 282 true-stationary records.

---

## 6. ADR Rollup

- D1/D2/D6: plan-first dispatch and focused review were followed; the refined
  spec became the implementation contract.
- D3/Q-B1: Path 2 local compute plus thin persist is the default report path;
  server-side action fan-out remains deferred.
- D4/Q-A1: pre-reveal evac status uses `Outside Evac`; inside-zone status uses
  `Inside Evac`.
- D4/Q-A2: prompt hashes remain turn-bound through `buildSystemPrompt(turn)`.
- D4/Q-A3: trace result vocabulary stays discriminating
  (`opened`, `looted`, `already_opened`, `empty`) while the agent-facing line
  renders empty outcomes uniformly.
- D4/Q-A4: speech is not artificially capped by this slice; JSON-safe quoting
  protects the feed.
- D4/Q-C1/Q-C2: the dashboard uses inline/local charting and lives as an
  app-level Diagnostics tab.
- D4/Q-D1: the persisted report type is `phase-7-closing-20`; diagnostics
  recompute on demand and persist no aggregate rows.
- D5: retry recovery is persisted via additive `llm.retried?: boolean`.
- D7/D8/D9: substrate, Convex unblock, diagnostics, and D1 aggregator landed
  before WP-D2; WP-D2 completed the closing run, persisted the canonical report,
  and published this record.

---

## 7. Replay/UI Verification

Manual replay smoke used the existing Vite dev server at
`http://localhost:5173`.

- `#/diagnostics?last=20` rendered the Diagnostics top-level tab with
  20 matches, 1,000 turns, and 7,212 agent records.
- The dashboard showed the three metric families: Critical, Mechanics, and
  Behaviour.
- A diagnostics row click deep-linked to
  `#/match/j975pf4g3bvz71zgeaj7b58gpx86m8xn?turn=3&character=Trader`.
- The existing replay turn-detail modal opened on that route, showing full
  LLM input, reasoning text pane, usage, raw-arguments-vs-decision status,
  failure reason, and decision JSON.
- The modal sample confirmed the iter-3 substrate shape in a live row:
  `Vision:` root, status `Outside Evac`, unarmed baseline
  `unarmed [dmg 5]`, coord-encoded chest ids, and separate speech feed lines.

---

## 7.5 Completion Review Addendum

The first completion-review pass approved the substrate and UAT but found that
the diagnostics feed-delivery counters were same-turn resolution counters, not
evidence from the next-turn user-role message. The fix-up pass changed
`turns.byMatchSlim` to audit previous-turn speech, loot, and damage events
against the next turn's `input.composedUserMessage` before stripping heavy
text, then re-persisted the canonical Path-2 report with the same explicit
20-match set.

- Superseded reportId: `jd7c6qjj5dmhxa97m2md7f533n86m9sk`
- Corrected reportId: `jd73vy815k7rdq6y7935hjagn186n9ga`
- Re-persist trigger: completion-review evidence-backed-gates fix
- `phase7Payload.meetsAllThresholds`: `true`
- `phase7Payload.failedMatches`: 0
- Evidence-backed damage-feed audit: `damageFeedMissing = 0` across 265
  next-turn-audited incoming damage feed lines

The old report row was overwritten by the closing driver (`--overwrite`), so
the corrected report id above is the canonical Phase 7 closeout source.

---

## 8. Deferred Items

1. Keep harness auto-retry for Convex OCC storage-layer transients as a future
   operational improvement. Phase 7 used the documented phase-6 manual
   replacement policy.
2. Revisit server-side action fan-out or pagination only if a future closing-50
   needs it. Path 2 is green for N <= 20.
3. Persona behaviour tuning remains out of scope. Diagnostics now expose
   armed-stance pause, true stationary, and saw-enemy/no-op distributions for a
   future tuning slice.
