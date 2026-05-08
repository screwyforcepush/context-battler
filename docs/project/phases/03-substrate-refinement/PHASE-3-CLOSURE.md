# Phase 3 — Closure Record

> Single-file handoff for phase-4 planning. Records what the
> substrate-refinement closing-10 produced, what proves it, and which
> README §5 thresholds are met vs documented-why-not.
> Closure date: 2026-05-08. Source commit at close: 0b4f6cb.
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
- `reportId` = `jd7ecmx2fgqa0yd7g8h18cv3n986bmwe`
- `reportType` = `phase-3-closing-10`
- `runCount` = 10
- `metBar` (composite) = `false` — 11 / 14 thresholds met; 3 documented
  misses with paragraphs in §3 below.
- `missingRunsForMatchIds` = `[]`

**Match ids (10):**

1. `j977127ajsenn14ycshgsf98j186ac7q`
2. `j9741jkxe0dgmvm229dpbk90sh86ab5k`
3. `j975sk6rj75fpyn3h8hm82kkqd86ac94`
4. `j978m95n4s710c9cqfens7mpxn86bvgn`
5. `j97asrj1q4mt3mkrgq65y0k7sx86a6dm`
6. `j97avpme48sa6msdmqdpjv09b186bnwt`
7. `j973qjym3yrnwmjf6a1m4gxg9186aw10`
8. `j9748s4whye1jy8wfysmta2y9186bzst`
9. `j977dqrackzff9axjy7ycarfxx86b159`
10. `j974ks6tendqsasj800453awbd86b2rp`

All 10 matches reached `status: "completed"` with no crashes / no
`harness_error` / no missing `runs` rows (harness summary: completed=10,
failed=0, durationMs=513056). The harness's auto-persisted `closing-10`
report is `jd72x8zz5d3nqeg11hcpp2dq6586bbwe` (carry-over phase-1 view);
the phase-3 report (this file's canonical source) carries both that view
and the substrate-refinement metrics.

### 2.1 Phase-3 enhanced metrics — threshold-vs-actual

| README §5 metric | Threshold | Measured | Verdict |
|---|---|---|---|
| Schema validity (fellBackToSafeDefault rate) | ≤ 10% of per-turn calls | 18.73% (617 / 3294) | **MISS** (see §3.1) |
| Wall-blocked move rate | ≤ 2% of move attempts | 1.33% (18 / 1357) | PASS |
| Drained-corpse repeat rate | ≤ 1% of loot attempts | 0% (0 / 95) | PASS |
| Corpse-loot success rate | ≥ 50% of runs | 0% (0 / 10) | **MISS** (see §3.2) |
| Defensive overwatch counter-fire | > 0 across 10 runs | 13 | PASS |
| Offensive overwatch fire | > 0 across 10 runs | 7 | PASS |
| Outcome-attribution heuristic | ≥ 50% of damage-taken pairs | 79.2% (61 / 77) | PASS |
| Reasoning text capture rate | ≥ 80% of non-fallback records | 66.3% (1775 / 2677) | **MISS** (see §3.3) |

### 2.2 Carry-over phase-1 metrics (10-run-scaled)

| README §5 metric | Threshold | Measured | Verdict |
|---|---|---|---|
| Runs ending with ≥ 1 extraction | ≥ 30% (≥ 3 of 10) | 90% (9 / 10) | PASS |
| Runs containing ≥ 1 kill | ≥ 80% (≥ 8 of 10) | 80% (8 / 10) | PASS |
| Runs containing ≥ 1 chest equip | ≥ 80% (≥ 8 of 10) | 100% (10 / 10) | PASS |
| Runs containing ≥ 1 speech event | ≥ 50% (≥ 5 of 10) | 100% (10 / 10) | PASS |
| Persona extraction-rate spread | ≥ 15 pp | 50 pp (trader 60% / sprinter 60% − duelist 10%) | PASS |
| 10 consecutive runs, no crashes / invalid states | required | 0 failures | PASS |

**11 / 14 thresholds met** (11 PASS + 3 MISS — schema validity, corpse-loot
success, reasoning capture). Each remaining miss is documented in §3 with
its substrate-correctness reading and phase-4 carry-forward note.

---

## 3. Documented-why-not for the threshold misses

The threshold list is the bar; misses require sign-off, not silent
acceptance. Each miss is recorded here with: what the metric actually
measures, what the data showed, what the substrate did right vs. wrong,
and what (if anything) phase-4 should pick up.

### 3.0 The WP-F fix-bundle — the corrective slice between two closing-10s

This closure record reflects the SECOND closing-10 run, not the first.
The original closing-10 (OLD reportId
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

Between the two closing-10 runs, the WP-F fix-bundle landed (six
substrate-correctness fixes, no behaviour tuning, no goalpost moves):

- **WP-F.1** — persistence adapter conditional-spread for
  `blockedBy` / `fromOverwatch` / `stance` so engine-emitted values are
  preserved through the Convex round-trip
  (`convex/_internal_runMatch.ts` lines 447–470).
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

The NEW closing-10 (reportId `jd7ecmx2fgqa0yd7g8h18cv3n986bmwe`) is the
first run on a substrate-correct ledger. The headline deltas are not
agent-behaviour changes; they are observability-correctness changes —
the agents were always doing some of this, but the report row was lying
about it. With the WP-F bundle landed, four previously-failing
thresholds flipped to PASS (kill rate 30%→80%, defensive overwatch
0→13, offensive overwatch 0→7, outcome attribution 0/0→79.2%) and the
remaining schema-validity rate dropped from 26.9% to 18.73%, measured
honestly for the first time.

### 3.1 Schema validity — fellBackToSafeDefault 18.73% vs ≤ 10%

The wrapper-level safe-default rate sits at 18.73% across 3294 per-turn
calls (617 fallbacks). Compared to the OLD closing-10 reading of 26.9%
this is an 8.2 pp improvement post-WP-F bundle, but still ~9 pp over
the threshold.

**Why the OLD number was unreliable.** Prior to WP-F.1, the persistence
adapter was overwriting engine-emitted overwatch / stance / blocked-by
fields with `undefined` on the way to Convex. That meant a sub-set of
agent decisions which the engine had accepted ended up persisted in a
shape that *looked* malformed downstream — the fallback rate was being
measured against a broken-baseline ledger, not the agents' actual
behaviour. WP-F.1's conditional-spread fix made the persisted record
honest, so the 18.73% rate is the first measurement of substrate
correctness against a clean ledger.

**Why this is still a phase-3 MISS, not a phase-3 bug.** Per North Star
§11 NON-GOALS, root-cause analysis of the residual fallback population
(target-not-visible rejections, action-grammar mismatches, etc.) is
explicitly out of scope for substrate refinement. The phase-3 mandate
was to give the agents a substrate where outcomes are reasoned about
and where the diagnostic surface honestly reports what happened. Both
are now true. Phase-4 carry-forward: a `validatorReason` aggregator
slice (the field is already persisted per-row on `agentRecord.llm`) to
surface the top fallback modes for targeted prompt / digest fixes.

### 3.2 Corpse-loot success 0% — combat-economy tuning, not substrate

Across the 10 NEW closing runs, 8 of 10 matches contained at least one
kill (kill-rate flipped 30%→80% post-WP-F bundle, see §3.0), so corpses
ARE being created — but agents are not pivoting to corpse-loot once the
target is down. The corpse-loot success rate sits at 0% (0 / 10 runs
with a successful `kind="loot" + result="looted"` against a corpse id).

**Why this is OOS for phase-3 per North Star §11 NON-GOALS.** The
substrate now correctly tells agents about killable targets, drained
corpses, and the `loot` action grammar. The decision policy "after a
kill, pivot to looting the corpse" is a combat-economy tuning concern
— it lives at the persona-prompt and system-prompt-encouragement layer,
not in the substrate. North Star §11 explicitly carves combat tuning
out of phase-3.

**Phase-4 candidate.** Persona / system-prompt tuning to encourage
post-kill loot pivots (e.g. `vulture` and `opportunist` archetypes are
the natural fit). The substrate is ready: the loot dispatch correctly
namespaces on `Corpse_` ids (WP-B), the digest exposes corpses with
`[drained]` annotation when relevant (WP-C), and the renderer
distinguishes corpse-loot from chest-loot (WP-F.3).

### 3.3 Reasoning capture 66.3% vs ≥ 80%

The reasoning capture metric counts per-turn calls that resulted in a
non-null `agentRecord.llm.reasoning` field across all NON-FALLBACK
records. Across 2677 non-fallback records, 1775 carried reasoning text
(66.3%), 902 did not. This is essentially flat against the OLD closing-10
reading of 65.0% — the rate is sticky around two-thirds across both
runs.

**Branch A is confirmed functional, not the question.** The WP-A.1
probe (`harness/probe-reasoning.ts`) verified that Azure DOES expose
reasoning items when prompted with `reasoning: { summary: "auto" }`
— Branch B (the de-risking fallback that would have added a
`decision.rationale` field) was correctly skipped because Branch A
works.

**Why the rate is sticky around 66%.** Spot-checking the no-reasoning
records: most are responses where `usage.output_tokens_details
.reasoning_tokens > 0` (Azure DID generate reasoning tokens internally)
but the response stream emitted an empty `summary: []` array on the
`output[].type === "reasoning"` item. The `summary: "auto"` opt-in only
fires when the response stream actually ships a summary item; a
sub-tier of model responses appear to omit the summary even with
auto-opt-in. This is Azure-side variability at `reasoning.effort:
"low"`, not a wrapper bug.

**Why this row is documented, not silently accepted.** Per ADR §2 and
de-risking D-P3-1 the diagnostic loop's load-bearing field carries a
"capture-or-document-why-not" mandate. The persistent ~⅓ shortfall is
recorded here as the substrate's first honest measurement of what
Azure ships at `effort: "low"`, captured against a substrate-correct
ledger (the OLD measurement of 65.0% is consistent with the NEW 66.3%,
which suggests the WP-F bundle didn't perturb this metric — it's a
genuine Azure-side floor).

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
  `agentRecord.llm.reasoning`. 1775 / 2677 = 66.3% non-fallback rate
  proves end-to-end function (compare phase-1 baseline: 0 — field
  didn't exist).
- **Walls in the digest** are emitted by `convex/engine/vision.ts` and
  rendered by `convex/llm/inputBuilder.ts`. The 1.33% wall-blocked move
  rate (under the 2% threshold) is the *substrate goal* — agents now
  see walls in `Visible:` and route around them. (Phase-1 had no walls
  in digest → multiple failures per run.)
- **Drained-corpse trace** emits `result: "empty"` per ADR §4. 0
  drained-repeat events across 10 runs proves the digest's `[drained]`
  bracket is steering agents away from already-empty corpses.
- **Loot/interact unify** is in flight: 0 `kind: "interact"` entries
  anywhere in the 10-run trace (verified via `target.startsWith("chest_")`
  vs `target.startsWith("Player_")` namespace dispatch). Chests +
  corpses both flow through `kind: "loot"` (PM lock D7).
- **Overwatch_priority removed** — schema doesn't carry the field; the
  3-arm action union (`attack | loot | none`) and `overwatch_stance:
  "offensive" | "defensive" | null` are the live shape. Live data: 13
  defensive counter-fires + 7 offensive overwatch fires across the 10
  runs persisted with `fromOverwatch` / `stance` intact (post-WP-F.1).
- **Outcome attribution loop** — 79.2% (61 / 77) of damage-taken
  pairs have a turn-N+1 reference back to the attacker, proving the
  digest's `Last turn (you):` line carries causal information across
  turn boundaries.
- **Replay UI raw-pane** (WP-D) collapses 5 tabs to 3 sections (full
  LLM input, reasoning text, tool-call JSON). Manually verified from a
  sample turn of `j977127ajsenn14ycshgsf98j186ac7q` in the local replay
  UI.
- **Case-insensitive chest typed-id** — landed during WP-E.1 smoke
  diagnosis. Without it, the closing-10 fallback rate would have been
  >70% (the original smoke-1 measurement) and the substrate refinement
  would have looked broken.

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
  case-insensitive lookup (WP-E.1 fix).
- **`convex/engine/resolution.ts`** — defensive overwatch counter-fire
  pass + offensive first-in-range + drained-corpse trace + loot
  dispatch by id namespace + Chest_NNN case-insensitive prefix
  (WP-E.1 fix).
- **`convex/engine/validation.ts`** — Chest_NNN case-insensitive
  normalisation at `toward_object` + `loot` dispatch (WP-E.1 fix);
  stance/primary consistency check.
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
  offensive overwatch + wall-block + drained-corpse vocabulary.
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
  against an 80% kill rate is the dominant remaining miss. Persona /
  system-prompt tuning to encourage post-kill loot pivots is the
  natural fit (combat-economy tuning, OOS for phase-3 per North Star
  §11 NON-GOALS).
- **Validator-rejection breakdown aggregator.** §3.1's 18.73%
  safe-default rate is dominated by validator-boundary rejections; a
  phase-4 aggregator slice over `agentRecord.llm.validatorReason`
  (already persisted per-row) would surface the top-N failure modes
  without another schema diff.
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
- `work-packages.md` — WP-A through WP-E.
- `de-risking.md` — D-P3-1 reasoning capture probe, D-P3-4
  outcome-attribution heuristic, others.
- `harness/probe-reasoning.ts` + `harness/probe-reasoning-output.json`
  — Branch A probe code + recorded output.
- `convex/reports/phase3.ts` — pure aggregator + persistence.
- `tests/reports/phase3.test.ts` — 17 unit tests locking the
  comparator math.
- `docs/project/spec/mental-model.md` §11 (or §12) — phase-3 closure
  paragraph.

---

## 9. Sign-off

> The user accepts the closing-10 outcome as the phase-3 closure record.
> Threshold misses are documented with reproducible references in §3;
> phase-4 may pick any of the §7 follow-ups.

(Sign-off block intentionally left blank for the user.)
