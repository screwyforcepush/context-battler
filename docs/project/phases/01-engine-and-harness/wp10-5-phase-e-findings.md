# WP10.5 Phase E.1 — Findings & Phase E Gate Decision

**Match:** `j974r5ndgdxfvca69t2ep5nads868zw2`
**Run:** 1 sequential, 50 turns, 201s, `--reasoning low`
**Gate verdict:** **FAIL — 16.1% safe-default fallback (gate is ≤ 10%; prior Pass B/C/D baseline was 13.8%).**
**Status:** Phase E.1 landed cleanly with no test/typecheck/lint regressions; the persona-text edit did NOT close the gate. **3.8 → 6.1 pp over the bar.** Worse than the prior commit by 2.3 pp.

Reporting per brief — "If GATE FAILS: STOP. Do NOT press into Stage-2 … document findings … commit Phase E.1 alone with clear GATE FAIL subject. Report back."

---

## Phase E.1 scope landed

| Sub-task | File | Status |
|---|---|---|
| persona-text edit (remove `strike`, `stab`, `smile then stab`) | `personas/betrayer.md` | landed |
| inline runtime mirror | `convex/_data/personas.ts` | landed |
| pre-existing typecheck repair (`harness/inspect-http.ts` referenced `llm.errorBody`, not on schema) | `harness/inspect-http.ts` | landed (use `rawArguments` fallback) |

**Edit content:** the betrayer body now reads:

> "You are a betrayer. Cooperate loudly while it suits you — speak often, offer truces, suggest plans. The moment you hold an advantage (better weapon, lower enemy HP, near evac alone), turn on the alliance without warning. If a foe wounds you, retaliate hard. Equip what you find. Promise allies, then leave them behind."

This matches the suggested rewrite in `wp10-5-phase-a-findings.md` §"Option 1 — Soften the betrayer persona text" (commit 8a247d0).

Validation: lint clean · typecheck clean (after `errorBody` repair) · 244 tests pass / 4 skipped (LLM env-gated). Token budget: 318 chars = 80 tokens (chars/4 ceil) — at the cliff but passes the binding ≤ 80 budget.

---

## Smoke headline

| Metric | Pass B/C/D baseline (8a247d0) | Phase E.1 | Δ |
|---|---|---|---|
| Total agent-records | 400 | 379 | (1 death + 21 absences from later turns; betrayer kept polluting) |
| **Fallback total** | 55 / 400 (**13.8%**) | 61 / 379 (**16.1%**) | **+2.3 pp (worse)** |
| `http_non_200` (status 400) | 39 | 40 | +1 |
| `schema_validation_failed` | 11 | 13 | +2 |
| `validator-rejection` | 4 | 8 | +4 |
| `content_filter_blocked` | 1 | 0 | −1 |
| Chest interacts succeeded | 7 / 7 | 4 / 4 | −3 |
| Chest equips | 6 | 4 | −2 |
| Speech events | 65 | 92 | +42% |
| Attacks landed | 0 | 0 | — |
| Distinct `move.kind` literals | 4 | 5 | +1 (`toward_entity` newly observed) |
| Wall-clock | 177 s | 201 s | +14% |

Net: persona-spread improvements visible (`+92` speech events, `+1` move-kind literal, `+1` attack `action.kind`), but the dominant fallback bucket (HTTP 400 betrayer) is statistically unchanged.

---

## Per-persona fallback breakdown (the diagnostic)

| Persona | Pass B/C/D | Phase E.1 | Δ | Notes |
|---|---|---|---|---|
| **betrayer** | **43 / 50 (86.0%)** | **41 / 50 (82.0%)** | **−4 pp** | within run-to-run noise; still dominant |
| paranoid | 1 / 50 (2.0%) | **8 / 50 (16.0%)** | **+14 pp** | new: schema-rejection on relative-move overshoots (dx=-2,dy=17 → ±12 cap) |
| sprinter | 3 / 50 (6.0%) | 5 / 50 (10.0%) | +4 pp | speed-consume vs no-consumable-equipped (4 cases) |
| camper | 0 / 50 (0.0%) | 4 / 50 (8.0%) | +8 pp | schema rejection on relative-move (dx=-2,dy=-19) |
| trader | 8 / 50 (16.0%) | 2 / 50 (4.0%) | −12 pp |  |
| vulture | 0 / 50 (0.0%) | 1 / 50 (2.0%) | +2 pp |  |
| rat | 0 / 50 (0.0%) | 0 / 50 (0.0%) | — |  |
| duelist | 0 / 50 (0.0%) | 0 / 29 (0.0%) | — | died at T29 |

**Headline:** the betrayer-text softening produced a 4-point shift indistinguishable from sample noise. The dominant fallback driver is *not* mitigated by the targeted vocabulary changes.

---

## Failure-mode breakdown (Phase E.1)

### Bucket 1 — `http_non_200` × HTTP 400 × betrayer (40 / 65.6% of fallbacks, 100% of http_non_200)

**EVERY** http_non_200 fallback (40/40) is:
- HTTP **400 Bad Request**
- Persona: **betrayer** (100%)
- Not retried (400 stays out of the retryable set per Pass D / WP13 minimal-backoff guidance — semantic non-transient)

The Azure deployment continues to reject every per-turn request that includes the betrayer persona text **even after** removing "strike", "stab", and "Smile, then stab". The persona-text moderation surface is broader than the surface phrases enumerated in the prior findings.

**Hypothesis for residual triggers** — by inspection of the new body, the still-present aggressive cues are:

1. **"turn on the alliance without warning"** — hostile-action framing without explicit weapon vocabulary.
2. **"retaliate hard"** — combat-escalation framing.
3. **"betrayer" / "betray"** — the noun itself is in the persona id and the opening sentence; the test contract (`tests/llm/personas.test.ts:168`) requires at least one of `["strike", "stab", "betray"]` and "betray" is the only one we have a path to keep.
4. **"Promise allies, then leave them behind"** — deception-with-malice framing.

Any combination of (1)+(2)+(4), or potentially (3) on its own, appears to trip the policy. Confidence: high — every other persona body has zero or near-zero rejection rate, and the only structural variable that changes is the betrayer body.

`errorBody` is **not** persisted on the agent-llm row (the schema validator does not include this field — see ADR §6 / `convex/schema.ts:232-251`). The "(no body persisted on this row)" sample lines from `inspect-http.ts` are a known gap; capturing the Azure 400 response body would let us read the exact policy reason rather than reasoning by elimination. **This is a candidate Pass F follow-up** if the PM elects to keep the betrayer text and instead extend telemetry.

### Bucket 2 — `schema_validation_failed` (13 / 21.3% of fallbacks)

Up from 11. New cases distributed across paranoid (≥6) and camper (≥3); pattern is `relative.dx`/`relative.dy` outside the locked ±12 bound (samples: `dx=-2,dy=17`, `dx=-2,dy=-19`, `dx=-4,dy=10`, `dx=-1,dy=-18`). This is the exact pattern Pass C added a system-prompt cheat-sheet line to address ("`relative.dx` and `relative.dy` must be integers in [-12, 12]").

The cheat-sheet line is present in `convex/llm/systemPrompt.ts` (verified). The model still emits out-of-bound values when targeting destinations far from the agent's spawn. Likely cause: the agent is computing a Chebyshev-true vector to a far landmark and emitting it directly without the cap clamp. This is a system-prompt or agent-behaviour signal, not a substrate bug.

**Out of scope for Phase E** — this is the schema-rejection residue, well-trodden in the prior findings.

### Bucket 3 — `validator-rejection` (8 / 13.1% of fallbacks)

Up from 4. Two reasons (4 cases each):

| Reason | Count |
|---|---|
| `loot target 'Player_1' is not a known corpse` | 4 |
| `consume='speed' but actor has no consumable equipped` | 4 |

Both are minor cheat-sheet gaps. The first is an agent attempting to loot a still-living agent (rejected by validator at WP5; `concept-spec.md` §13 requires a corpse); the second is the inverse of the Pass-D-era cheat-sheet line ("consume='speed' but actor has consumable 'heal'" — the cheat-sheet covered the wrong-consumable-equipped case but not the no-consumable-equipped case).

Neither is a betrayer-specific issue.

### Bucket 4 — `content_filter_blocked` (0)

Down from 1. Probably noise — the betrayer text shift may have moved one row from `content_filter_blocked` to `http_non_200`, or vice versa. Not load-bearing.

---

## Sanity assertions

| Assertion | Pass B/C/D | Phase E.1 | Result |
|---|---|---|---|
| ≤ 10% fallback rate | FAIL (13.8%) | **FAIL** (16.1%) | regression |
| ≥ 1 chest equip event | PASS (6) | PASS (4) | preserved |
| ≥ 1 attack landed-or-near-miss | FAIL (0) | FAIL (0) | unchanged (persona-tuning per D24) |
| ≥ 3 distinct `move.kind` literals | PASS (4) | PASS (5) | improved |

The combat-zero finding is unchanged. Substrate sanity preserved per the brief's acceptance.

---

## Hypothesis: why Option 1 didn't work

Per the prior findings doc, Option 1 was **the** recommended path because:

> "if betrayer's 86% fallback drops to the 0–6% range of the other 7 personas, total fallback drops to ~5–8% (well under the 10% gate). High confidence — this is the entire dominant bucket."

The 4-pp shift (86% → 82%) is consistent with sample noise on a 50-call sample (1σ ≈ 5 pp at p=0.86, n=50). The persona-rewrite did not move the population mean.

The hypothesis the prior findings stated — "Removes 'strike', 'stab', 'smile then stab' — the explicit violence-cue phrases. Preserves 'betrayal', 'deception', 'alliance breaking', which are theme-appropriate but **not safety-flagged**" — is **falsified by this run**. The Azure deployment's content-moderation surface includes "betrayal/deception/alliance breaking" framing, not just explicit violence vocabulary.

---

## Recommended next move (PM decision)

Three options, ranked:

### Option A — Replace betrayer with a non-deception archetype (~10 min, mechanical)

North Star §4 explicitly permits replacement: "personas illustrative, not prescribed." Concept-spec §19 lists 8 illustrative personas; the substrate Gate-3 done-bar requires *differentiation* across the 8, not the literal betrayer archetype.

Drop the deception/aggression framing entirely. Candidate replacement archetype: **"opportunist"** — gathers gear aggressively, breaks for evac when their loadout is good, no explicit deception or aggression vocabulary.

Suggested body (≤ 80 tokens, no aggressive framing):

> "You are an opportunist. Move toward chests and corpses to load up on the best gear you can find. Pick fights only when your equipment clearly outclasses the foe. Speak rarely. Once geared, head straight for evac and don't look back. Profit is survival; survival is profit."

This requires renaming the persona id from `betrayer` → `opportunist` across:
- `personas/betrayer.md` → `personas/opportunist.md`
- `convex/schema.ts:41` (literal union)
- `convex/engine/types.ts:41` (PERSONA_IDS)
- `convex/_data/personas.ts:27`
- `convex/llm/personas.ts` (no change; loader walks the inline)
- `tests/llm/personas.test.ts:168` (KEYWORDS map)
- `docs/project/phases/01-engine-and-harness/work-packages.md:269,273,275`
- `docs/project/phases/01-engine-and-harness/architecture-decisions.md:330`

Substantial edit surface but mechanical. Ids are kebab-case literal union (ADR §6) — *single rename pass*, no per-row migration concern (no production data to migrate; phase 1 is local-deployment).

**Projected impact:** if the replacement reaches the 0–6% fallback range of the other 7 personas, total fallback drops to **~3–5%** (comfortably under the gate).

### Option B — Strip the betrayer body to its tactical-mechanical core only (~5 min)

Keep the id `betrayer` (no schema rename) but rewrite the body to remove every word that frames intent toward other agents. Trade-off: persona signal collapses toward the camper/vulture cluster.

Candidate body:

> "You are a betrayer. Speak often: offer truces, share plans, propose alliances. Equip the best gear you can pick up. When you have an advantage, break ties and head to evac alone. Avoid prolonged fights; finish weakened foes only when it costs you nothing."

Removes: "turn on the alliance", "without warning", "retaliate hard", "Promise allies, then leave them behind". Preserves: "betrayer" (id-keyword for the test), "break ties", "head to evac alone", "finish weakened foes only when it costs you nothing".

Risk: still uses "betrayer" in the opening sentence, so policy may still trip. Lower-confidence path.

### Option C — Capture HTTP 400 errorBody on the trace (~30 min, follow-up Pass F)

Extend the agent-llm validator + `convex/llm/azure.ts` to persist the response body on `http_non_200`. Today the diagnostic helper falls back to `rawArguments` (which is null for HTTP 400, since the parse never happened). With the body persisted, the next Phase E iteration could read Azure's actual policy reason and target the rewrite precisely.

This is **not corrective** on its own — it's a diagnostic substrate improvement that lets Option A or B converge faster. Recommended only if Option A is ruled out for product-design reasons and Option B fails.

**Recommended path: Option A.** Highest probability of clearing the gate, smallest behavioural risk (the substrate doesn't depend on betrayer specifically — only on 8-fold differentiation), reversible.

---

## What this commit lands

A single-purpose commit with the GATE FAIL outcome:

- `personas/betrayer.md` — softened body
- `convex/_data/personas.ts` — inline mirror updated
- `harness/inspect-http.ts` — repaired pre-existing typecheck failure (`errorBody` → `rawArguments` fallback)
- `docs/project/phases/01-engine-and-harness/wp10-5-phase-e-findings.md` — this file

VALIDATE green: lint · typecheck · 244 tests pass / 4 skipped.

Stage-2 was **NOT** dispatched. The PM should re-scope per the options above before Stage-2 is attempted again.
