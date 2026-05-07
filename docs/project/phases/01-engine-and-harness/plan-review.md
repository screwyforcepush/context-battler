# Phase 1 Plan Review — Engine + Evaluation Harness

**Verdict:** ✅ **APPROVE WITH CHANGES**

This is an exceptionally high-quality plan that demonstrates deep alignment with the `mental-model.md` and `concept-spec.md`. The three-stage cadence correctly prioritizes substrate stability before scale, and the de-risking spikes target exactly the right technical unknowns (Azure tool-use shape and Convex bootstrap).

The changes required are minor clarifications and safety assertions to prevent "drift" during the 12-day implementation window.

---

## 1. Artefact Assessment

| Artefact | Status | Notes |
|---|---|---|
| `README.md` | **Pass** | Clear goals, metrics, and dependency map. Stage gates are well-defined. |
| `architecture-decisions.md` | **Pass** | ADRs for schema, isolation, and tool-use are technically sound. ADR §4 (Azure loop) is particularly well-calibrated to `azure-llm.md` §7. |
| `work-packages.md` | **Concern** | Minor ambiguity in WP7/WP8 regarding the "speech window" turn-indexing. |
| `de-risking.md` | **Pass** | Spikes are well-scoped. RED criteria for Spike A are correctly conservative. |

---

## 2. Issues & Required Changes

| Severity | Area | Description | Recommendation |
|----------|------|-------------|----------------|
| **Low** | **Engine (Speech)** | `README.md` §10.2 and WP8 are ambiguous on speech turn-indexing. If speech is said in Turn N, it is resolved in Phase 3 of Turn N. Agents should see it in the "Heard:" section of Turn N+1. | **Change:** Update `README.md` §10.2 to state: "Speech said in Turn N appears in the input of Turn N+1 (the 'Heard' buffer). It remains in the buffer for exactly one more turn (Turn N+2) before eviction." |
| **Low** | **Schema (Trace)** | ADR §6/§7 `agentRecords` captures `visibleState` (the digest) but not the full `systemPrompt` or `personaPrompt`. While these are mostly static, a change in persona mid-run (unlikely but possible during debugging) would invalidate the trace's auditability. | **Change:** Add `personaId` or a hash of the persona prompt to `agentRecords` in ADR §6 to ensure the trace is 100% reconstructible. |
| **Low** | **Tests (Collisions)** | WP7 mentions collision but doesn't explicitly mandate a test for the "simultaneous identical tile" case in §24. | **Change:** Add an explicit acceptance bullet to WP7: "Unit test for §24: two agents moving to the same tile from different origins both fail to enter and remain in their previous tiles." |

---

## 3. Spec / Guide Deviations

- **`concept-spec.md` §16 vs README §10.2**: The spec says "speech is broadcast ... in the turn it's said". The plan interprets this as a multi-turn window. This is a sensible engineering "safety margin" for agent reaction time, but should be locked as Turn N+1 and N+2 only.
- **`azure-llm.md` §7**: The plan (ADR §4) correctly identifies that `parallel_tool_calls` must be `false` and `tool_choice` must be `required`. No deviations found.

---

## 4. Spec-Conformance "Breaking" Checks

I actively tried to find gaps in the mechanic coverage. Findings:
- **Overwatch vs. Speech-Reveal**: Corrected in WP7 (revealed-at-phase-3 speakers are targets for phase-5 overwatch).
- **Dynamic Movement**: Corrected in WP7 (substep simulation mentioned).
- **Evac Reveal**: Corrected in WP7 (Phase 7/8 handles the turn-30 flip).
- **Simultaneity**: ADR §3 and WP7 use substeps and matchId-keyed state to prevent race conditions. This is robust.

---

## 5. Decision Notes for implementing Agents

1. **WP4 Spike A**: If the model fails to honour `parallel_tool_calls: false` despite the flag, the implementer of WP6 MUST add a client-side filter to only take the *first* `function_call` and log the others as warnings.
2. **WP15 Tuning**: The "12-iteration cap" is a hard budget. If the metrics don't clear after 120 runs, do not keep tuning prompts; escalate to a Reviewer to check for engine logic bugs (e.g., vision blocking too aggressively).
3. **Map Descriptor**: ADR §5 is the right path. Do not let the map grow into a 100x100 ASCII grid in the codebase.

---

## 6. Items Not Flagged (and why)

- **Chebyshev Distance**: Not flagged because ADR §1 and WP5 both explicitly cite it.
- **Convex Action Timeouts**: Not flagged because WP10's use of `scheduler.runAfter(0, ...)` and `AbortController` (60s) sufficiently mitigates the 10-minute risk.
- **Cost**: Not flagged because gpt-5.4-mini pricing makes a 50-run report (~$10-15) negligible for this phase.

---

**Reviewer Signature:** Review Architect
**Date:** 2026-05-07

---

# Independent Review Addendum — Review Architect

**Verdict:** **APPROVE WITH CHANGES**

The plan is directionally strong and should not be rejected: it aligns with the phase-1 north star, uses the right three-stage cadence, keeps the engine as referee, avoids UI/player-surface work, and puts most business logic behind pure functions with tests-first coverage. However, several plan lines need correction before implementation jobs are dispatched. The risky parts are not broad architecture choices; they are exact contract details around Azure tool calls, trace reconstructability, speech timing, and gate acceptance.

## Review Summary

- Overall assessment: **Concern / approve-with-changes**. Foundation can proceed after the sequencing note is fixed; WP6, WP8, WP10, and Spike A should not proceed on the current wording.
- What is solid: TS + Convex actions match `architecture.md`; pure engine modules under `convex/engine/*` are the right test seam; `--runs` / `--concurrency` harness shape matches `mental-model.md` phase-1 cadence; the plan explicitly excludes rendering, player input, public leaderboards, progression, prompt caching, dashboards, and cross-run learning.
- What is risky or unclear: Spike A proposes a JSON-mode rollback that violates the source guides; trace rows do not yet preserve the full LLM input or tool `call_id`; WP8 can be read as exposing same-turn speech before the speech phase has happened; WP10 simultaneously requires 50 turn rows and early completion on last survivor.

## Per-Artefact Findings

| Artefact | Assessment | Findings |
|---|---|---|
| `README.md` | **Requires changes before implementation** | Scope/gates are aligned, but speech timing in §10.2 is ambiguous, foundation parallelism is overstated, and hard out-of-scope should explicitly add no formal trade/diplomacy systems, no noise system, and no ranged weapons. |
| `architecture-decisions.md` | **Requires changes before WP6/WP10** | ADRs 1, 2, 3, 5, 6, 8 are broadly sound. ADR 4 must store `call_id`, handle Azure status/content-filter failures and timeouts, and ADR 6/7 must persist reconstructible LLM input, not only `visibleState`. |
| `work-packages.md` | **Requires changes before implementation** | WP5/WP7 coverage is mostly good but misses explicit acceptance for consumable reveal, gear replacement/discard, last-agent-standing, no mid-movement reaction, and speech-revealed overwatch targets. WP10 has a sequencing conflict with WP12. |
| `de-risking.md` | **Requires fix-before-implement** | Spike A is the biggest issue: JSON-mode fallback is not a cheap rollback and loses the tool-call trace properties the plan says are load-bearing. Spike C thresholds also conflict with WP13. |

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| High | Azure / Decision Contract | Spike A's RED fallback to JSON-mode conflicts with the phase-1 requirement that the decision contract is a tool. JSON-mode loses the model's `call_id` and the tool-call semantics that `azure-llm.md` says are project-relevant. | `de-risking.md:47-52`; `azure-llm.md:168-172`; `architecture-decisions.md:166-168` | Replace the JSON-mode rollback with: RED blocks WP6 and triggers schema/prompt simplification or PM escalation. JSON-mode should require an explicit source-of-truth change, not be a planned fallback. Make GREEN require 5/5 `function_call` outputs for `tool_choice: "required"` and 5/5 schema-valid args; use YELLOW for recoverable schema/prompt tweaks. |
| High | Trace / Observability | The turns ledger stores `visibleState`, decision, scratchpads, and `llm`, but not the full LLM input or prompt text/version. After WP15 tuning changes persona/system prompts, old traces may not reconstruct what was actually sent. ADR 4 also says `call_id` is valuable but the raw shape omits it. | `architecture-decisions.md:125-128`, `architecture-decisions.md:239-246`, `architecture-decisions.md:307-319`; `mental-model.md:120-130`; `azure-llm.md:126-128`, `azure-llm.md:170` | Change `agentRecords` to include an `input` object: `{ systemPromptVersion or text, personaPromptVersion/hash and text, visibleStateDigest, scratchpadBefore }`, plus `llm.callId`, `llm.rawArguments`, `llm.failureReason?`, and `llm.fellBackToSafeDefault`. This makes any `(run, agent, turn)` trace self-contained enough for post-hoc agent introspection. |
| High | Engine / Speech Timing | The plan can be read as putting speech from turn T into turn T's agent input, but decisions are collected before the speech phase. That would violate simultaneous resolution and let agents react to speech before it exists. | `README.md:149`; `work-packages.md:206`; `concept-spec.md:1205-1218` | Lock the timing as: speech declared on turn T is emitted and logged in turn T phase 3; eligible recipients see it in the `Heard` section of turn T+1 input only, unless their scratchpad preserves it longer. Update WP8 tests accordingly. |
| High | Gate Semantics / Match Completion | WP10 says the match stops when `turn < 50` and only one agent is alive, but its acceptance also requires 50 turn rows. The concept spec requires immediate last-agent-standing completion before turn 50. | `work-packages.md:260`, `work-packages.md:266`; `concept-spec.md:248-256` | Change WP10/Gate 1 acceptance to "terminal condition reached cleanly: either 50 turn rows, or fewer rows with `outcome.lastSurvivor` and no further turns scheduled." If Gate 1 specifically needs a 50-turn smoke, use mock LLM decisions that keep at least two agents alive. |
| Medium | Azure / Wrapper Robustness | ADR 4 and WP6 acceptance assert the request shape but do not require handling `status !== "completed"`, `incomplete_details`, content-filter blocked responses, HTTP non-200s, or an AbortController timeout in the wrapper. | `architecture-decisions.md:131-138`; `work-packages.md:134-136`; `azure-llm.md:28`, `azure-llm.md:78`; `work-packages.md:275` | Move the 60s `AbortController` requirement into ADR 4/WP6, not only WP10 risk text. Add unit tests for non-200, incomplete/failed status, blocked content filter, no function call, multiple function calls despite `parallel_tool_calls:false`, timeout, and malformed args. All should become per-agent safe default with traceable failure reason. |
| Medium | Engine / Hiding | Concept §7 says an agent in cover is revealed by using a consumable. WP5/WP7 tests mention attack/loot/speech/leaving cover but not consumables. | `concept-spec.md:370-378`; `work-packages.md:112-117`, `work-packages.md:150-170` | Add WP5/WP7 acceptance tests for hidden-in-cover + heal/speed use revealing the agent during the consumable phase, and ensure the visibility update/trace records the reveal. |
| Medium | Engine / Gear and Loot | Gear slot rules and replacement/discard semantics are in the spec but not explicitly accepted or tested. This is where equip counts and corpse looting can drift. | `concept-spec.md:684-715`, `concept-spec.md:743-747`; `work-packages.md:155`, `work-packages.md:162-170`, `work-packages.md:330-331` | Add WP7 tests for weapon/armour/consumable single-slot replacement, replaced gear discarded, no backpack, chest contents consumed on equip, corpse gear transferred to corpse on death, corpse loot equippable in range 2. |
| Medium | Engine / Overwatch and Movement Edge Cases | The plan identifies speech reveal then overwatch as a risk, but it is not promoted to acceptance. It also lacks an explicit test that newly visible enemies during movement are not reacted to until next turn. | `work-packages.md:174-176`; `concept-spec.md:526-532`, `concept-spec.md:593-607`, `concept-spec.md:1219-1233` | Add WP7 acceptance bullets for: phase-3 speech reveal makes the speaker a valid phase-5 overwatch target; overwatch that does not fire preserves hidden state; agents do not retarget to newly visible enemies mid-movement. |
| Medium | Sequencing / Parallelism | The foundation dependency map says WP1-WP4 can all run in parallel, but WP1 creates/bootstrap-stubs `convex/schema.ts` while WP2 implements the real schema. That is a direct write-set conflict and WP2 relies on WP1's tooling/codegen. | `README.md:98-101`, `README.md:156`; `work-packages.md:16`, `work-packages.md:29`, `work-packages.md:39-45` | Sequence WP1's minimal bootstrap first, then run WP2/WP3/WP4 in parallel. WP3/WP4 can start before WP2 if they avoid generated Convex imports and own disjoint files. |
| Medium | Sequencing / Runs Aggregation | WP10 says `advanceTurn` writes the `runs` summary, but WP12 owns `runs.aggregate` and is scheduled after Gate 1. | `work-packages.md:260`; `work-packages.md:316-321`; `README.md:112-114` | Remove "write `runs` summary" from WP10, or add a stub completion hook that WP12 replaces. Gate 1 should not depend on per-match aggregation; Gate 2 should. |
| Medium | Reasoning Policy | De-risking says if `low` reasoning is slow, tune to `none` for development and accept persona degradation. That conflicts with the phase-1 rule that reasoning off is wrong, except for a one-off calibration measurement. | `de-risking.md:47-50`; `mental-model.md:130-132`; `README.md:140-151` | Clarify that `reasoning.effort:"none"` is allowed only for Spike A calibration, never for gate runs or tuning conclusions. If `low` is too slow, lower concurrency, reduce prompt size, or escalate; do not collect phase metrics with reasoning off. |
| Low | Rate-Limit Spike | WP13 and Spike C use different thresholds for when to add backoff or lower stage-3 concurrency. | `work-packages.md:349-351`; `de-risking.md:127-130` | Pick one policy and repeat it in both files. Prefer explicit bands: `0% -> no backoff`; `0-5% -> add 3-retry backoff, keep concurrency 10 after re-spike`; `5-20% -> backoff and lower concurrency until clean`; `>20% -> concurrency 5 or PM escalation if still hot`. |
| Low | Out of Scope | README excludes the major user-facing non-goals, but several concept-spec later/v0-avoid items are not called out and are common scope-creep traps. | `README.md:42-57`; `concept-spec.md:899-912`, `concept-spec.md:1291-1312`, `concept-spec.md:1324-1367` | Add hard non-goals: no formal trade, no engine-enforced diplomacy/trust/reputation/alliance mechanics, no noise/directional hearing system, no ranged weapons, no auth/guest/account flows, no replay sharing/result cards. |

## Spec / Guide Deviations

- `de-risking.md:48` deviates from `azure-llm.md:170-172` and the North Star by making JSON-mode an expected fallback for a required tool contract.
- `work-packages.md:206` deviates from `concept-spec.md:1205-1218` if "this turn's broadcasts" means data available before decisions are collected.
- `architecture-decisions.md:239-246` does not yet satisfy the strongest reading of the phase-1 introspection contract because it stores the visible digest but not the full prompt/input or `call_id`.
- `de-risking.md:49` conflicts with `mental-model.md:130-132` if reasoning-off is used for anything beyond a one-call calibration.
- ADR 4/WP6 are incomplete against `azure-llm.md:28` and `azure-llm.md:78` until status, incomplete, and content-filter checks are required.

## Required Concrete Changes

| File:line | Change |
|---|---|
| `docs/project/phases/01-engine-and-harness/de-risking.md:47-52` | Replace JSON-mode fallback with block/rethink/escalate; make GREEN require 5/5 function-call + schema-valid outputs; define YELLOW for schema simplification/retry. |
| `docs/project/phases/01-engine-and-harness/architecture-decisions.md:125-128` | Add `callId`, `toolName`, `rawArguments`, `failureReason?`, and timeout/status/content-filter handling to `callDecisionTool` return/trace shape. |
| `docs/project/phases/01-engine-and-harness/architecture-decisions.md:239-246` | Change `agentRecords.visibleState` into a fuller `input` record that persists the digest plus exact persona/system prompt text or immutable versions/hashes. |
| `docs/project/phases/01-engine-and-harness/README.md:149` and `work-packages.md:206` | Define speech emitted on turn T as visible in turn T+1 input only; remove wording that implies same-turn LLM awareness. |
| `docs/project/phases/01-engine-and-harness/work-packages.md:134-136` | Add WP6 tests for non-200, incomplete/failed status, blocked content filters, missing function call, multiple function calls, timeout, and malformed args. |
| `docs/project/phases/01-engine-and-harness/work-packages.md:162-170` | Add acceptance tests for consumable reveal, last-agent-standing, gear replacement/discard, corpse looting, speech-revealed overwatch target, and no mid-movement reaction. |
| `docs/project/phases/01-engine-and-harness/work-packages.md:260-266` | Reconcile early last-survivor completion with 50-turn acceptance; remove or defer `runs` summary writing until WP12. |
| `docs/project/phases/01-engine-and-harness/README.md:98-101` and `README.md:156` | Change foundation sequencing to WP1 bootstrap first, then WP2-WP4 parallel where write sets are disjoint. |
| `docs/project/phases/01-engine-and-harness/de-risking.md:47-50` | Clarify reasoning `none` is calibration-only and never acceptable for gate/tuning metrics. |
| `docs/project/phases/01-engine-and-harness/work-packages.md:349-351` and `de-risking.md:127-130` | Align rate-limit threshold policy. |

## Calibration Items

- Open question 1, map descriptor: **approved**. A descriptor expanded to a 100x100 grid preserves the single hand-crafted map invariant and is easier to review than 10,000 literal tiles.
- Open question 2, speech audibility: **requires wording fix**. Range 20 is fine; persistence must be tied to turn T+1 input, not same-turn input. "Turn it was said" should mean the resolution trace, not the deciding agent input.
- Open question 3, scratchpad length: **approved**. A 500-character phase-1 default does not conflict with `concept-spec.md` §2A.2 as long as it is enforced in parser/trace tests and tunable only upward if needed.
- Open question 4, reasoning vs latency: **approved with guardrail**. Measuring `none` once is fine; running gates or tuning with reasoning off is not.
- Open question 5, fixed personas: **approved**. Keeping the 8 personas fixed across 50 runs is required. Randomizing persona-to-spawn assignment is acceptable if the assignment is seeded and persisted per run, because it reduces spawn bias without changing the map.
- WP4 fallback: **not approved as written**. JSON-mode is not a cheap rollback and does not preserve `call_id`. The RED threshold of any `output_text` in 5 calls is correctly conservative, but RED should stop the tool-contract path rather than silently change it.
- WP15 tuning cap: **approved**. Twelve 10-run tuning iterations is a reasonable hard cap. If the bar is still missed, escalation to engine/rules bug-hunt is the right move, not endless persona prompt chasing.

## Spec-Conformance Breaking Checks

- Resolution order in WP7 matches `concept-spec.md` §23: collect decisions -> consumables -> speech -> movement -> action -> death/loot -> visibility update -> next turn state.
- Decision tool fields in ADR 4 cover the conceptual §21 fields and no obvious extra game actions. The schema still needs concrete discriminated unions for `move` and `action`, and the trace must store `call_id`.
- Mechanics covered well: Chebyshev distance, tactical digest instead of ASCII dump, local affordances, dynamic entity-targeted movement, turn-30 evac reveal, turn-50 extraction, deterministic simultaneous combat, collisions, speech broadcast, overwatch, and parallel-run isolation.
- Mechanics under-specified or missing explicit acceptance: consumable reveal from hiding, last-agent-standing scoring/early completion, gear slot replacement/discard/no backpack, corpse gear transfer/loot, speech-revealed overwatch target, and no retargeting to newly visible enemies during movement.

## Decision Notes

- PM should require the listed doc edits before dispatching WP6/WP8/WP10 and Spike A. Otherwise implementers may build incompatible traces or a non-tool fallback path that is expensive to unwind.
- The existing six-table Convex schema is acceptable for phase 1, but the `turns.agentRecords` payload should be treated as the canonical replay/introspection record, so it must carry enough prompt/input metadata to survive prompt file edits.
- Do not promote formal diplomacy, trade, reputation, noise, ranged combat, or replay/leaderboard work into phase 1. Speech and scratchpad are the substrate; emergent behavior belongs to prompts.

## Items Not Flagged

- TS-only single package with pure engine modules under `convex/engine/*`: not flagged because it aligns with `architecture.md` while preserving unit-testability.
- Convex actions plus `scheduler.runAfter(0)`: not flagged because per-turn actions avoid 10-minute match-level action timeouts; the missing piece is wrapper-level HTTP timeout tests.
- No `function_call_output` continuation after the decision tool call: not flagged because the tool call itself is the decision and no synthesized assistant text is needed. The plan only needs to persist `call_id`.
- 500-character scratchpad default: not flagged because the spec leaves length TBD and phase 1 needs a tight prompt budget.
- Persona roster flexibility: not flagged because `mental-model.md` §10 explicitly says the starter cards are illustrative, not prescribed.
- Map tuning in WP15: not flagged because bounded tuning to clear the quantitative done-bar is in scope; procedural generation remains out of scope.
- Token-budget assertions: not flagged because WP8 and the cross-cutting risks correctly make them tests, not guidelines.

**Reviewer Signature:** Review Architect
**Date:** 2026-05-07

---

# Independent Review — Third Pass (Review Architect)

> Independent review, written without consulting the two prior reviews above. Cross-referenced against `mental-model.md`, `concept-spec.md`, `architecture.md`, `azure-llm.md`, `convex-backend.md`, `.agents/AGENTS.md`. After writing, I diffed my findings against reviews above; concurrence and additions are noted at the end.

## Verdict

**Approve with changes.** Plan is structurally sound and spec-aligned; the remaining gaps are concrete edits, not re-planning.

## Review Summary

- **Solid:** TS + Convex actions per `architecture.md` §3; pure-function engine seam; tests-first per AOP; resolution order in WP7 matches `concept-spec.md` §23 phase-for-phase; harness CLI shape (`--runs` / `--concurrency`) matches `mental-model.md` §10's three-stage cadence; spike targeting (Azure tool-use, Convex bootstrap, rate limits) hits the genuinely load-bearing unknowns; explicit out-of-scope list correctly excludes rendering, player input, leaderboard, cursed names, procedural maps, dashboards, determinism, prompt caching.
- **Risky / unclear:** Decision tool schema in ADR §4 leaves `move` and `action` as comment placeholders; harness has no failure-state path; Spike A RED threshold is too lenient and its rollback to JSON-mode silently degrades the trace; several §13–§14 game values (item stat tiers, replace-and-discard, last-known tracking) are implied but unowned by any WP.

## New Issues Not Flagged Above

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| **High** | Harness | WP11 polls for `status: "completed"` but the schema has `failed`; a single failed match would hang the harness indefinitely with no timeout, failure threshold, or surfacing path. | `architecture-decisions.md:213` (status enum); `work-packages.md:298-299` (poll for completed only); `architecture-decisions.md:218` (`failure?: { turn, reason }` exists but unused by harness). | Add to WP11: poll for `completed \| failed`; on failed, propagate to stdout, exclude from aggregation, fail-loud at harness exit if failure rate exceeds a threshold (≥10% on stage 3). Add to WP10: try/catch around the action body marks `status: "failed"`, writes `failure`, halts the chain. |
| **Med** | Engine | `concept-spec.md` §14 specifies concrete weapon/armour/consumable stat tiers (Rusty Blade 10 / Sword 15 / Axe 20 / Greatsword 25; Cloth 0 / Leather 3 / Chain 6 / Plate 10; Heal 20% / Speed 12). WP3 mentions named loot tables but doesn't lock the tier values. WP7 references heal/speed but not weapon/armour stats. | `work-packages.md:62-63`; `concept-spec.md:756-822`. | Lock the v0 stat tiers in ADR §6 or a new ADR §9. WP3's loot tables resolve to these instances; WP7 tests assert `axe vs leather → 20−3 = 17`, min damage floor 5. |
| **Med** | Engine | `concept-spec.md` §7 specifies last-known position tracking. WP8 lists "Relevant last-known positions" as an input field but no WP owns *who computes/stores* them. | `work-packages.md:106-110` (WP5 scope omits); `work-packages.md:188` (WP8 lists as input but doesn't compute); `concept-spec.md:392-396`. | Anchor in WP5 (engine maintains a per-character last-known map at the visibility-update phase). Cap to 3 most-recent entries to control token budget. |
| **Med** | Trace shape | `move` and `action` schema in ADR §4 are left as `/* … */` placeholders. The exact discriminated-union shape is the contract WP5 (validation) and WP6 (tool definition) must share. Underspecified now means drift later. | `architecture-decisions.md:147-151`. | Lock concrete schema in ADR §4: `move: { kind: "relative" \| "toward_entity" \| "away_from_entity" \| "toward_object" \| "toward_evac" \| "none", target?: ... }` and same for `action`. |
| **Med** | Out-of-scope | README §4 omits four items called out in `concept-spec.md` §25–§26 that should be explicit non-goals: formal trade, ranged weapons, noise system, down-but-not-out / revives. They're excluded by absence, not statement. | `README.md:42-56`; `concept-spec.md:910-912`, `:1296-1313`. | Add four bullets to §4. (Addendum 2 also mentioned trade/diplomacy/noise/ranged but omitted DBNO/revives.) |
| **Low** | Token budget | WP8's ≤1 200-token assertion is good but the digest-section caps (max N visible entities, max N heard, max N last-known) are only in WP8 *risks* not *scope*. Without the caps in scope, the assertion test fights a moving target. | `work-packages.md:208-215`. | Promote to WP8 scope: max 8 visible entities, 5 heard messages, 3 last-known, oldest-first eviction. |
| **Low** | Persona identity | `personaId: string` is unanchored across schema, loader, aggregator, and report. | `architecture-decisions.md:222`; `work-packages.md:223`. | Lock to kebab-case filename without extension (`"rat"`, `"duelist"`, …). WP9 test asserts `loadPersonas()` returns exactly the 8 ids. |
| **Low** | WP15 escalation | Hard cap is correct; the *escalation criteria* are absent — implementer can't tell which condition (engine bug vs prompt floor vs tooling bug) they hit at iteration 13. | `work-packages.md:412-413`. | Add escalation matrix: (a) deterministic engine test starts failing → engine bug, return to WP5/WP7; (b) all 8 personas converge under mock LLM → tooling/contract bug, return to WP6; (c) live LLM differentiated but report misses → escalate to user before further tuning. |
| **Low** | CLI | WP15 mentions tuning `reasoning.effort` but WP11's CLI has no `--reasoning` flag; tuning iteration would require a code edit. | `work-packages.md:296-297`; `work-packages.md:402`. | Add `--reasoning low|medium|high` (default `low`) to WP11. |

## Concurrence with prior reviews

I independently arrived at the same calls on these (cross-referencing for confidence, not duplicating):

- **Speech timing** (Addendum 1, Addendum 2 issue 3): same direction — speech said in turn N appears in turn N+1 listener input only. High agreement.
- **JSON-mode rollback in Spike A** (Addendum 2 high-severity #1): same conclusion — JSON-mode loses `call_id`/typed args and is not a cheap rollback. RED should block, not silently degrade.
- **Trace input completeness** (Addendum 1 #2, Addendum 2 high-severity #2): same direction — `agentRecords` should be self-contained (callId + prompt versions/hashes).
- **Azure wrapper failure modes** (Addendum 2 medium #4): same — non-200, `incomplete_details`, content-filter-blocked, timeouts must be in the wrapper contract, not in WP10 risk text.
- **Last-agent-standing vs 50 turn rows** (Addendum 2 high-severity #4): I missed this on my pass — Addendum 2's catch is correct. WP10 acceptance must accept either 50 rows *or* `outcome.lastSurvivor` set with fewer rows.
- **Foundation sequencing** (Addendum 2 medium #8): WP1 must land before WP2/WP3/WP4 because WP1 owns the bootstrap stub `convex/schema.ts` and `_generated/`. Addendum 2's catch holds.
- **WP10 writing `runs` summary vs WP12 owning it** (Addendum 2 medium #9): correct catch.
- **Spike C ↔ WP13 threshold policy** (Addendum 2 low #10): same — wording diverges between files.

## Dissent / refinement

- **Addendum 1's "5/5 function_call required" for Spike A GREEN.** I'd accept "≥4/5 of N≥20" rather than 5/5 of N=5 — small-N strictness is statistically weaker than larger-N tolerance. Either flavour is defensible; the operative point is N=5 is too low.
- **Addendum 2's recommendation to seed persona-to-spawn assignment** (open question 5): agree this is the cleaner shape, but flag that *which persona spawns where* across 50 runs needs to be deterministic per run (seeded by `rngSeed`) so the closing report's per-persona breakdown isn't conflated with spawn-position bias.

## Decision Notes for PM

1. The high-severity issues across all three reviews cluster around four files: `architecture-decisions.md` §4 + §6/§7, `de-risking.md` Spike A, `work-packages.md` WP10/WP11/WP6 acceptance, `README.md` §4 + §10. A single coherent edit pass over those files retires every High issue.
2. Recommend the planning crew publish a v1.1 of the four artefacts after applying the consolidated changes, then dispatch implement jobs from v1.1.
3. **Do not block on user escalation.** All listed changes are inside the planning crew's authority and within spec.
4. **Foundation can be re-sequenced** to WP1 (bootstrap, including stub `schema.ts` + `_generated/`) → then WP2/WP3/WP4 in parallel, where WP3/WP4 avoid generated Convex imports. This is a `README.md` §7 + §11 edit.

**Reviewer Signature:** Review Architect (independent third pass)
**Date:** 2026-05-07

---

# Plan v1.1 — Response

**Date:** 2026-05-07
**Author:** Planning Architect
**Verdict applied:** Approve-with-changes (per all three reviews). v1.1 ships with every fix-before-implement issue retired. Implement jobs may now be dispatched from v1.1.

The 17 fixes listed in the assignment correspond 1-to-1 to the consolidated issues across reviews A, B, C. Each issue is mapped to its resolution at file + section granularity below. Where a single issue touched multiple files, every touch point is listed so a reviewer can spot-check coherence.

## Issue → Resolution map

| # | Issue (origin reviews) | Resolution touch points |
|---|---|---|
| 1 | Spike A — JSON-mode rollback unsafe; N=5 too small (A high #1, B high) | `de-risking.md` Spike A — replaced RED rollback with block / simplify / escalate; JSON-mode explicitly NOT a planned fallback; GREEN bumped to ≥ 16/20 (≥ 80 %) of N≥20; YELLOW band added for recoverable schema/prompt tweaks (max 2 iterations). `work-packages.md` WP4 — aligned acceptance to v1.1 Spike A bands and "RED blocks WP6". |
| 2 | Reasoning `none` is calibration-only, never gates / tuning (A med, B med) | `de-risking.md` Spike A — new "Reasoning policy" subsection (binding for the entire phase). `work-packages.md` WP11 — `--reasoning` CLI rejects `none`. WP15 — only `low\|medium\|high` are tuning levers. Cross-cutting risk #5 — wording tightened. `README.md` §10.4 — locked policy; question 4 closed. |
| 3 | ADR §4 — discriminated unions for move/action; HTTP non-200, status, incomplete_details, content-filter, missing/multiple function_calls, AbortController, malformed args (B high, C med) | `architecture-decisions.md` §4 — locked discriminated unions for `move` (relative \| toward_entity \| away_from_entity \| toward_object \| toward_evac \| none) and `action` (attack \| interact \| loot \| none); added `FailureReason` union enumerating every mode; wrapper return now includes `callId`, `rawArguments`, `failureReason?`, `fellBackToSafeDefault`, `httpStatus`, `latencyMs`, `responseId`; 60 s `AbortController` is wrapper-internal; wrapper never throws. `work-packages.md` WP6 — one unit test per `FailureReason` enumerated in acceptance. |
| 4 | Trace shape — `agentRecords.visibleState` insufficient; missing prompt text/version + `callId` + `rawArguments` (A med, B high, C med) | `architecture-decisions.md` §6 — `agentRecords[].input` now includes `systemPromptHash`, `systemPromptText`, `personaPromptHash`, `personaPromptText`, `visibleStateDigest`, `scratchpadBefore`. `agentRecords[].llm` includes `callId`, `rawArguments`, `httpStatus`, `failureReason?`, `fellBackToSafeDefault`. `agentRecords[].personaId` duplicated for self-containment. ADR §7 — worked example updated; rationale on post-edit auditability + storage cost. WP6/WP10 acceptance — persists the new shape. |
| 5 | Item stat tiers unanchored (C med) | `architecture-decisions.md` §6 — locked v0 tiers (`WEAPONS`, `ARMOUR`, `CONSUMABLES`, `MIN_DAMAGE_FLOOR = 5`) with worked damage examples WP7 must assert. `work-packages.md` WP3 — loot tables resolve to these locked instances; test asserts no invented items. WP7 — combat tests assert the math (axe vs leather = 17, sword vs plate = 5 floor binds, etc.). |
| 6 | Speech timing ambiguous (A low, B high, C low) | `README.md` §10.2 — locked one-turn window: speech in turn N → input of turn N+1 only; turn N+2 input does NOT include turn N's speech (deciding agent never sees same-turn speech). `work-packages.md` WP7 (resolution scope + acceptance), WP8 (digest scope + 3-turn unit test). `architecture-decisions.md` §6 — `resolution.speech[].heardBy` is the eligibility list. |
| 7 | WP10 last-agent-standing vs 50 turn rows; runs-summary boundary; try/catch (B high, C high, A high) | `work-packages.md` WP10 — terminal status is `completed \| failed`; "completed" satisfies EITHER 50 turn rows OR fewer rows with `outcome.lastSurvivor` set. Mock-LLM scenarios (50-turn smoke / last-agent-standing / crash injection). Try/catch around `advanceTurn` body — uncaught error → `status: "failed"` + `failure: { turn, reason }` + halt chain. WP10 no longer writes `runs` row — schedules `runs.aggregate(matchId)` (WP12 owns the write). `architecture-decisions.md` §6 Consequences updated. |
| 8 | WP11 — poll completed only; no `--reasoning` flag (A high, C high, C low) | `work-packages.md` WP11 — polls `completed \| failed`; on failed surfaces to stdout + excludes from aggregation; fail-loud thresholds (any/stage 1, > 1/stage 2, ≥ 5/stage 3); per-match wall-clock guard. `--reasoning low\|medium\|high` flag (default `low`); rejects `none`. |
| 9 | WP6 — failure-mode unit tests (B med) | `work-packages.md` WP6 — acceptance enumerates one unit test per `FailureReason`; structural-equivalence test JSON Schema ↔ Zod; integration test asserts non-null `callId` + `rawArguments`. |
| 10 | WP7 — explicit acceptance for §24 collisions, consumable-reveal, gear/corpse, speech-overwatch, no mid-movement retargeting (B med x3, C low) | `work-packages.md` WP7 — acceptance enumerates: §24 simultaneous-tile collision with order-independence shuffle; consumable-reveal (heal AND speed); gear single-slot replacement (chest AND corpse) with discard; chest-contents-consumed-on-equip; corpse formation (full equipped slots); corpse loot in range 2; phase-3-speech-revealed speaker valid for phase-5 overwatch; overwatch-no-fire preserves hidden; no mid-movement retargeting; locked v0 damage math. Lifted unit-test minimum to 50. |
| 11 | WP5 last-known ownership; WP8 digest caps in scope (C med, C low) | `work-packages.md` WP5 — owner of `lastKnown.ts` (computed at visibility-update phase, capped 3 entries oldest-first eviction). WP8 — caps promoted from "risks" to "scope" (8 visible / 5 heard / 3 last-known); token-budget assertion is binding. `architecture-decisions.md` §6 — `characters.lastKnown` field added with WP5 ownership note. |
| 12 | Foundation sequencing — WP1 first, then WP2/3/4 parallel (B med, C decision note, A concurrence) | `README.md` §7 (dependency map) — WP1 sequenced first; WP2 / WP3 / WP4 then parallel with disjoint write sets and a no-codegen-import rule. §11 (job sequence) — step 1 = WP1 alone; step 2 = WP2/3/4 parallel. `work-packages.md` Foundation header — sequencing note; WP1 owns bootstrap stub `convex/schema.ts` + `_generated/` + Spike B fold; WP2/3/4 acceptance updated. |
| 13 | Hard out of scope additions (A med, B low) | `README.md` §4 — added: no formal trade; no engine-enforced diplomacy/trust/reputation/alliance; no noise/directional hearing; no ranged weapons; no DBNO/revives; no auth/account/guest-mode; no replay sharing/result cards. |
| 14 | WP15 escalation matrix for iteration 13+ (C low) | `work-packages.md` WP15 — added 3-row escalation matrix (deterministic engine test failing → engine bug; mock-LLM byte-identical decisions → tooling/contract bug; live LLM differentiated but report misses → escalate to user). `tuning-log.md` records which row triggered. |
| 15 | WP13 + Spike C threshold policy alignment (A low, B low) | `de-risking.md` Spike C — single locked policy (4 bands: 0 % / 0–5 % / 5–20 % / > 20 %). `work-packages.md` WP13 — same policy verbatim ("do not paraphrase between files"). `architecture-decisions.md` §8 — same policy repeated. |
| 16 | Persona id literal kebab-case (C low) | `architecture-decisions.md` §6 — `PersonaId` literal union (`"rat" \| "duelist" \| "trader" \| "opportunist" \| "paranoid" \| "camper" \| "sprinter" \| "vulture"`) used in `characters`, `turns.agentRecords[]`, `runs.perPersona`. `work-packages.md` WP9 — files hard-fixed; `loadPersonas()` test asserts `Object.keys(...).sort()` deep-equals the 8 literals. WP2 — schema validator rejects strings outside the locked 8. |
| 17 | Persona-to-spawn assignment seeded per `rngSeed` (C dissent/refinement) | `README.md` §10.5 — locked: 8 personas fixed across 50 runs; persona-to-spawn assignment randomised but seeded by `rngSeed`, persisted on `characters.spawnIndex`, separates per-persona stats from per-spawn-position bias. `architecture-decisions.md` §6 — `characters.spawnIndex` + `matches.rngSeed` doc. `work-packages.md` WP3 — produces the seeded mapping; acceptance test asserts deterministic permutation per seed. |

## Cross-file coherence anchors

The following contracts now appear in multiple files in matching language; an implementer can grep any of them and find a single answer:

- **Tool call shape (`decide_turn`, discriminated unions, `additionalProperties: false`)** — ADR §4 + WP6 + WP4 + Spike A.
- **Failure reasons (8-member union)** — ADR §4 + ADR §6 (`turns.agentRecords[].llm.failureReason?`) + WP6 acceptance.
- **Speech window (turn N → turn N+1 input only)** — README §10.2 + WP7 + WP8 + ADR §6 (`resolution.speech[].heardBy`).
- **Termination (`completed | failed`, lastSurvivor OR 50 rows)** — WP10 + WP11 + Gate 1 acceptance + ADR §6 (`matches.status` + `matches.outcome`).
- **`runs` boundary (WP12 owns it; WP10 only schedules)** — WP10 + WP12 + ADR §6 Consequences.
- **`PersonaId` literal kebab-case 8-union** — ADR §6 + WP2 + WP9 + WP3 (persona-to-spawn).
- **v0 item stat tiers + damage math** — ADR §6 + WP3 (loot tables) + WP7 (combat assertions).
- **Rate-limit policy (4 bands)** — Spike C + WP13 + ADR §8 (verbatim).
- **Reasoning `none` calibration-only** — Spike A + README §10.4 + WP11 (CLI rejects) + WP15 (tuning levers) + cross-cutting risk #5.
- **Foundation sequencing (WP1 first, then WP2/3/4 parallel)** — README §7 + README §11 + WP1 + WP2 + WP3 + WP4.

## Issues surfaced during this pass (not in any of the three reviews)

None of substance. One presentational tightening:

- README §10 was renamed from "Open questions for review" to "Open questions and locked answers" so the four locked items can't be misread as still-open. Question 1 (map size) explicitly stays open as a WP15 lever.
- WP11 acceptance gained a per-match wall-clock guard so a match that never reaches terminal status (e.g., a Convex action that hangs without throwing) is treated as failed — closes a corner-case implied by the WP10 try/catch contract but not previously enforced by WP11.

## Items NOT changed (and why)

- **Three-stage cadence (1 → 10 → 50).** Untouched; reviewers concur it is correct.
- **Gate structure (review-before-gate-close).** Untouched.
- **Spike topics (A: Azure tool-use, B: Convex bootstrap, C: rate limits).** Untouched; only the contents and bands within each spike were tightened.
- **Test runner / lint / typecheck / build choices (Vitest / ESLint / `tsc --noEmit` / no build step).** Untouched (ADR §1, §2).
- **Convex schema table count (six tables).** Untouched; field shapes within `turns.agentRecords[]` and `characters` were extended, but no new tables added.
- **Hard cap of 12 WP15 tuning iterations.** Untouched; only the escalation matrix at iteration 13+ was added.
- **`previous_response_id` only within a turn (never across turns).** Untouched (`README.md` §9 hygiene).

## Ready to dispatch

v1.1 is implementable directly. Recommended next job per the assignment: implement, dispatching the vertical slice WP1 → (WP2 ∥ WP3 ∥ WP4) → (WP5 ∥ WP6 ∥ WP9) → (WP7 ∥ WP8) → WP10 → Gate 1 review.

**Author Signature:** Planning Architect (v1.1)
**Date:** 2026-05-07

---

# Plan v1.2 — Nudge Application

**Date:** 2026-05-07
**Author:** Planning Architect
**Trigger:** Bird's-eye nudge — "verified guides are contracts, not unknowns" (auto-memory `feedback_verified_guides_are_contracts`). Surgical doc edits only; not a re-plan, not a re-review.

## Edits applied

- **`de-risking.md`** — Spike A dropped (one-paragraph stub left at the original heading for traceability). "Reasoning policy" lifted from inside Spike A to its own top-level section (binding for the entire phase, same substance). Spike B reframed as "Bootstrap Checklist B — Convex deploy-key write path"; GREEN/YELLOW/RED bands and outcome block removed; steps preserved. Spike C renamed to "Measurement C — Rate-limit characterisation at stage-2 concurrency"; 4-band rate-limit policy preserved verbatim. v1.2 changelog appended above v1.1's.
- **`work-packages.md`** — WP4 deleted (heading replaced with a one-paragraph "(removed in v1.2)" stub; downstream IDs WP5–WP16 keep their v1.1 numbers, gap intentional). WP1 acceptance restated as absorbing Bootstrap Checklist B. WP2 / WP3 headers and WP2 codegen-race risk dropped "WP4". WP6 acceptance augmented with absorbed Spike A sanity-assertion bullets (function_call emitted, JSON.parse + Zod schema validation, latency observed ≤ 30 s at `low`, parallel-call defence) — augments, does NOT replace, the v1.1 `FailureReason` coverage. WP6 risks: "WP4 re-spike" replaced with PM-escalation. WP11, WP15, cross-cutting risk #5 cross-references updated from "Spike A 'Reasoning policy'" → "`de-risking.md` 'Reasoning policy'". v1.2 changelog appended above v1.1's.
- **`README.md`** — §6 cadence diagram updated `WP1–4` → `WP1–3` with a clarifier line (WP4 gap intentional; de-risking is now 1 measurement + 1 checklist). §7 dependency map: WP4 dropped from foundation fan; WP13 relabelled "Measurement C: rate limits"; trailing paragraph notes Spike A retirement. §10.4 cross-ref updated from "Spike A 'Reasoning policy'" → "`de-risking.md` 'Reasoning policy'"; calibration-only carve-out removed (vacuous after Spike A drop). §11 step 2 now `WP2 ∥ WP3` (was `WP2 ∥ WP3 ∥ WP4`). v1.2 changelog appended above v1.1's.
- **`plan-review.md`** — this v1.2 changelog appended after the v1.1 Response section. Prior review passes and v1.1 Response preserved verbatim.

## Items NOT changed (v1.1 retained)

- All 17 v1.1 issue resolutions stand. The 17-row issue → resolution table at line 237+ remains the ground truth for v1.1 fix-before-implement.
- `architecture-decisions.md` — ADR §4 / §6 / §7 untouched (trace shape, `FailureReason` union, item stat tiers all retained). The single back-reference in ADR §4's JSON-mode-rejected alternative bullet still says "see `de-risking.md` Spike A" — and resolves correctly because the v1.2 stub is still labelled "Spike A — Azure tool-use round-trip *(removed in v1.2)*".
- Measurement C (formerly Spike C) bands: `0 % / 0–5 % / 5–20 % / > 20 %` 4-band rate-limit policy preserved verbatim across `de-risking.md` Measurement C / `work-packages.md` WP13 / `architecture-decisions.md` §8.
- Three-stage cadence (1 → 10 → 50). Gate structure (review-before-gate-close). Six-table Convex schema. WP15 hard cap (12 iterations) and escalation matrix. `previous_response_id` only within a turn.

## Grep verification

After v1.2 edits, `grep -rn "Spike A\|WP4\|JSON-mode\|≥ 16/20"` across the four phase-1 docs returns hits only in:

1. v1.2 removal stubs (de-risking.md Spike A heading, work-packages.md WP4 heading) — by design, for traceability.
2. v1.2 explanatory clarifier text (README.md §6 cadence note, §7 dependency-map trailing paragraph, §11 step 2 trailing line).
3. v1.2 changelogs (this file + each artefact's v1.2 section).
4. v1.1 changelogs (preserved verbatim for historical traceability — never edit history).
5. ADR §4's JSON-mode-rejected alternative bullet, which points at `de-risking.md` Spike A and still resolves to the v1.2 stub.

No live references to Spike A as a load-bearing unknown, no live references to WP4 as a deliverable, no JSON-mode-as-fallback wording, no `≥ 16/20` GREEN-band gates outside historical changelogs.

## Ready to dispatch

v1.2 is implementable directly. Recommended next job: implement, dispatching the vertical slice WP1 → (WP2 ∥ WP3) → (WP5 ∥ WP6 ∥ WP9) → (WP7 ∥ WP8) → WP10 → Gate 1 review. Note WP6 now carries the absorbed Spike A sanity assertions in its integration-test acceptance — the implement crew gets one acceptance surface to satisfy, not two (one for Spike A, one for WP6) as in v1.1.

**Author Signature:** Planning Architect (v1.2)
**Date:** 2026-05-07

