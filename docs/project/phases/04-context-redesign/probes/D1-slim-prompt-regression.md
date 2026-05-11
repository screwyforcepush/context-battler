# D1 Slim Prompt Regression Probe

Date: 2026-05-11

## Verdict

**FAIL — blocks WP-D.**

The shipping phase-4 slim prompt on the current foundation is still far above
the canonical D1 trip-wire:

```text
phase-3 baseline fallbackRate = 8.256%
phase-4 slim fallbackRate     = 33.242%
trip-wire                     = 11.3% max (baseline + 3 pp)
```

WP-D remains user-gated. This artifact is probe data only; it does not advance
WP-D / WP-E / WP-F / WP-G.

## Diagnosis

The original D1 headline framed this as a slim-system-prompt failure. The
matched cohorts show a more specific split:

```text
slim-prose marginal contribution              = +2.868 pp
WP-C enriched tool-description contribution    = +15.268 pp
current-foundation / live-cohort residual      = +6.850 pp
total slim-vs-phase-3-baseline regression      = +24.986 pp
```

The documented D1 ITERATE / ESCALATE paths that restore a compact system-level
action grammar primarily target the slim-prose marginal. That path does **not**
fit the dominant cause by itself.

The third cohort pins the dominant isolated regressor to **WP-C tool-schema
description enrichment**. Reverting the tool schema descriptions to the
phase-3 shape while also using the phase-3 verbose system prompt dropped
fallback from `30.374%` to `15.106%` on the same matched seed prefix. That is
still above the 11.3% D1 trip-wire, so the result is a **combination**:

- WP-C enriched descriptions are the largest isolated regression.
- Slim prose adds only a smaller marginal regression on top.
- A residual `+6.850 pp` remains versus the historical phase-3 baseline even
  with phase-3 prompt + phase-3 tool descriptions on the current foundation.
  That residual may be current-foundation substrate drift and/or cohort
  variance versus the historical phase-3 closing-10 baseline.

The engine-semantic validator clusters remain load-bearing across cohorts:
already-opened chest re-loots, `consume="speed"` without speed equipped, and
cover ids emitted as `toward_object` targets. These point at lost prompt/schema
teaching around opened chests, consumable equipment, and cover-as-hide, not just
JSON Schema shape.

## Cohorts

All fresh cohorts used `reasoning.effort="low"`, 10 matches, concurrency 10, 8
personas, 50 max turns, and the matched seed prefix:

```text
phase4-d1-matched-01
phase4-d1-matched-02
...
phase4-d1-matched-10
```

Prompt / tool variants:

- **Slim**: current `convex/llm/systemPrompt.ts` and current enriched
  `convex/llm/decisionTool.ts` after foundation hardening.
- **Verbose prompt**: `git show f3d4d40:convex/llm/systemPrompt.ts`, with the
  current enriched `decisionTool.ts` left in place. During this run, only
  `systemPrompt.ts` was temporarily swapped; all other foundation files stayed
  current.
- **Phase-3 prompt + phase-3 tool**: `git show f3d4d40:convex/llm/systemPrompt.ts`
  plus `git show f296f5b:convex/llm/decisionTool.ts`. `f296f5b` is the last
  pre-phase-4 `decisionTool.ts` change; `f3d4d40:decisionTool.ts` is identical,
  but `f296f5b` is the semantically correct provenance for the tool baseline.
  All other foundation files stayed current: `inputBuilder.ts`,
  `runMatch.ts`, engine weapon emit, schema validators, replay UI, and harness.

Provenance note: `--seed-prefix` landed in `5ac57b7` (probe dispatch), not in
the foundation-hardening commit.

## Commands

Slim run:

```bash
npm run harness -- --runs 10 --concurrency 10 --reasoning low --seed-prefix phase4-d1-matched \
  > /tmp/phase4-d1-slim.stdout.jsonl \
  2> /tmp/phase4-d1-slim.stderr.log
```

Verbose-prompt run:

```bash
git show f3d4d40:convex/llm/systemPrompt.ts > /tmp/phase4-systemPrompt-verbose.ts
cp /tmp/phase4-systemPrompt-verbose.ts convex/llm/systemPrompt.ts
npm run harness -- --runs 10 --concurrency 10 --reasoning low --seed-prefix phase4-d1-matched \
  > /tmp/phase4-d1-verbose.stdout.jsonl \
  2> /tmp/phase4-d1-verbose.stderr.log
cp /tmp/phase4-systemPrompt-slim.ts convex/llm/systemPrompt.ts
```

Phase-3 prompt + phase-3 tool run:

```bash
cp convex/llm/systemPrompt.ts /tmp/phase4-systemPrompt-current-foundation-before-third.ts
cp convex/llm/decisionTool.ts /tmp/phase4-decisionTool-current-foundation-before-third.ts
git show f3d4d40:convex/llm/systemPrompt.ts > convex/llm/systemPrompt.ts
git show f296f5b:convex/llm/decisionTool.ts > convex/llm/decisionTool.ts

npm run harness -- --runs 10 --concurrency 10 --reasoning low --seed-prefix phase4-d1-matched \
  > /tmp/phase4-d1-phase3system-phase3tool.stdout.jsonl \
  2> /tmp/phase4-d1-phase3system-phase3tool.stderr.log

cp /tmp/phase4-systemPrompt-current-foundation-before-third.ts convex/llm/systemPrompt.ts
cp /tmp/phase4-decisionTool-current-foundation-before-third.ts convex/llm/decisionTool.ts
git diff --exit-code -- convex/llm/systemPrompt.ts convex/llm/decisionTool.ts
```

Metrics were computed from replay bundles with the same
`computePhase3Metrics(...)` pure aggregator used by the phase-3 closure, plus
a local no-op/raw-decision/failure-taxonomy script. Temporary prompt/tool swaps
were restored before committing.

## Raw Report Ids

| Cohort | Harness reportId | Phase-3 metrics reportId | Match ids |
|---|---:|---:|---|
| Phase-3 closure baseline | `jd78d1rxtdgen91b4xebgjbnzs86b8yz` | `jd7b98r81fxarkb3yyctsap2p186bbj7` | `j97a5s5ec2vmw0xrx8877ka2h186bvfe`, `j978tr822tkr2m4sxspqy6p9f586brm6`, `j977v4w2sjq4jp1dtxjr3axqcx86bxcn`, `j971m6z4vcm5pv8tx7aa6chen986bzee`, `j97275g72xg8q1h5cdvy8s47p986aqeq`, `j97end92x1bmymtta7cvsnmnn586b2wk`, `j972jcfba246hs3dtb3vefhwrn86byh5`, `j97fcesb7wj3gy1a6k8fq9nmnx86adk8`, `j977sadre407jpqbcerkxx61n586am8b`, `j97awg1sdyjmfmj0fk9446035s86a0jd` |
| Slim prompt | `jd79653nwj9c2v55xyq75afrds86g6v7` | `jd749rvr6qk6kpbz0dyn7qtwvn86hzvd` | `j9723w93tp8dxhb58btg0rqaxs86harc`, `j97fszxh0j9rxn81m3fz7b0c3d86h10e`, `j97ascna1hrzptvmzhnwdefmp986h0yv`, `j97efd7e0b51znczv7g24n9seh86gqf7`, `j971s043hmw4kf9w7847gadwa986hbys`, `j97c7a3es1zb9nrqq3qm0tt2q186h9cq`, `j979jxy9kjmp73znx5xw7y9ffn86gtcm`, `j970ghgzd83x7awkgj5dsxxf5986ggc1`, `j9733btj888dp807zgxthe22fn86gx6d`, `j97f0009s6qz8ph1q5y5hex97186h8ds` |
| Verbose prompt + current enriched tool | `jd77js95s7gazgm2q0bsdddwe986h011` | `jd7e56et08tm6jwcpggwpjx8a586g8sk` | `j975bfk8kqn9qxkws3qnmdeqqn86h0df`, `j9777hwjvgdmv2zmxk35m790n986g6g5`, `j97f7egx7gmjsr79z1tkjaf87x86hck6`, `j975zkwrjkpfferpaw63x8wbqh86gc9f`, `j973mvznmkwyak0p3enqtxwpa186hen4`, `j979pv0bqv399knp46c5y3pcn986hrnj`, `j97ag1535pjdj8zngat26524fx86hp96`, `j971k2mrz09ejs16y7xyrzafh586gzap`, `j97e453pzvs882jk41weeb79vs86ghsz`, `j971r7e3s81xddw79pnkmh7zpd86h7fe` |
| Phase-3 prompt + phase-3 tool on current foundation | `jd76dj93eb1792rjmgzyk1sbcn86g4tr` | `jd7dmzngv2h6c8r5cywdrjt0q186hsxj` | `j977edr17jge0paeacvyegjens86gpd4`, `j974stgps2d9x65az85yespz5x86h1p6`, `j972mjg52r02t84wbqd0bc5hpd86gr68`, `j97fvhkzm9zhjeeq5k2my9k6sx86hft0`, `j9757hh7cw6sev3vnbkndjrt6186hhps`, `j97cjnam4awbn9yj5jb4dgedeh86g8ag`, `j97ft9byb9ecjhxam2e07h9b3n86hx6g`, `j97dp6e6r5g6jcq23715h15rmx86g1nt`, `j97a6mkmmb5ce3767ganh14g2h86hxsg`, `j973sbp12ydey9ast8kvbc4g5586gy1z` |

## Metrics

Rates are shown as percentages. Delta is against the phase-3 closure baseline
unless otherwise noted.

| Metric | Phase-3 baseline | Slim prompt | Slim delta | Verbose prompt + current tool | Verbose delta | Phase-3 prompt + phase-3 tool | Third delta | Threshold read |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| fallbackRate / safe default | 8.256% | 33.242% | **+24.986 pp** | 30.374% | **+22.118 pp** | 15.106% | **+6.850 pp** | FAIL vs D1 max 11.3% |
| extractionRate | 90.0% | 80.0% | -10.0 pp | 80.0% | -10.0 pp | 100.0% | +10.0 pp | Pass done-bar (>=30%) |
| killRate | 90.0% | 90.0% | 0.0 pp | 100.0% | +10.0 pp | 70.0% | -20.0 pp | Third cohort misses done-bar (>=80%) |
| equipRate | 100.0% | 100.0% | 0.0 pp | 100.0% | 0.0 pp | 100.0% | 0.0 pp | Pass done-bar (>=80%) |
| speechRate | 100.0% | 100.0% | 0.0 pp | 100.0% | 0.0 pp | 100.0% | 0.0 pp | Pass done-bar (>=50%) |
| persona extraction spread | 50 pp | 50 pp | 0 pp | 50 pp | 0 pp | 60 pp | +10 pp | Pass done-bar (>=15 pp) |
| crashes / failed matches | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Pass |
| no-op rate | 17.056% | 44.689% | **+27.633 pp** | 40.891% | **+23.835 pp** | 24.966% | **+7.910 pp** | Diagnostic |
| rawArguments == decision | 91.744% | 68.954% | -22.790 pp | 71.391% | -20.353 pp | 86.076% | -5.668 pp | Diagnostic |
| validatorReason rate | 7.840% | 24.671% | +16.831 pp | 14.799% | +6.959 pp | 13.568% | +5.728 pp | Diagnostic |
| failureReason rate | 0.416% | 8.571% | +8.155 pp | 15.575% | +15.159 pp | 1.538% | +1.122 pp | Diagnostic |

Fresh matched-cohort deltas:

```text
slim vs verbose-current-tool fallback:         slim worse by +2.868 pp
verbose-current-tool vs phase3-tool fallback:  current enriched tool worse by +15.268 pp
phase3-tool vs phase-3 baseline fallback:      current foundation/cohort worse by +6.850 pp
```

## Failure-Mode Semantics

The fallback metric combines different mechanisms:

- **LLM-side schema / wrapper failures:** `failureReason ===
  "schema_validation_failed"` or `"content_filter_blocked"` (plus any future
  wrapper values such as `abort_timeout` or `http_non_200`). These are model or
  request/response contract failures before engine validation.
- **Engine-side safe defaults:** `failureReason` absent but
  `validatorReason` present. The LLM emitted syntactically valid JSON, then the
  engine zeroed it because the target was impossible in the current state.

These have different fixes. The dominant slim cohort bucket is engine-semantic:
`806` validator-zeroed turns versus `280` LLM-side failures. The prominent
clusters are already-opened chest re-loots (`Chest_007`, `Chest_006`,
`Chest_005`, `Chest_009`), `consume="speed"` without speed equipped, and
cover ids used as object targets. That implicates lost teaching around
`Chests show [opened]`, consumable equipment, and cover-as-hide more than raw
JSON shape alone.

## Full Failure Taxonomy

Primary fallback bucket, no double counting:

| Cohort | Total records | Fallbacks | LLM-side failures | Validator-zeroed | Unknown |
|---|---:|---:|---:|---:|---:|
| Slim prompt | 3267 | 1086 | 280 | 806 | 0 |
| Verbose prompt + current tool | 3480 | 1057 | 542 | 515 | 0 |
| Phase-3 prompt + phase-3 tool | 3641 | 550 | 56 | 494 | 0 |

LLM-side `failureReason` values:

| Cohort | `schema_validation_failed` | `content_filter_blocked` | Other wrapper failures |
|---|---:|---:|---:|
| Slim prompt | 176 | 104 | 0 |
| Verbose prompt + current tool | 456 | 86 | 0 |
| Phase-3 prompt + phase-3 tool | 6 | 50 | 0 |

Top validator-zeroed clusters:

| Slim prompt | Count |
|---|---:|
| `loot target 'Chest_007' is already opened` | 155 |
| `loot target 'Chest_006' is already opened` | 100 |
| `consume='speed' but actor has no consumable equipped` | 96 |
| `loot target 'Chest_005' is already opened` | 87 |
| `loot target 'Chest_009' is already opened` | 79 |
| `loot target 'Chest_012' is already opened` | 55 |
| `loot target 'Chest_010' is already opened` | 34 |
| `move.kind='toward_object' targetObjectId='Cover_54_42' is not a known chest or corpse` | 19 |
| `move.kind='toward_object' targetObjectId='Cover_54_54' is not a known chest or corpse` | 19 |
| `move.kind='toward_object' targetObjectId='Cover_66_66' is not a known chest or corpse` | 18 |

| Phase-3 prompt + phase-3 tool | Count |
|---|---:|
| `consume='speed' but actor has no consumable equipped` | 99 |
| `loot target 'Chest_006' is already opened` | 93 |
| `loot target 'Chest_009' is already opened` | 46 |
| `loot target 'Chest_007' is already opened` | 26 |
| `move.kind='toward_object' targetObjectId='Cover_53_53' is not a known chest or corpse` | 25 |
| `loot target 'Chest_011' is already opened` | 22 |
| `loot target 'Chest_010' is already opened` | 20 |
| `move.kind='toward_object' targetObjectId='Cover_54_54' is not a known chest or corpse` | 19 |
| `move.kind='toward_object' targetObjectId='Cover_66_66' is not a known chest or corpse` | 17 |
| `move.kind='toward_object' targetObjectId='Cover_42_42' is not a known chest or corpse` | 15 |

## Delta Investigation

The review handoff's arithmetic (`33.242%` on `1500` turns ~= `498`) used the
wrong denominator. The actual slim denominator is `3267` persisted
agent-records:

```text
slim fallback count = 1086 / 3267 = 33.242%
```

The prior "Failure Breakdown" was incomplete because it listed only
`failureReason` rows plus a few top validator clusters:

- `176 schema_validation_failed + 104 content_filter_blocked = 280` LLM-side
  failures.
- The missing `806` rows are engine validator rejections.
- The six validator examples previously listed accounted for `536` of those
  `806`; the full taxonomy accounts for the remaining long tail.
- There are no hidden `abort_timeout`, `http_non_200`, `json_parse_failed`,
  `status_not_completed`, or unknown buckets in the slim cohort.
- `rawArguments null` equals the `content_filter_blocked` count in these
  cohorts and is a diagnostic duplicate, not an additional fallback category.

## Gate Decision

D1 is **red**. WP-D remains blocked pending user sign-off on an iteration path.
The data no longer support "restore slim prompt prose" as the sole next move:
that only targets about `+2.868 pp`. The largest isolated regression is the
WP-C enriched tool-schema description rewrite (`+15.268 pp`), with a smaller
current-foundation/cohort residual (`+6.850 pp`) still above the trip-wire.
