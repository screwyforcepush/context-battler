# WP10.5 Phase A — Findings & Phase A Gate Decision

**Match:** `j979a83m3dbr8697fq4wwhwqhh868w8m`
**Run:** 1 sequential, 50 turns, 203s, `--reasoning low`
**Gate verdict:** **FAIL — 45.0% safe-default fallback (gate is ≤ 10%).**
**Status:** Phase A landed cleanly with substantial substrate improvement; gate not met.
Reporting per brief — "If GATE fails: stop, dump samples + persona breakdown, report findings."

---

## Phase A scope landed

| Sub-task | Owner | Status |
|---|---|---|
| A1 affordances → schema-aligned vocab | EmmaVortex | landed |
| A2 systemPrompt Decision-schema cheat-sheet | EmmaVortex | landed |
| A3 resolution.ts §9 short-circuit removed | EmmaVortex | landed |
| A3+ validation.ts post-move action gating | EmmaVortex | landed |
| A4 buildHeardForObserver direct-read | MarcusPlinth | landed |
| A5 `--reasoning` plumbed CLI → Azure | MarcusPlinth | landed |
| A6 `_data/map.ts` removed; map.ts uses JSON-import | MarcusPlinth | landed |

Validation: lint clean · typecheck clean · 220 tests pass / 4 skipped (LLM env-gated) — up from 205 baseline (+15 net new tests).

---

## Smoke headline

| Metric | Value | Notes |
|---|---|---|
| Total agent-records | 400 | 8 personas × 50 turns |
| Fallback total | 180 / 400 (45.0%) | down from gate-1 84.5% (1.9× improvement) |
| `schema_validation_failed` | 32 | 17.8% of fallbacks |
| `http_non_200` | 36 | 20.0% — ~one per turn, Azure rate-limit / transient |
| validator-rejection (no failureReason) | 112 | 62.2% of fallbacks — hidden until now |
| Chest interacts succeeded | 5 / 5 attempted | one per chest before persona started looping |
| Speech events | 34 | substrate signal: dialogue works |
| Attacks landed | 0 | no combat — personas spawned far apart, never converged |
| Deaths | 0 | corollary of above |
| Extractions | 0 | corollary of above |
| Distinct `move.kind` literals | 4 | `none`, `toward_object`, `relative`, `toward_evac` (no `toward_entity` / `away_from_entity` because zero combat) |

---

## Failure-mode breakdown (the diagnostic that the contract-vocab repair unblocked)

### Bucket 1 — `schema_validation_failed` (32, 17.8%)

Three model-emission patterns the schema correctly rejected:

| Pattern | Count est. | Sample |
|---|---|---|
| `relative` dx/dy outside ±12 cap | ~16 | `rat T1: dx=8,dy=-1` (T2-T4 dx=17,dy=-2); `duelist T1-T3: dx=-2,dy=-19` |
| `action.kind: "overwatch"` (overwatch is `primary`, not `action.kind`) | ~5 | `betrayer T4: action:{"kind":"overwatch"}` |
| `action.kind: "loot"` with `targetObjectId` (schema needs `targetCorpseId`) | ~3 | `trader T5: action:{"kind":"loot","targetObjectId":"chest_002"}` |
| Other (mostly missing fields under speed/stress) | ~8 |  |

Two are direct holes in the system-prompt cheat-sheet (A2): the prompt enumerates `move.kind` literals but never tells the model the `relative` arm has a ±12 bound, and never warns that `overwatch` is a `primary` value, not an `action.kind`. The third (`loot.targetCorpseId`) is a sub-field discriminator; the cheat-sheet doesn't show field schemas, only `kind` literals.

### Bucket 2 — validator-rejection (112, 62.2%)

This bucket was hidden in gate-1. The wrapper sets `fellBackToSafeDefault=true` when the engine validator rejects, but **`validatorReason` is computed locally in `runMatch.ts:512` and never persisted to the trace** (it's a local variable used only for the boolean, then dropped). Trace-introspection sees `failureReason: undefined` and `fellBackToSafeDefault: true`, which the analyzer reports as "unknown".

Once samples are inspected the pattern is overwhelming and unambiguous: **every persona keeps targeting their assigned chest after it's been opened.**

| Persona | Chest | Repeats observed |
|---|---|---|
| paranoid | chest_001 | T3, T4, T5, T6, … |
| camper | chest_003 | T3, T4, T5, T6, T7, … |
| sprinter | chest_004 | T3, T4, T6 (briefly varies), … |
| trader | chest_002 | T5, T7, … |
| vulture | chest_009 | T5, T6, … |
| betrayer | chest_? | similar pattern |

Root cause: `convex/engine/affordances.ts:98-100` emits `toward_object: <chestId>` for every visible chest with **no `opened` filter**. The action arm correctly filters opened chests at `affordances.ts:145-147`, but the movement arm doesn't. The model parrots `move.kind: toward_object, action.kind: interact` against the same chest turn after turn, the action validator rejects with `interact target ... is already opened` (`validation.ts:197`), and the trace records a fallback with no failure reason.

Two surgical fixes needed:
1. **Filter opened chests from movement affordances** (`affordances.ts:97-100`): same `!opened` predicate the action arm already uses.
2. **Persist `validatorReason`** in the trace (`runMatch.ts:512` + `schema.ts` agent-llm validator): so this class of substrate signal is visible from the start in future runs, not hidden behind "unknown".

The digest itself (the chest entries the model sees) probably also needs an `[opened]` marker — without that, the model can't reason about "this chest is consumed" even if we filter affordances. That's an `inputBuilder.ts` change.

### Bucket 3 — `http_non_200` (36, 20.0%)

One per turn for ~36 of 50 turns. With 8 LLM calls per turn = ~400 calls total, ~9% of calls hit HTTP errors. Pattern: spread across all turns, not bursty — likely Azure TPM/RPM limits on `gpt-5.4-mini`. **This is exactly the WP13 Measurement C signal.** No backoff is currently configured (`convex/llm/azure.ts` returns `safeDefaultResult` directly on non-200). A single retry with exponential backoff would likely halve this number; tuning `--concurrency` for Stage-2 would reveal the safe ceiling.

---

## Sanity assertions

| Assertion | Result |
|---|---|
| ≤ 10% fallback rate | **FAIL** — 45.0% |
| ≥ 1 chest equip event | PASS — 5 |
| ≥ 1 attack landed-or-near-miss | **FAIL** — 0 (substrate signal: zero combat in 50 turns) |
| ≥ 3 distinct `move.kind` literals | PASS — 4 |

The 0 attacks finding is **not** caused by Phase A regressions — combat zeros also appeared in the pre-Phase-A gate-1 smoke (per `gate-1-review.md`). Personas spawn one per corner on a 100×100 map (see `maps/reference.json`); 8 max-tile movement / turn × 50 turns = 400 tiles of travel max, but cross-map chebyshev is 99, so paths converge only when personas explicitly head toward each other. Most personas head to chests instead. This is a persona-tuning concern, not a contract concern.

---

## Recommendation for re-scope

The remaining noise floor is **diagnosable, well-scoped, and surgically fixable** — it was simply invisible until Phase A's contract-vocab repair landed. Two more passes within WP10.5 scope would clear the gate:

### Pass B — affordance + digest filter for opened chests (eliminates the 112 bucket → ~9% projected fallback)
1. `convex/engine/affordances.ts:97-100` — add `if (state.world.chests.find(c=>c.id===chest.id)?.opened !== false) skip` to movement affordances. (One-line change mirroring the action-arm filter at line 145-147.)
2. `convex/llm/inputBuilder.ts` — render opened chests in the digest with an `[opened]` marker, OR omit them entirely. (TBD by reviewer — omitting is simpler but loses last-known position memory; marking is the spec-honest answer per concept-spec §13.)
3. `convex/runMatch.ts:512` + `convex/schema.ts` agent-llm validator — persist `validatorReason: v.optional(v.string())` so this class of substrate signal is visible from the trace immediately.

### Pass C — system prompt micro-revision (eliminates most of the 32 bucket → ~7% projected fallback)
1. `convex/llm/systemPrompt.ts` Decision-schema subsection — add three lines:
   - "`relative.dx` and `relative.dy` must be integers in [-12, 12]."
   - "`overwatch` is a `primary` value, not an `action.kind` — set `primary:overwatch` and leave `action.kind:none`."
   - "`loot` requires `targetCorpseId` (a dead character id like `Player_3`), not `targetObjectId`. Use `interact` for chests."
2. Verify `inputBuilder.test.ts` ≤ 1200-token cap still holds; trim prose if needed.

### Pass D — minimal Azure retry (eliminates most of the 36 bucket → ~3% projected fallback)
1. `convex/llm/azure.ts` HTTP-error path — single retry with 1s exponential backoff on `http_non_200` when status ∈ {429, 500, 502, 503, 504}. Do NOT over-engineer; this is per the WP13 derisking-md "minimal backoff" guidance.

**Combined estimate:** ~3-9% fallback rate, comfortably under the 10% gate.

**Effort estimate:** Pass B ~30 min · Pass C ~15 min · Pass D ~30 min · re-run smoke ~5 min · gate verification ~5 min. **One bundled engineer pass, ~90 min.**

If the PM elects to re-scope WP10.5 with Pass B+C+D, the orchestrator can dispatch immediately. Otherwise, Phase A landed as committed (substantial improvement, fully validated, broken-out diagnostics scripts available for the next pass).

---

## Diagnostic artefacts (committed)

- `harness/analyze-match.ts` — per-match fallback rate + sanity assertions runner.
- `harness/cluster-failures.ts` — clusters fallback patterns by failure mode + persona; surfaces the validator-rejection bucket.

Both are usable post-commit by any future agent investigating a specific match.
