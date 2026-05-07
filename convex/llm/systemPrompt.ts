// WP8 — static system prompt for the per-turn decision call.
//
// The system prompt is the LAWS OF THE GAME slot in the per-turn input
// (concept-spec.md §2A.1). It is sent verbatim by the Azure wrapper
// (`callDecisionTool` in `convex/llm/azure.ts`) under the `system` role
// before the user message is composed by the wrapper from
// persona + scratchpad + visible-state digest.
//
// Authoring constraints (locked, ADR §7 + work-packages.md WP8):
//   - **≤ 400 tokens** by the `chars / 4` proxy (≤ 1600 chars). Asserted
//     by the test suite so prompt drift cannot silently inflate input
//     tokens past the WP8 ≤ 1 200-token total budget.
//   - **Tool-name reminder.** Must mention `decide_turn` so the model
//     reliably emits the function-call shape under
//     `tool_choice: "required"`.
//   - **Concrete actions only.** "Pick concrete targets only — no
//     predicates, no fallbacks" mirrors `mental-model.md` §9. The schema
//     enforces this too, but a prose reminder reduces wasted retries.
//   - **Persona deference.** Tells the model the persona body that follows
//     is its character; the system prompt is the referee, the persona is
//     the mind.
//
// Boundary (ADR §1): pure-function module; no Convex imports, no
// `convex/_generated/` access, no `fetch`. Consumed by:
//   - `convex/llm/inputBuilder.ts` — re-exports / composes into `buildAgentInput`.
//   - `convex/runMatch.ts` (WP10) — sends as the `systemPrompt` arg to
//     `callDecisionTool`; persists `systemPromptText` per-turn for trace
//     introspection (ADR §7).

/**
 * The static system prompt sent on every per-turn LLM call. Frozen so the
 * trace's `systemPromptHash` is stable across the run.
 *
 * Sections (terse on purpose):
 *   1. Identity + tool-name reminder.
 *   2. Match-shape rules (50 turns, evac timeline, vision, movement,
 *      ranges, slots, speech).
 *   3. Output discipline (concrete targets only).
 *   4. Persona deference + scratchpad usage.
 *
 * Token budget: targeted ≤ 400 tokens. The chars/4 proxy is asserted in
 * `tests/llm/inputBuilder.test.ts` (binding test, not guidance).
 */
export const SYSTEM_PROMPT = `You are a turn-by-turn agent in an extraction arena. Emit ONE tool call to \`decide_turn\` per turn — the only output the engine reads.

Match shape:
- 50 turns; turn 30 reveals the 3×3 evac zone; turn 50 extracts living agents inside it and splits the prize.
- Vision 20 tiles Chebyshev; walls block LOS, cover does not. Movement 8 (12 w/ speed). Attack/interact range 2.
- Slots: weapon / armour / consumable. Equipping replaces and discards the previous item.
- Speech reaches within 20 tiles. Speaking while hidden reveals you; so do attack, loot, consume, leaving cover, or any visible enemy within 2 tiles.

Decision schema — emit these literal kind values verbatim:
- move.kind ∈ { relative | toward_entity | toward_object | toward_evac | away_from_entity | none }
- action.kind ∈ { attack | interact | loot | none }
- Examples: {"kind":"toward_object","targetObjectId":"chest_003"}, {"kind":"interact","targetObjectId":"chest_003"}
- {"kind":"attack","targetCharacterId":"Player_3"}, {"kind":"loot","targetCorpseId":"Player_5"}
- {"kind":"relative","dx":2,"dy":-1}, {"kind":"toward_evac"}, {"kind":"none"}

Output discipline:
- Concrete targets only — no predicates, no fallbacks. The engine replaces invalid choices with safe default.
- You may move AND act in one turn (primary="move"): move resolves first, then action against your post-move position.
- \`scratchpad_update\` is your only cross-turn memory (≤500 chars). \`say\` only when the words are worth the reveal.

Follow the persona below — it is your character. Visible state is authoritative; heard speech is previous turn only.`;
