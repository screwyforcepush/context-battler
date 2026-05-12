# Phase 05 — Move-Arm Consolidation Closure

Status: **CLOSED — 2026-05-12.**

The phase-5 substrate refactor is closed on the 4-arm move grammar:
`toward {targetId}`, `away {targetId}`, `relative {dx,dy}`, and `none`.
`toward` and `away` accept any visible entity id; the engine owns
per-entity `stopAtRange` dispatch.

## Verdict

**PASS — substrate clean.** The post-wipe smoke cohort completed 5 / 5
matches with no engine crashes, no schema-mirror drift errors, and no
retired Cover/Wall-as-`toward_object` validator clusters.

| Gate | Result |
|---|---:|
| Smoke matches completed | 5 / 5 |
| Cover `targetObjectId='Cover_*_*' is not a known chest or corpse` | 0 |
| Wall `targetObjectId='Wall_*_*' is not a known chest or corpse` | 0 |
| Legacy move-arm schema failures (`toward_entity`, `away_from_entity`, `toward_object`, `toward_evac`) | 0 |
| Total schema validation failures | 7 / 1,798 records (0.389%) |
| HTTP non-200 fallbacks | 1 / 1,798 records (0.056%) |

The schema-validation failures that remain are malformed new-shape
attempts such as `kind:"any"` / `kind:"dxdy"` / `kind:"targetId"`, not
removed phase-3 arm names. Per D6/D32 this is observational, not a
pass/fail gate.

## Convex Wipe

Destructive POC wipe executed against the dev deployment on
2026-05-12 UTC using `spike:wipeOneTable` after user authorization.
The wipe removed all persisted phase-3/phase-4 rows so the replay
renderer can ship without legacy move-arm shims.

| Table | Rows deleted |
|---|---:|
| `turns` | 3,595 |
| `characters` | 576 |
| `matches` | 72 |
| `worldState` | 72 |
| `runs` | 72 |
| `reports` | 16 |

Post-wipe verification:

- Zero-row check returned 0 rows for all six tables.
- `npx convex dev --once` pushed the current schema/functions cleanly.
- `spike:checkEnv` confirmed the Azure deployment env is still present.

## Health Check

Single-match health check:

- Command: `npm run harness -- --runs 1 --concurrency 1 --reasoning low --seed-prefix move-arm-health`
- Match: `j97f4dv7tmx1bh1nc006aw40dn86jt20`
- Report: `jd75kv80b4mkywfsnffvbg3ag986kxqe` (`closing-1`)
- Result: completed at turn 50, wrote 50 turn traces, `runs.aggregate`
  row `jh7fe2d7sj5f5v5vggpk9bv5nd86knag`, and report row with
  `missingRunsForMatchIds: []`.

The `closing-1` metric thresholds are intentionally irrelevant here;
this check only proves the post-wipe deployment can run and persist a
match on the new schema.

## Smoke Evidence

Smoke command:

```bash
npm run harness -- --runs 5 --concurrency 5 --reasoning low --seed-prefix move-arm-smoke
```

Artifacts:

- Full cluster output: `docs/project/phases/05-move-arm-consolidation/smoke-clusters-2026-05-12.txt`
- Machine summary: `docs/project/phases/05-move-arm-consolidation/smoke-summary-2026-05-12.json`
- Harness stdout/stderr captured at `/tmp/phase5-move-arm-smoke.jsonl`
  and `/tmp/phase5-move-arm-smoke.err` during the run.

| Match | Records | Schema fails | Validator rejects | Cover retired | Wall retired | Chest re-loot | `consume='speed'` |
|---|---:|---:|---:|---:|---:|---:|---:|
| `j971pzkks3xqrvn9fnt36f3g6n86j015` | 302 | 0 | 32 | 0 | 0 | 17 | 14 |
| `j972gg47kxafne7ecrk8qj3dhh86kws8` | 332 | 0 | 72 | 0 | 0 | 52 | 20 |
| `j970nwa8dsnn9ayqdfsy3rt9q186kbmv` | 364 | 4 | 29 | 0 | 0 | 14 | 15 |
| `j97648q7gdhw0w9enrdz8hg88186k57h` | 400 | 1 | 72 | 0 | 0 | 58 | 14 |
| `j970m9d19xn6fbcyf9ryr1036s86kt7x` | 400 | 2 | 67 | 0 | 0 | 48 | 19 |
| **Total** | **1,798** | **7** | **272** | **0** | **0** | **189** | **82** |

Cluster excerpts for the substrate-retirement check:

```text
=== j971pzkks3xqrvn9fnt36f3g6n86j015 ===
schema_validation_failed: 0
validator-rejection: 32
Cover targetObjectId cluster: 0
Wall targetObjectId cluster: 0

=== j972gg47kxafne7ecrk8qj3dhh86kws8 ===
schema_validation_failed: 0
validator-rejection: 72
Cover targetObjectId cluster: 0
Wall targetObjectId cluster: 0

=== j970nwa8dsnn9ayqdfsy3rt9q186kbmv ===
schema_validation_failed: 4
validator-rejection: 29
Cover targetObjectId cluster: 0
Wall targetObjectId cluster: 0

=== j97648q7gdhw0w9enrdz8hg88186k57h ===
schema_validation_failed: 1
validator-rejection: 72
Cover targetObjectId cluster: 0
Wall targetObjectId cluster: 0

=== j970m9d19xn6fbcyf9ryr1036s86kt7x ===
schema_validation_failed: 2
validator-rejection: 67
Cover targetObjectId cluster: 0
Wall targetObjectId cluster: 0
```

## Out Of Scope Clusters

The D1 out-of-scope classes remain present and are explicitly not fixed
by phase 5:

- Chest re-loot / already-opened chest: 189 records in this 5-match
  smoke. The D1 cohort's larger run observed 510; this smoke confirms
  the same class remains phase-4 D1 territory.
- `consume='speed' but actor has no consumable equipped`: 82 records in
  this 5-match smoke. The D1 cohort observed 96; this remains an
  equipped-state semantics / prompt-teaching issue, not a move substrate
  issue.

## Helper Foundation

WP-D.5 landed as `resolveTypedEntity` in
`convex/llm/idNormalisation.ts`; the file was not renamed to
`entityResolve.ts` to avoid churn around the existing phase-3 id bridge
helpers.

- Type and resolved-entity contract: `convex/llm/idNormalisation.ts:117`.
- Visible target projection: `convex/llm/idNormalisation.ts:143`.
- Resolver function: `convex/llm/idNormalisation.ts:188`.
- Validator call-through: `convex/engine/validation.ts:162` and
  `convex/engine/validation.ts:169`.
- Movement call-through: `convex/engine/movement.ts:262`; stop range is
  consumed in `convex/engine/movement.ts:135`.
- Namespace coverage tests: `tests/llm/idNormalisation.test.ts:100`
  and `tests/llm/idNormalisation.test.ts:192`.

## Docs Sanity

The source-of-truth docs match the landed substrate:

- `docs/project/spec/mental-model.md` section 14 declares the 6 -> 4
  collapse, any-visible-id target contract, and stopAtRange table.
- `docs/project/spec/concept-spec.md` section 10 declares movement as
  relative, toward visible id, away from visible id, or none, with the
  stopAtRange table.
- `docs/project/spec/concept-spec.md` section 21 lists the four move
  targets only.
- `docs/project/spec/concept-spec.md` section 22 teaches the phase-5
  action grammar and typed-id copy contract.
- `docs/project/spec/concept-spec.md` section 15 was corrected during
  closure to say evac movement is available once `Evac` is revealed as a
  visible id.

## Legacy Handling

The chosen POC posture is wipe, not renderer compatibility shim.

- Schema surfaces are 4-arm only:
  `convex/llm/decisionTool.ts:217`,
  `convex/llm/decisionTool.ts:309`,
  `convex/engine/types.ts:198`,
  `convex/schema.ts:164`, and
  `convex/_internal_runMatch.ts:73`.
- Renderer renders only `none`, `relative`, `toward`, and `away`:
  `apps/replay/src/lib/decisionEnglish.ts:208`.
- Negative tests reject removed arm names:
  `tests/llm/decisionTool.test.ts:422` and
  `tests/llm/schemaMirror.test.ts:327`.
- Restricted legacy grep across `convex/*` and `apps/replay/src/*`
  source is clean for `toward_entity`, `away_from_entity`,
  `toward_object`, `toward_evac`, `targetObjectId`, and
  `targetEntityId`.

## Follow-Ups

These are recorded for future work; none block phase-5 closure.

- **D10 cap divergence:** `convex/engine/vision.ts:34` caps cover at
  12 while `convex/llm/inputBuilder.ts:56` / `:756` caps walls at 12.
  The canonical visible-target-id projection inherits the engine-side
  cover cap.
- **D20 / LOW-2 away tie-break comment:** `convex/engine/movement.ts:146`
  preserves phase-3 behavior, but the comment says `dx=dy=0` while the
  code branches on either zero axis.
- **D23 trace wire-contract widening:** `convex/engine/resolution.ts:988`
  and `:1031` can now emit reason-only `hidden:false` proximity entries
  for already-visible actors; `convex/schema.ts:342` supports the shape
  and `apps/replay/src/lib/reconstruct.ts:264` applies it idempotently.
- **A-LOW1 trace verbosity:** `convex/engine/resolution.ts:1000`
  records proximity every turn for in-cover actors near another living
  character, including visible -> visible no-state-change cases.
- **A-LOW2 optional symmetric test gap:** current tests cover the
  one-actor visible-near-living case and hidden proximity reveal at
  `tests/engine/resolution.test.ts:451` and `:515`, but not the optional
  two-visible-in-cover-adjacent symmetric case.
- **A-Info comment drift:** `convex/engine/resolution.ts:329` says
  "Only reveal if currently hidden"; `recordRevealCause` now fires
  unconditionally for leaving-cover and only the state flip is gated.
- **C-LOW Phase 7 order dependence:** `convex/engine/resolution.ts:982`
  mutates `working` during the sorted Phase 7 loop before
  `convex/engine/resolution.ts:1021` computes each actor's `lastKnown`.
  Future cleanup should split state flips from visibility snapshotting.

## Validation

Final validation ran after closure docs and smoke artifacts were written:

- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS, 687 passed / 4 skipped
- `npm run build` — PASS
- `npm run build:replay` — PASS, 144 modules transformed
- Restricted legacy-arm grep across `convex/*` and `apps/replay/src/*`
  source — PASS, zero matches
