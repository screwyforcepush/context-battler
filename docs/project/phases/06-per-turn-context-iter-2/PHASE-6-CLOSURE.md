# Phase 6 - Closure Record

> Single-file handoff for Phase 7 planning. Records what the
> per-turn-context iter-2 closeout produced, what proves it, and which
> North Star thresholds are met vs documented-why-not.
> Closure date: 2026-05-12. Source worktree at close: uncommitted implementation batch.
>
> This is a closure RECORD, not a retrospective and not a phase-7 plan.

---

## 1. What we set out to build

Phase 6 replaced the phase-3/4 coordination overlay with the iter-2
per-turn contract:

- tool schema collapsed to `use`, `position`, `action`, `say`, `scratchpad`;
- `position` became the discriminated union `overwatch | counter | move`;
- `use` is emitted as a per-turn variant and narrows to `null` when no
  consumable is equipped;
- persona name is the agent id on every prompt, trace, target, corpse, and
  replay surface;
- the user-role message now carries the Status block plus the Current Game
  State event log with personal damage feed and global kill feed;
- validators zero only invalid fields and preserve the rest of the turn.

The user-facing proof target was a fresh 20-run Convex report and replay UI
traces showing action+overwatch combos, movement-triggered overwatch, counter
retaliation, compass/target-relative movement, per-turn schema variants, and
raw-vs-parsed diagnostics.

---

## 2. Canonical source

- `reportId` = `jd78f616beq7dvs84gcs1n2f9586kbqt`
- `reportType` = `phase-6-closing-20`
- `runCount` = 20
- `metBar` / `meetsAllThresholds` = `false`
- `missingRunsForMatchIds` = `[]`
- `phase6Payload.failedMatches` = 0

The canonical report is queryable with:

```bash
npx convex run reports:byId '{"id":"jd78f616beq7dvs84gcs1n2f9586kbqt"}'
```

The first 20-run harness dispatch was run at `--reasoning low` and produced
19 completed matches plus one Convex optimistic-concurrency failure at turn 2.
That failed high-concurrency match was excluded from the canonical report and
replaced by a single-run, concurrency-1 live Azure match using the same persona
seed. The canonical report therefore covers 20 completed matches with zero
failed matches in the selected set.

### 2.1 OCC substitution policy

**Policy:** The canonical closing-run set excludes Convex
optimistic-concurrency storage-layer failures, not engine invalid states.
Excluded matches are replaced 1-for-1 by a concurrency-1 live re-run of the
same persona seed. Automatic retry policy in the harness is deferred to Phase 7.

**Provenance:** excluded match `j975s0g4nm509vh0byv2mbw51s86jh81` failed at
turn 2 with a Convex optimistic-concurrency storage-layer error
(`/tmp/phase6-closing-20.jsonl:1343`). It was replaced by
`j974w0qyq10d8j8jm6ynymq2gs86k1be`, a concurrency-1 live Azure re-run using
the same persona seed (`/tmp/phase6-closing-20-replacement.jsonl:124`).

### 2.2 Match ids

1. `j97e6dvmegsemdvazv52g66jxd86j7ad`
2. `j97fje15x6kwta3dxjym5dpn9186k7r7`
3. `j977vn9djw3r2jz4qdev0tx8ws86j9x4`
4. `j975axezcvwvazn732kagf8bpn86kqqt`
5. `j972wq4nbatyg4qwmahctazn8586jbsn`
6. `j9781970tayjngk48ey90t1yhx86jg0c`
7. `j9710xv30ah1adk6qkh4t5yywd86k6ws`
8. `j971jy8y7nweekzm38s88kbte186jbrn`
9. `j97bx6d1xsbd4h6w9am62b7q0n86jgmx`
10. `j9731temtavtsfn388c1g0gves86j8d3`
11. `j973pnzengvghwh4hnrxwz15s986jrds`
12. `j974d6masrjmmv7zkfgcay8hwn86jpq2`
13. `j979gemc15fmw6gxtt3e3ay8jx86jash`
14. `j976skvxarg1wc7q979q97rj7586k1nw`
15. `j974f6fp2fqfd5rdd72cbzv4f186knwq`
16. `j9774p9bsmczk1n8zpt0z21qtd86kvp3`
17. `j97eyhdzcvnbkfywz7v82mrd2s86j5pg`
18. `j9785jjg5rf70qg8bxrg6atp8186ktv3`
19. `j97aatr5ar9kt9100362k8p3t586kgzj`
20. `j974w0qyq10d8j8jm6ynymq2gs86k1be`

---

## 3. Threshold verdict

| Gate | Threshold | Measured | Verdict |
|---|---:|---:|---|
| Runs with extraction | >= 30% | 95% (19 / 20) | PASS |
| Runs with kill | >= 80% | 90% (18 / 20) | PASS |
| Runs with equip | >= 80% | 100% (20 / 20) | PASS |
| Runs with speech | >= 50% | 100% (20 / 20) | PASS |
| Persona extraction spread | >= 15 pp | 75 pp | PASS |
| Failed matches in canonical set | 0 | 0 | PASS |
| `null_only` raw `use:"consumable"` emissions | 0 | 0 | PASS |
| Action+overwatch combos | >= 10 | 43 | PASS |
| Movement-triggered overwatch fires | >= 5 | 52 | PASS |
| Counter retaliations | >= 5 | 150 | PASS |
| Compass bearings | all 8 | E, N, NE, NW, S, SE, SW, W | PASS |
| Target-relative movement | toward and away | away, toward | PASS |
| Personal damage feed missing lines | 0 | 0 / 328 | PASS |
| Whole-turn validator zeroes | 0 | 0 | PASS |
| Per-field rejection rate | <= 10% | 0.0297% (10 / 33,715 fields) | PASS |
| `Player_N` surfaced literals | 0 | 0 | PASS |
| No-op rate | < 5% | 43.245% (2,916 / 6,743 records) | MISS |

**16 / 17 gates pass.** The composite `meetsAllThresholds` is false because
the no-op rate remains above the iter-2 threshold. The report does not lower
that bar; it records the miss.

### 3.1 Documented-why-not: no-op rate

The no-op definition is the Phase 6 iter-2 definition:

`use:null` AND `say:null` AND `action.kind:"none"` AND stationary position
resolution (`move` with `dist:0`, or `overwatch`/`counter` with no action).

The closing set produced 2,916 such records across 6,743 agent records
(43.245%). Most other behaviour gates passed strongly, including action+
overwatch, movement-triggered overwatch, counter retaliation, damage feeds, and
persona ids. The miss therefore reads as a behaviour-policy gap in agent turn
selection under the locked Phase 6 prompt/persona posture, not as a schema,
engine, replay, or report correctness failure. Persona behaviour tuning was
explicitly out of scope for this closeout, so this remains a Phase 7 candidate.

---

## 4. DB wipe and report pipeline

WP-H wipe used `convex/spike.ts:wipeOneTable` in table order before the
closing run. Deleted rows:

| Table | Deleted |
|---|---:|
| `turns` | 300 |
| `matches` | 6 |
| `characters` | 48 |
| `worldState` | 6 |
| `runs` | 6 |
| `reports` | 2 |

After the wipe, `npx convex data <table>` returned empty for the wiped tables,
and the replay picker rendered the empty state. Convex functions were then
repushed successfully with `npx convex dev --once --typecheck=disable`.

The initial in-Convex report computation over all 20 matches exceeded Convex's
16 MB per-function read limit because persisted LLM input is intentionally
large. The closeout added `reports/phase6:persistComputedPhase6Report`, then
computed the Phase 6 payload locally from exported dev data and persisted the
canonical small payload through `convex/reports/phase6.ts`. That computation
used the Section 2 selected 20-match set after OCC substitution; it did not
include the excluded storage-layer failure.

---

## 5. Audit samples and event scopes

Damage-feed audit samples are deterministic first-20 eligible post-damage
turns in match/turn/record iteration order. The persisted
`damageFeedAuditScopeNote` states the coverage boundary:

> damageFeedAuditSamples are the deterministic first 20 eligible post-damage
> turns in match/turn/record iteration order; damage on the final turn and
> damage where the victim has no next-turn agent record (including victim dies)
> are intentionally outside the audit window.

All 20 persisted samples have `present: true`; the full eligible feed count is
328 and `damageFeedMissing` is 0.

---

## 6. ADR rollup

- D1/D2: tool schema and parser now use the five-field iter-2 shape.
- D3: persona name is the id; the closing payload has `playerNLiteralCount: 0`.
- D4: action+position combos resolve in the same turn.
- D5: validators are field-scoped; 9 records carried field errors, 0 whole
  turns were zeroed.
- D6/D14: schema break and dev DB wipe were exercised.
- D7: cover reveal text no longer teaches `leaving cover`; the declared literal
  remains for trace compatibility per ADR-10.
- D10/D11: overwatch fire carries `triggeredByMovement:true`, and trace targets
  are persona display names.
- D12/D17: use-variant and schema-mirror tests pin the JSON Schema/Zod contract.
- D13: Azure request composition is the only LLM-call substitution site; persisted
  `systemPromptText` remains the `<Player Name>` template with stable hashes.
- D16: production phase-3 fallback is stripped; legacy replay rows are detected
  and gated by vintage notice instead of rendered through shims.

---

## 7. Replay/UI verification

Manual replay check after the fresh closing run:

- picker lists fresh completed iter-2 matches;
- `#/match/j974w0qyq10d8j8jm6ynymq2gs86k1be?turn=1` renders 8 decisions with
  no error boundary;
- expand modal shows full LLM input, per-turn tool schema variant, usage,
  rawArguments-vs-decision status, and decision English;
- system-role pane substitutes `<Player Name>` for display while persisted
  text remains the template.

---

## 8. Deferred items

1. Reduce the no-op rate below 5% in a behaviour-tuning slice. The likely lever
   is persona/policy tuning or an explicit planning pressure outside the locked
   Phase 6 system prompt.
2. Decide whether high-concurrency OCC failures should be retried automatically
   by the harness when running closing reports.
3. Keep the local/precomputed report persistence path or replace it with a
   paginated Convex aggregation if future reports need server-side recompute
   over full LLM input.
