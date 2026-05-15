# Phase 12 - Closure Record

Closure date: 2026-05-15

Phase 12 closes the crate substrate, deterministic equipment catalog,
world-event airdrop lifecycle, telefrag mechanic, and per-persona kill
attribution rider. The canonical persisted report is:

- `reportId`: `jd75980xfbda1d19pynjgyb88186ramv`
- `reportType`: `phase-12-closing-20`
- `runCount`: 20
- `metBar`: true
- `phase12Payload.meetsAllThresholds`: true
- `missingRunsForMatchIds`: []
- Closing harness log: `/tmp/phase12-closing-harness.jsonl`
- Phase-12 report output: `/tmp/phase12-closing-report.json`
- Persisted report query output: `/tmp/phase12-report-byid.json`
- Telefrag turn evidence: `/tmp/phase12-telefrag-events.json`
- Diagnostics output: `/tmp/phase12-diagnostics.json`
- Telefrag-frequency output: `/tmp/phase12-telefrag-frequency.jsonl`

The report was persisted from the fresh closing set with:

```bash
npm run harness -- --runs 20 --concurrency 10 --reasoning low --seed-prefix phase12-fresh4-20260515143233
npx tsx harness/closing/phase12.ts --matchIds "$(cat /tmp/phase12-closing-matchids.txt)" --overwrite
npx convex run reports:byId '{"id":"jd75980xfbda1d19pynjgyb88186ramv"}'
```

No OCC substitutions were required.

## Acceptance Evidence

| Criterion | Evidence | Verdict |
|---|---|---|
| Crate vocabulary replaces the legacy loot-container term on live surfaces | Scoped live-surface legacy-token scan returned exit 1 with no output across `convex/engine`, `convex/llm`, live match state, personas, harness, replay, phase-12 report code, and current spec docs. Frozen historical phase reports remain intentionally excluded. | PASS |
| Agent-facing crate ids work end to end | Persisted airdrop ids and loot targets use `Crate_<x>_<y>`, for example landed airdrop loot trace: match `j9788hfn6237k84pgskk3swjh186sqha`, turn 27, `kind:"loot"`, `result:"opened"`, `target:"Crate_25_75"`, `lootedItem:"axe"`. | PASS |
| Deterministic equipment catalog shipped | `referenceCrateCount` is 12. The deterministic crate signature includes hand-authored plain items: `cloth`, `dagger`, `rusty_blade`, `leather`, `sword`, `axe`, `chain`, `greatsword`, `plate`, `warhammer`, and `heal`. `deterministicCratesAcrossSeeds` is true. | PASS |
| No new RNG in this slice | `deterministicStaticMapSignature`, `deterministicCrateSignature`, and `deterministicAirdropSignature` are stable; `deterministicAirdropsAcrossSeeds` is true. The preserved reference map still has evac at `{x:48,y:48}` and the same wall/cover/spawn layout. | PASS |
| Airdrop telegraph -> land -> spent lifecycle works | `airdropCountdowns` observed countdown 3/2/1/0 for all four drops: `Crate_50_50` turn 10, `Crate_25_75` turn 20, `Crate_75_25` turn 30, `Crate_48_48` turn 40. `airdropFirstLootableViolations` is 0 and `airdropSpentVisibilityViolations` is 0. | PASS |
| Airdrop crates are normal loot once landed | `airdropLandedSeen` is 1137 and `airdropLootedSpent` is 32. The landed airdrop trace above uses the same loot action contract as static crates. | PASS |
| Telefrag is discoverable, killer-less, and environmental | Closing payload has `environmentalDeaths: 23`, `telefragDeathCount: 23`, `telefragKillFeedLineCount: 23`. Persisted lines include `Vulture got telefragged by crate spawn`. | PASS |
| Telefrag excludes combat death, corpse, and gear transfer | Turn evidence: match `j977zvbqv9h80jdpm6bxvaen6186sze5`, turn 10, victim `j579exwxdyse8fpjqc6bvy111186r00e`, persona `vulture`; `environmentalDeaths` contains the victim, `deaths` is `[]`, and no corpse loot target exists for that victim. | PASS |
| Alive count and survivor state update after telefrag | Minimal engine reproduction `tests/engine/resolution.test.ts:1039` moves an agent onto the spawn tile before landing, records `environmentalDeaths`, leaves no corpse, marks the victim dead, and leaves only the survivor alive. | PASS |
| Prompt-visible kill-feed line is emitted | `tests/engine/resolution.test.ts:1077` asserts `buildKillFeedLines` returns `Sprinter got telefragged by crate spawn`; `tests/llm/inputBuilder.test.ts:1218` and related cases assert the same feed path from `environmentalDeaths`. | PASS |
| runStats rider is retired | `perPersonaKillTotal` is 137 and every persona has non-zero kills: rat 2, duelist 43, trader 2, opportunist 26, paranoid 12, camper 18, sprinter 7, vulture 27. Environmental deaths remain separate from combat deaths. | PASS |
| Telefrag-frequency experiment delivered | 10 runs at telegraphed stopAtRange 0 produced 12 environmental/telefrag deaths. 10 runs at stopAtRange 2 produced 3 environmental/telefrag deaths. Both cohorts completed with 0 failed runs. | PASS |
| Diagnostics and replay expose the slice | CLI diagnostics against the closing set show `Environmental deaths: 23; telefrags: 23` and `Airdrop funnel: telegraphed-seen 1942, landed 1137, looted/spent 32, telefrags 23`. Replay Diagnostics uses `api.turns.byMatchSlim`, `computeMechanicsDiagnostics`, and renders environmental deaths plus the airdrop funnel. | PASS |
| Standard validation gates are green | `npm run lint`, `npm run ts:check`, `npm test`, `npm run build`, `npm run build:replay`, and `git diff --check` all exited 0. Full suite: 44 files passed, 1 skipped; 767 tests passed, 2 skipped. | PASS |

## Thresholds

### Preserved Phase 7 / Phase 9 Gates

| Gate | Threshold | Measured | Verdict |
|---|---:|---:|---|
| Runs with extraction | >= 30% | 80% (16/20) | PASS |
| Runs with kill | >= 80% | 100% (20/20) | PASS |
| Runs with equip | >= 80% | 100% (20/20) | PASS |
| Runs with speech | >= 50% | 100% (20/20) | PASS |
| Persona extraction spread | >= 15 pp | 55 pp | PASS |
| Failed matches in canonical set | 0 | 0 | PASS |
| Raw `null_only` `use:"consumable"` emissions | 0 | 0 | PASS |
| `Player_N` surfaced literals | 0 | 0 | PASS |
| Whole-turn validator zeroes | 0 | 0 | PASS |
| Per-field rejection rate | <= 10% | 0.4821% (136/28209 fields, 133 records) | PASS |

### Phase 12 Slice Gates

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

`phase12Payload.meetsAllThresholds` is true.

### Data-Only Counters

| Counter | Measured |
|---|---:|
| `combatDeathCount` | 90 |
| `airdropTelegraphedSeen` | 1942 |
| `airdropLandedSeen` | 1137 |
| `airdropLootedSpent` | 32 |
| Telefrag-frequency stopAtRange 0 | 12 telefrags / 10 runs |
| Telefrag-frequency stopAtRange 2 | 3 telefrags / 10 runs |

## Telefrag Evidence

Report-reconstructed kill-feed lines from the canonical payload:

```text
Camper got telefragged by crate spawn
Vulture got telefragged by crate spawn
Opportunist got telefragged by crate spawn
Duelist got telefragged by crate spawn
Sprinter got telefragged by crate spawn
Trader got telefragged by crate spawn
```

The first persisted event in `/tmp/phase12-telefrag-events.json` is:

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
and no loot transfer surface from the victim. The reproduction and
input-builder tests assert the line is created from turn resolution
state, not from a prompt rule.

## Telefrag-Frequency Experiment

Command:

```bash
npx tsx harness/telefrag-frequency.ts --runs-per-cohort 10 --concurrency 10 --reasoning low --seed-prefix phase12-telefrag-frequency-20260515144256
```

Results:

| Telegraph stopAtRange | Completed | Failed | Environmental deaths | Telefrag deaths |
|---:|---:|---:|---:|---:|
| 0 | 10 | 0 | 12 | 12 |
| 2 | 10 | 0 | 3 | 3 |

The prior stall mode was addressed in the experiment harness before the
run: a match whose status and turn stop advancing for 90 seconds now
emits `stale_match_advance`, invokes `runMatch:advanceTurn`, and fails
loudly after three unsuccessful recovery attempts. This completed run
needed no stale-match recovery events and exited 0.

The experiment restored `TELEGRAPHED_CRATE_STOP_AT_RANGE` to `0` after
both cohorts.

## Diagnostics Evidence

CLI diagnostics were captured immediately after the fresh closing set,
before the experiment matches changed the latest-run window:

```bash
npx tsx harness/diagnostics.ts --last 20 --format json --out /tmp/phase12-diagnostics.json
```

Summary:

```text
Crate loot: seen 5615, actions 228, opened 206, equipped 206
Airdrop funnel: telegraphed-seen 1942, landed 1137, looted/spent 32, telefrags 23
Environmental deaths: 23; telefrags: 23
```

Replay Diagnostics evidence:

- `apps/replay/src/lib/diagnosticsFanout.ts` queries `api.turns.byMatchSlim`.
- `apps/replay/src/routes/Diagnostics.tsx` computes mechanics diagnostics
  from slim turns and renders environmental deaths.
- The same route renders the `Airdrop funnel` panel and lists
  `turn.resolution.environmentalDeaths` entries.

## Determinism Evidence

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

## Known Issues Retired

- `runStats` per-persona kills are no longer structurally zero. The
  closing payload attributes 137 kills across all eight personas.
- Lethal counter-fire remains part of combat kill attribution, while
  telefrag deaths are tracked only as environmental deaths.
- The stale report-type issue is retired for this evidence set: the
  persisted report row and `phase12Payload.reportType` are both
  `phase-12-closing-20`.

## Out of Scope Carried Forward

- OUT OF SCOPE: new RNG for loot, crate positions, player positions,
  walls, cover, evac, or daily-seed mode.
- OUT OF SCOPE: multi-item crates and agent choice among loot items.
- OUT OF SCOPE: prompt-injection or cursed item names. The Phase-12
  catalog uses plain names only.

## Final Validation

All final gates passed after the closure record was filled:

| Command | Result | Log |
|---|---|---|
| `npm run lint` | PASS | `/tmp/phase12-validate-lint.log` |
| `npm run ts:check` | PASS | `/tmp/phase12-validate-ts-check.log` |
| `npm test` | PASS, 44 files passed / 1 skipped; 767 tests passed / 2 skipped | `/tmp/phase12-validate-test.log` |
| `npm run build` | PASS | `/tmp/phase12-validate-build.log` |
| `npm run build:replay` | PASS, Vite production build completed | `/tmp/phase12-validate-build-replay.log` |
| `git diff --check` | PASS | `/tmp/phase12-validate-diff-check.log` |
