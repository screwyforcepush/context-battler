# Phase 3 — Closure Record

> Single-file handoff for phase-4 planning. Records what the
> substrate-refinement closing-10 produced, what proves it, and which
> README §5 thresholds are met vs documented-why-not.
> Closure date: 2026-05-08. Source commit at close: `57a06aa`.
>
> This is a closure RECORD, not a retrospective and not a phase-4 plan.

---

## 1. What we set out to build

> Phase 3 — substrate refinement: rebuild the per-turn LLM substrate
> (digest, system prompt, action schema, engine semantics) so agents can
> reason about *outcomes* and the replay UI can show their minds. Close
> with 10 Convex-persisted runs that meet the enhanced acceptance bar in
> `README.md` §5.

The substrate's whole job is producing watchable, attributable behaviour
the user can trust. Without phase-3, the scratchpad-as-explainability
pillar (mental-model §6 pillar 4) was structurally unattainable — agents
couldn't reference attackers (no incoming-attack channel in the digest),
looped on drained corpses (engine silently no-op'd), and emitted
`overwatch_priority` decoration the engine ignored.

---

## 2. Done-bar verdict (README §5 — phase-3 enhanced thresholds)

**Canonical source:**
- `reportId` = `jd769hc5vap1v11bd6jsy307ts86ab05`
- `reportType` = `phase-3-closing-10`
- `runCount` = 10
- `metBar` (composite) = `false` — 12 / 14 thresholds met; 2 documented
  misses with paragraphs in §3 below.
- `missingRunsForMatchIds` = `[]`

**Match ids (10):**

1. `j97a5s5ec2vmw0xrx8877ka2h186bvfe`
2. `j978tr822tkr2m4sxspqy6p9f586brm6`
3. `j977v4w2sjq4jp1dtxjr3axqcx86bxcn`
4. `j971m6z4vcm5pv8tx7aa6chen986bzee`
5. `j97275g72xg8q1h5cdvy8s47p986aqeq`
6. `j97end92x1bmymtta7cvsnmnn586b2wk`
7. `j972jcfba246hs3dtb3vefhwrn86byh5`
8. `j97fcesb7wj3gy1a6k8fq9nmnx86adk8`
9. `j977sadre407jpqbcerkxx61n586am8b`
10. `j97awg1sdyjmfmj0fk9446035s86a0jd`

All 10 matches reached `status: "completed"` with no crashes / no
`harness_error` / no missing `runs` rows (harness summary: completed=10,
failed=0, durationMs=525542 — ~8.76 min). The harness's auto-persisted
`closing-10` report is `jd78d1rxtdgen91b4xebgjbnzs86b8yz` (carry-over
phase-1 view, `meetsAllThresholds: true`); the phase-3 report (this
file's canonical source) carries both that view and the
substrate-refinement metrics.

### 2.1 Phase-3 enhanced metrics — threshold-vs-actual

| README §5 metric | Threshold | Measured | Verdict |
|---|---|---|---|
| Schema validity (fellBackToSafeDefault rate) | ≤ 10% of per-turn calls | 8.256% (258 / 3125) | PASS |
| Wall-blocked move rate | ≤ 2% of move attempts | 0.964% (13 / 1349) | PASS |
| Drained-corpse repeat rate | ≤ 1% of loot attempts | 0% (0 / 110) | PASS |
| Corpse-loot success rate | ≥ 50% of runs | 0% (0 / 10) | **MISS** (see §3.2) |
| Defensive overwatch counter-fire | > 0 across 10 runs | 18 | PASS |
| Offensive overwatch fire | > 0 across 10 runs | 4 | PASS |
| Outcome-attribution heuristic | ≥ 50% of damage-taken pairs | 88.571% (93 / 105) | PASS |
| Reasoning text capture rate | ≥ 80% of non-fallback records | 68.818% (1973 / 2867) | **MISS** (see §3.3) |

### 2.2 Carry-over phase-1 metrics (10-run-scaled)

| README §5 metric | Threshold | Measured | Verdict |
|---|---|---|---|
| Runs ending with ≥ 1 extraction | ≥ 30% (≥ 3 of 10) | 90% (9 / 10) | PASS |
| Runs containing ≥ 1 kill | ≥ 80% (≥ 8 of 10) | 90% (9 / 10) | PASS |
| Runs containing ≥ 1 chest equip | ≥ 80% (≥ 8 of 10) | 100% (10 / 10) | PASS |
| Runs containing ≥ 1 speech event | ≥ 50% (≥ 5 of 10) | 100% (10 / 10) | PASS |
| Persona extraction-rate spread | ≥ 15 pp | 50 pp (trader 50% / opportunist 40% / sprinter 40% − paranoid 0% / camper 0%) | PASS |
| 10 consecutive runs, no crashes / invalid states | required | 0 failures | PASS |

**12 / 14 thresholds met** (12 PASS + 2 MISS — corpse-loot success,
reasoning capture). Each remaining miss is documented in §3 with its
substrate-correctness reading and phase-4 carry-forward note.

---

## 3. Documented-why-not for the threshold misses

The threshold list is the bar; misses require sign-off, not silent
acceptance. Each miss is recorded here with: what the metric actually
measures, what the data showed, what the substrate did right vs. wrong,
and what (if anything) phase-4 should pick up.

### 3.0 The WP-F + WP-G corrective slice — between three closing-10s

This closure record reflects the THIRD closing-10 run, not the first or
the second. The original closing-10 (OLDEST reportId
`jd7fz3dkfx36cqf8q0qhpt1t8d86ab6h`) was generated against a
broken-substrate state: the persistence adapter dropped engine-emitted
`fromOverwatch` / `stance` / `blockedBy` fields by overwriting them with
unconditional `undefined`s; the validator boundary rejected
display-form ids; the chest-loot renderer truncated typed ids; the
wall-blocked outcome trace lacked its directional vector; the digest
concept-spec lines drifted from the live shape; and `schemaMirror` was
not pinned to live validator exports. Those defects masked the
substrate's actual behaviour — the engine WAS firing overwatch
counter-fire, but the trace persisted with the stance field stripped, so
the report read 0.

The WP-F fix-bundle landed first (six substrate-correctness fixes on
the persistence/render half of the gap) and produced the SECOND
closing-10 (reportId `jd7ecmx2fgqa0yd7g8h18cv3n986bmwe`), which closed
four previously-failing thresholds (kill rate 30→80%, defensive
overwatch 0→13, offensive overwatch 0→7, outcome attribution
vacuous→79.2%) but left schema validity stuck at 18.73% — well above
the ≤10% bar. Reviewer-B's completion-review-2 audit then surfaced two
HIGH findings on the LLM↔engine contract half:

- **HIGH-1** (corpse-id): the validator+engine accepted only engine
  primary keys for corpse loot; agents emitting display-form
  `Corpse_Player_N` (the form the system prompt teaches) were rejected
  at the namespace boundary.
- **HIGH-2** (schema field-list): `decisionTool.ts` declared 4 required
  fields in the JSON Schema but Zod required 7; the 207/234
  schema-validity failures that mentioned a missing `say` field were
  caused by this asymmetry, not by agent malformation.

WP-G closed the LLM↔engine contract half (three substrate-correctness
fixes, no behaviour tuning, no goalpost moves):

- **WP-G.1** — `Corpse_Player_N` namespace normalisation at the
  validator+engine boundary (commit `634524b`). Adds
  `normaliseCorpseTargetId` in `convex/llm/idNormalisation.ts`; wires
  into `convex/engine/{validation,resolution,movement}.ts` so loot and
  toward_object dispatch accept the display form. Reviewer-B HIGH-1
  fix.
- **WP-G.2** — JSON Schema `required[]` aligned to all 7 fields per D39
  PM-lock (commit `f296f5b`). `convex/llm/decisionTool.ts:166,195` now
  matches the Zod-side strict shape; `tests/llm/schemaMirror.test.ts`
  parity test now asserts the same set on both sides. Reviewer-B HIGH-2
  fix.
- **WP-G.3** — chest-loot phrasing polish (commit `b86fe01`). UAT-001
  round-2 cosmetic: "Opened Chest_005 — opened." now renders
  "Opened Chest_005." via `isOutcomeRedundantWithIntent()` in
  `apps/replay/src/lib/decisionEnglish.ts`; corpse-loot path
  preserved.

The full corrective slice context for the reader:

- **WP-F.1** — persistence adapter conditional-spread for
  `blockedBy` / `fromOverwatch` / `stance` so engine-emitted values are
  preserved through the Convex round-trip
  (`convex/runMatch.ts` lines 447–470, inside `adaptResolutionForSchema`).
- **WP-F.2** — display-id normalisation at the validator boundary
  (commit `5420073`).
- **WP-F.3** — chest-loot renderer emits the full typed id without the
  `Corpse_` prefix mistake (commit `53ce3cb`).
- **WP-F.4** — wall-blocked outcome carries the `(dist, bearing)`
  directional vector through the trace (commit `04177f5`).
- **WP-F.5** — concept-spec lines 130 / 406 re-aligned to the live
  phase-3 digest shape (commit `76484da`).
- **WP-F.6** — `schemaMirror` test pinned to live validator exports so
  drift can't recur (commit `6eafbab`).

The NEW closing-10 (reportId `jd769hc5vap1v11bd6jsy307ts86ab05`) is
the first run on a substrate-correct ledger across BOTH halves of the
substrate (persistence/render via WP-F + LLM↔engine contract via
WP-G). The headline delta vs the WP-F-only run is the schema-validity
flip from 18.73% → 8.256%, dropping below the ≤10% bar for the first
time. That is the load-bearing measurement on the WP-G slice: the
two HIGH findings from completion-review-2 were correct, the fixes
worked, and the residual fallback population is now genuinely
small-tail rather than dominated by the corpse-id and missing-`say`
clusters.

### 3.1 Schema validity — fellBackToSafeDefault 8.256% vs ≤ 10% (PASS)

The wrapper-level safe-default rate measures honestly at 8.256% across
3125 per-turn calls (258 fallbacks). Vs the WP-F-only reading of 18.73%
this is a 10.47 pp drop on a single bundle of LLM↔engine contract fixes
— the schema-validity gap is now CLOSED.

**Why it passed.** The 207-record missing-`say` cluster (which
dominated the WP-F-only reading) was eliminated by WP-G.2's JSON
Schema `required[]` alignment: agents were honestly emitting all 7
fields, but the wrapper's JSON Schema only required 4, so Zod's
strict-mode parse rejected responses where the model omitted any of
the other 3 even though the model had no schema-side instruction to
include them. With `required[]` extended to all 7 fields, that
cluster collapses. WP-G.1's corpse-id namespace normalisation closed
the second visible cluster — display-form `Corpse_Player_N` targets
that the system prompt teaches but the validator was rejecting at the
namespace boundary.

Reviewer-B's projection going into the rerun was ~6.4% raw rate; the
measured 8.256% is slightly above that projection but comfortably
under the ≤10% bar. The residual ~258-fallback population is
small-tail (validator-boundary rejections of various flavours,
target-not-visible mismatches, action-grammar edge cases), not
dominated by any single fixable cluster.

**Phase-4 carry-forward (deferred, not blocked).** A `validatorReason`
aggregator slice — already-persisted per-row on `agentRecord.llm` —
would surface the residual top-N fallback modes if phase-4 wants to
push the rate even lower. The substrate is already correct; this is
optimisation, not a substrate-correctness gap.

### 3.2 Corpse-loot success 0% — combat-economy tuning, substrate now correct

Across the 10 NEW closing runs, 9 of 10 matches contained at least one
kill (kill rate 90%), so corpses ARE being created — but agents are not
pivoting to corpse-loot once the target is down. The corpse-loot
success rate sits at 0% (0 / 10 runs with a successful
`kind="loot" + result="looted"` against a corpse id).

**Why this is now genuinely propensity, not substrate-rejection.**
Pre-WP-G.1, agents emitting the `Corpse_Player_N` display form (the
form the system prompt teaches at line 70) were rejected at the
validator's namespace boundary, masking propensity behind a
substrate-correctness defect. WP-G.1's `normaliseCorpseTargetId`
wires the display form through the validator+engine (loot dispatch,
toward_object, movement) and is exercised by 11 new tests across
`tests/engine/{validation,resolution,movement}.test.ts` +
`tests/llm/systemPrompt.test.ts`. The new closing-10 traces contain
zero `Corpse_Player_*` invalid-namespace failures — the rejection
path is gone. The 0% rate is therefore the first honest measurement
of post-kill corpse-loot propensity against a substrate-correct
ledger.

**Why this is OOS for phase-3 per North Star §11 NON-GOALS.** The
substrate now correctly tells agents about killable targets, drained
corpses, and the `loot` action grammar against the display-form id
they actually emit. The decision policy "after a kill, pivot to
looting the corpse" is a combat-economy tuning concern — it lives at
the persona-prompt and system-prompt-encouragement layer, not in the
substrate. North Star §11 explicitly carves combat tuning out of
phase-3.

**Phase-4 candidate.** Persona / system-prompt tuning to encourage
post-kill loot pivots (e.g. `vulture` and `opportunist` archetypes are
the natural fit, per §7). The substrate is ready: the loot dispatch
correctly namespaces on display-form `Corpse_Player_N` ids (WP-G.1),
the digest exposes corpses with `[drained]` annotation when relevant
(WP-C), and the renderer distinguishes corpse-loot from chest-loot
(WP-F.3 + WP-G.3).

### 3.3 Reasoning capture 68.818% vs ≥ 80%

The reasoning capture metric counts per-turn calls that resulted in a
non-null `agentRecord.llm.reasoning` field across all NON-FALLBACK
records. Across 2867 non-fallback records, 1973 carried reasoning text
(68.818%), 894 did not. This is a small uptick from the WP-F-only
reading of 66.3% — likely an artefact of the larger non-fallback
denominator (2867 vs 2677) following WP-G.2's schema-fix —
consistent with the prior thesis that this metric is sticky around
two-thirds.

**Branch A is confirmed functional, not the question.** The WP-A.1
probe (`harness/probe-reasoning.ts`) verified that Azure DOES expose
reasoning items when prompted with `reasoning: { summary: "auto" }`
— Branch B (the de-risking fallback that would have added a
`decision.rationale` field) was correctly skipped because Branch A
works.

**Why the rate is sticky around two-thirds.** Spot-checking the
no-reasoning records: most are responses where `usage.output_tokens
_details.reasoning_tokens > 0` (Azure DID generate reasoning tokens
internally) but the response stream emitted an empty `summary: []`
array on the `output[].type === "reasoning"` item. The `summary:
"auto"` opt-in only fires when the response stream actually ships a
summary item; a sub-tier of model responses appear to omit the
summary even with auto-opt-in. This is Azure-side variability at
`reasoning.effort: "low"`, not a wrapper bug. Completion-review-1
review-A's analysis of the 901-records-with-reasoning-tokens-but-no
-text Azure-side floor still holds — the floor is intrinsic to the
Azure response shape at this effort level.

**Why this row is documented, not silently accepted.** Per ADR §2 and
de-risking D-P3-1 the diagnostic loop's load-bearing field carries a
"capture-or-document-why-not" mandate. The persistent ~⅓ shortfall is
recorded here as the substrate's first honest measurement of what
Azure ships at `effort: "low"`, captured against a substrate-correct
ledger across both halves (WP-F + WP-G). The trio of measurements
(65.0% pre-bundle / 66.3% post-WP-F / 68.818% post-WP-G) cluster
tightly, which suggests the substrate-correctness fixes don't perturb
this metric — it's a genuine Azure-side floor.

**Phase-4 carry-forward.** Capture the full reasoning content
(`output[].type === "reasoning"` item content array, not just the
summary) so the diagnostic surface no longer depends on Azure choosing
to emit a summary. This is the natural next step — the field shape is
already nullable string, so the wrapper change is local to
`convex/llm/azure.ts` reasoning-extraction logic.

---

## 4. Substrate proof points (independent of metric verdicts)

The substrate refinements landed and are observable in the trace
ledger:

- **Reasoning text persistence** is wired through Azure → CallResult →
  `agentRecord.llm.reasoning`. 1973 / 2867 = 68.818% non-fallback rate
  proves end-to-end function (compare phase-1 baseline: 0 — field
  didn't exist).
- **Walls in the digest** are emitted by `convex/engine/vision.ts` and
  rendered by `convex/llm/inputBuilder.ts`. The 0.964% wall-blocked
  move rate (well under the 2% threshold) is the *substrate goal* —
  agents now see walls in `Visible:` and route around them. (Phase-1
  had no walls in digest → multiple failures per run.)
- **Drained-corpse trace** emits `result: "empty"` per ADR §4. 0
  drained-repeat events across 110 loot attempts proves the digest's
  `[drained]` bracket is steering agents away from already-empty
  corpses.
- **Loot/interact unify** is in flight: 0 `kind: "interact"` entries
  anywhere in the 10-run trace (verified via `target.startsWith("chest_")`
  vs `target.startsWith("Player_")` namespace dispatch). Chests +
  corpses both flow through `kind: "loot"` (PM lock D7); display-form
  `Corpse_Player_N` ids are normalised at the validator boundary
  (WP-G.1).
- **Overwatch_priority removed** — schema doesn't carry the field; the
  3-arm action union (`attack | loot | none`) and `overwatch_stance:
  "offensive" | "defensive" | null` are the live shape. Live data: 18
  defensive counter-fires + 4 offensive overwatch fires across the 10
  runs persisted with `fromOverwatch` / `stance` intact (post-WP-F.1).
- **Outcome attribution loop** — 88.571% (93 / 105) of damage-taken
  pairs have a turn-N+1 reference back to the attacker, proving the
  digest's `Last turn (you):` line carries causal information across
  turn boundaries.
- **Replay UI raw-pane** (WP-D) collapses 5 tabs to 3 sections (full
  LLM input, reasoning text, tool-call JSON). Manually verified from a
  sample turn of `j97a5s5ec2vmw0xrx8877ka2h186bvfe` in the local
  replay UI.
- **Case-insensitive chest typed-id** — landed during WP-E.1 smoke
  diagnosis. Without it, the closing-10 fallback rate would have been
  >70% (the original smoke-1 measurement) and the substrate refinement
  would have looked broken.
- **Schema field-list contract aligned** — `decisionTool.ts` JSON
  Schema `required[]` matches the Zod-side strict shape (all 7
  fields). The `tests/llm/schemaMirror.test.ts` parity test now
  passes naturally and is pinned to live validator exports
  (WP-F.6 + WP-G.2).
- **Chest-loot phrasing polished** — `isOutcomeRedundantWithIntent()`
  drops the redundant "— opened" suffix when the intent verb already
  encodes the outcome state ("Opened Chest_005." instead of "Opened
  Chest_005 — opened."); `intentVsOutcome` modal preserves both
  columns for engine traceability (WP-G.3).

---

## 5. Architecture artifacts inventory (phase-3 additions)

Paths and one-line purposes — only the phase-3 deltas vs phase-1 +
phase-2:

- **`convex/reports/phase3.ts`** — NEW. Pure aggregator
  `computePhase3Metrics(runs)` (8 metrics + carry-over) + Convex
  internal action `computePhase3Report({matchIds})` reading
  `turns`/`worldState`/`characters` directly + `persistPhase3Report`
  mutation that writes the row with `reportType:
  "phase-3-closing-10"`. No per-run aggregate columns added to
  the `runs` table (PM lock D10).
- **`convex/schema.ts`** — `phase3Payload` optional sibling field on
  `reports` table (no `payload` validator union; minimal-diff per
  WP-E.4 brief). `actionValidator` 3-arm union + `decisionValidator`
  `overwatch_stance` field + `agentLlmValidator` `reasoning` field
  (REQUIRED-NULLABLE) all from WP-A. `resolutionValidator` extends
  `actions[]` with `fromOverwatch?: boolean` + `stance?:
  "offensive"|"defensive"`; `moves[]` with `blockedBy?: "wall"`.
- **`convex/engine/vision.ts`** — wall emission (WP-B).
- **`convex/engine/movement.ts`** — wall-blocked move trace + Chest_NNN
  case-insensitive lookup (WP-E.1 fix); `Corpse_Player_N` namespace
  normalisation at toward_object (WP-G.1).
- **`convex/engine/resolution.ts`** — defensive overwatch counter-fire
  pass + offensive first-in-range + drained-corpse trace + loot
  dispatch by id namespace + Chest_NNN case-insensitive prefix
  (WP-E.1 fix); `Corpse_Player_N` namespace normalisation at loot
  dispatch (WP-G.1).
- **`convex/engine/validation.ts`** — Chest_NNN case-insensitive
  normalisation at `toward_object` + `loot` dispatch (WP-E.1 fix);
  `Corpse_Player_N` normalisation at loot+toward_object (WP-G.1);
  stance/primary consistency check.
- **`convex/llm/idNormalisation.ts`** — `normaliseCorpseTargetId`
  helper mapping display-form `Corpse_Player_N` to engine
  `characterId` (WP-G.1).
- **`convex/llm/decisionTool.ts`** — JSON Schema `required[]` aligned
  to all 7 fields (D39 PM-lock / WP-G.2): `consume`, `primary`,
  `move`, `action`, `say`, `overwatch_stance`, `scratchpad_update`.
- **`convex/llm/inputBuilder.ts`** — full digest rebuild per North
  Star §1 (You / Last-turn-you / Visible-with-observation-brackets;
  no Affordances / Heard / Last-known / Evac sections).
- **`convex/llm/systemPrompt.ts`** — full rewrite as schema teacher.
- **`convex/llm/azure.ts`** — `reasoning: {effort, summary: "auto"}`
  (WP-E.1 fix); reasoning-text extraction from `output[].type ===
  "reasoning"` items.
- **`apps/replay/src/components/ExpandModal.tsx`** — 5-tab → 3-section
  raw-pane (WP-D).
- **`apps/replay/src/lib/decisionEnglish.ts`** — counter-fire +
  offensive overwatch + wall-block + drained-corpse vocabulary;
  `isOutcomeRedundantWithIntent()` chest-loot phrasing polish
  (WP-G.3).
- **`apps/replay/src/lib/reconstruct.ts`** — chest-flip filter to
  `loot/opened/chest_*`.

Deleted in phase-3:
- `convex/engine/affordances.ts` + `tests/engine/affordances.test.ts`
  (Affordances section removed from digest per ADR §6).

---

## 6. Out of scope — reaffirmed for phase-4

Phase 3 deliberately did NOT change any of the following, per README §4
+ North Star §11:

- **Engine combat tuning.** `CHARACTER_MAX_HP = 50`, weapon damage
  table, attack/interact ranges, vision range — all phase-1 values
  inherited unchanged.
- **Procedural map generation.** Reference map (`maps/reference.json`)
  is the only map.
- **Public spectator / consumer renderer / fog-of-war.** Replay UI is
  still personal-overseer-only.
- **Cursed-item flavour text or prompt-injection content authoring.**
  Moderation layer constraint.
- **Migration shims, dual-shape compatibility.** POC schema-wipe
  endorsed.
- **Reasoning model upgrade.** `reasoning.effort` stays at "low".

---

## 7. Open follow-ups for phase 4

Observations from the phase-3 closing-10 that future planning may treat
as in-scope, deferred, or accepted as-is.

- **Post-kill loot-pivot tuning.** §3.2's 0% corpse-loot success rate
  against a 90% kill rate is the dominant remaining miss. With the
  WP-G.1 corpse-id namespace fix landed, this is now genuinely a
  combat-economy / persona-tuning concern (not substrate rejection
  masking propensity). Persona / system-prompt tuning to encourage
  post-kill loot pivots is the natural fit (combat-economy tuning,
  OOS for phase-3 per North Star §11 NON-GOALS).
- **Validator-rejection breakdown aggregator.** §3.1's residual 8.256%
  safe-default rate is small-tail. A phase-4 aggregator slice over
  `agentRecord.llm.validatorReason` (already persisted per-row) would
  surface the top-N residual failure modes if phase-4 wants to push
  the rate even lower; the substrate is already correct, so this is
  optimisation, not a gap.
- **Full reasoning content capture.** §3.3's ~⅓ shortfall is sticky
  because we capture only the Azure `summary: "auto"` item. Capture
  the full reasoning content (`output[].type === "reasoning"` content
  array) so the diagnostic surface no longer depends on Azure choosing
  to emit a summary. Wrapper-local change in `convex/llm/azure.ts`.
- **`reasoning.effort` upgrade probe.** Alternative to the above:
  probe `medium`-effort token budget vs. capture-rate trade-off if the
  diagnostic surface starts feeling thin at the current `effort:
  "low"` floor.

---

## 8. Cross-references

Phase-3 documents that together form the full record:

- `README.md` — phase goal / scope / gates / dependency map / metrics.
- `architecture-decisions.md` — 9 ADRs (decision schema unify,
  reasoning capture contract, overwatch stance, drained corpse,
  walls in digest, last-turn line, system prompt, concept-spec edits,
  blocked-move trace).
- `work-packages.md` — WP-A through WP-G.
- `de-risking.md` — D-P3-1 reasoning capture probe, D-P3-4
  outcome-attribution heuristic, others.
- `harness/probe-reasoning.ts` + `harness/probe-reasoning-output.json`
  — Branch A probe code + recorded output.
- `convex/reports/phase3.ts` — pure aggregator + persistence.
- `tests/reports/phase3.test.ts` — 17 unit tests locking the
  comparator math.
- `docs/project/spec/mental-model.md` §11 — phase-3 closure paragraph.

---

## 9. Sign-off

> The user accepts the closing-10 outcome as the phase-3 closure record.
> Threshold misses are documented with reproducible references in §3;
> phase-4 may pick any of the §7 follow-ups.

(Sign-off block intentionally left blank for the user.)
