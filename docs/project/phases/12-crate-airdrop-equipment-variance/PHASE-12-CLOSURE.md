# Phase 12 — Closure Record

> Single-file handoff for Phase 13 planning. Records what the
> crate substrate + equipment variance + airdrop lifecycle + telefrag
> slice produced, what proves it, and which North Star thresholds are met.
> Closure date: 2026-05-15. Source commits at close: `ff1d868`, `d709e94`.
>
> This is a closure RECORD, not a retrospective and not a phase-13 plan.

---

## 1. What we set out to build

Phase 12 shipped five connected threads in one slice:

- **Crate vocabulary closure (WP-A):** Engine-wide rename of the legacy
  loot-container term to "crate" — the word agents naturally use
  unprompted. Same vocabulary-gap precedent as `Player_N`→persona names
  and `chest_NNN`→`Chest_53_54`. Scoped to live agent-facing surfaces,
  engine dispatch paths, persona prompts, replay UI, diagnostics, and
  current spec docs; frozen historical phase reports intentionally
  excluded.
- **Deterministic equipment catalog (WP-B):** Expanded weapon and armour
  tiers with plain names (no prompt-injection this slice). Hand-authored
  `contents` per crate — `rollLoot` RNG path retired from the crate
  expand seam. 12 static crates on the reference map, identical every
  run.
- **World-event airdrop lifecycle (WP-C):** Four hand-authored airdrops
  at turns 10/20/30/40, each telegraphed 3 turns ahead via a per-entity
  countdown in every agent's Vision (non-LOS, match-meta like the evac
  reveal). BC-3 two-clock semantics apply: on `landsAtTurn` the input
  still shows the telegraph with `countdown: 0`; `resolveTurn` then lands
  the crate and evaluates telefrag; the first normal LOS-gated loot turn
  is `landsAtTurn + 1`. Once looted/emptied, the crate falls out of
  Vision entirely (absence, not a flag — pillar 8). Mid-game value
  curve: turn-10 weakest, turn-40 strongest under incineration-clock
  pressure.
- **Telefrag (WP-D):** Discoverable, undocumented mechanic — no
  tool-schema surface, no system-prompt teaching. An agent whose resolved
  position equals the airdrop spawn tile on the landing turn is
  vaporised: no corpse, no gear transfer, total erasure. Movement
  resolves first, then the crate spawns (camped or raced-onto both pay).
  Kill-feed line is the only discovery channel (pillar 5). Environmental
  death: credited to no agent, excluded from kill-rate, alive count
  decrements, prize split recomputes.
- **runStats per-persona kill-attribution fix (WP-F, rider):** Mirrored
  the `buildTargetIdLookup` participant-translation pattern from
  `turnsDerived.ts:auditDamageFeed` into `runStats.ts`. Retired the
  phase-6-era structurally-zero `perPersona[*].kills` known issue
  carried through phases 7/9/10.

Two additional work packages supported these: **WP-E** (state-aware
`stopAtRange` per id namespace + telefrag-frequency harness experiment)
and **WP-G** (diagnostics + closing report infrastructure).

The proof target was a persisted 20-match `phase-12-closing-20` report
plus slice-specific evidence (telefrag environmental deaths, airdrop
lifecycle fidelity, determinism, equipment variance, kill attribution).

---

## 2. Canonical Source

- `reportId` = `jd75980xfbda1d19pynjgyb88186ramv`
- `reportType` = `phase-12-closing-20`
- `runCount` = 20
- `metBar` = `true`
- `phase12Payload.meetsAllThresholds` = `true`
- `missingRunsForMatchIds` = `[]`
- `failedMatches` = 0

The canonical report is queryable with:

```bash
npx convex run reports:byId '{"id":"jd75980xfbda1d19pynjgyb88186ramv"}'
```

The canonical metric payload is `phase12Payload`. The report follows the
sibling-payload pattern established by phases 7/9/10.

Report-truth boundary: the persisted row above is the closure artifact.
Completion-review v1 follow-ups landed after this row was written, but
they were read-side projection fixes and a stricter report-gate
interpretation over data already present in the row. No closing-20
regeneration was performed; the canonical payload already satisfies the
tightened all-persona kill-attribution gate.

Harness invocation:

```bash
npm run harness -- --runs 20 --concurrency 10 --reasoning low --seed-prefix phase12-fresh4-20260515143233
```

Report driver:

```bash
npx tsx harness/closing/phase12.ts --matchIds "$(cat /tmp/phase12-closing-matchids.txt)" --overwrite
```

### 2.1 OCC Substitution Policy

**Policy:** No OCC substitutions were required. All 20 matches completed
successfully with zero Convex optimistic-concurrency storage-layer
failures. `failedMatches: 0`, `missingRunsForMatchIds: []`.

---

## 3. Threshold Verdict

### 3.1 Preserved Phase-7 Thresholds

| Gate | Threshold | Measured | Verdict |
|---|---:|---:|---|
| Runs with extraction | >= 30% | 80% (16/20) | PASS |
| Runs with kill | >= 80% | 100% (20/20) | PASS |
| Runs with equip | >= 80% | 100% (20/20) | PASS |
| Runs with speech | >= 50% | 100% (20/20) | PASS |
| Persona extraction spread | >= 15 pp | 55 pp | PASS |
| Failed matches in canonical set | 0 | 0 | PASS |
| `null_only` raw `use:"consumable"` emissions | 0 | 0 | PASS |
| `Player_N` surfaced literals | 0 | 0 | PASS |
| Whole-turn validator zeroes | 0 | 0 | PASS |
| Per-field rejection rate | <= 10% | 0.4821% (136/28209 fields, 133 records) | PASS |

**10 / 10 preserved threshold checks pass.** All phase-7 gates
preserved without regression.

### 3.2 Phase-12 Slice-Specific Evidence

| Gate | Expected | Measured | Verdict |
|---|---:|---:|---|
| `environmentalDeaths` | >= 1 | 23 | PASS |
| `telefragDeathCount` | >= 1 | 23 | PASS |
| `telefragKillFeedLineCount` | >= 1 | 23 | PASS |
| `airdropCountdowns` | Every drop has countdown 3, 2, 1, 0 | All four drops observed | PASS |
| `airdropFirstLootableViolations` | 0 | 0 | PASS |
| `airdropSpentVisibilityViolations` | 0 | 0 | PASS |
| `airdropLandedSeen` | > 0 | 1137 | PASS |
| `airdropLootedSpent` | > 0 | 32 | PASS |
| `perPersonaKillTotal` | > 0 | 137 | PASS |
| `deterministicCratesAcrossSeeds` | true | true | PASS |
| `deterministicAirdropsAcrossSeeds` | true | true | PASS |
| `referenceCrateCount` | 12 | 12 | PASS |
| `referenceAirdropCount` | 4 | 4 | PASS |

**13 / 13 slice-specific checks pass.** `phase12Payload.meetsAllThresholds`
is true.

BC-3 lifecycle evidence is interpreted on the input/projection clock:
each airdrop is telegraphed through `landsAtTurn` with countdown
`3, 2, 1, 0`; the landing/telefrag occurs during
`resolveTurn(landsAtTurn)`; the first normal landed-crate loot
opportunity is `landsAtTurn + 1`.

Additional data-only counters:

| Counter | Measured |
|---|---:|
| `combatDeathCount` | 90 |
| `airdropTelegraphedSeen` | 1942 |
| `airdropLandedSeen` | 1137 |
| `airdropLootedSpent` | 32 |
| Telefrag-frequency stopAtRange 0 | 12 telefrags / 10 runs |
| Telefrag-frequency stopAtRange 2 | 3 telefrags / 10 runs |

### 3.3 Telefrag Evidence

Report-reconstructed kill-feed sample from the canonical payload
(6 distinct-persona examples from 23 total persisted telefrag kill-feed
lines; `telefragKillFeedLineCount: 23`):

```text
Camper got telefragged by crate spawn
Vulture got telefragged by crate spawn
Opportunist got telefragged by crate spawn
Duelist got telefragged by crate spawn
Sprinter got telefragged by crate spawn
Trader got telefragged by crate spawn
```

Turn-level evidence (first persisted event):

```json
{
  "matchId": "j977zvbqv9h80jdpm6bxvaen6186sze5",
  "turn": 10,
  "victimId": "j579exwxdyse8fpjqc6bvy111186r00e",
  "personaId": "vulture",
  "line": "Vulture got telefragged by crate spawn",
  "deaths": [],
  "environmentalDeaths": ["j579exwxdyse8fpjqc6bvy111186r00e"],
  "corpseActionTargets": []
}
```

Discoverability remains constrained to the feed line. There is no new
tool-schema action for telefrag, no system-prompt teaching for agents,
and no loot transfer surface from the victim. The same discoverable-
mechanic pattern as Phase 10 body-collision.

### 3.4 Telefrag-Frequency Experiment (WP-E)

```bash
npx tsx harness/telefrag-frequency.ts --runs-per-cohort 10 --concurrency 10 --reasoning low --seed-prefix phase12-telefrag-frequency-20260515144256
```

| Telegraph stopAtRange | Completed | Failed | Environmental deaths | Telefrag deaths |
|---:|---:|---:|---:|---:|
| 0 | 10 | 0 | 12 | 12 |
| 2 | 10 | 0 | 3 | 3 |

At stopAtRange 0 (ship default), telefrag is ~1.2 per match — "rare,
funny" per North Star intent. At stopAtRange 2, frequency drops to ~0.3
per match, confirming the knob is effective. The experiment harness
includes stale-match detection and bounded `advanceTurn` recovery; this
run needed no recovery events and exited 0. `TELEGRAPHED_CRATE_STOP_AT_RANGE`
was restored to `0` after both cohorts.

### 3.5 Determinism Evidence

The canonical payload reports:

- `deterministicCratesAcrossSeeds: true`
- `deterministicAirdropsAcrossSeeds: true`
- `referenceCrateCount: 12`
- `referenceAirdropCount: 4`

Airdrop signature:

```text
Crate_50_50 landsAtTurn 10, leather
Crate_25_75 landsAtTurn 20, axe
Crate_75_25 landsAtTurn 30, plate
Crate_48_48 landsAtTurn 40, greatsword
```

Static crate contents remain hand-authored and plain-named. The reference
map signature preserves the existing size, walls, cover clusters, evac
tile, and spawn coordinates.

---

## 4. Schema Wipe and Report Pipeline

The schema break (`environmentalDeaths` on `resolutionValidator`,
`airdrops`/`airdropWaves` on `worldState`/`worldStatic`,
`phase12Payload` on `reports`, `crateValidator` replacing
`chestValidator`) was exercised under POC posture
(`project_poc_schema_wipe_acceptable`). Dev DB wiped before phase-12
schema push.

The report pipeline used the same Path-2 pattern as phases 7/9/10:

1. Harness completed 20 live matches at `--reasoning low`.
2. `harness/closing/phase12.ts` fanned out one `turns.byMatchSlim` read
   per match id.
3. The CLI computed metrics locally via `computePhase12Metrics`.
4. The CLI persisted only the small computed payload through
   `reports/phase12:persistComputedPhase12Report`.

---

## 5. Implementation Summary

Landed across commits `6e6c5e0`, `91c6e89`, `ff1d868`, `d709e94`
(72 files, 5,501 insertions, 876 deletions).

### 5.1 Crate Vocabulary Closure (WP-A)

Engine-wide rename of `chest`/`Chest_`/`chest_` → `crate`/`Crate_`/`crate_`
across 72 files. Blast-radius inventory re-derived from a fresh full-repo
grep (BC-1); post-WP-A re-grep gate confirmed zero live-surface hits.
Frozen historical phase reports (`phase{3,6,7,9,10}`) and the schema's
`legacyChestLiteralCount`/`meetsChestLiteralThreshold` fields (phase-7
payload) intentionally excluded.

### 5.2 Deterministic Equipment Catalog (WP-B)

- **`convex/engine/map.ts`** — `rollLoot` RNG path retired from
  `expandMap`; crate entries carry hand-authored `contents: ItemRef`.
- **`convex/matches.ts`** — parallel `expandMapInline` seam updated
  (BC-1 key miss).
- Expanded `WeaponName`/`ArmourName` unions + `WEAPONS`/`ARMOUR` stat
  tables with plain-named tiers: `dagger`, `rusty_blade`, `sword`,
  `axe`, `greatsword`, `warhammer` (weapons); `cloth`, `leather`,
  `chain`, `plate` (armour); `heal` (consumable).

### 5.3 Airdrop Entity State Machine (WP-C)

- **`convex/engine/airdrops.ts`** (NEW) — `airdropProjectionState`,
  `airdropCountdown`, `findCrateById`, `findNavigableCrateById`,
  `worldAirdrops`. Three-state lifecycle: `TELEGRAPHED` → `LANDED` →
  `SPENT`.
- **`convex/engine/vision.ts`** — airdrop telegraph emission (non-LOS,
  every agent) with per-entity countdown; landed airdrop emits as normal
  LOS-gated crate.
- **`convex/llm/idNormalisation.ts`** — Crate namespace + airdrop
  state-aware resolution; `ResolvedEntity` extended for airdrop crates.
- **`convex/llm/inputBuilder.ts`** — Airdrop countdown rendering in
  Vision; kill-feed `buildKillFeedLines` extended for telefrag lines.
- **`convex/engine/loot.ts`** — Shared `findCrateById` helper for both
  static and airdrop crate loot dispatch; SPENT-flip on loot;
  `result:"opened"` + `lootedItem` trace contract (BC-2).

### 5.4 Telefrag (WP-D)

- **`convex/engine/resolution.ts:907-930`** — New sub-phase after
  movement: checks each living agent's resolved position against
  airdrop spawn tiles on the landing turn. Victim is removed entirely
  (no death trace, no corpse, no gear transfer).
  `trace.environmentalDeaths` populated; alive count decremented; prize
  split recomputed.
- **`convex/llm/inputBuilder.ts`** — `buildKillFeedLines` emits
  `"<Persona> got telefragged by crate spawn"` from
  `environmentalDeaths`.
- **`convex/runMatch.ts`** — `adaptPriorTurnRowForBuilder` carries
  `environmentalDeaths` for next-turn input projection.

### 5.5 stopAtRange + Experiment (WP-E)

- **`convex/llm/idNormalisation.ts`** — State-aware `stopAtRange` per
  id namespace: telegraphed crate = 0 (race onto tile), landed crate = 2
  (normal loot range). Controlled by `TELEGRAPHED_CRATE_STOP_AT_RANGE`
  env knob.
- **`harness/telefrag-frequency.ts`** (NEW) — Two-cohort experiment
  harness with stale-match detection, bounded recovery, and env-knob
  toggle. Outputs per-cohort telefrag counts.

### 5.6 runStats Kill-Attribution Fix (WP-F)

- **`convex/engine/runStats.ts`** — `buildTargetIdLookup` pattern
  mirrored from `turnsDerived.ts:auditDamageFeed`. Per-persona kills
  now attributed via characterId↔displayName translation. Lethal
  `kind:"counter"` credited. Environmental deaths (telefrag) handled
  gracefully without corrupting attribution.

### 5.7 Closing Infrastructure (WP-G)

- **`convex/reports/phase12.ts`** (675 lines) — `computePhase12Metrics`,
  `phase12PayloadValidator`, `persistComputedPhase12Report` mutation.
  23 threshold gates + `meetsAllThresholds` rollup.
- **`harness/closing/phase12.ts`** (398 lines) — CLI driver (mirrors
  phase-7/9/10 drivers).
- **`harness/diagnostics/mechanics.ts`** — Environmental death +
  airdrop funnel metrics added.
- **`apps/replay/src/routes/Diagnostics.tsx`** — Environmental deaths
  + airdrop funnel panels rendered.

### 5.8 Persona Scrub

Mechanical `chest`→`crate` scrub of 4 persona prompts
(`duelist`, `vulture`, `opportunist`, `camper`) and their inlined copies
in `convex/_data/personas.ts`. No behaviour tuning.

---

## 6. Decision Rollup

All decisions D1–D21 from the spec, review rounds, and implementation
were honoured. Key decisions:

- **D2 (Q3):** Turn-40 airdrop at evac bullseye `(48,48)` is
  intentional — North Star wants late-loot-vs-incineration tension +
  canonical camp-the-bullseye telefrag.
- **D3 (Q4):** Full deletion of `rollLoot`/`LOOT_TABLES` from crate
  path — single forward shape, POC posture. Deferred-RNG slice brings
  its own mechanism.
- **D5 (Q1/Q2):** Plain-name catalog + wave→coords→contents table
  ratified as reversible POC working default.
- **D6:** Plan-v1 reviewed by 3 architects → unanimous
  APPROVE-WITH-BINDING-CONDITIONS. Core architecture code-verified sound.
- **D8:** Plan-v2 folds all binding conditions (BC-1/2/3/4/7).
- **D20:** Tail closed — telefrag env-death in persisted closing-20
  confirmed real (was absent in earlier cycles per D13/D16).

---

## 7. Validation Gates

- `npm run lint` — PASS
- `npm run ts:check` — PASS
- `npm test` — PASS (44 files passed, 1 skipped; 767 tests passed, 2 skipped)
- `npm run build` — PASS
- `npm run build:replay` — PASS
- `git diff --check` — PASS

Working tree clean at close.

---

## 8. Test Coverage

| File | Phase-12 tests | Coverage |
|---|---:|---|
| `tests/engine/resolution.test.ts` | ~8 | Telefrag on camped tile, telefrag on move-onto-tile, telefrag vs same-turn lethal attack, environmentalDeaths trace, buildKillFeedLines telefrag line, no corpse/gear transfer |
| `tests/engine/map.test.ts` | ~6 | Deterministic crate expansion, expanded equipment catalog, airdrop wave table, rollLoot retirement |
| `tests/engine/vision.test.ts` | ~5 | Airdrop telegraph emission (non-LOS), landed-crate LOS gating, spent-crate absence, countdown rendering |
| `tests/engine/loot.test.ts` | ~4 | Static crate loot, airdrop crate loot dispatch, SPENT-flip, shared findCrateById |
| `tests/engine/runStats.test.ts` | ~6 | buildTargetIdLookup, per-persona kill attribution, counter-fire credit, telefrag environmental exclusion |
| `tests/engine/validation.test.ts` | ~4 | Crate-vocabulary rejection text, namespace dispatch |
| `tests/llm/inputBuilder.test.ts` | ~8 | Telefrag kill-feed line, weapon/charge/telefrag ordering, telefraged-character Vision exclusion, airdrop countdown in Vision |
| `tests/llm/idNormalisation.test.ts` | ~6 | Crate namespace, airdrop state-aware resolution, stopAtRange per namespace |
| `tests/llm/schemaMirror.test.ts` | ~2 | environmentalDeaths schema-mirror parity |
| `tests/reports/phase12.test.ts` | ~15 | Metric computation, all 23 threshold gates, telefrag gate, determinism gate, airdrop lifecycle fidelity |
| `tests/harness/telefrag-frequency.test.ts` | ~8 | Two-cohort experiment, stale-match recovery, env-knob toggle |
| `tests/harness/diagnostics.test.ts` | ~4 | Environmental death + airdrop funnel diagnostic metrics |
| `tests/runMatch.test.ts` | ~3 | environmentalDeaths persistence roundtrip, adaptPriorTurnRowForBuilder |
| `tests/turns.test.ts` | ~3 | environmentalDeaths slim projection |

All tests are unit-level (pure-function engine + projection logic).
Integration exercised by the closing-20 end-to-end.

---

## 9. Diagnostics Evidence

CLI diagnostics captured against the closing set:

```bash
npx tsx harness/diagnostics.ts --last 20 --format json --out /tmp/phase12-diagnostics.json
```

```text
Crate loot: seen 5615, actions 228, opened 206, equipped 206
Airdrop funnel: telegraphed-seen 1942, landed 1137, looted/spent 32, telefrags 23
Environmental deaths: 23; telefrags: 23
```

Replay Diagnostics tab (`#/diagnostics?last=N`) renders environmental
deaths and the airdrop funnel panel using the same `byMatchSlim` fan-out
and `computeMechanicsDiagnostics` computation as the CLI.

---

## 10. Deferred Items

1. **RNG slice** — OUT OF SCOPE. New RNG for loot, crate positions,
   player positions, walls, cover, evac, or daily-seed mode. Deliberately
   sequenced as its own slice *after* mechanics settle, *before* the
   consumer render phase (mental-model §10).
2. **Multi-item crates / agent loot choice** — OUT OF SCOPE. Requires
   richer equipment stats (not just dmg) so the choice has real
   trade-offs. Near-future direction noted in mental-model §12.
3. **Prompt-injection / cursed item names** — OUT OF SCOPE. The phase-12
   catalog uses plain names only. The catalog is the future seam for
   pillar-5 cursed-item flavour text (mental-model §11).
4. **Telefrag frequency calibration** — The experiment delivered
   stopAtRange 0 → ~1.2/match, stopAtRange 2 → ~0.3/match. Whether the
   ship default (0) is at "rare, funny" or needs tuning is a future
   observation question, not a phase-12 blocker.
5. **Persona behaviour-tuning for airdrop/crate/telefrag** — Substrate
   slice; behaviour tuning is a later loop. Diagnostics expose the
   airdrop funnel and environmental death distribution for a future
   tuning pass.
6. **Legacy payload per-persona speech/equip structural-zero** — Carry
   forward. This is the same translation-namespace family as the retired
   WP-F per-persona kills bug (characterId / personaId / display-name
   attribution drift), but applies to legacy payload/read surfaces and is
   out of Phase-12 scope. Do not treat the WP-F kill-attribution fix as
   proof that legacy per-persona speech/equip rows were repaired.

---

## 11. Known Issues / Review Carry-Forward

### 11.1 Retired in Phase 12

- **`runStats` per-persona kills structurally zero (phase 6 → 12).**
  The closing payload attributes 137 kills across all eight personas:
  duelist 43, vulture 27, opportunist 26, camper 18, paranoid 12,
  sprinter 7, rat 2, trader 2. Phase-7/9/10 closure docs' deferred
  item retired.
- **Lethal counter-fire attribution.** Counter-fire (`kind:"counter"`)
  is credited as combat kill attribution. Environmental deaths (telefrag)
  are tracked separately and excluded from kill-rate.
- **Stale report-type string.** Earlier closing runs persisted
  `reportType: "closing-20"`; reconciled to `"phase-12-closing-20"` in
  the canonical evidence set.

### 11.2 Completion-Review v1 Disposition

- **Replay reconstruction environmental deaths.** Fixed after
  completion-review v1: replay `applyTurn` now applies
  `resolution.environmentalDeaths` by marking the victim dead at the
  spawn turn without creating a corpse, matching telefrag "vanishes
  entirely" semantics.
- **Replay grid airdrop visibility.** Fixed after completion-review v1:
  the grid now renders inbound telegraphed airdrops with countdown and
  hover details; landed airdrops render through the normal crate layer;
  spent airdrops remain absent.
- **Phase-12 report gate.** Tightened after completion-review v1:
  `meetsPerPersonaKillAttributionThreshold` now requires every locked
  persona to have `kills > 0`. The canonical persisted row already
  satisfies this stricter interpretation (rat 2, duelist 43, trader 2,
  opportunist 26, paranoid 12, camper 18, sprinter 7, vulture 27), so no
  closing-20 regeneration was needed.
- **Legacy payload per-persona speech/equip structural-zero.** Carry
  forward to the next report-compatibility/read-side slice. Same root
  namespace-translation family as the WP-F kills bug, but not fixed by
  Phase 12 and not a blocker for the Phase-12 crate/airdrop/telefrag
  substrate closure.

---

## 12. Cross-references

- Canonical intent: [`mental-model.md` §11](../../spec/mental-model.md#11-current-vision--equipment-variance--contested-public-objectives)
- Predecessor: [Phase 10 — Body-Collision + Overseer v0](../10-body-collision-overseer/PHASE-10-CLOSURE.md)
- Phase spec: [Phase 12 README](./README.md) (plan-v2 + 7 WPs)
- Phase 7 closure: [PHASE-7-CLOSURE.md](../07-context-payload-iter-3/PHASE-7-CLOSURE.md) (threshold baseline)
- Phase 9 closure: [PHASE-9-CLOSURE.md](../09-walls-vision-rect-grained/PHASE-9-CLOSURE.md) (wall-slide + rect-Vision predecessor)
- Phase 10 closure: [PHASE-10-CLOSURE.md](../10-body-collision-overseer/PHASE-10-CLOSURE.md) (discoverable-mechanic pattern precedent)
- Discoverable-mechanic precedent: Phase 10 body-collision (no schema surface, no system-prompt teaching, kill-feed-only discovery)
