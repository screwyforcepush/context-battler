# WP10.5 Phase E.2 + WP12 Stage-2 — Findings & Outcome

**Status:** GATES CLEARED. Phase E.2a (archetype replacement) + Phase E.2b (Stage-2 10-run parallel + WP12 aggregator) both green.
**Reasoning:** `low` (held end-to-end per de-risking.md "Reasoning policy").

---

## Phase E.2a — Archetype replacement (`betrayer` → `opportunist`)

**Premise.** The Phase E.1 hypothesis ("soften violence vocabulary, keep the deception/betrayal frame") was falsified at commit `fa06fd8`: aggregate fallback held at 16.1 % with 41/50 (82 %) HTTP 400s on the betrayer prompt. Conclusion: the Azure deployment moderates the deception/betrayal *archetype* itself, not just explicit violence words.

**Action.** Atomic rename of the `betrayer` persona to `opportunist`, preserving load-bearing differentiation (greedy gear-collector who flees combat unless arithmetic favours them) and complying with North Star §4 ("personas illustrative, not prescribed; engineering agents may keep, trim, replace, or invent personas as long as the roster is 8 and the differentiation requirement is met").

**Surface (atomic single-rename pass; ids are kebab-case literal union per ADR §6):**

| Touchpoint | Change |
|---|---|
| `personas/betrayer.md` → `personas/opportunist.md` | New body, no deception/aggression vocabulary |
| `convex/_data/personas.ts` | Inline mirror updated (key + body) |
| `convex/schema.ts:41` | `v.literal("betrayer")` → `v.literal("opportunist")` |
| `convex/engine/types.ts:41` | `PERSONA_IDS` literal updated |
| `tests/llm/personas.test.ts:168` | KEYWORDS map: `["strike","stab","betray"]` → `["gather","loot","flee"]` |
| `docs/.../work-packages.md` (4 lines) | Locked-union references updated |
| `docs/.../architecture-decisions.md` | Locked-union reference updated |
| `docs/.../plan-review.md` | Locked-union reference updated |

**Body (74 tokens by chars/4 proxy, ≤80 budget):**

> "You are an opportunist. Move toward chests and corpses to gather the best gear you can find. Pick fights only when your loadout clearly outclasses the enemy; otherwise flee and stay alive. Loot what others leave behind. Speak rarely. Once geared, head straight for evac on the most direct path."

**Schema deploy.** Required clearing the 6 stale `matches`/`characters`/`turns`/`worldState` rows (40 characters with legacy `personaId="betrayer"`) before `npx convex dev --once` would deploy the new validator. Phase 1 is local-deployment per ADR D5; no production data to migrate; the brief explicitly disallowed a backwards-compat alias ("The working tree is shared!"; "do not preserve the betrayer key as a vestige — make the rename atomic and clean").

---

## Phase E.2a Stage-1 GATE — PASS

**Smoke:** `--runs 1 --concurrency 1 --reasoning low`
**matchId:** `j97cja316je65pxaw970j40dtx869jpf`
**Duration:** 189 s, 50 turns

| Metric | Pass-D baseline (8a247d0) | Phase E.1 (fa06fd8) | **Phase E.2a (this run)** |
|---|---|---|---|
| Total agent-records | 400 | 379 | **400** |
| Aggregate fallback | 13.8 % (55/400) | 16.1 % (61/379) | **6.8 % (27/400)** |
| HTTP 400s | 39 | 40 | **0** |
| `schema_validation_failed` | 11 | 13 | 21 |
| `validator-rejection` | 4 | 8 | 6 |
| `content_filter_blocked` | 1 | 0 | 0 |
| Chest equips | 6 | 4 | **7** |
| Speech events | 65 | 92 | 51 |
| Distinct `move.kind` literals | 4 | 5 | 5 |

**Per-persona fallback (Phase E.2a):**

| Persona | Fallback rate |
|---|---|
| rat | 0 / 50 (0 %) |
| duelist | 1 / 50 (2 %) |
| trader | 5 / 50 (10 %) |
| **opportunist** | **3 / 50 (6 %)** |
| paranoid | 5 / 50 (10 %) |
| camper | 7 / 50 (14 %) |
| sprinter | 5 / 50 (10 %) |
| vulture | 1 / 50 (2 %) |

**Headline:** the entire HTTP-400 bucket evaporated. The replacement archetype's per-persona rate (6 %) is in the same band as the median persona, validating the Phase E.1 falsification hypothesis ("the Azure deployment moderates the betrayal/deception framing itself, not just explicit violence vocabulary").

**Residual fallback (27/400 = 6.8 %):**
- `schema_validation_failed × 21` — `relative.dx`/`relative.dy` outside the locked ±12 bound (paranoid/camper). Same pattern observed in Pass C/D; system-prompt cheat-sheet line is present but the model still emits over-long relative vectors when chasing distant landmarks. Out of Phase-E scope.
- `validator-rejection × 6` — 4× `consume='speed' but actor has no consumable equipped`, 2× `interact target 'chest_NNN' is already opened`. Minor cheat-sheet gaps.

---

## Phase E.2b — WP12 aggregator + Stage-2 (10 matches × concurrency 5)

### Implementation

**TDD per AOP.** Tests written first at `tests/engine/runStats.test.ts` (13 tests covering top-level counts, per-persona breakdowns, the WP12 acceptance scenario verbatim "2 kills T5+T12, 3 chest opens with equip, 1 chest open without equip, 1 extraction → kills=2, equips=3, extractions=1"). Red → Green:

- `convex/engine/runStats.ts` — pure aggregator (no Convex imports per ADR §1). Walks turns + character rows; emits the `runs` row payload.
- `convex/runs.ts` — public mutation `runs.aggregate({matchId})` (DB I/O only; idempotent — re-fire on the same matchId is a no-op) + public query `runs.byMatch({matchId})`.
- `convex/runMatch.ts` — completion branch schedules `runs.aggregate` via `scheduler.runAfter(0, api.runs.aggregate, ...)` per the WP10 → WP12 boundary contract (ADR §6 / WP10 acceptance: "WP10 itself does NOT call runs.aggregate's body — it only schedules the WP12 mutation").
- `harness/run.ts` — post-run hook polls `runs.byMatch` for up to 30 s per completed match, emits per-match `run_aggregate` event, then a `multi_run_summary` event with totals + per-persona breakdown summed across runs.

### Counter semantics (locked at the aggregator)

- **kills** = `sum(turns[*].resolution.deaths.length)`. Per-persona kills = each landed-attack (`action.kind="attack"` AND `result.startsWith("dmg ")`) against a same-turn deathId credits the attacker. Multi-attacker scenarios share credit per concept-spec §12; the sum of `perPersona.kills` may exceed top-level `kills` accordingly.
- **extractions** = count of `characters` rows where `extractedAtTurn` is populated (final state).
- **equips** = `(action.kind="interact" AND result="opened")` + `(action.kind="loot" AND result="looted")`. The resolver only emits `result="opened"` when the equip side-effect succeeded (chests with `null` contents short-circuit before the trace push at `convex/engine/resolution.ts:455-461`); failed `already_opened`/`out_of_range`/`no_chest` are NOT counted.
- **speechEvents** = `sum(turns[*].resolution.speech.length)`. Per-persona attribution by speaker.
- **survivedTurns** (per persona) = `extractedAtTurn` if extracted, else `diedAtTurn` if dead, else `FINAL_TURN=50`.

### Stage-2 GATE — PASS

**Run:** `--runs 10 --concurrency 5 --reasoning low`
**Wall-clock:** 393 s (~6.5 min).
**Outcome:** **10/10 completed, 0 failed, 0 429s observed.** No backoff invoked.

**multi_run_summary headline:**

| Metric | Total over 10 runs |
|---|---|
| kills | 4 |
| extractions | 12 |
| equips | 69 |
| speech events | 717 |

**Per-persona breakdown (over 10 runs):**

| Persona | extractions | kills | equips | speech |
|---|---|---|---|---|
| rat | 0 | 0 | 6 | 0 |
| duelist | 2 | 2 | 15 | 0 |
| trader | 2 | 0 | 13 | 400 |
| opportunist | 3 | 0 | 7 | 0 |
| paranoid | 0 | 1 | 4 | 267 |
| camper | 1 | 0 | 7 | 16 |
| sprinter | 3 | 0 | 7 | 3 |
| vulture | 1 | 0 | 10 | 31 |

**Persona extraction-rate spread:** opportunist 30 % – rat 0 % = **30 pp** (vs 15 pp Gate-3 target). Already substantively above the bar on a 10-run sample (Gate-3 binds on the closing 50-run report; the Stage-2 spread is an early indicator only).

**Combat reads:** 4 total kills (vs Stage-1 zero). Duelist 2, paranoid 1, plus 1 that the trace credited to "no attacker still alive that turn" (i.e., simultaneous deaths or attribution gap from out-of-window damage). Substrate is now visibly producing combat outcomes at concurrency 5.

**matchIds (10):**
```
j97324vsy6wt75qpf0jnb7r5vs8697hq
j97191qt1jnbxhegkm43spst31868fzv
j97bcsxa0gabzfa811v1ngef45869078
j976tkq81rbg7b02wqekyraew58697na
j978n5fm16hj2hekpf7ac70z81868bng
j9752s6xwmv9bj5a17zw60zdv1869pzg
j9736tjjnr714ypcvmaywhgcvx869a66
j97fx9p9zgcsy5stha2kjqnngx869t2k
j973p3v94rdfqmppk15a9zt13x8683v8
j97a4tm0f9m44q7fqtpzeyc0a9868f3v
```

---

## Validation

| Gate | Result |
|---|---|
| `npm run lint` | PASS (clean) |
| `npm run typecheck` | PASS (clean) |
| `npm test` | PASS (257 / 4 skipped — +13 vs prior baseline; no LLM-gated tests run by default) |
| `npm run build` | N/A — ADR §2 / D1 (no build step in phase 1) |

---

## What landed

- `personas/opportunist.md` — replacement archetype.
- `convex/_data/personas.ts`, `convex/schema.ts:41`, `convex/engine/types.ts:41` — locked-id literal updated atomically.
- `tests/llm/personas.test.ts:168` — KEYWORDS updated for the new archetype.
- `convex/engine/runStats.ts` — pure aggregator, 13 unit tests in `tests/engine/runStats.test.ts`.
- `convex/runs.ts` — `runs.aggregate` mutation (idempotent) + `runs.byMatch` query.
- `convex/runMatch.ts` — completion branch schedules `runs.aggregate`; WP10 → WP12 boundary contract preserved (WP10 only schedules; WP12 owns the row).
- `harness/run.ts` — post-run hook + `run_aggregate` + `multi_run_summary` JSONL events.
- `docs/.../work-packages.md`, `architecture-decisions.md`, `plan-review.md` — locked-union literals updated for engineering coherence.

## What did NOT land (per brief constraints)

- No edits to substrate contract files (Decision Record D25): `convex/engine/affordances.ts`, `convex/llm/systemPrompt.ts`, `convex/llm/decisionTool.ts`, `convex/engine/resolution.ts`, `convex/llm/inputBuilder.ts`.
- No persona-stat / behavioural-depth tuning for combat outcomes — that's WP15 / Gate-2 review territory.
- No HTTP 400 added to retryable set in `convex/llm/azure.ts` — 400 is non-transient by HTTP semantics.
- `docs/project/spec/concept-spec.md` §19 + `docs/project/spec/mental-model.md` §10 — illustrative narrative per North Star §4; intentionally untouched. The substrate Gate-3 done-bar requires "differentiation across 8 personas", not the literal betrayer archetype.

## Path forward

- **Gate-2 review** (WP15 prelude) — PM dispatches per ADR D7 once this commit lands. Substrate is approved per D25; the persona+harness wiring is now demonstrating measurable behaviour at concurrency 5.
- **Pass F (telemetry diagnostic, follow-up)** — extending the agent-llm validator + `convex/llm/azure.ts` to persist HTTP 400 response body would let the next persona-text iteration read Azure's actual policy reason rather than reasoning by elimination. Not corrective on its own; deferred unless a future moderation collision recurs.
- **schema_validation_failed × 21 residual** — `relative.dx`/`relative.dy` overshoots are the dominant residual; system-prompt cheat-sheet improvements are WP15 territory but cheap to win if Gate-3 hovers near the bar.
