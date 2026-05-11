# D1 Slim Prompt Regression Probe

Date: 2026-05-11

## Verdict

**FAIL — blocks WP-D.**

The current slim system prompt cohort regressed the schema-validity /
safe-default metric by **+24.986 pp** versus the phase-3 closing-10
baseline:

```text
phase-3 baseline fallbackRate = 8.256%
phase-4 slim fallbackRate     = 33.242%
trip-wire                     = 11.3% max (baseline + 3 pp)
```

The current foundation with the prior phase-3 verbose system prompt also
regressed badly (`30.374%` fallback), so the fresh live-run result is not
a clean "slim prose alone caused the whole regression" read. It still
answers the gate: the shipping slim prompt is above the canonical D1
trip-wire and must not feed WP-D until the user signs off on an iteration
path.

Recommended next step before WP-D: follow de-risking.md D1's ITERATE path
and add finer per-arm schema descriptions or restore a small action-grammar
system block, then rerun D1.

## Cohorts

All fresh cohorts used `reasoning.effort="low"`, 10 matches, concurrency
10, 8 personas, 50 max turns, and a matched seed prefix:

```text
phase4-d1-matched-01
phase4-d1-matched-02
...
phase4-d1-matched-10
```

Prompt variants:

- **Slim**: current `convex/llm/systemPrompt.ts` on `main` after
  foundation hardening.
- **Verbose**: prior phase-3 prompt recovered with:
  `git show f3d4d40:convex/llm/systemPrompt.ts`.

The verbose prompt was copied into `convex/llm/systemPrompt.ts` only for
the fresh verbose run, then the slim file was restored before committing.

## Commands

Slim run:

```bash
npm run harness -- --runs 10 --concurrency 10 --reasoning low --seed-prefix phase4-d1-matched \
  > /tmp/phase4-d1-slim.stdout.jsonl \
  2> /tmp/phase4-d1-slim.stderr.log
```

Verbose run:

```bash
git show f3d4d40:convex/llm/systemPrompt.ts > /tmp/phase4-systemPrompt-verbose.ts
cp /tmp/phase4-systemPrompt-verbose.ts convex/llm/systemPrompt.ts
npm run harness -- --runs 10 --concurrency 10 --reasoning low --seed-prefix phase4-d1-matched \
  > /tmp/phase4-d1-verbose.stdout.jsonl \
  2> /tmp/phase4-d1-verbose.stderr.log
cp /tmp/phase4-systemPrompt-slim.ts convex/llm/systemPrompt.ts
```

Metrics were computed from replay bundles with the same
`computePhase3Metrics(...)` pure aggregator used by the phase-3 closure,
plus a local no-op/raw-decision comparison script.

## Raw Report Ids

| Cohort | Harness reportId | Phase-3 metrics reportId | Match ids |
|---|---:|---:|---|
| Phase-3 closure baseline | `jd78d1rxtdgen91b4xebgjbnzs86b8yz` | `jd7b98r81fxarkb3yyctsap2p186bbj7` | `j97a5s5ec2vmw0xrx8877ka2h186bvfe`, `j978tr822tkr2m4sxspqy6p9f586brm6`, `j977v4w2sjq4jp1dtxjr3axqcx86bxcn`, `j971m6z4vcm5pv8tx7aa6chen986bzee`, `j97275g72xg8q1h5cdvy8s47p986aqeq`, `j97end92x1bmymtta7cvsnmnn586b2wk`, `j972jcfba246hs3dtb3vefhwrn86byh5`, `j97fcesb7wj3gy1a6k8fq9nmnx86adk8`, `j977sadre407jpqbcerkxx61n586am8b`, `j97awg1sdyjmfmj0fk9446035s86a0jd` |
| Slim prompt | `jd79653nwj9c2v55xyq75afrds86g6v7` | `jd749rvr6qk6kpbz0dyn7qtwvn86hzvd` | `j9723w93tp8dxhb58btg0rqaxs86harc`, `j97fszxh0j9rxn81m3fz7b0c3d86h10e`, `j97ascna1hrzptvmzhnwdefmp986h0yv`, `j97efd7e0b51znczv7g24n9seh86gqf7`, `j971s043hmw4kf9w7847gadwa986hbys`, `j97c7a3es1zb9nrqq3qm0tt2q186h9cq`, `j979jxy9kjmp73znx5xw7y9ffn86gtcm`, `j970ghgzd83x7awkgj5dsxxf5986ggc1`, `j9733btj888dp807zgxthe22fn86gx6d`, `j97f0009s6qz8ph1q5y5hex97186h8ds` |
| Verbose prompt | `jd77js95s7gazgm2q0bsdddwe986h011` | `jd7e56et08tm6jwcpggwpjx8a586g8sk` | `j975bfk8kqn9qxkws3qnmdeqqn86h0df`, `j9777hwjvgdmv2zmxk35m790n986g6g5`, `j97f7egx7gmjsr79z1tkjaf87x86hck6`, `j975zkwrjkpfferpaw63x8wbqh86gc9f`, `j973mvznmkwyak0p3enqtxwpa186hen4`, `j979pv0bqv399knp46c5y3pcn986hrnj`, `j97ag1535pjdj8zngat26524fx86hp96`, `j971k2mrz09ejs16y7xyrzafh586gzap`, `j97e453pzvs882jk41weeb79vs86ghsz`, `j971r7e3s81xddw79pnkmh7zpd86h7fe` |

## Metrics

Rates are shown as percentages. Delta is against the phase-3 closure
baseline unless otherwise noted.

| Metric | Phase-3 baseline | Slim prompt | Slim delta | Verbose prompt | Verbose delta | Threshold read |
|---|---:|---:|---:|---:|---:|---|
| fallbackRate / schema invalid | 8.256% | 33.242% | **+24.986 pp** | 30.374% | **+22.118 pp** | FAIL vs D1 max 11.3% |
| extractionRate | 90.0% | 80.0% | -10.0 pp | 80.0% | -10.0 pp | Pass done-bar (>=30%) |
| killRate | 90.0% | 90.0% | 0.0 pp | 100.0% | +10.0 pp | Pass done-bar (>=80%) |
| equipRate | 100.0% | 100.0% | 0.0 pp | 100.0% | 0.0 pp | Pass done-bar (>=80%) |
| speechRate | 100.0% | 100.0% | 0.0 pp | 100.0% | 0.0 pp | Pass done-bar (>=50%) |
| persona extraction spread | 50 pp | 50 pp | 0 pp | 50 pp | 0 pp | Pass done-bar (>=15 pp) |
| crashes / failed matches | 0 | 0 | 0 | 0 | 0 | Pass |
| no-op rate | 17.056% | 44.689% | **+27.633 pp** | 40.891% | **+23.835 pp** | Diagnostic, not D1 pass/fail |
| rawArguments == decision | 91.744% | 68.954% | -22.790 pp | 71.391% | -20.353 pp | Diagnostic |
| validatorReason rate | 7.840% | 24.671% | +16.831 pp | 14.799% | +6.959 pp | Diagnostic |
| failureReason rate | 0.416% | 8.571% | +8.155 pp | 15.575% | +15.159 pp | Diagnostic |

Fresh slim-vs-verbose deltas on the matched seed prefix:

```text
fallbackRate: slim worse by +2.868 pp
no-op rate:   slim worse by +3.798 pp
rawArguments==decision: slim worse by -2.437 pp
validatorReason rate: slim worse by +9.872 pp
failureReason rate: slim better by -7.004 pp
```

## Failure Breakdown

Slim prompt:

```text
schema_validation_failed: 176
content_filter_blocked: 104
rawArguments null: 104
rawArguments invalid JSON: 0
```

Verbose prompt:

```text
schema_validation_failed: 456
content_filter_blocked: 86
rawArguments null: 86
rawArguments invalid JSON: 0
```

Top slim validator rejections clustered around repeated already-open chest
loots and invalid cover-as-object movement:

```text
loot target 'Chest_007' is already opened: 155
loot target 'Chest_006' is already opened: 100
consume='speed' but actor has no consumable equipped: 96
loot target 'Chest_005' is already opened: 87
loot target 'Chest_009' is already opened: 79
move.kind='toward_object' targetObjectId='Cover_54_42' is not a known chest or corpse: 19
```

## Gate Decision

D1 is **red**. WP-D remains blocked pending user sign-off on an iteration
path. The safest next experiment is the D1 documented mitigation: enrich
move/action union-arm descriptions or restore a compact system-level
action grammar, then rerun the matched 10-run probe.
