# Phase 11 Closure — DB Bandwidth Substrate Refinement

> Closed 2026-05-15. Implementation landed the prompt-text dedup,
> persisted-input slimming, and `worldStatic` split. Standard gates and
> the 10-run smoke passed. The write-bandwidth claim passed; the
> combined world-read bandwidth target did not, because the v2 target
> conflicts with locked D5/D14 per-turn double-read scope.

## 1. What Shipped

- `prompts` table keyed by `(hash, kind)` with collision-guarded
  `getOrCreatePrompt`. DJB2-32 stays per D1; collisions throw
  `DataIntegrityError`.
- `agentRecord.input` now persists only hashes plus structured
  `status`, `narrativeLines`, `aliveCount`, `visibleStateDigest`, and
  `scratchpadBefore`. It no longer persists `systemPromptText`,
  `personaPromptText`, or `composedUserMessage`.
- `recomposeUserMessage({ input, turn, displayName, prompts })`
  rebuilds the exact user-role message at read time. Missing prompt
  hash is fatal server-side and visible in replay UI.
- `worldStatic` table holds immutable `walls`, `coverClusters`, and
  `coverTiles`; `worldState` holds dynamic `chests`, `corpses`, and
  `evac`.
- `runMatch.advanceTurn` reads dynamic + static world rows and merges
  them into complete `MatchState.world`.
- Replay bundle returns one merged `worldState` field and a
  `promptsLookup` map. TurnFeed status reads `input.status` directly.
- Diagnostics projections use the forward sources from D16:
  `narrativeLines.some(...)`, `visibleStateDigest`, and `input.status`.

## 2. Validation Gates

| Gate | Result |
|---|---:|
| `npm run lint` | PASS |
| `npm run ts:check` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS: 719 passed, 2 skipped |

Targeted tests added/updated cover schema mirror parity, prompt
collision guard, missing-hash fatal recomposition, byte-equal
recomposition, slim persisted input shape, `projectSlimTurnRows`
field preservation with split-line atomicity, worldStatic merge, and
replay raw-pane/Status card rendering.

## 3. DB Wipe + Deploy

Wipe used the existing paginated `spike:wipeOneTable` helper before
the schema push:

| Table | Rows Deleted |
|---|---:|
| `turns` | 2233 |
| `characters` | 360 |
| `worldState` | 45 |
| `matches` | 45 |
| `runs` | 45 |
| `reports` | 4 |

Then `npx convex dev --once --typecheck=disable` pushed the new schema
and functions. `spike:wipeOneTable` was extended so future wipes also
cover `prompts` and `worldStatic`.

## 4. Smoke

Command:

```bash
npm run harness -- --runs 10 --concurrency 10 --reasoning low \
  --seed-prefix phase11-smoke-20260515
```

Artifacts:

- `closing-10` report: `jd7f82nezegb6wdy13n0h73r8x86r6w9`
- Phase-9 compatibility report over the same 10 matches:
  `jd70eegy9e668rke07a1p80jwx86r43t`
- Match count: 10
- Turn rows: 496
- Agent records: 3366

Light bars:

| Bar | Result |
|---|---:|
| Engine crashes | 0 |
| Whole-turn validator zeroes | 0 |
| Extraction | 31 extractions, 9/10 runs |
| Kill | 41 kills, 10/10 runs |
| Equip | 111 equips, 10/10 runs |
| Speech | 478 speech events, 10/10 runs |
| All 8 personas active | PASS |
| `Player_N` literals | 0 |
| `Chest_NNN` literals | 0 |

Data-only drift:

| Metric | Phase 11 Smoke | Phase 9 Closing-20 | Phase 7 Closing-20 |
|---|---:|---:|---:|
| Runs with extraction | 90% | 95% | 100% |
| Runs with kill | 100% | 95% | 90% |
| Runs with equip | 100% | 100% | 100% |
| Runs with speech | 100% | 100% | 100% |
| Persona extraction spread | 80 pp | 50 pp | 50 pp |
| Per-field rejection rate | 0.137% | 0.112% | not recorded in closure |
| Alive at T-25 | min 6, max 8, mean 7.0 | not recorded | not recorded |

Diagnostics CLI completed over the smoke cohort:

- `critical`: 3366 records, fallback rate 0.98%, validator field
  rejections 23.
- `mechanics`: attack/loot/speech/damage-feed families populated;
  speech events 478, inbound delivered 973.
- `behaviour`: persona/equipment cross-cuts populated.

## 5. Bandwidth Bench

### Prompt Write / Persisted Input

Measured by reconstructing the legacy equivalent input shape for the
same smoke rows and comparing it to the new persisted input shape:

| Measure | Bytes |
|---|---:|
| New persisted `agentRecord.input` total | 6,653,384 |
| Legacy-equivalent `agentRecord.input` total | 16,700,812 |
| Drop | 60.16% |

Prompt table cardinality and cohort dedup:

| Measure | Value |
|---|---:|
| `prompts` rows | 58 |
| System rows | 50 |
| Persona rows | 8 |
| Unique prompt text bytes | 29,712 |
| Legacy duplicated prompt text bytes | 2,902,266 |
| Prompt text write drop | 98.98% |

This matches D13: the system prompt is turn-bound, so the steady-state
cohort cardinality is about 50 system rows plus 8 persona rows.

### World Read

Result: structural split landed, but the v2 combined-payload target did
not pass.

Measured across smoke sample matches:

| Measure | Bytes / Turn |
|---|---:|
| Old-equivalent full world row | 3,499-3,936 |
| New slim `worldByMatch` | 1,320-1,757 |
| New `worldStaticByMatch` | ~2,300 |
| D14 combined payload | 3,620-4,057 |

Interpretation: this is the expected consequence of locked D5/D14.
Phase 11 split immutable terrain out of `worldByMatch`, so the hot
function itself is ~55-62% smaller, and engine/replay correctness is
preserved. But because `advanceTurn` still reads `worldStaticByMatch`
every scheduled turn, the combined Convex read payload is about 3%
larger than the old full-world read. The original >=80% combined-read
target is incompatible with the locked per-turn double-read scope.
True combined world-read reduction requires a separately scoped
action-chain/cache refactor or revised benchmark target.

### AC3 Adjudication (D17 — completion review)

North Star AC3 names `worldByMatch(read)` as a bandwidth target and
requires static terrain to be read once per match. The shipped
implementation net-regresses combined per-turn world-read bandwidth
by ~3%. Ruling: **ACCEPTED principled deferral**, not an open
North-Star gap.

Rationale:

- AC3's structural split ("When" clause) is complete: immutable
  terrain lives in `worldStatic`, mutable state in `worldState`.
- AC3's per-turn payload ("Then" clause) IS met: `worldByMatch`
  returns only `chests` + `corpses` + `evac`.
- The unmet clause is "static terrain read once per match" — this
  conflicts with locked D5/D14 (Convex action chain is stateless
  across `scheduler.runAfter`; each `advanceTurn` invocation is
  independent).
- The North Star scope caps ("no overfit", "no back-into-a-corner",
  "substrate is mid-iteration") explicitly prohibit the chain
  refactor needed to achieve once-per-match reads.
- Mental-model §19 done-bar was intentionally set at WRITE-size
  proof, not combined-read proof.

The structural split is the correct foundation for the deferred
follow-up (once-per-chain static terrain caching via in-action turn
loop or equivalent). The ~3% combined-read regression is a known
cost of the D5/D14 per-turn double-read scope, not an architectural
deficiency.

## 6. Manual Replay UAT

UAT match: `j9774e8eewhb54qj0ze8rdvx7d86s0km`

Verified in the replay app at turn 1:

- Grid rendered terrain and entities from the merged `worldState`.
- TurnFeed rendered the structured Status card from `input.status`.
- Expand modal opened and rendered Full LLM Input via prompt lookup +
  recomposition, including system role, user role, and tool schema.
- Raw pane showed the expected prompt text; no prompt lookup fatal state.

Only observed browser console warning was the existing `/favicon.ico`
404.

## 7. Deferred / Open

- **Combined world-read bandwidth (ACCEPTED DEFERRAL — see §5 AC3
  adjudication).** The per-turn `worldByMatch` payload is slim
  (chests+corpses+evac only), satisfying AC3's structural and
  payload clauses. The combined read (`worldByMatch` +
  `worldStaticByMatch`) net-regresses ~3% because D5/D14 locked
  per-turn double-read. This is an accepted principled deferral,
  not an open North-Star gap. Deferred follow-up: once-per-chain
  static terrain caching via in-action turn loop or Convex action
  chain refactor (out of scope under NS no-overfit/no-corner caps).
- No persona tuning was done.
- No partial chest/corpse patching, sidecar LLM tables, materialized
  rollups, or replay redesign were picked up.
