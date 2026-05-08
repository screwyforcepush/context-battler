# Phase 03 — Plan Review, Round 2

> Reviewer: Review Architect (read-only). Round 1 lives at
> `plan-review-round-1.md`; I read it after completing my own pass and
> note overlaps below. This round adds findings the prior round missed,
> calls out one place where I disagree on severity, and consolidates a
> single pre-WP-A punch list.
>
> Scope: the four phase-3 spec docs, `mental-model.md` §11, the North
> Star, and the current codebase (specifically the consumer fan-out for
> the schema break and the trace fields the closing-10 metrics depend
> on).
>
> Posture: identify must-fix gaps **before WP-A starts** so the schema
> break doesn't ship with downstream consumers stranded on old vocab or
> with metric formulas that can't be evaluated against the trace.

---

## Review Summary

**Overall assessment: Concern — must-fix bundle required before WP-A
starts.** Round 1's reading is correct: the plan is North-Star aligned
and the WP sequencing is sensible, but the schema-break consumer fan-out
is under-scoped and one closing-10 metric is uncomputable as
formulated. I additionally surfaced gaps Round 1 missed (wall-blocked
move rate, harness CLI consumer, 12-wall ceiling test, token-proxy
calibration) and want to bookmark one spot where I read the severity
differently from Round 1.

**What is solid (re-affirmed):**

- WP-C/WP-D write-set disjoint at runtime. I separately verified there
  are no `convex/llm/*` ↔ `apps/replay/src/*` cross-imports
  (`Grep "from\s+[\"'].*convex/llm" apps/replay` and the converse:
  zero matches in either direction). Codegen-only coupling is
  acceptable per architecture.md §1.
- POC schema-wipe posture is consistent across all four docs and
  endorsed by user memory `project_poc_schema_wipe_acceptable`.
- Branch A/B contingency for reasoning text is well-bounded in
  WP-A.1 (probe-first), with the fallback path symmetric across
  decision tool, agent record, and replay UI.
- Token-budget cross-check arithmetic in README §8 holds; the trim
  path in D-P3-3 has ≥ 150 tokens of recoverable headroom.
- Cucumber scenarios mostly trace to Vitest cases (one gap, see
  issue R2-3 below).

**What is risky and was missed by Round 1:**

- The closing-10 wall-blocked-move-rate metric is uncomputable from
  `resolution.moves[]` because `simulateMovement` filters out
  `from === to` entries before push. Engine fix or aggregator
  rewrite is required; the plan handwaves "no schema diff needed".
- `harness/analyze-match.ts:52` filters `kind === "interact"` —
  not in any WP, will produce wrong CLI diagnostics post-WP-B.
- ADR §5's 12-wall safety ceiling has no test coverage in
  WP-B.8 / WP-C.5.

**Where I read it differently from Round 1:**

- Round 1 issue "Concept-spec edits too narrow" (Med) — on re-read
  I agree, but I want to be precise about the surface (see R2-7
  below): §7 example, §8 input list, §22 entire section, and §23
  overwatch line are the ones that genuinely conflict with the new
  contract. §10 movement options stay intact (no vocab change there).

---

## Issues (NEW — not in Round 1)

| Severity | Area | Description | Evidence | Recommendation |
|----------|------|-------------|----------|----------------|
| **High** | Closing-10 metric uncomputable | The wall-blocked move rate (README §5) is sourced from "`resolution.moves[]` where `from === to` AND adjacent wall in intended direction". But `simulateMovement` only pushes a move entry when `start.x !== end.x \|\| start.y !== end.y` — blocked moves emit nothing. The plan can't compute the metric as stated; WP-E.3 risks bullet handwaves "the aggregator handles this; there's no schema diff needed", which doesn't match the data shape. | `convex/engine/movement.ts:368–375` (push gated by `start !== end`); `README.md:200` metric source column; `work-packages.md` WP-E.3 risks bullet 2 | **Blocking before WP-E (and ideally before WP-B locks the engine emit shape).** Choose one path explicitly: (a) engine emit — push a `from === to` blocked-by-wall trace entry to `resolution.moves[]` (or a sibling `blockedMoves[]`); requires schema diff, locks the metric to a single source. (b) aggregator-side derivation — WP-E.3 reads `agentRecord.decision.move`, computes intended direction, and correlates against the *next-turn's* `worldState.characters[].pos` to detect "intended a move, didn't move", then checks an adjacent wall; no schema diff but more complex than current WP-E.3 scope. Document the chosen path in `README.md` §5 source column and in WP-E.3. |
| **High** | Schema break — harness CLI consumer | `harness/analyze-match.ts:52` filters `a.kind === "interact"`. After WP-B unifies dispatch, this branch is unreachable and chest-event diagnostics produced by the CLI will silently undercount. Round 1 covered the `apps/replay/` consumer surface (`reconstruct.ts`, `HoverCard.tsx`) but missed the harness side. | `harness/analyze-match.ts:52` (literal filter); WP-B / WP-D scope lists in `work-packages.md` (no harness file referenced) | **Should-fix before WP-E.** Add `harness/analyze-match.ts` to WP-B.7 or WP-E pre-flight scope. Same fix shape as the other consumers: detect chest opens via `(kind === "loot" && result === "opened" && target.startsWith("chest_"))`. |
| **Medium** | Test coverage — wall safety ceiling | ADR §5 introduces a 12-wall safety ceiling on the digest's wall section. Neither WP-B.8 (vision tests) nor WP-C.5 (inputBuilder tests) lists a test case that exercises the ceiling. If a vision sphere ever exposes >12 walls (corner of a wall maze on the reference map could plausibly do this), the digest could overshoot the token budget unobserved. | `architecture-decisions.md` ADR §5 paragraph 3; `work-packages.md` WP-B.8 + WP-C.5 test lists | **Should-fix.** Add a synthetic-fixture test (observer in a wall-dense corner, e.g. (1,1) of the reference map's lowest-x lowest-y maze cluster) that asserts `vision.computeVisibleEntities` emits all walls within Chebyshev 20 and `inputBuilder` caps at 12. 4–6 lines of test code; closes the only ADR §5 invariant currently lacking a test. |
| **Medium** | Branch B prompt-ask wiring | If WP-A.1's reasoning probe returns Branch B, the model must be asked in the system prompt to populate `decision.rationale`. `de-risking.md` D-P3-1 documents the ask, but ADR §7's section ordering does NOT mention `rationale`, and WP-C.2's scope is "full rewrite per ADR §7". An engineer following WP-C.2 literally would not include the Branch B ask, and the reasoning-capture-rate metric (≥80%) would fail silently. Round 1 covered Branch B nullability and required-vs-optional but did not connect to the ADR §7 / WP-C.2 omission. | `architecture-decisions.md` ADR §7 (six bullet sections, none mention rationale); `work-packages.md` WP-C.2 ("full rewrite per ADR §7"); `de-risking.md` D-P3-1 Branch B (the actual ask language) | **Should-fix before WP-A starts.** Either: (a) add a conditional bullet "(Branch B only) Section 5b — ask for rationale" to ADR §7; (b) explicitly link WP-C.2 scope to D-P3-1 Branch B with the conditional captured in WP-C body. Combine with Round 1's "Reasoning Branch B" point about the rationale being required, not optional. |
| **Low** | Token-proxy under-estimate | `chars/4` is the budget gate. The new system prompt is dense with token-irregular literals (`Player_N`, `Wall_X_Y`, `Corpse_PlayerN`, `Cover_X_Y`). Real tiktoken counts may exceed `chars/4` by 5–10% for technical content. With ~50–150 tokens of headroom, this could erode silently in the smoke run. | `de-risking.md` D-P3-3 success criterion; phase-1's chars/4 baseline | **Nit / calibration.** WP-C smoke run could optionally cross-check with a real tiktoken on one composed input from each persona as a sanity check against the chars/4 proxy. Not blocking. |
| **Low** | Cucumber scenario coverage in README | The North Star contains a "Scenario: Offensive overwatch picks deterministically" that Round 1 also flagged. Confirming: the scenario is folded into the broader overwatch stance scenario (READMEs §3 fourth scenario) but only mentions defensive counter-fire explicitly; offensive-first-in-range is in WP-B.5 + WP-B.8 but not in README §3 visibly. This is documentation coverage, not implementation gap. | `README.md` §3 scenarios; `work-packages.md` WP-B.5; North Star §design-decisions §4 | **Nit.** Add a brief offensive-overwatch scenario stub to README §3 OR add a note that it is covered in WP-B's test suite. |

## Issues (overlap with Round 1 — for traceability)

| Round 1 ID | My read | Severity agreement |
|---|---|---|
| R1 — Sequencing/Build (`affordances.ts` deletion in WP-B before WP-C drops the import) | Confirmed. `convex/llm/inputBuilder.ts:46` imports `localAffordances`, `:267` and `:352` call it. WP-B as written cannot pass typecheck/build because deleting `affordances.ts` while the inputBuilder still imports it is a hard error. | **Agree — High.** |
| R1 — `_internal_runMatch.ts` schema mirror | Confirmed at `convex/_internal_runMatch.ts:95–123` (rebuilt validators) and `:151–158` (`agentRecordValidator` references). The `recordTurn` mutation arg path will reject every new-shape decision after the schema break. | **Agree — High.** Consider consolidation into a single shared module instead of mirror-update; eliminates the invariant. |
| R1 — Reporting / data flow (closing-10 metrics not derivable from `RunSummary`) | Confirmed. Several metrics need turn-level decision/scratchpad/move/world-state data; `convex/reports.ts:193` aggregates only summaries. WP-E.3's scope says "extend `convex/engine/reportStats.ts`" but doesn't address the upstream data-flow shape. | **Agree — High.** This compounds with my R2-1 (wall-blocked move rate uncomputable) — both point at WP-E.3 not yet having a data-flow design. |
| R1 — Trace schema for `fromOverwatch` / stance attribution | Confirmed. `convex/schema.ts:299` and `convex/_internal_runMatch.ts:181` both define `actions[]` as `{characterId, kind, target, result}` (kind is `v.string()`); ADR §3 references `fromOverwatch: true` and stance attribution but no validator carries it. | **Agree — High.** Adds another "decide and document the persisted shape" decision item alongside R1's reasoning-nullability and reporting items. |
| R1 — Concept-spec edits too narrow | Re-checked: §7 example shows the old `Heard:` and `Evac:` blocks (`concept-spec.md:357–361`); §8 lists `Recent heard`, `Relevant last-known positions`, `Valid local affordances` (`:418–422`); §22 entire section is the conceptual home of the deleted `Affordances:` block (`:1175–1198`); §23 "Overwatch attacks resolve according to priority" (`:1231`) needs stance/counter-fire update. ADR §8 only covers §11/§13/§21 — too narrow. | **Agree — Medium.** §10 movement options stay intact; that section is unaffected by the schema break. |
| R1 — Replay reconstruction (`reconstruct.ts`, `HoverCard.tsx`) | Confirmed at `apps/replay/src/lib/reconstruct.ts:215, 220, 232` and `apps/replay/src/components/HoverCard.tsx:318`. After WP-B, chests will display as permanently closed in the replay grid. | **Agree — High** (Round 1 marked Med; I'd argue High because closing-10 demos directly fail the visual test if chests show as closed). |
| R1 — Branch B reasoning under-spec / nullability | Agreed on substance. My R2-4 above adds the ADR §7 / WP-C.2 placement angle that complements Round 1's "ask required not optional" angle. | **Agree — Medium.** |
| R1 — Reasoning nullability inconsistency | Confirmed: README declares `string \| null` (`README.md:135`) and metric reads `reasoning !== null` (`:206`); ADR §2 / WP-A use `v.optional(v.string())` (`architecture-decisions.md:177`, `work-packages.md:50`). `undefined !== null` is a classic counting-bug source. | **Agree — Medium.** |
| R1 — System prompt test coverage | Agreed; my R2-3 (12-wall ceiling) is a sibling test-coverage gap. | **Agree — Low.** |
| R1 — Offensive overwatch scenario absent from README §3 | Confirmed; my R2-6 documents the same. | **Agree — Low.** |

## Spec / Guide Deviations

- **Architecture.md §1 boundary:** independently verified clean —
  zero `convex/llm/*` ↔ `apps/replay/src/*` runtime imports in
  either direction. Codegen-only coupling.
- **Mental-model.md §11:** plan aligns. The substrate-refinement
  paragraph's intent (digest rebuild, schema unify, reasoning
  capture, raw-pane) is fully reflected in the four spec docs.
- **Architecture-decisions.md §1 (slice boundaries) and §6 (locked
  stat tiers):** unaffected by phase 3.
- **AOP.CALIBRATE / source-of-truth doctrine:** Round 1 is right —
  the concept-spec must be edited beyond §11/§13/§21 to keep the
  spec coherent with the new contract. See R2-7 / Round 1's
  same-named issue.
- **Hard out-of-scope (README §4):** no WP scope creep verified.
  No procedural maps, no fog-of-war, no public spectator/auth, no
  cursed-item authoring, no migration shims.

## Decision Notes

(Decisions PM must resolve before WP-A starts.)

1. **Trace `kind` for chest opens after schema unify.** Round 1
   raised this. The cleanest answer: trace-action `kind` matches the
   *resolved-engine-path*. Since WP-B unifies dispatch, chest opens
   should emit `kind: "loot", result: "opened"` (same `result`
   vocabulary, unified `kind`). This is the read I assumed in R2's
   harness consumer issue (R2-2). Confirm or pick the alternative
   (keep trace `kind: "interact"` while decision uses `loot`) and
   document the split in ADR §1 + ADR §4.
2. **Persisted shape of overwatch trace entries.** Round 1's R1
   `fromOverwatch` issue. Decide between (a) extending the action
   validator with `fromOverwatch?: boolean` and `stance?: "offensive"
   | "defensive"`, or (b) deriving stance from the same-turn
   `agentRecord.decision.overwatch_stance` lookup at metric-eval
   time. (a) is more diagnostic; (b) avoids a schema diff.
3. **Wall-blocked move rate computability.** R2-1 above. Either the
   engine emits a blocked-move trace entry (schema diff + WP-B
   scope expansion), or the aggregator derives it from
   `decision.move` + next-turn position (WP-E.3 scope expansion).
4. **Reporting data-flow shape.** R1's same-named issue. Either
   extend `runs` rows with phase-3 per-run aggregates, or write a
   phase-3-specific report writer that reads `turns`/`worldState`/
   `characters` directly. Pick now so WP-E.3 has a target.
5. **Branch B "ask for rationale" placement.** R2-4 above. Either
   amend ADR §7 with a conditional Branch B section, or make
   WP-C.2 explicitly conditional on D-P3-1 outcome.
6. **Concept-spec edit surface.** R1's same-named issue + R2's
   surface-list above. Expand ADR §8's edit targets to include §7,
   §8, §22, §23.

## Pre-WP-A Punch List (consolidated, in dispatch order)

**Blocking — must land before WP-A starts:**

1. Add `convex/_internal_runMatch.ts` to WP-A.2 file list (or
   refactor to share validators). [R1, R2 agree]
2. Decide and document persisted overwatch trace shape
   (`fromOverwatch` validator vs. stance derivation). [R1]
3. Decide and document closing-10 reporting data-flow shape (per-run
   aggregate vs. report writer). [R1]
4. Decide and document wall-blocked move rate computation (engine
   emit vs. aggregator derivation). [R2-1]
5. Wire Branch B's rationale ask into ADR §7 (conditional) or
   WP-C.2 explicit sub-deliverable. [R2-4]
6. Reconcile `reasoning` nullability across README, ADR, and WP-A
   (use `v.union(v.string(), v.null())`, persisted as null on every
   non-captured path). [R1]

**Blocking — must land before WP-B/WP-D close:**

7. Move `affordances.ts` deletion (and its tests) out of WP-B and
   into WP-C, or extend WP-B to remove the inputBuilder import that
   blocks build. [R1]
8. Add `convex/engine/runStats.ts` chest-equip filter update to
   WP-B.7 scope. [R1, R2 agree]
9. Add `apps/replay/src/lib/reconstruct.ts` filter update to
   WP-D scope. [R1, R2 agree]
10. Add `apps/replay/src/components/HoverCard.tsx` filter update to
    WP-D scope. [R1, R2 agree]
11. Add `harness/analyze-match.ts` filter update to WP-B or WP-E
    scope. [R2-2 only]
12. Expand ADR §8 concept-spec edit targets to include §7, §8, §22,
    §23 (in addition to §11/§13/§21). [R1, R2 agree]

**Should-fix — strongly recommended:**

13. Add structural-equivalence assert covering
    `_internal_runMatch.ts`'s validator copies, OR refactor to
    eliminate the mirror entirely. [R2-augmenting-R1]
14. Add 12-wall safety ceiling test to WP-B.8 or WP-C.5. [R2-3]
15. Add explicit "no `Affordances:` / `Heard:` / `Last-known:` /
    `Evac:` headers" assertion to WP-C.5 inputBuilder tests. [R1
    flagged at low; R2 echoes]

**Nice-to-have / nits:**

16. Add `tests/llm/systemPrompt.test.ts` (or move equivalent into
    inputBuilder.test.ts) to assert the system prompt teaches the
    typed-id glossary, action grammar, overwatch stance, and (Branch
    B) rationale instruction. [R1]
17. Add offensive-overwatch Cucumber scenario to README §3 or note
    that it's folded into the stance scenario. [R1, R2-6 agree]
18. WP-C smoke could cross-check chars/4 proxy against real tiktoken
    on one input per persona. [R2-5, calibration only]

Items 1–12 are blocking; 13–15 are strongly recommended; 16–18 are
nits.

---

*Reviewer note:* the plan's design content is largely correct and
aligned with the North Star. The blocking gaps are about
contract-coverage (consumer fan-out, mirrored validators, trace
shape) and metric measurability (wall-blocked moves, reporting
data flow), not about design errors. With Round 1 + Round 2's punch
lists folded into WP-A/B/D/E scopes and the six PM decisions
above resolved, the plan is ready for WP-A execution.
