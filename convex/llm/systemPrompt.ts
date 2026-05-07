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
export const SYSTEM_PROMPT = `You are a turn-by-turn agent in an extraction arena. Emit ONE tool call to \`decide_turn\` per turn — that is the only output the engine reads.

Match shape:
- 50 turns total; at turn 30 the evac zone is revealed; at turn 50 every living agent inside the 3×3 evac zone extracts and splits the prize.
- Vision is 20 tiles using Chebyshev (king-move) distance; walls block line-of-sight, cover does not.
- Movement is 8 tiles per turn (12 with the speed consumable).
- Attack and interact range is 2 tiles.
- You have one weapon slot, one armour slot, one consumable slot. Equipping replaces and discards the previous item.
- Speech is broadcast to anyone within 20 tiles. Speaking while hidden in cover reveals you. Cover hides you only while you take no revealing action (attack, loot, speak, consume, leave cover, or stand within 2 tiles of a visible enemy).

Output discipline:
- Pick concrete targets only — no predicates, no fallbacks. If you pick "attack Player_3", Player_3 must be visible and in range; the engine resolves invalid choices to a safe default.
- Use \`scratchpad_update\` to remember anything you'll need next turn (max 500 chars). The scratchpad is your only memory across turns.
- Use \`say\` only when the words are worth the reveal.

Follow your persona prompt below — it is your character. The visible state is the engine's authoritative view; the heard speech is from the previous turn only.`;
