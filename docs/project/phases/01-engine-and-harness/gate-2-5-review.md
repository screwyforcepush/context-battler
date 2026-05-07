# Gate-2.5 Substrate-Fitness Review

Review date: 2026-05-07  
Scope: Gate-2.5 review of commit `63d6206` surgical correctness fixes, commit `08cef5c` WP15 tuning attempts, and `wp15-tuning-findings.md` structural-lever recommendation. This is not a Gate-3 completion review; the 50-run report has not been produced.

## Review Summary

- Overall assessment: **Concern / APPROVE-WITH-CHANGES**.
- Batch 1 metric-correctness fixes are sound enough to trust the next probe's kill/equip counters.
- WP15 findings are evidence-driven and correctly identify a mechanism-level bottleneck: range-2 combat plus 100 HP plus separated spawns yields too few lethal engagements.
- The structural levers are spec-respectful tunables under `mental-model.md` §3 and §10, but the HP recommendation is not a one-line implementation change in the current codebase.

Recommended path: **Path A** — dispatch one bounded structural-tuning implement job, then a 10-run internal probe. If the probe reaches `>=6/10` lethal runs, dispatch Stage-3 50-run report and WP13 Measurement-C at `--concurrency 10`. If the probe stays red, stop and escalate to the user before spending the 50-run pass.

## Artifact Verdicts

| Artifact | Verdict | Rationale |
|---|---|---|
| `(1)` Batch 1 surgical correctness fixes at `63d6206` | **APPROVE-WITH-CHANGES** | Equip and overwatch metric paths are correct. Harness exits nonzero on missing `runs` rows. HTTP body capture is useful, but its sanitizer does not fully prove the "no env values / PII" claim. |
| `(2)` WP15 tuning attempts at `08cef5c` | **APPROVE** | Three persona-text cycles plus a medium-reasoning probe were enough to show diminishing returns. The strongest committed state is Cycle 2: procedural duelist/vulture plus radius-28 spawns. |
| `(3)` WP15 findings and structural levers | **APPROVE-WITH-CHANGES** | HP=50, radius-20 spawns, and evac-side chests are in-scope tunables. Implementation scope must update both initial HP and max HP, and should avoid further persona-text churn in this pass. |

## Batch 1 Verification

Equip ground truth: **pass**. `resolution.ts` queues chest interactions at lines 455-463, but emits `result: "opened"` only inside the application loop after `!chest.opened && chest.contents !== null` at lines 530-548. `runStats.ts` counts chest equips only on `kind === "interact" && result === "opened"` at lines 213-224. Tests cover dud chests and same-turn collisions in `tests/engine/runStats.test.ts`.

Overwatch kill attribution: **pass**. `runStats.ts` lines 190-209 require all three conditions: `kind` is `attack` or `overwatch`, `result` starts with `"dmg "`, and `target` is in same-turn `deaths`. This matches simultaneous damage semantics: top-level kills count deaths, while per-persona kill credit can exceed top-level kills for dogpiles.

HTTP body capture: **partial pass**. `azure.ts` captures the non-OK response body only in the `!response.ok` branch at lines 475-488, threads it through `safeDefaultResult`, and schema persistence is optional at `schema.ts` lines 251-259. It is absent on happy path and non-HTTP failure modes. The body is truncated to 2048 chars at `azure.ts` lines 272-276.

Harness missing-row exit: **pass**. `harness/run.ts` collects null `runs.byMatch` poll results at lines 580-612, emits `harness_error` at lines 662-668, and returns exit code 1 when any run failed or any completed match lacks a `runs` row at lines 671-679. Tests cover missing-row, failed-match, happy, and mixed cases in `tests/harness/run.test.ts`.

No aggregator-counter regression found. The current contract preserves top-level `kills`, `extractions`, `equips`, and `speechEvents` semantics and improves per-persona overwatch attribution.

## WP15 Ratification

The findings doc is rigorous enough for the next decision. It distinguishes mechanisms from vibes: no-engagement matches, unarmed-only damage-floor matches, and armed-combat matches with kills.

Convex spot-checks:

- Stage-2 match `j97324vsy6wt75qpf0jnb7r5vs8697hq`: 24 duelist decision-attacks and 17 camper decision-attacks; 39 attack hits and 3 overwatch hits all at `dmg 5`; run row has `kills: 0`. Equipped-state trace shows duelist attacked 24 times with weapon `—`.
- Stage-2 match `j976tkq81rbg7b02wqekyraew58697na`: duelist made 11 decision-attacks with rusty blade; 10 attack hits at `dmg 10`, 1 overwatch hit at `dmg 5`; run row has `kills: 1`, credited to duelist.
- Cycle-2 match `j979v7wts2crwkqzmg317a3xq9868gmt`: duelist made 13 sword attacks at `dmg 15`; run row has `kills: 2`, both credited to duelist.

`combat.ts` lines 50-64 correctly implements `max(MIN_DAMAGE_FLOOR, weapon.damage - armour.reduction)`. The lethality problem is not an engine bug.

Persona text appears exhausted as the primary lever for this phase. The duelist now works when geometry and weapon acquisition permit it. Paranoid/camper/vulture issues are positional: they wait for targets to cross a range-2 window that the map rarely produces. More aggression text without geometry or HP changes already regressed in Cycle 3.

## Structural Levers Spec-Check

| Lever | Spec-respectfulness | Test impact | Projected EV | Review ruling |
|---|---|---|---|---|
| HP `100 -> 50` | **Pass.** `concept-spec.md` §12 defines deterministic damage and a minimum floor, not max HP. `mental-model.md` §10 explicitly allows bounded prompt and value tuning to clear the report signal. | Combat tests assert damage math, not global HP. Integration fixtures and comments that assume `100` need review. Current code has separate initial HP and max HP sources. | **High.** Sword-vs-unarmoured drops from 7 hits to 4; rusty blade from 10 to 5; unarmed floor from 20 to 10. | Apply, but as a shared source-of-truth change, not only `runMatch.ts:73`. |
| Spawn radius `28 -> 20` | **Pass.** `concept-spec.md` §6 requires a 100x100 arena with terrain; spawn coordinates are map tunables. | Map tests assert 8 walkable spawns and reachability, not exact coordinates. | **High.** Moves adjacent spawn pairs into immediate or near-immediate vision, compounding the duelist's working trigger. | Apply. |
| 2-3 evac-side chests | **Pass.** `concept-spec.md` §13-§14 define loot mechanics and item categories, not chest count/layout. `§15` wants evac to create convergence pressure. | Map/loot tests should pass if chests remain reachable and use valid loot tables. | **Medium-high.** More agents arm during the turn-30-to-50 convergence window; a cover-adjacent central chest also fixes the camper chest-then-return anti-pattern structurally. | Apply 3 chests, append to preserve existing chest IDs. |

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| High | Tuning implementation scope | HP is currently not a single-line knob. `runMatch.ts` sets `maxHp` from `MAX_HP`, but `matches.start` seeds `characters.hp` independently as `100`. Changing only `runMatch.ts:73` would create `hp=100, maxHp=50`, muddy prompts and fail to materially change time-to-kill. | `convex/runMatch.ts:73`, `convex/runMatch.ts:190-191`, `convex/matches.ts:173-175`, `convex/matches.ts:255` | Add one shared exported constant, e.g. `CHARACTER_MAX_HP = 50`, and use it in both `matches.start` initial `hp` and `runMatch.buildMatchState` `maxHp`. Update comments/tests that call 100 an invariant. |
| Medium | Trace hygiene | `httpBodyExcerpt` sanitizer covers labelled API-key and bearer-token shapes, but does not guarantee removal of arbitrary env values or PII if Azure ever echoes prompt text or request metadata. The assignment asked to verify "no API keys / env values / PII"; current code proves only token-pattern scrubbing plus truncation. | `convex/llm/azure.ts:223-257`, `tests/llm/azure.test.ts` Pass F tests | Before Stage-3, extend tests to cover the exact configured `azureApiKey` value appearing unlabeled, and consider conservative email/phone redaction if retaining raw HTTP bodies. Keep the 2KB cap. |
| Low | Documentation accuracy | WP15 findings say HP is a single-line change in `runMatch.ts`; current code requires at least two runtime touchpoints. The existing untracked draft also suggested `convext/runMatch.ts`. | `wp15-tuning-findings.md:195`, `convex/matches.ts:255` | Treat this review as the corrected scope. If implementation updates code, update nearby comments and any phase notes that call HP=100 an invariant. |
| Low | Observability nuance | Dud chest and same-turn collision losers no longer emit a non-success trace from the application loop. This is correct for equip metrics, but it means failed same-turn equip attempts are less visible in `resolution.actions`. | `convex/engine/resolution.ts:530-548` | Do not block Stage-3 on this. If future diagnostics need it, emit explicit `no_loot` / `already_opened` from the application loop without counting them as equips. |

## Spec / Guide Deviations

- No blocking spec deviation found in the Batch 1 metric paths.
- `httpBodyExcerpt` currently falls short of the review assignment's strongest sanitation wording. It satisfies ADR §7's "sanitised+truncated" trace-shape intent only for known credential-token patterns, not all env/PII possibilities.
- HP=50 is not a spec deviation. `concept-spec.md` §12 specifies damage formula and minimum floor only; max HP is absent. The value change stays inside the "prompt and value tuning is in scope" clause in `mental-model.md` §10.
- Spawn radius and evac-side chests are not spec deviations. They tune the hand-authored reference map while preserving `concept-spec.md` §6 map semantics and §15 evac convergence.

## Decision Notes

Path recommendation: **Path A**.

Rationale: The current kill-rate signal is too weak for Stage-3 spend, but the next levers are still bounded tunables, not scope expansion. Path B is premature until one HP/geometry/chest cycle has been tried.

Next implement job scope:

1. `convex/engine/types.ts`: add a shared exported HP constant near `MIN_DAMAGE_FLOOR`, e.g. `export const CHARACTER_MAX_HP = 50;`.
2. `convex/matches.ts`: import `CHARACTER_MAX_HP`; replace `hp: 100` at line 255 with the shared constant; update the line 173 comment so HP is no longer documented as hard-coded 100.
3. `convex/runMatch.ts`: replace local `MAX_HP = 100` at line 73 with the shared constant or import alias; update the line 71-72 comment so HP is documented as a phase-1 tuning value, not a spec invariant.
4. `convex/llm/inputBuilder.ts`: update the comment at line 286 from `X/100 HP` to `X/max HP`; code already renders `${observer.hp}/${observer.maxHp}`.
5. `tests`: add or adjust tests so a new-match character starts with `hp === maxHp === CHARACTER_MAX_HP`; keep combat formula tests unchanged because weapon damage and floor are locked.
6. `maps/reference.json`: append three central chests after line 55 so existing chest IDs remain stable: suggested candidates are `(47,46)` with `weapons-light`, `(49,52)` with `weapons-light`, and `(53,54)` with `weapons-heavy`. Verify walkability/reachability.
7. `maps/reference.json`: replace current spawns at lines 57-65 with a radius-20 ring around evac: `(28,28)`, `(48,28)`, `(68,28)`, `(68,48)`, `(68,68)`, `(48,68)`, `(28,68)`, `(28,48)`.
8. Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`.
9. Run one 10-run probe at `--concurrency 5 --reasoning low`. Green threshold remains `>=6/10` lethal runs, `0` crashes, fallback `<=10%`, and no missing `runs` rows.
10. On green only: run Stage-3 50-run closing report with WP13 Measurement-C at `--concurrency 10`. On red: stop and escalate to the user with the probe evidence.

Defer in the next job:

- Additional persona-text aggression edits. Cycle 3 already showed this can regress.
- Combat formula or weapon-tier edits. `concept-spec.md` §12 and ADR §6 make those load-bearing; HP is the safer value knob.
- Any UI/report viewer work. Phase 1 observability remains Convex + JSON traces for agents.

## Independent Pass Consolidation

- Pass A, metric integrity: approved equip and overwatch counter changes; flagged no counter regression.
- Pass B, tuning diagnosis: ratified Convex trace evidence and combat-engine correctness; confirmed persona-text diminishing returns.
- Pass C, spec and operations: approved HP/map/chest tunables as spec-respectful; expanded Path A implementation scope to include shared HP source-of-truth and HTTP excerpt sanitation hardening.

## Reviewer Spot-Check Addendum

This review was finalised after one reviewer re-walked the diagnostic helpers against committed matchIds. The spot-check reproduces the findings doc claims verbatim and adds two carry-over recommendations.

### Spot-check evidence (independent reproduction)

`npx tsx harness/inspect-attacks.ts j979v7wts2crwkqzmg317a3xq9868gmt` (Cycle-2 best lethal):
  - decision-attacks: duelist=13, every other persona=0;
  - resolution: 13× `dmg 15` (sword), all attacks landed; 4× overwatch hits at `dmg 5` (unarmed cover-campers);
  - confirms doc claim "duelist closed with sword (dmg 15), made 13 attacks, all 13 landed".

`npx tsx harness/inspect-attacks.ts j97evk4nk8qxs4m359mt9my1cn869k42` (zero-engagement Cycle-2):
  - 0 decision-attacks across all 50 turns; 110 overwatch decisions across 6 personas;
  - Equipped survey: duelist 0/50; sprinter 49/50 sword (never attacked); vulture 18/50 greatsword (never attacked);
  - Confirms the "5/10 zero-engagement" mode is real and the bottleneck is geometric, not deliberative.

### Persona-text carry-overs to bundle with Path A

The findings doc retires persona-text generally, but two narrow edits address the two personas (camper, paranoid) that ran 0 kills across all three cycles. They are *complementary* to the structural levers, not a replacement; their value is contingent on HP=50 making the 5-dmg overwatch path occasionally lethal.

  - **Camper.** Sit in cover with whatever weapon spawned (incl. fists, MIN_DAMAGE_FLOOR=5); overwatch fires. Don't gate on "armed." At HP=50, 10× 5-dmg overwatch hits = a kill. Edit `personas/camper.md` and `convex/_data/personas.ts:29` step (2): replace `armed — sit still and overwatch...` with `sit still and overwatch — any enemy at range 2 is shot on sight, even with fists.`
  - **Paranoid.** From turn 30 onward, occupy evac-corner cover and overwatch the approach. Targets converge by spec (every living agent must reach evac to extract). Edit `personas/paranoid.md` and `convex/_data/personas.ts:28`: append `Once evac is revealed, occupy a cover tile at the evac corner and overwatch every approach. Targets must come to you.`

Neither was tried in Cycles 1-3. Token-budget verified at <80 tokens.

### Defensive cross-checks (non-blocking)

  - **Combat-test resilience under HP=50.** `tests/engine/combat.test.ts:80-117` asserts specific damage values from concept-spec §14 weapon tiers (axe vs leather=17, sword vs plate=5 floor, etc.). These are independent of HP and remain green. Test-fixture defaults (`hp: opts.hp ?? 100`) are local fixtures, not MAX_HP assertions; they continue to test combat with explicit HP values.
  - **Schema HP unconstrained.** `convex/schema.ts:471` is `hp: v.number()` — no value range. Schema accepts the new value cleanly; no migration needed.
  - **Loot-table audit footnote.** If any seeded chest expander returns null content, the dud-chest interactions now correctly emit no equip event (verified at `tests/engine/runStats.test.ts:499-543`). Worth a glance at the loot-table expander if Stage-3 numbers don't move as predicted; not blocking for the next implement.

### Final consolidation

All three passes converge on Path A. The implement scope listed in §"Decision Notes" is the binding scope; the camper + paranoid persona edits above are bundled additions. The `--reasoning low` setting is retained per WP15 medium-probe retirement; reasoning bumps are off the table for the kill-rate gate.
