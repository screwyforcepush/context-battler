# Phase 12 — Closure Record

> Single-file handoff skeleton for closing Phase 12. Records what the
> crate substrate + deterministic equipment-variance catalog +
> world-event airdrop slice must prove, where the proof will live, and
> which North Star thresholds must be signed off.
>
> Closure date: `TBD(ORCHESTRATOR): fill after fresh closing evidence`.
> Source commit at close: `TBD(ORCHESTRATOR): fill exact commit`.
>
> This is a closure RECORD skeleton, not a retrospective and not a new
> phase plan. All runtime evidence below is intentionally placeholdered
> until the orchestrator runs the fresh closing workflow.

---

## 0. Placeholder Convention

Every unknown runtime datum is written as:

`TBD(ORCHESTRATOR): <specific replacement instruction>`

Do not replace a placeholder from memory, stale local output, or prior
reports. Replace only with fresh Phase-12 closing evidence.

This skeleton intentionally does **not** contain:

- A fresh `reportId`.
- Actual telefrag kill-feed line(s).
- Telefrag-frequency cohort counts.
- Diagnostics CLI or replay-dashboard output.
- Final lint/typecheck/test/build results.

---

## 1. What we set out to build

Phase 12 ships four connected substrate threads:

- **Crate vocabulary closure:** rename the live engine, LLM, replay,
  diagnostics, personas, and report surfaces from chest vocabulary to
  crate vocabulary. Agent-facing ids are `Crate_<x>_<y>`.
- **Deterministic equipment variance:** replace seed-rolled crate
  contents with hand-authored `contents` and expand the plain-name
  weapon/armour catalog so replay shows visible gear variance without
  RNG noise.
- **World-event airdrop crates:** hand-authored drops telegraph publicly
  for four inputs (`countdown` 3, 2, 1, 0), land as normal lootable
  crates on the following input, and become absent from Vision once
  spent.
- **Telefrag + honest attribution:** a crate landing vaporises any
  living agent on its spawn tile after movement/action and before corpse
  formation. The death is recorded as `environmentalDeaths`, produces a
  discoverable kill-feed line, forms no corpse, transfers no gear, and
  is excluded from combat kill attribution.

The rider retired in this slice:

- **runStats per-persona kill attribution:** `perPersona[*].kills` must
  be non-zero when warranted, displayName targets must resolve to engine
  character ids, lethal `counter` fire must credit correctly, and
  telefrag/environmental deaths must not corrupt kill counts.

---

## 2. Canonical Source

- `reportId` = `TBD(ORCHESTRATOR): paste fresh phase-12 report id`
- `reportType` = `phase-12-closing-20`
- `runCount` = `TBD(ORCHESTRATOR): expected 20; paste payload runCount`
- `metBar` = `TBD(ORCHESTRATOR): paste persisted reports.metBar`
- `failedMatches` = `TBD(ORCHESTRATOR): paste phase12Payload.failedMatches`
- `missingRunsForMatchIds` = `TBD(ORCHESTRATOR): paste if present on report row`
- `matchIds` = `TBD(ORCHESTRATOR): paste canonical closing-20 match ids`

The canonical report is queryable with:

```bash
npx convex run reports:byId '{"id":"TBD(ORCHESTRATOR): reportId"}'
```

The canonical metric payload is `reports.byId(...).phase12Payload`.
Do **not** read Phase-12 slice fields from the legacy `reports.payload`;
that field carries only the compatibility/carry-over subset. The Phase
12 payload follows the Path-2 sibling-payload pattern used by phases
7/9/10:

```bash
npx tsx harness/closing/phase12.ts --matchIds "TBD(ORCHESTRATOR): comma-separated closing-20 ids" --overwrite
```

Harness invocation that produced the match set:

```bash
npm run harness -- --runs 20 --concurrency <TBD(ORCHESTRATOR): concurrency> --reasoning low \
  --seed-prefix <TBD(ORCHESTRATOR): seed-prefix>
```

### 2.1 OCC Substitution Policy

**Policy:** `TBD(ORCHESTRATOR): record whether OCC substitutions were
needed. If any match was substituted, list original matchId, substitute
matchId, reason, and report payload impact. If none, state "No OCC
substitutions were required."`

---

## 3. North-Star Acceptance Evidence

| Assignment criterion | Required evidence | Fresh evidence placeholder | Verdict |
|---|---|---|---|
| Crate vocabulary replaces chest on live surfaces | Scoped live-surface `[Cc]hest` scan is clean, excluding frozen docs/closed-phase artifacts as defined in the Phase-12 README | `TBD(ORCHESTRATOR): paste scoped scan command + zero-hit output` | `TBD` |
| Agent-facing crate ids work end-to-end | Vision, validation, id-normalisation, loot traces, replay, and diagnostics use `Crate_<x>_<y>` | `TBD(ORCHESTRATOR): paste report/diagnostic/replay evidence` | `TBD` |
| Deterministic equipment catalog shipped | Reference static crates have hand-authored contents; expanded weapon/armour tiers are visible; crate contents are seed-independent | `TBD(ORCHESTRATOR): paste deterministicCrateSignature, deterministicCratesAcrossSeeds, referenceCrateCount, equipment variance notes` | `TBD` |
| No RNG added for this slice | Crate contents and airdrop schedule are deterministic; single handcrafted reference map preserved | `TBD(ORCHESTRATOR): paste determinism payload + map preservation note` | `TBD` |
| Airdrop telegraph -> land -> spent lifecycle works | Countdown 3/2/1/0 appears for all four drops; first lootable turn is `landsAtTurn + 1`; spent airdrops disappear from Vision | `TBD(ORCHESTRATOR): paste airdropCountdowns, airdropFirstLootableViolations, airdropSpentVisibilityViolations` | `TBD` |
| Airdrop crates are normal loot once landed | Landed airdrop loot emits the same `kind:"loot", result:"opened", lootedItem` trace contract as static crates | `TBD(ORCHESTRATOR): paste landed-airdrop loot trace example(s)` | `TBD` |
| Telefrag is discoverable, killer-less, and environmental | At least one closing-20 `environmentalDeaths` entry, reconstructed report line(s), and prompt-visible kill-feed line(s): `"<Persona> got telefragged by crate spawn"` | `TBD(ORCHESTRATOR): paste telefrag payload counts + prompt-visible line evidence` | `TBD` |
| Telefrag excludes kill-rate and corpse/gear transfer | Telefrag victim is absent from `trace.deaths`, produces no corpse, transfers no gear, and does not credit any attacker | `TBD(ORCHESTRATOR): paste match/turn trace evidence` | `TBD` |
| runStats rider is retired | `perPersona[*].kills` is correctly attributed, lethal `counter` is credited, env-death turns do not count as kills | `TBD(ORCHESTRATOR): paste perPersonaKills, perPersonaKillTotal, counter/env-death evidence` | `TBD` |
| Telefrag-frequency experiment delivered | 10-run cohort at telegraphed stopAtRange 0 and 10-run cohort at 2 report telefrag counts | `TBD(ORCHESTRATOR): paste cohort JSON/table; not a closing metBar gate` | `TBD` |
| Diagnostics and replay expose the slice | CLI and replay Diagnostics tab show environmental-death stat + airdrop funnel; replay can step telegraph, landing, spent absence, and telefrag feed | `TBD(ORCHESTRATOR): confirm closing-20 are latest 20, then paste diagnostics output path/summary + replay UAT notes` | `TBD` |
| Standard validation gates are green | lint, typecheck, tests, build, and any phase-specific non-harness smoke checks pass | `TBD(ORCHESTRATOR): paste final command results` | `TBD` |

---

## 4. Out-of-Scope Labels

These are explicit labels carried forward so Phase 12 closure does not
accidentally claim future work:

- **OUT OF SCOPE: RNG** — no loot RNG, crate-spawn RNG, player-spawn RNG,
  wall/cover/evac RNG, or daily-seed mode in this slice.
- **OUT OF SCOPE: multi-item crates / agent chooses loot** — crates carry
  one hand-authored item; the tool-schema and choice surface for picking
  among multiple loot items is deferred.
- **OUT OF SCOPE: prompt-injection / cursed item names** — the expanded
  catalog stays plain-named. Cursed/prompt-injection item naming remains
  a later content/moderation pass.

---

## 5. Threshold Verdict

### 5.1 Preserved Phase-7 / Phase-9 Thresholds

| Gate | Threshold | Measured | Verdict |
|---|---:|---:|---|
| Runs with extraction | >= 30% | `TBD(ORCHESTRATOR): phase12Payload.extractionRate` | `TBD` |
| Runs with kill | >= 80% | `TBD(ORCHESTRATOR): phase12Payload.killRate` | `TBD` |
| Runs with equip | >= 80% | `TBD(ORCHESTRATOR): phase12Payload.equipRate` | `TBD` |
| Runs with speech | >= 50% | `TBD(ORCHESTRATOR): phase12Payload.speechRate` | `TBD` |
| Persona extraction spread | >= 15 pp | `TBD(ORCHESTRATOR): phase12Payload.personaSpread` | `TBD` |
| Failed matches in canonical set | 0 | `TBD(ORCHESTRATOR): phase12Payload.failedMatches` | `TBD` |
| `null_only` raw `use:"consumable"` emissions | 0 | `TBD(ORCHESTRATOR): phase12Payload.nullOnlyUseViolations` | `TBD` |
| `Player_N` surfaced literals | 0 | `TBD(ORCHESTRATOR): phase12Payload.playerNLiteralCount` | `TBD` |
| Whole-turn validator zeroes | 0 | `TBD(ORCHESTRATOR): phase12Payload.wholeTurnZeroedValidatorRecords` | `TBD` |
| Per-field rejection rate | <= 10% | `TBD(ORCHESTRATOR): phase12Payload.perFieldRejectionRate` | `TBD` |

**Preserved threshold summary:** `TBD(ORCHESTRATOR): e.g. "10 / 10
preserved threshold checks pass."`

### 5.2 Phase-12 Slice-Specific Gates

| Gate | Threshold / expected value | Measured | Verdict |
|---|---:|---:|---|
| `environmentalDeaths` | >= 1 | `TBD(ORCHESTRATOR)` | `TBD` |
| `telefragDeathCount` | >= 1 | `TBD(ORCHESTRATOR)` | `TBD` |
| `telefragKillFeedLineCount` | >= 1 | `TBD(ORCHESTRATOR)` | `TBD` |
| `airdropCountdowns` | every drop has countdown 3, 2, 1, 0 observed | `TBD(ORCHESTRATOR)` | `TBD` |
| `airdropFirstLootableViolations` | 0 | `TBD(ORCHESTRATOR)` | `TBD` |
| `airdropSpentVisibilityViolations` | 0 | `TBD(ORCHESTRATOR)` | `TBD` |
| `airdropLandedSeen` | > 0 | `TBD(ORCHESTRATOR)` | `TBD` |
| `airdropLootedSpent` | > 0 | `TBD(ORCHESTRATOR)` | `TBD` |
| `perPersonaKillTotal` | > 0 | `TBD(ORCHESTRATOR)` | `TBD` |
| `deterministicCratesAcrossSeeds` | `true` | `TBD(ORCHESTRATOR)` | `TBD` |
| `deterministicAirdropsAcrossSeeds` | `true` | `TBD(ORCHESTRATOR)` | `TBD` |
| `referenceCrateCount` | 12 | `TBD(ORCHESTRATOR)` | `TBD` |
| `referenceAirdropCount` | 4 | `TBD(ORCHESTRATOR)` | `TBD` |

`phase12Payload.meetsAllThresholds` =
`TBD(ORCHESTRATOR): paste boolean and any why-not`.

### 5.3 Data-Only / Non-Gating Evidence

| Counter | Expected use | Measured |
|---|---|---:|
| `combatDeathCount` | Confirms combat deaths remain separate from environmental deaths | `TBD(ORCHESTRATOR)` |
| `airdropTelegraphedSeen` | Funnel visibility count | `TBD(ORCHESTRATOR)` |
| `airdropLandedSeen` | Funnel visibility count | `TBD(ORCHESTRATOR)` |
| `airdropLootedSpent` | Funnel completion count | `TBD(ORCHESTRATOR)` |
| `telefrag-frequency stopAtRange=0` | In-loop tuning cohort, not `metBar` | `TBD(ORCHESTRATOR)` |
| `telefrag-frequency stopAtRange=2` | In-loop tuning cohort, not `metBar` | `TBD(ORCHESTRATOR)` |

---

## 6. Telefrag Evidence

### 6.1 Closing Payload Evidence

`phase12Payload.telefragKillFeedLines` is report-reconstructed from
`resolution.environmentalDeaths`. It is necessary report evidence, but it
does not by itself prove the prompt-visible kill feed. Fill §6.2 with
the actual input/replay evidence.

| Field | Fresh value |
|---|---|
| `phase12Payload.environmentalDeaths` | `TBD(ORCHESTRATOR)` |
| `phase12Payload.telefragDeathCount` | `TBD(ORCHESTRATOR)` |
| `phase12Payload.telefragKillFeedLineCount` | `TBD(ORCHESTRATOR)` |
| `phase12Payload.telefragKillFeedLines` | `TBD(ORCHESTRATOR): paste exact line(s), one per line if multiple` |

Expected line shape:

```text
<Persona> got telefragged by crate spawn
```

Report-reconstructed line(s) from canonical evidence:

```text
TBD(ORCHESTRATOR): paste exact phase12Payload.telefragKillFeedLines
```

### 6.2 Prompt-Visible Kill-Feed Evidence

| Evidence item | Fresh value |
|---|---|
| Match id | `TBD(ORCHESTRATOR)` |
| Turn whose input/replay feed contains the line | `TBD(ORCHESTRATOR)` |
| Prompt-visible source | `TBD(ORCHESTRATOR): inputBuilder/buildKillFeedLines test, replay UAT, or persisted input evidence` |
| Actual prompt-visible line(s) | `TBD(ORCHESTRATOR): paste exact line(s)` |
| Confirmation line is not schema/system-prompt teaching | `TBD(ORCHESTRATOR)` |

### 6.3 Match / Turn Trace Evidence

| Evidence item | Fresh value |
|---|---|
| Match id | `TBD(ORCHESTRATOR)` |
| Turn | `TBD(ORCHESTRATOR)` |
| Airdrop id / tile | `TBD(ORCHESTRATOR)` |
| Victim persona / character id | `TBD(ORCHESTRATOR)` |
| `resolution.environmentalDeaths` entry | `TBD(ORCHESTRATOR)` |
| `resolution.deaths` exclusion | `TBD(ORCHESTRATOR): confirm victim is absent from combat deaths` |
| Corpse absence | `TBD(ORCHESTRATOR): confirm no corpse was formed for victim` |
| Gear transfer absence | `TBD(ORCHESTRATOR): confirm victim gear was not transferred` |
| Kill credit exclusion | `TBD(ORCHESTRATOR): confirm no attacker/persona received telefrag credit` |

### 6.4 Discoverability Constraint

Telefrag remains a discovered consequence:

- No system-prompt teaching: `TBD(ORCHESTRATOR): paste grep/test evidence`.
- No tool-schema action or rule exposure: `TBD(ORCHESTRATOR): paste grep/test evidence`.
- Discovery channel is the kill-feed line above.

---

## 7. Frequency Experiment

This is an in-loop tuning measurement, not a `metBar` closing gate. Do
not substitute it for the closing-20 report evidence.

Experiment command:

```bash
npx tsx harness/telefrag-frequency.ts --runs-per-cohort 10 --concurrency <TBD(ORCHESTRATOR): concurrency> --reasoning low \
  --seed-prefix <TBD(ORCHESTRATOR): seed-prefix>
```

| Cohort | Completed | Failed / timed out | `environmentalDeaths` | `telefragDeaths` | Match ids / output |
|---|---:|---:|---:|---:|---|
| telegraphed `stopAtRange = 0` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| telegraphed `stopAtRange = 2` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |

Interpretation:

`TBD(ORCHESTRATOR): summarize whether stopAtRange=0 produces the desired
rare/funny/shareable telefrag frequency versus stopAtRange=2. If the
experiment is blocked or partially complete, record the exact failure
mode instead of inventing counts.`

---

## 8. Diagnostics / Replay Evidence

Diagnostics CLI command:

```bash
npx tsx harness/diagnostics.ts --last 20 --format json --out <TBD(ORCHESTRATOR): diagnostics-json-path>
```

Diagnostics CLI and the replay Diagnostics tab recompute from
`turns.byMatchSlim` over `last=N`; they do not read a persisted
`reportId` or explicit report match-id set. Before using
`#/diagnostics?last=20` as same-cohort proof, confirm the canonical
closing-20 match ids are still the latest 20. If newer matches exist,
record the mismatch and do not treat the replay Diagnostics tab as proof
for the canonical report.

| Surface | Evidence required | Fresh value |
|---|---|---|
| Cohort identity | Latest 20 diagnostics match ids equal canonical closing-20 match ids | `TBD(ORCHESTRATOR)` |
| Diagnostics CLI | Environmental-death stat present | `TBD(ORCHESTRATOR)` |
| Diagnostics CLI | Airdrop funnel present: telegraphed seen -> landed seen -> looted/spent | `TBD(ORCHESTRATOR)` |
| Diagnostics CLI | Telefrag count visible under airdrop/environmental deaths | `TBD(ORCHESTRATOR)` |
| Replay Diagnostics tab | Same environmental-death + airdrop-funnel metrics render | `TBD(ORCHESTRATOR)` |
| Replay match view | Telegraph countdown visible in replay | `TBD(ORCHESTRATOR)` |
| Replay match view | Landed airdrop loot visible | `TBD(ORCHESTRATOR)` |
| Replay match view | Spent airdrop absent from agent Vision | `TBD(ORCHESTRATOR)` |
| Replay match view | Telefrag kill-feed line visible | `TBD(ORCHESTRATOR)` |

Manual replay/UAT notes:

```text
TBD(ORCHESTRATOR): paste concise notes with match id, turn(s), and what was visually confirmed.
```

---

## 9. runStats Rider Retired

Phase 9 and Phase 10 closure records deferred the per-persona kill
attribution issue. Phase 12 retires it as a rider because telefrag adds
killer-less deaths that must not corrupt attribution.

### 9.1 Fresh Closing Evidence

| Field | Fresh value |
|---|---|
| `phase12Payload.perPersonaKillTotal` | `TBD(ORCHESTRATOR)` |
| `phase12Payload.perPersonaKills` | `TBD(ORCHESTRATOR): paste rows` |
| Lethal `counter` credit evidence | `TBD(ORCHESTRATOR): paste test/report evidence` |
| DisplayName target attribution evidence | `TBD(ORCHESTRATOR): paste test/report evidence` |
| Environmental death excluded from top-level kills | `TBD(ORCHESTRATOR): compare combatDeathCount, environmentalDeaths, and perPersonaKills` |

Per-persona rows:

| Persona | Kills |
|---|---:|
| Rat | `TBD(ORCHESTRATOR)` |
| Duelist | `TBD(ORCHESTRATOR)` |
| Trader | `TBD(ORCHESTRATOR)` |
| Opportunist | `TBD(ORCHESTRATOR)` |
| Paranoid | `TBD(ORCHESTRATOR)` |
| Camper | `TBD(ORCHESTRATOR)` |
| Sprinter | `TBD(ORCHESTRATOR)` |
| Vulture | `TBD(ORCHESTRATOR)` |

### 9.2 Retirement Verdict

`TBD(ORCHESTRATOR): state whether the Phase 9/10 deferred runStats item
is retired. If not retired, move the residual gap to Deferred Items with
specific failing evidence.`

---

## 10. Schema Wipe and Report Pipeline

Schema/report changes expected for this phase:

- `phase12Payload` sibling field on `reports`.
- `environmentalDeaths` persisted in resolution traces and slim turn
  rows.
- `WorldState.airdrops` and crate/airdrop state needed by diagnostics
  and replay.
- Phase-12 Path-2 closing driver persists
  `reportType: "phase-12-closing-20"`.

Fresh pipeline evidence:

| Item | Fresh value |
|---|---|
| Dev DB wipe, if performed | `TBD(ORCHESTRATOR): counts or "not required"` |
| Schema push command/result | `TBD(ORCHESTRATOR)` |
| Closing driver command/result | `TBD(ORCHESTRATOR)` |
| Persisted report id | `TBD(ORCHESTRATOR)` |
| `reports.metBar` | `TBD(ORCHESTRATOR)` |

---

## 11. Implementation Summary

`TBD(ORCHESTRATOR): replace with concise summary after final merge. Keep
this factual; do not include stale branch notes.`

Expected rollup areas:

### 11.1 Crate Rename

- `TBD(ORCHESTRATOR): summarize live-surface rename and scoped grep gate`.

### 11.2 Equipment Catalog

- `TBD(ORCHESTRATOR): summarize new plain tiers, static crate contents,
  and determinism evidence`.

### 11.3 Airdrop Lifecycle

- `TBD(ORCHESTRATOR): summarize airdrop state, countdown projection,
  landed loot, and spent absence`.

### 11.4 Telefrag

- `TBD(ORCHESTRATOR): summarize environmental death channel, kill-feed,
  no-corpse/no-transfer behavior, and exclusion from kill credit`.

### 11.5 stopAtRange Experiment

- `TBD(ORCHESTRATOR): summarize state-aware stopAtRange and experiment
  result or blockage`.

### 11.6 runStats Rider

- `TBD(ORCHESTRATOR): summarize attribution fix retirement`.

### 11.7 Diagnostics + Closing Infrastructure

- `TBD(ORCHESTRATOR): summarize phase12 report, closing CLI, diagnostics
  CLI, and replay Diagnostics tab`.

---

## 12. ADR Rollup

| Decision | Closure status | Evidence |
|---|---|---|
| Airdrops are separate scheduled world events, not static crate fields | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| Lifecycle is turn-derived; no stored enum state | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| Telegraph countdown lives in per-entity Vision, not system prompt | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| Telefrag death channel is `environmentalDeaths`, not `trace.deaths` | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| Telefrag sub-phase runs after action and before corpse formation | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| Landed-airdrop loot shares static-crate trace contract | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| Crate contents are hand-authored and seed-independent | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| WP-F retires runStats attribution and BC-7 runStats rename ownership | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |
| Frequency experiment is in-loop data, not a closing gate | `TBD(ORCHESTRATOR)` | `TBD(ORCHESTRATOR)` |

---

## 13. Validation Gates

Do not paste stale local output. Fill only after final validation on the
closing state.

| Command | Required status | Fresh result |
|---|---|---|
| `npm run lint` | PASS | `TBD(ORCHESTRATOR)` |
| `npm run typecheck` | PASS | `TBD(ORCHESTRATOR)` |
| `npm test` | PASS | `TBD(ORCHESTRATOR)` |
| `npm run build` | PASS | `TBD(ORCHESTRATOR)` |
| `npm run build:replay` | PASS if replay UI touched in final slice | `TBD(ORCHESTRATOR)` |
| `git diff --check` | PASS | `TBD(ORCHESTRATOR)` |
| `npx convex dev --once` | PASS if schema/backend deployment validation is part of close | `TBD(ORCHESTRATOR)` |

Final validation verdict:

`TBD(ORCHESTRATOR): concise pass/fail statement and any residual risk.`

---

## 14. Test Coverage

| Area | Coverage expected | Fresh result |
|---|---|---|
| Crate rename | Engine/LLM/replay/diagnostics/persona/report fixtures updated; scoped grep gate clean | `TBD(ORCHESTRATOR)` |
| Deterministic catalog | Static crates and airdrops are seed-independent; map parity preserved | `TBD(ORCHESTRATOR)` |
| Airdrop lifecycle | Countdown, first-lootable turn, spent absence, static/airdrop coord collision | `TBD(ORCHESTRATOR)` |
| Telefrag | Camped tile, moved-onto tile, same-turn lethal precedence, at-most-one victim, no corpse/no transfer | `TBD(ORCHESTRATOR)` |
| Kill feed | Telefrag-only turn emits line; mixed weapon/charge/telefrag ordering | `TBD(ORCHESTRATOR)` |
| stopAtRange | Telegraphed crate range 0 by default; override supports 0 and 2 | `TBD(ORCHESTRATOR)` |
| runStats | DisplayName attribution, lethal counter credit, env-death exclusion | `TBD(ORCHESTRATOR)` |
| Reports/diagnostics | Phase12 payload gates, closing CLI persist, diagnostics airdrop funnel | `TBD(ORCHESTRATOR)` |

---

## 15. Deferred Items

1. **RNG** — Out of scope. The later RNG slice owns loot variance,
   crate-spawn/player-spawn variance, walls/cover/evac variance, and any
   seed-mode product framing.
2. **Multi-item crates / agent chooses loot** — Out of scope. This needs
   richer equipment tradeoffs and tool-schema surface after deterministic
   equipment variance is proven.
3. **Prompt-injection / cursed item names** — Out of scope. The catalog
   is deliberately plain-named until a content/moderation pass designs
   the text-as-terrain risks.
4. **Telefrag-frequency calibration follow-up** —
   `TBD(ORCHESTRATOR): after the cohort experiment, record whether
   frequency feels acceptable or needs a later tuning slice. Keep as
   deferred if tuning remains open.`
5. **Residual validation failures** —
   `TBD(ORCHESTRATOR): list only if final gates are not all green.`

---

## 16. Cross-references

- Canonical intent: [mental-model.md §11](../../spec/mental-model.md#11-current-vision--equipment-variance--contested-public-objectives)
- Phase spec: [Phase 12 README](./README.md)
- Closure mirror: [Phase 9 closure](../09-walls-vision-rect-grained/PHASE-9-CLOSURE.md)
- Closure mirror for discoverable mechanics: [Phase 10 closure](../10-body-collision-overseer/PHASE-10-CLOSURE.md)
- Eval pipeline guide: [eval-pipeline.md](../../guides/eval-pipeline.md)
