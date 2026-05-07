# Phase 01 — Work Packages

> Fifteen WPs (v1.2 deleted WP4) sequenced into Foundation → Stage 1 → Stage 2 → Stage 3, with explicit dependency arrows and gates from `README.md` §6–§7. Every WP has scope, acceptance, test strategy, and risks. Tests-first per `.agents/AGENTS.md` AOP for everything tagged "engine business logic." WP IDs are stable — WP4 is intentionally vacant so downstream IDs (WP5–WP16) keep their v1.1 numbers.

---

# Foundation — sequencing

WP1 lands first (it owns the bootstrap stub `convex/schema.ts` + `convex/_generated/` and absorbs Bootstrap Checklist B from `de-risking.md`); WP2 and WP3 then run in parallel where their write sets are disjoint. See `README.md` §7 for the diagram.

## WP1 — Tooling + Convex bootstrap (FOUNDATION-FIRST)

**Scope.**
- Initialise `tsconfig.json` (strict, ES2022, NodeNext modules).
- Add Vitest, ESLint (`@typescript-eslint`), `tsx`, `zod` (decision validation), Convex client, dotenv.
- Wire `package.json` scripts: `lint`, `typecheck`, `test`, `build`, `harness` (`tsx harness/run.ts`).
- Update `.agents/repo.md` `[Repository Guidelines]` block to point at the four scripts.
- **Create the bootstrap stub schema** at `convex/schema.ts`:
  ```ts
  import { defineSchema } from "convex/server";
  export default defineSchema({});
  ```
  This stub unblocks Convex codegen. WP2 replaces it with the real schema; WP3 must NOT touch this file before WP2 lands.
- Run `npx convex dev --once` to bootstrap `convex/_generated/`. Commit the generated files (per Convex convention) so tests can resolve them.
- Set Convex deployment env vars: `npx convex env set AZURE_API_KEY <val>`, `AZURE_URI <val>`, `AZURE_MODEL <val>`. Document in this WP's notes.
- Add `.gitignore` entries for `.env`, `node_modules/`, Vitest cache, Convex local cache.
- Add a tiny `internalAction` `convex/spike.ts` exporting `checkEnv()` that returns `process.env.AZURE_API_KEY?.slice(0, 4) ?? "MISSING"` (Bootstrap Checklist B step — see `de-risking.md` "Bootstrap Checklist B").

**Acceptance.** WP1 acceptance absorbs Bootstrap Checklist B from `de-risking.md` (operational steps for a fresh Convex deployment per `convex-backend.md` §4):
- `npm run lint && npm run typecheck && npm test && npm run build` all pass on a near-empty repo.
- `npx convex data` returns "no tables" cleanly (key still works).
- `convex/_generated/` exists on disk after first `npx convex dev --once` and typechecks.
- `convex/schema.ts` is the empty stub (`defineSchema({})`); empty-schema deploy succeeded on the live deployment.
- Convex deployment env vars listed by `npx convex env list` include `AZURE_API_KEY`, `AZURE_URI`, `AZURE_MODEL`.
- `npx convex run spike:checkEnv` returns the first 4 chars of `AZURE_API_KEY` (proves env var is plumbed into actions).
- WP1 notes record any deviations from `convex-backend.md` §4 (e.g., if Convex dev refuses an empty schema → workaround used).

**Test strategy.** A single sanity test (`tests/sanity.test.ts`) that asserts `1 + 1 === 2`. The point is to prove Vitest runs, not to test logic.

**Risks.**
- **Convex codegen depends on a `schema.ts` existing.** Mitigated above: stub `schema.ts` is part of WP1 scope.
- ESLint flat config (`eslint.config.mjs`) vs legacy `.eslintrc` — pick flat (it's the supported path).
- **Write-set conflict if WP2 starts in parallel.** Hard-sequence: WP2 must wait for WP1's PR to land (or merge to a shared branch) so the schema replacement doesn't race the bootstrap stub.

**Effort.** 0.5 day. **Sequenced first** — WP2 / WP3 wait for WP1.

---

## WP2 — Convex schema (depends on WP1; parallel with WP3)

**Scope.**
- Replace WP1's bootstrap stub `convex/schema.ts` with the full schema per `architecture-decisions.md` §6 (six tables: `matches`, `characters`, `turns`, `worldState`, `runs`, `reports`).
- Include the `PersonaId` literal kebab-case union (`"rat" | "duelist" | "trader" | "betrayer" | "paranoid" | "camper" | "sprinter" | "vulture"`) in the validators for `characters.personaId`, `turns.agentRecords[].personaId`, and `runs.perPersona` keys.
- Include the `agentRecords[].input` fuller-shape and `agentRecords[].llm` failure-aware shape per ADR §7.
- Indexes: `matches.by_status`, `turns.by_match_turn`, `characters.by_match`, `runs.by_match`, `reports.by_generatedAt`.
- Add a tiny mutation `matches.create` (no logic; just `insert`) and a query `matches.get(matchId)` to validate the write/read path against the deployment.

**Acceptance.**
- `npx convex dev --once` deploys clean.
- `npx convex run matches.create` creates a row; `npx convex run matches.get '{"id":"<id>"}'` returns it.
- `npx convex data matches` shows the inserted row.
- `validator` for `characters.personaId` rejects strings outside the locked 8.

**Test strategy.** Deferred — schema is exercised by every later WP. No isolated tests for "is the schema right" that aren't already integration tests.

**Risks.**
- **Schema drift mid-phase.** Lock the shape now; if a later WP needs a field, add via a migration mutation, don't redefine. Convex dev migrations are fast but production-shaped thinking matters.
- **Codegen race with WP3.** WP2 owns the only writes to `convex/schema.ts`; WP3 must avoid importing from `convex/_generated/` until WP2's deploy completes (use `tsc --noEmit` against pure-function modules, not Convex modules, until then).

**Effort.** 0.5 day.

---

## WP3 — Reference map (depends on WP1; parallel with WP2)

**Scope.**
- Author `maps/reference.json` per `architecture-decisions.md` §5.
- Implement `convex/engine/map.ts` with `expandMap(descriptor) → WorldState` and `loadReferenceMap()`. Pure-function module; no Convex imports.
- Hand-place: 20–40 wall rectangles (corridors, rooms), 8–12 cover clusters, 6–10 chest spawns with named loot tables, 8 agent spawn points distributed around the perimeter, evac centre near map middle.
- Loot tables: 3–4 named tables (`starter`, `weapons-light`, `weapons-heavy`, `consumables`) keyed in `convex/engine/loot.ts`. Loot tables resolve to the **locked v0 item stat tiers in ADR §6** (`WEAPONS`, `ARMOUR`, `CONSUMABLES`) — do not invent new tiers in WP3. Chest contents resolved deterministically per `rngSeed` at match start.
- Persona-to-spawn assignment: produce a deterministic seeded mapping from `rngSeed → permutation of [0..7] → assignment of the 8 personas to the 8 spawnIndex slots`. Stored on each `characters` row at match start (per ADR §6 `spawnIndex`).

**Acceptance.**
- Unit test: `expandMap(reference)` returns a `WorldState` with 8 spawns, all spawns are walkable floor (not in walls), all chests are reachable from at least one spawn (Chebyshev BFS check), evac is reachable from all spawns.
- Unit test: same `rngSeed` → identical chest contents AND identical persona-to-spawn mapping across two `expandMap` calls. Different seed → different contents AND different mapping (probabilistically).
- Unit test: every chest's resolved contents reference a name in the locked `WEAPONS` / `ARMOUR` / `CONSUMABLES` set (no invented items).

**Test strategy.** Pure-function unit tests. Map is data, expander is logic.

**Risks.**
- **Map produces all-zero stats** because chests are too far from spawns or cover doesn't connect to evac. Mitigation: WP15 tuning loop is empowered to edit `reference.json`. The risk here is *initial* tuning, not architecture.
- **BFS reachability check is overkill for v0.** Acceptable; a manual eyeball of the descriptor + a single reachable-evac test is enough.

**Effort.** 1.0 day (most of which is hand-placing landmarks well).

---

## WP4 — *(removed in v1.2)*

WP4 in v1.1 was the execution work package for Spike A (Azure tool-use round-trip). Spike A was retired in v1.2 because `azure-llm.md` §7 documents the contract; sanity assertions absorbed into WP6 integration-test acceptance. Downstream WP IDs (WP5–WP16) keep their v1.1 numbers — the gap is intentional.

---

# Stage 1 — Engine smoke gate (1 run, sequential)

**Gate exit:** A single match runs end-to-end (50 turns) without crashes; `(matchId, turn=23, characterId=Player_4)` returns a complete trace record.

## WP5 — Engine pure-functions

**Scope.** Implement and unit-test the pure side of the engine:
- `distance.ts` — Chebyshev between tiles.
- `vision.ts` — line-of-sight calculation; "what does agent X see at end-of-turn-N?" returns `VisibleEntities` (other agents, chests, corpses, cover, walls blocking LOS) and the heard-speech list.
- `hiding.ts` — given a character in cover and an action they took (attack / loot / speech / consumable use / leaving cover / proximity), compute hidden state per `concept-spec.md` §7.
- `lastKnown.ts` — **owned by WP5** per ADR §6. At the visibility-update phase, for each (observer, target) pair, if `target` was visible to `observer` at the end of turn T, write/update the `observer.lastKnown` entry for `target.characterId` with `{ pos, atTurn: T }`. Cap to **3 most-recent entries per observer**, oldest-first eviction. Pure function: `updateLastKnown(observer.lastKnown, observerVisibleEntities, currentTurn) → newLastKnown`.
- `validation.ts` — given a parsed `Decision` and a `MatchState`, return either `Valid` or `Invalid(reason)`. Engine never trusts LLM; invalid → safe-default. Validates against the locked discriminated-union shape from ADR §4.
- `affordances.ts` — given a `MatchState` and a `characterId`, return the local affordances list per `concept-spec.md` §22.

All inputs/outputs are plain objects; no Convex imports.

**Acceptance.**
- Vitest suite covers:
  - **§4 distance edge cases** (same tile, diagonal, mixed).
  - **§7 vision wall-blocking** (Bresenham line through wall returns blocked).
  - **§7 hide reveals** — separate test per reveal cause: attack, loot, speech, **consumable use** (heal AND speed), leaving cover, enemy proximity within 2 tiles. Each test asserts the resolution trace's `visibilityUpdates[].revealedBy` matches the cause.
  - **§7 last-known position tracking** — observer sees target at turn 5, target moves out of LOS by turn 6, observer's `lastKnown` for target reads `{ pos: turn-5-pos, atTurn: 5 }` after turn 6's visibility update. Cap test: after observing 4 distinct targets across consecutive turns, `lastKnown` holds 3 entries (the oldest evicted).
  - **Validation** rejects out-of-range moves, attacks on dead targets, equipping from out-of-range chests, malformed discriminator (e.g., `move.kind = "toward_entity"` with missing `targetCharacterId`); rejected decisions surface a reason that maps to a safe-default replacement.
  - **§22 affordances** includes "open chest" only when in range, "loot corpse" only when in range, "overwatch" always when alive, "attack X" only when X visible and in weapon range.
- ≥ 35 unit tests, ≥ 90 % branch coverage on these files.

**Test strategy.** Tests-first. Each rule from `concept-spec.md` §4 / §7 / §22 → at least one explicit test. Test names reference spec sections directly (e.g., `"§7 — speaker in cover is revealed"`).

**Risks.**
- **Vision LOS algorithm complexity.** Bresenham's line is sufficient for v0; don't reach for FOV-shadowcasting.
- **Heard-speech persistence horizon.** Locked in `README.md` §10.2 — speech said in turn N appears in turn N+1 input only (a one-turn window). The `lastKnown` cap is the analogous control for visual memory.

**Effort.** 1.5 days.

---

## WP6 — Decision contract tool + Azure wrapper

**Scope.**
- `convex/llm/decisionTool.ts` — the tool definition (single tool `decide_turn`) with the locked discriminated-union `move` and `action` schemas per `architecture-decisions.md` §4.
- `convex/llm/azure.ts` — the `callDecisionTool` wrapper. **Wrapper never throws** — every failure mode resolves to `SAFE_DEFAULT_DECISION` with a populated `failureReason` per ADR §4. Wrapper internalises a 60 s `AbortController` (configurable via `abortTimeoutMs`).
- Zod schema for `ParsedDecision` mirroring the tool definition exactly; `parseDecision(rawArgs: string) → Decision | { error }`. **Structural-equivalence test** between the JSON Schema and the Zod schema so they cannot drift.
- Safe-default constant per ADR §4 (`SAFE_DEFAULT_DECISION`).

**Acceptance.**
- Request-shape unit tests (mocked `fetch`): request body has `tool_choice: "required"`, `parallel_tool_calls: false`, `reasoning.effort: "low"` (default), `input` is `[system, user]`, `tools: [decisionTool]`, `additionalProperties: false` on the tool parameters, `store: false`.
- Failure-mode unit tests (one test per `FailureReason` from ADR §4):
  - `http_non_200` — fetch returns HTTP 500 → safe-default returned, `fellBackToSafeDefault: true`, `failureReason: "http_non_200"`, `httpStatus: 500`.
  - `status_not_completed` — response with `status !== "completed"` → safe-default + `failureReason`.
  - `incomplete_details` — response with `incomplete_details` populated → safe-default + `failureReason`.
  - `content_filter_blocked` — response with content-filter result item → safe-default + `failureReason`.
  - `no_function_call` — response with only `output_text` items → safe-default + `failureReason: "no_function_call"`.
  - `multiple_function_calls` — response with 2 `function_call` items despite `parallel_tool_calls: false` → first decision returned, `failureReason: "multiple_function_calls"` for telemetry but `fellBackToSafeDefault: false`.
  - `json_parse_failed` — `arguments` is `"not json"` → safe-default + `failureReason`, `rawArguments` preserved.
  - `schema_validation_failed` — valid JSON but missing required field, or `move.kind = "toward_entity"` with no `targetCharacterId`, or extra unknown property → safe-default + `failureReason`, `rawArguments` preserved.
  - `abort_timeout` — `fetch` mock that resolves after 70 s with `abortTimeoutMs: 100ms` → safe-default + `failureReason: "abort_timeout"`.
- Schema-equivalence test: the JSON Schema's `required` set, `properties` keys, and discriminated-union arms exactly match the Zod schema's parsed output type.
- Integration test (skipped by default, runnable with `VITEST_LLM=1`): real call against Azure with synthetic system + persona + scratchpad + visible-state digest, returns a parsed decision with non-null `callId` and `rawArguments`.
- **Absorbed Spike A sanity assertions** (integration-test layer; v1.2 — `de-risking.md` Spike A is retired and these are now WP6's responsibility):
  - `function_call` emitted (response `output[]` contains an item with `type === "function_call"`, named `decide_turn`); the wrapper does NOT fall back to safe-default on the live happy path. Asserted under `VITEST_LLM=1`.
  - `JSON.parse(rawArguments)` succeeds and the parsed object validates against the locked Zod schema (`additionalProperties: false`, required fields, discriminated-union arms).
  - **Latency observed.** Wrapper records `latencyMs` per call; integration test asserts `latencyMs <= 30_000` for `reasoning.effort: "low"` (a sanity bound — well above the WP15 tuning sweet spot, just enough to catch regressions / hangs short of the 60 s `AbortController`).
  - **Parallel-call defence.** Even though `parallel_tool_calls: false` is set on every request, assert the wrapper handles `multiple_function_calls` correctly: a `fetch` mock returning two `function_call` items in `output[]` produces a single `Decision` (the first), surfaces `failureReason: "multiple_function_calls"` for telemetry, and `fellBackToSafeDefault: false` (because the first decision is usable). This unit test guards against future model-side regressions silently producing parallel calls.

**Test strategy.** Mock `fetch` for unit (one mock per failure mode); live call (env-gated) for integration. The fetch mock is the source of truth for the request shape.

**Risks.**
- **Schema drift between tool definition and Zod parser.** Mitigation: structural-equivalence test (above).
- **Safe-default is too forgiving.** If a high fraction of LLM calls fall back, persona signal collapses. WP6 logs each fallback with `failureReason`; WP12 surfaces the rate in stats; if > 10 % over a 10-run window, escalate to WP15 (prompt/schema tuning) or to user (PM) if the failure mode points at the wrapper / schema rather than the prompts.

**Effort.** 1.0 day. Parallel with WP5.

---

## WP7 — Resolution phases

**Scope.** Implement the 8-phase resolver per `concept-spec.md` §23 in `convex/engine/resolution.ts`:
1. Collect decisions (input).
2. Apply consumables (heal +20 % HP, speed → movement = 12 this turn). Hidden agents using a consumable are revealed in this phase (per `concept-spec.md` §7).
3. Speech phase (broadcast within hearing range; reveal hidden speakers; emitted speech is logged this turn but is **only visible in turn N+1's input**, never in turn N's deciding-agent input — see WP8 + README §10.2).
4. Movement phase (substep simulation; entity-tracking per §10; collision per §24). Agents do **not** retarget to newly visible enemies mid-movement (per §10).
5. Action phase (attacks, interacts, loot/equip, overwatch firing). Speakers revealed in phase 3 are valid overwatch targets in phase 5.
6. Death + loot. Dead agents become corpses; corpse contents = the dead agent's full equipped slots (weapon / armour / consumable) per §13.
7. Visibility update (per WP5, including last-known-position update with cap-3 eviction).
8. Next turn state.

All inputs/outputs are plain objects: `(MatchStateBeforeTurn, Decision[]) → MatchStateAfterTurn + ResolutionTrace`. Damage formula uses the locked v0 stat tiers from ADR §6 (`max(MIN_DAMAGE_FLOOR, weapon.damage - armour.reduction)`).

**Acceptance.**
- Vitest suite covers each phase in isolation + the composed resolver:
  - **§9 turn economy:** consume + move + action + say + scratchpad-update in one turn; consume after primary commitment is rejected (validation in WP5 catches it before resolver).
  - **§10 movement:** entity-targeted movement tracks current target position substep-by-substep; movement stops at range 2; agents who become aware of a new enemy mid-movement do **not** retarget — they continue toward original target and react next turn.
  - **§11 overwatch:** overwatching agent attacks first valid in-range enemy; misses if none in range; **reveal-on-fire** (overwatching hidden agent reveals when overwatch fires); **overwatch that does not fire preserves hidden state** (no-fire → still hidden, assuming no other reveal cause).
  - **§12 combat (locked tiers from ADR §6):** axe (20) vs leather (3) → 17 damage; sword (15) vs plate (10) → 5 damage (floor binds); rusty_blade (10) vs plate (10) → 5 damage (floor binds); greatsword (25) vs cloth (0) → 25 damage. A and B simultaneously kill each other → both die; three attackers on one target → all damage applies; min-damage floor is 5.
  - **§13 gear single-slot replacement:** chest open + equip replaces the slot; **replaced gear is discarded** (no backpack); corpse-equip from range 2 also replaces and discards. Chest contents are consumed on equip (`opened: true`, `contents: null`).
  - **§13 corpse formation:** on death in phase 6, the corpse's `contents` mirror the dead agent's `equipped` slots; weapon AND armour AND consumable all transferred. Corpse is lootable in range 2 from the next turn.
  - **§15 evac:** turn-30 reveal flips `evac.revealedAtTurn`; turn-50 extraction marks living-in-zone as extracted; agents not in zone at end of turn 50 do not extract.
  - **§16 speech timing (cross-ref WP8 + README §10.2):** speech emitted in turn N's phase 3 appears in `resolution.speech[]` for turn N AND surfaces in turn N+1's `input.visibleStateDigest` "Heard" section for eligible recipients only; turn N+2's input does NOT include turn N's speech (one-turn window — locked).
  - **§7 hide reveal — consumable:** a hidden-in-cover agent that uses heal or speed reveals during phase 2; the resolution trace's `visibilityUpdates[].revealedBy` is `"consumable"`.
  - **Speech-revealed speaker → overwatch target:** Setup: agent A is hidden in cover with overwatch, agent B is hidden in cover and says "hi". Phase 3 reveals B. Phase 5: A's overwatch fires at B (valid target).
  - **§24 collisions (simultaneous identical tile):** two agents moving into the same tile from different origins both fail to enter and remain in their previous tiles. Order-independence: shuffle the input decision order across N permutations and assert the post-state is byte-identical.
- ≥ 50 tests covering at minimum every numbered scenario above.

**Test strategy.** Tests-first, table-driven where possible. Each test sets up a synthetic `MatchState`, runs `resolveTurn`, asserts the post-state and the resolution trace.

**Risks.**
- **Movement substep ordering.** `concept-spec.md` §10 says simultaneous; implementation must avoid order-dependent bugs (agent A "moves first" beating agent B). Use a substep loop where each agent advances one tile per substep, with collision detection per substep. Test for order-independence by shuffling input order and asserting identical outputs.
- **Speech-reveal-then-overwatch ordering.** Resolver must emit phase-3 visibility updates before phase 5 reads visible enemies for overwatch targeting.

**Effort.** 2.0 days. Depends on WP5.

---

## WP8 — Agent input builder

**Scope.** `convex/llm/inputBuilder.ts`:
- `buildVisibleStateDigest(matchState, characterId, heardLastTurn) → string` produces the tactical digest from `concept-spec.md` §7. Plain text, terse. Locked digest-section caps (token-budget control, in scope NOT a risk):
  - **Visible entities:** max 8, sorted by Chebyshev distance ascending, oldest-evicted if > 8.
  - **Heard messages:** max 5 (input is the previous turn's `resolution.speech[]` filtered to messages where `characterId ∈ heardBy`).
  - **Last-known positions:** max 3 (already capped at WP5's `lastKnown`; this is the rendering cap).
  - **Affordances:** list every valid affordance from WP5's `affordances.ts`; do not pre-cap (the affordance list is naturally bounded by what the engine emits).
- **Speech timing (locked, mirrors README §10.2):** speech said in turn N is emitted in turn N's resolution and **only appears in turn N+1's input** for eligible recipients. Turn N+2 input does NOT include turn N's speech. The deciding agent never sees same-turn speech — that would violate simultaneous resolution.

```text
Turn: 34/50  HP: 72  Equipped: axe / leather / heal
Visible:
- Player_3, dist 12 NE, HP~low, holding sword
- Chest, dist 6 W
- Corpse, dist 9 S, axe + leather
- Cover cluster, dist 4 NW
Heard (last turn):
- Player_5: "Truce at evac?"
Last-known:
- Player_2 last seen 3 tiles SE at turn 31
Evac:
- Revealed, dist 43 NW, est 6 turns
Affordances:
- attack Player_3 (out of range), open chest (out of range), loot corpse (out of range), overwatch
```

- `buildSystemPrompt(): string` — terse rules + objective + tool-name reminder. Target ≤ 400 tokens.
- `buildAgentInput(state, characterId, persona): { system, user }` composes everything for `callDecisionTool`.

**Acceptance.**
- Unit tests:
  - Digest correctly summarises a synthetic state; visibility filter excludes hidden enemies.
  - **Speech window:** for a synthetic match where Player_5 says "X" on turn 10, Player_3's turn-10 input has empty Heard; Player_3's turn-11 input contains `Player_5: "X"`; Player_3's turn-12 input does NOT contain `Player_5: "X"`. Test asserts the same input across all three turns, isolating the speech window behaviour.
  - **Hearing range filter:** speech is only included if the speaker was within 20 tiles of the listener at the moment of speech (per `concept-spec.md` §16).
  - Affordances list only includes valid options.
  - **Digest caps enforced:** state with 12 visible entities → digest lists 8 (closest); state with 7 heard messages → digest lists 5 (oldest evicted); state with 4 last-known → digest lists 3.
- **Token budget assertion** (binding test, not guideline): `system + persona + scratchpad + digest` for an 8-agent crowded mid-game state with all caps saturated stays under **≤ 1 200 input tokens** measured by `tiktoken` (or a documented proxy if the binding fails to install). CI fails if exceeded.

**Test strategy.** Tests-first. Especially: assert the digest is plain text (not ASCII grid) per `mental-model.md` §10 prompt-economy rule.

**Risks.**
- **Tokeniser availability.** If `tiktoken` is hostile to the Convex/Vitest runtime, fall back to a documented char-count-to-token proxy (e.g., `chars/4`) but keep the assertion test enforced.

**Effort.** 1.0 day. Depends on WP5, WP6.

---

## WP9 — Personas (8 brief prompts)

**Scope.** Eight short behavioural prompts in `personas/*.md`, one per persona. Brief = target ≤ 80 tokens each. The roster *content* (what each persona pushes the agent toward) is illustrative per `mental-model.md` §10 — engineer may rewrite each persona's prompt body. The roster *ids* are **locked to a kebab-case literal union** (per ADR §6) so the schema, loader, aggregator, and report all share one source of truth. Files MUST be exactly:

- `personas/rat.md`, `personas/duelist.md`, `personas/trader.md`, `personas/betrayer.md`, `personas/paranoid.md`, `personas/camper.md`, `personas/sprinter.md`, `personas/vulture.md`.

Prompts must:
- Be sufficiently differentiated to register on the simulation report (extraction-rate spread ≥ 15 pp at Gate 3).
- Encourage at least *some* speech in 50 % of runs (so trader / paranoid / betrayer carry the "say" signal).
- Encourage chest interaction (so vulture / camper / rat carry the "equip" signal).
- Vary aggression (so duelist / vulture / betrayer carry the "kill" signal).

`convex/llm/personas.ts` exports `loadPersonas(): Record<PersonaId, string>` returning a record whose keys are exactly the 8 literals above.

**Acceptance.**
- 8 files exist with exactly the locked filenames; each ≤ 80 tokens (`tiktoken` count test or documented char-count proxy).
- `loadPersonas()` returns a record with **exactly** the 8 literal ids — `Object.keys(loadPersonas()).sort()` deep-equals `["betrayer","camper","duelist","paranoid","rat","sprinter","trader","vulture"]`. No 9th key, no missing key, no `.md` extension on the keys.
- A "smoke read" test runs `callDecisionTool` against each persona on the same synthetic state (with `VITEST_LLM=1`, otherwise mocked) and asserts the 8 decisions are not byte-identical (cheap diversity smoke; signal-strength is measured at Gate 3).

**Test strategy.** Token-budget + literal-id assertion + non-identical-output. Real diversity is observed at Gate 2 / Gate 3 stats.

**Risks.**
- **Personas converge to "go to evac" once revealed at turn 30.** Mitigation: WP15 is the tuning loop, but expect to bias persona prompts toward different *paths* (camper waits, rat hides, vulture detours via corpses).

**Effort.** 0.5 day. Parallel with WP5–WP8. WP15 will likely revisit the *bodies* but never the *ids*.

---

## WP10 — Match action + trace persistence (Stage 1 gate artefact)

**Scope.**
- `convex/runMatch.ts`:
  - Action `startMatch(args)` creates the `match`, `worldState`, 8 `characters` with seeded persona-to-spawn assignment (per WP3 + ADR §6 `spawnIndex`), schedules `advanceTurn` for turn 1.
  - Action `advanceTurn(matchId)` — wrap the entire body in a single `try/catch`. On uncaught error: mark `match.status = "failed"`, write `match.failure = { turn, reason }`, do **NOT** schedule the next turn. The chain halts; the harness will observe `failed` status (WP11).
  - Inside the try body:
    1. Read current state.
    2. Build agent inputs for each living agent (WP8) — including persisting the full `input` object per ADR §6/§7 (`systemPromptHash`, `systemPromptText`, `personaPromptHash`, `personaPromptText`, `visibleStateDigest`, `scratchpadBefore`).
    3. `Promise.all` 8 calls to `callDecisionTool` (WP6). Each call is independent; the wrapper never throws (WP6 contract), so per-agent fallbacks are visible via `failureReason` rather than via try/catch.
    4. Validate decisions (WP5); fall back to safe-default on invalid (still per-agent, no throw).
    5. Resolve the turn (WP7).
    6. Write the `turns` row (full `agentRecords[]` per ADR §6 — including `personaId`, `input`, `decision`, `scratchpadAfter`, `llm` with `callId` / `rawArguments` / `failureReason?` / `fellBackToSafeDefault`).
    7. Update `characters` (incl. `lastKnown` from WP5) and `worldState`.
    8. **Termination:** if `turn < 50` and `>= 2` agents alive → `scheduler.runAfter(0, advanceTurn, ...)`. Else → mark `match.status = "completed"`, set `outcome.lastSurvivor` if exactly 1 agent alive, set `outcome.extracted` if turn 50 reached, then schedule `runs.aggregate(matchId)` (WP12) — **WP10 does NOT compute or write the `runs` row itself** (boundary owned by WP12).
- Convex query `turns.getAgentTurn(matchId, turn, characterId)` returning the full self-contained record per ADR §7 (input + decision + scratchpadAfter + llm).

**Acceptance.**
- Triggering `npx convex run runMatch.startMatch '{...}'` runs a match to terminal status in < 5 minutes wall-clock (or fails loudly with `match.status = "failed"` and `match.failure` populated).
- Match status transitions: `pending → running → completed | failed`.
- **Terminal condition reached cleanly — EITHER:**
  - 50 turn rows exist with `match.status = "completed"`, `outcome.extracted` reflects who is in evac at end-of-turn-50; OR
  - Fewer than 50 turn rows with `match.status = "completed"` and `outcome.lastSurvivor` set to the single living character. No further turns scheduled (verified by checking `ctx.scheduler` queue is empty for this matchId after completion).
- For Gate 1's specific 50-turn smoke: use a **mock-LLM mode** (env flag) that returns canned decisions keeping ≥ 2 agents alive for all 50 turns, so the smoke exercises both 50-row persistence AND the turn-50-extraction branch.
- Every row in `turns` has agent records for every agent that was alive at the **start** of that turn (dead agents are omitted from later rows).
- `getAgentTurn(matchId, 23, "Player_4")` returns the full self-contained record per ADR §7.
- No invalid states: every alive character is on a walkable tile; every dead character has `alive: false` and `diedAtTurn` set; total HP changes match damage events.
- WP10 itself does NOT call `runs.aggregate`'s body — it only schedules the WP12 mutation.

**Test strategy.**
- **Integration test with a deterministic mock LLM.** Replace `callDecisionTool` with a stub that returns canned decisions (via dependency injection or a test-only env flag). Three explicit scenarios:
  1. **Mock 50-turn smoke** — canned decisions keep ≥ 2 agents alive for all 50 turns; assert 50 turn rows + completion via the turn-50 branch.
  2. **Mock last-agent-standing** — canned decisions kill 7 agents by turn 12; assert match completes at turn 12 with `outcome.lastSurvivor` set, fewer than 50 turn rows, no scheduled follow-up turn.
  3. **Mock crash injection** — patch resolver to throw on turn 7; assert match status flips to `failed`, `failure: { turn: 7, reason }` is populated, no turn-8 action is scheduled.
- **Live single-run smoke.** Skipped by default; runnable with `VITEST_LLM=1 npm test -- single-match`. Asserts the match reaches a terminal status, asserts no crashes, asserts trace rows are well-formed.

**Risks.**
- **Convex action timeout (10 min).** Per-turn action chains via `runAfter(0, ...)` so each action is one turn — well within timeout. The 60 s `AbortController` per LLM call lives inside the wrapper (ADR §4 / WP6).
- **Concurrent writes** — phase 1 stage 1 has no concurrency, but the schema must already be safe (`matchId`-keyed reads/writes only). Verified at WP11.
- **`runs.aggregate` failing post-WP10 leaves match `completed` with no `runs` row.** Acceptable for stage 1 — the harness (WP11) reads `runs.byMatch` and surfaces the absence.

**Effort.** 1.5 days. Depends on WP5–WP9.

### 🔒 Gate 1 acceptance (engine smoke)
- WP10 acceptance bullets pass (terminal-condition flexibility, full self-contained trace, no `runs` write from WP10).
- A reviewing agent runs `getAgentTurn(matchId, 23, "Player_4")` and verifies the **full** self-contained record per ADR §7 — input (incl. system + persona prompt text), decision, scratchpadAfter, llm (incl. `callId`, `rawArguments`, `fellBackToSafeDefault`).
- Resolution-order spot-check: pick a turn with speech + movement + attack and verify the trace's phase ordering matches `concept-spec.md` §23. Verify speech said in turn N appears in turn N+1's `input.visibleStateDigest` Heard section (WP8 contract) and is absent from turn N+2's input.
- `npm run lint && npm run typecheck && npm test` green.

---

# Stage 2 — Iteration loop (10 runs, parallel)

**Gate exit:** Harness fans out 10 matches, all complete cleanly, aggregated stats produced, Azure rate-limit behaviour documented.

## WP11 — Harness CLI

**Scope.** `harness/run.ts`:
- Args:
  - `--runs N` (required at stage ≥ 2).
  - `--concurrency C` (required at stage ≥ 2; defaults documented in ADR §8).
  - `--report` (boolean, default true at stage 3).
  - `--reasoning low|medium|high` (default `low`). Plumbed all the way through to `callDecisionTool`'s `reasoningEffort` so WP15 tuning iterations can change reasoning effort without code edits. Validated against the literal union; `none` is **not** a valid CLI value (per `de-risking.md` "Reasoning policy" — binding for the entire phase).
- Convex client setup using `CONVEX_URL` + `CONVEX_DEPLOY_KEY`.
- Semaphore-bounded fan-out: trigger up to `C` matches; await each via `matches.status` polling (or Convex reactive query if simpler from Node).
- **Poll for terminal status `completed | failed`** (NOT just `completed`). On any match reaching `failed`:
  - Surface `match.failure = { turn, reason }` to stdout immediately (don't wait for batch end).
  - Exclude that match from the aggregation set passed to `reports.aggregate`.
  - Increment a failure counter.
- On all matches reaching terminal status: print a summary (counts of completed / failed) + per-run kill/extract/equip/speech counts + (if `--report`) call `reports.aggregate(completedMatchIds)`.
- **Fail-loud at exit:** if failure rate > threshold, exit non-zero with a diagnostic. Thresholds:
  - Stage 1 (1 run): any failure → exit 1.
  - Stage 2 (≤ 10 runs): > 1 failure (≥ 20 %) → exit 1.
  - Stage 3 (50 runs): ≥ 5 failures (≥ 10 %) → exit 1 — the closing report is invalid.
- Logs per-run start/finish timestamps + per-run kill/extract/equip/speech counts to stdout (machine-readable JSONL preferred so reviewing agents can grep).

**Acceptance.**
- `npm run harness -- --runs 1 --concurrency 1` runs Gate 1's single-match flow and exits 0 if completed, 1 if failed.
- `npm run harness -- --runs 2 --concurrency 2` runs two matches concurrently, both reach terminal status, distinct `matchId`s.
- Tests assert:
  - Matches with same `rngSeed` produce identical chest contents AND identical persona-to-spawn assignments (state isolation: per-match rng); matches with different `matchId` never share `worldState`/`characters` rows.
  - **Failed-status surfacing:** with WP10's "mock crash injection" scenario, a 2-run harness invocation where 1 match fails surfaces the failure to stdout, completes (does not hang), and exits 1 (≥ 20 % failure rate triggers stage-2 fail-loud).
  - **`--reasoning` plumbing:** `--reasoning medium` causes the `callDecisionTool` mock to receive `reasoningEffort: "medium"`; `--reasoning none` is rejected by the CLI parser with a non-zero exit.

**Test strategy.** Integration test with mock LLM, asserts state isolation, failed-status handling, and `--reasoning` plumbing. The state-isolation tests are critical; if they fail, stage 2 is unsafe.

**Risks.**
- **Polling overhead.** 10-run wait via 1-second polling is fine; if it gets noisy, switch to Convex reactive subscription. Don't optimise prematurely.
- **A match that never reaches terminal status.** Mitigated by the WP10 try/catch contract — every uncaught engine error inside `advanceTurn` flips status to `failed`. Wall-clock guard: harness applies a per-match wall-clock cap (10 min for stage 1, configurable) and treats elapsed-cap as failed.

**Effort.** 1.0 day.

---

## WP12 — Stats aggregation (per match) — owner of the `runs` row

**Scope.** `convex/runs.ts`:
- Mutation `runs.aggregate(matchId)` walks the `turns` ledger for a completed match and writes a `runs` row with kills, extractions, equips, speech events, per-persona breakdowns, average survival turn.
- **Boundary contract (cross-ref WP10):** `runs.aggregate` is **owned exclusively by WP12**. WP10's `advanceTurn` completion branch *schedules* `runs.aggregate(matchId)` but does NOT compute or write the `runs` row inline. This keeps Gate 1 acceptance (engine smoke) decoupled from per-match aggregation, and Gate 2 acceptance dependent on it.
- Failed matches (`match.status = "failed"`) do **not** get a `runs` row — the harness (WP11) excludes them from `reports.aggregate`.
- Query `runs.byMatch(matchId)` for the harness to read.

**Equip vs interact rule.** "Equip" is counted once per `equipped` slot transition (chest-equip OR corpse-loot-equip). Opening a chest without taking the contents is not an equip event. Looting a corpse without equipping is not an equip event. Document in source comment near the aggregator.

**Acceptance.**
- For a completed match, `runs.byMatch` returns a row with all 6 top-level counts populated.
- Per-persona breakdown sums equal top-level counts (consistency).
- Synthetic match with 2 kills (one in turn 5, one in turn 12), 3 chest opens with equip, 1 chest open without equip, 1 extraction → aggregator returns `kills=2, equips=3, extractions=1`.
- Failed match → `runs.aggregate` is not invoked (the WP10 completion branch only fires on `completed`); `runs.byMatch` returns null.

**Test strategy.** Unit tests on the pure aggregation function (separate from the Convex mutation).

**Risks.**
- **Equip vs interact distinction.** Locked above; tests assert.

**Effort.** 0.5 day. Parallel with WP11.

---

## WP13 — Spike: rate-limit behaviour ⚠️ DE-RISKING

**Scope.** See `de-risking.md` Spike C. Run `harness --runs 10 --concurrency 10` with the engine + 8 personas + real LLM. Measure:
- Total wall-clock.
- 95-percentile per-turn latency.
- 429 / RPM / TPM responses, if any.
- Total tokens consumed (input + output + reasoning).
- Whether reasoning at `low` is workable at 80 concurrent in-flight LLM calls (10 matches × 8 agents).

**Acceptance.**
- A markdown note (`de-risking.md` "Spike C — outcome") records all measurements.
- **Action policy (verbatim with Spike C and ADR §8 — do not paraphrase between files):**
  - 0 % 429s: stage-3 concurrency = 10. No backoff machinery. No re-spike needed.
  - 0–5 % 429s: add 3-retry exponential backoff (base 1 s, jittered) to `azure.ts`. Re-spike. After re-spike clean: stage-3 concurrency = 10.
  - 5–20 % 429s: add the same backoff AND lower concurrency (start at 7, then 5) until re-spike is clean. Stage-3 concurrency = whichever value ran clean.
  - > 20 % 429s: stage-3 concurrency = 5 with backoff. If still > 20 % at concurrency 5, escalate to user (PM) before running 50.
- Stage 3 concurrency value is locked and recorded in `de-risking.md` Spike C outcome block.

**Test strategy.** Spike, not a tested feature. Output goes into `de-risking.md`.

**Risks.**
- **Spike consumes meaningful tokens.** 10 runs × 8 agents × ~50 turns × ~1 500 input tokens/turn = ~6 M input tokens, plus output + reasoning. Budget-aware.

**Effort.** 0.5 day execution + variable tuning.

### 🔒 Gate 2 acceptance (iteration loop)
- WP11, WP12 acceptance bullets pass.
- WP13 spike outcome documented; concurrency knob set per the locked policy above.
- 10-run harness invocation reaches terminal status for all 10 matches (`completed | failed`) with no hangs and a failure rate below the stage-2 threshold (≤ 1 failure on 10 runs).
- `runs` rows written for all completed matches (not for failed ones); per-persona breakdowns differentiate the 8 personas at least in *some* dimension.

---

# Stage 3 — Closing report (50 runs, parallel)

**Gate exit:** Done-bar in `README.md` §2 met.

## WP14 — Report mutation

**Scope.** `convex/reports.ts`:
- Mutation `reports.aggregate(runIds)` reads N `runs` rows, computes the §10 metrics, writes a `reports` row, returns it.
- Sets `metBar: true` only if all 6 thresholds clear.
- Includes the per-persona extraction-rate map and the spread (`max − min`).

**Acceptance.**
- Synthetic test: feed it 50 fake `runs` rows with known counts → asserts each metric and `metBar` flag correctness.
- Edge case: 0 extractions, 0 kills → `metBar: false`, all metrics report 0 cleanly.

**Test strategy.** Pure-function unit tests on the aggregation logic; thin wrapper test on the mutation.

**Risks.**
- **Persona spread computed wrong** (e.g., counts vs rates). Test explicitly with one persona at 100 % extraction and one at 0 %.

**Effort.** 0.5 day.

---

## WP15 — Tuning loop ⚠️ BOUNDED

**Scope.** Iterative loop, NOT a single deliverable:
1. Run `harness --runs 10 --concurrency <stage-2-locked> --reasoning <current>`.
2. Read `reports.aggregate(...)` for those 10 runs.
3. If any metric is below its §10 threshold, identify which dimension is failing and tune **one** lever:
   - **Persona prompt** (most likely lever) — strengthen the behaviour the metric measures (more speech, more aggression, more chest interest). Persona *bodies* may be edited; persona *ids* (the 8 kebab-case literals from WP9) are locked and never change.
   - **Map descriptor** — chests too far from spawns, evac too central/peripheral, cover too sparse near evac.
   - **`reasoning.effort`** — bump to `medium` via the harness `--reasoning medium` flag if persona signal reads as noise. Never `none` (`de-risking.md` "Reasoning policy").
   - **System prompt** — only as last resort; system prompt must stay terse and the WP8 ≤ 1 200-token assertion must keep passing.
4. Re-run 10. Iterate.

**Bounded.** Stop at the moment a 50-run dry-run hits the §10 thresholds. Do NOT continue tuning past that. Phase-1 tuning is "make the substrate prove itself," not "make the meta interesting."

**Hard cap & escalation matrix (iteration 13+).** Hard cap is 12 tuning iterations of 10 runs each (= 120 runs). At iteration 13, classify the failure mode and escalate; do **not** continue tuning prompts:

| Symptom at iteration 12 | Diagnosis | Action |
|---|---|---|
| A deterministic engine unit test (WP5 / WP7) starts failing during iteration | Engine bug introduced by tuning side-effect (e.g., map descriptor edit broke reachability) | Stop tuning. Return to WP5 / WP7 — fix the bug first, then resume tuning from a clean engine. |
| All 8 personas converge on byte-identical decisions under the **mock LLM** smoke (WP9 acceptance) | Tooling / contract bug — the persona text isn't reaching the model, or the system prompt is overriding persona | Stop tuning. Return to WP6 / WP8 — diagnose the input pipeline, then resume. |
| Live LLM produces visibly differentiated decisions (per (run, agent, turn) traces look distinct), but the report still misses one or more §10 thresholds | Likely real persona-floor — either personas are inherently too similar, or §10 thresholds are too tight for this engine | **Escalate to user (PM)** before any further prompt tuning. Do not chase the bar past the cap. |

**Acceptance.**
- A 10-run iteration sample reads as "trending toward all 6 metrics passing." (Some of these — extraction rate especially — need 50 runs to read reliably; a 10-run trend is a proxy.)
- Tuning notes captured in this folder as `tuning-log.md`: each iteration's diff (which file, which line) + observed metric delta + the `--reasoning` value used.
- If the hard cap fires: `tuning-log.md` records which row of the escalation matrix triggered.

**Test strategy.** N/A (this is iteration, not new code). The tuning is itself measured by WP14's report.

**Risks.**
- **Tuning runs forever.** Mitigated by the hard cap above.
- **Tuning the map invalidates earlier reports.** Acceptable in stage 3 — only the closing 50-run report matters.

**Effort.** Variable; budget 1.0–2.0 days.

---

## WP16 — Closing 50-run report

**Scope.** Single execution:
- `npm run harness -- --runs 50 --concurrency <stage-3-locked> --report`.
- Verify `reports.aggregate` writes the row with `metBar: true`.
- If `metBar: false`, return to WP15.
- If `metBar: true`: phase 1 done. Capture report ID + a sample (run, agent, turn) trace query in `closing-notes.md`.

**Acceptance.**
- One `reports` row with `runCount: 50` and `metBar: true`.
- `npm run lint && npm run typecheck && npm test` green.
- Sample query: `npx convex run turns:getAgentTurn '{"matchId":"<m>","turn":23,"characterId":"<c>"}'` returns a complete record.

**Test strategy.** This is the gate, not a tested unit.

**Risks.**
- **Stochastic miss.** 50 runs may sit just below the bar by luck. Re-run is acceptable but document the variance; if 3 consecutive 50-run reports hover at the bar, persona tuning needs another pass.

**Effort.** 0.5 day.

### 🔒 Gate 3 acceptance (the done-bar)
- WP14, WP15, WP16 acceptance bullets pass.
- Done-bar metrics in `README.md` §2 all met on a single 50-run report row.
- `closing-notes.md` records: report ID, sample trace query, persona breakdown, spread.
- An independent reviewing agent reads the report, queries 3 random (run, agent, turn) traces, confirms introspection contract holds.

---

# Cross-cutting risks (not tied to a single WP)

1. **Brevity drift.** Easy to let prompts grow during tuning. Mitigation: token-budget assertions in WP8 are *tests*, not just guidelines. CI fails if budget exceeded.
2. **Engine bugs hiding inside LLM noise.** Mitigation: WP5/WP7 mock-LLM integration tests catch deterministic engine bugs without LLM; live runs catch only end-to-end issues.
3. **Schema migration mid-phase.** Mitigation: WP2 over-specifies the schema once; later WPs adopt rather than redefine.
4. **Convex deployment env vars stale.** Mitigation: WP1's last step lists current env; document re-set command in `de-risking.md`.
5. **Reasoning tokens exploding cost.** Mitigation: WP6 integration tests record per-call `latencyMs` and usage (input/output/reasoning tokens) at `low`; WP13 (Measurement C) measures aggregate behaviour at stage-2 concurrency; WP15 can drop reasoning to `low` (but **never** `none` — `de-risking.md` "Reasoning policy") if cost is biting.

---

## Changelog — v1.2

Diff vs v1.1 (bird's-eye nudge — verified guides are contracts, not unknowns):

- **WP4 — DELETED.** v1.1's WP4 was the Spike A execution work package. With Spike A retired in `de-risking.md`, WP4 disappears. WP IDs WP5–WP16 keep their v1.1 numbers (gap intentional).
- **Foundation header + WP1 + WP2 + WP3.** Foundation parallelism is now WP2 ∥ WP3 only after WP1 lands. WP1 acceptance absorbs Bootstrap Checklist B from `de-risking.md` (operational sequence per `convex-backend.md` §4); the steps were already present in v1.1 but framed as a Spike B fold — now framed as part of WP1's readiness checklist with no GREEN/YELLOW/RED bands. WP2 / WP3 headers updated to drop "WP4" from "parallel with" lists; WP2 codegen-race risk no longer mentions WP4.
- **WP6 acceptance — augmented.** Added the absorbed Spike A sanity assertions as integration-test bullets: function_call emitted on the live happy path, JSON.parse + Zod schema validation, latency observed (≤ 30 s sanity bound at `low`), and an explicit parallel-call defence test (multi-`function_call` mock → single `Decision`, `failureReason: "multiple_function_calls"`, `fellBackToSafeDefault: false`). These augment — do not replace — the v1.1 `FailureReason` coverage.
- **WP6 risks.** "WP4 re-spike" replaced with "escalate to user (PM)" — WP4 no longer exists, so the recourse for systemic safe-default fallout is WP15 (prompt/schema tuning) or escalation.
- **WP11 / WP15 / cross-cutting risk #5 — pointer updates.** Cross-references to "Spike A 'Reasoning policy'" updated to point at `de-risking.md` "Reasoning policy" (top-level section in v1.2 — same substance, no longer scoped to a removed spike). Cross-cutting risk #5's "WP4 spike measures it" replaced with "WP6 integration tests record per-call latencyMs and usage at low".

## Changelog — v1.1

Diff vs v1.0, by WP:

- **Foundation sequencing (header + WP1 + WP2 + WP3 + WP4).** Hard-sequenced WP1 first (it owns the bootstrap stub `convex/schema.ts` + `_generated/` and the env-var Spike B fold). WP2 / WP3 / WP4 run in parallel after WP1 lands, with disjoint write sets and a no-codegen-import rule for WP3 / WP4 until WP2 deploys. WP1 also adds `convex/spike.ts checkEnv` (Spike B fold).
- **WP3.** Loot tables now resolve to the locked v0 stat tiers in ADR §6 (no invented items). Persona-to-spawn assignment is seeded by `rngSeed` and persisted on `characters.spawnIndex`.
- **WP4.** Aligned Spike A to the v1.1 N ≥ 20 / GREEN-YELLOW-RED bands. JSON-mode is no longer a fallback; RED **blocks WP6**. Calibration call at `reasoning.effort: "none"` is single-shot and never used to set phase-1 metrics.
- **WP5.** Owner of `lastKnown.ts` (per-character last-known map; cap-3 oldest-first eviction; updated at the visibility-update phase). Added explicit acceptance for hide-reveal on consumable use, last-known cap test, validation against the discriminated-union shape from ADR §4. Lifted unit-test minimum from 30 to 35.
- **WP6.** Acceptance now enumerates one unit test per `FailureReason` from ADR §4 (HTTP non-200, status-not-completed, incomplete_details, content-filter, no/multiple function_calls, JSON parse failure, schema validation failure, abort timeout). Added schema-equivalence test (JSON Schema ↔ Zod). 60 s `AbortController` is now wrapper-internal (was WP10 risk text). Wrapper never throws.
- **WP7.** Acceptance now enumerates: §24 simultaneous-tile collision (with order-independence shuffle test), consumable-revealing-hidden-agent (heal AND speed), gear single-slot replacement (chest AND corpse), chest-contents-consumed-on-equip, corpse formation on death (weapon + armour + consumable), corpse loot in range 2, phase-3 speech reveal making speaker a valid phase-5 overwatch target, overwatch-no-fire preserves hidden, no mid-movement retargeting, locked v0 damage math (axe vs leather = 17, sword vs plate = 5 floor binds, etc.). Speech timing locked: emitted in turn N, surfaces in turn N+1 input only. Lifted unit-test minimum from 40 to 50.
- **WP8.** Digest-section caps promoted from "risks" to "scope" (8 visible / 5 heard / 3 last-known). Speech timing locked in scope (one-turn window, turn N → turn N+1 only) with explicit unit test for the three-turn sequence (T-empty, T+1-present, T+2-empty). Token-budget assertion is binding (not guidance); fallback proxy documented.
- **WP9.** Persona ids locked to the kebab-case literal union from ADR §6. Filenames are hard-fixed (`rat.md` … `vulture.md`). `loadPersonas()` test asserts `Object.keys(...).sort()` deep-equals the 8 literals. WP15 may edit persona *bodies* but never *ids*.
- **WP10.** Termination reconciled: terminal status is `completed | failed`; "completed" satisfies EITHER 50 turn rows OR fewer rows with `outcome.lastSurvivor` set + no further scheduled turns. Mock-LLM scenarios for the smoke + last-agent-standing + crash injection (3 scenarios). Added try/catch around `advanceTurn` body that flips status to `failed` on uncaught error, populates `failure: { turn, reason }`, halts the chain. Removed `runs` summary write (ownership moves to WP12); WP10 only schedules `runs.aggregate`. Persists the new fuller `input` shape (system + persona prompt text + hashes) and the new `llm` failure-aware shape per ADR §6/§7.
- **WP11.** Polls `completed | failed` (was: only `completed`). On `failed`: stdout surfacing, exclude from aggregation, fail-loud at exit if rate > stage threshold (any/stage 1, > 1/stage 2, ≥ 5/stage 3). Added `--reasoning low|medium|high` flag (default `low`); CLI rejects `none`. Per-match wall-clock guard prevents indefinite hangs.
- **WP12.** Made owner of `runs.aggregate` exclusively (boundary contract spelled out). Failed matches don't get a `runs` row. Equip-vs-interact rule documented.
- **WP13.** Rate-limit threshold policy locked verbatim with Spike C (one source-of-truth). Gate 2 acceptance updated to "terminal status reached" with stage-2 failure threshold.
- **WP15.** Added escalation matrix for iteration 13+ (3 rows: deterministic engine test failing → engine bug; mock-LLM byte-identical decisions → tooling/contract bug; live LLM differentiated but report misses → escalate to user). Reasoning tuning bound to `--reasoning low|medium|high` (never `none`).
- **Cross-cutting risk #5.** Tightened wording — `none` is never an acceptable phase-1 reasoning value.
