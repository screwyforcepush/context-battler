// WP-C.2 — system prompt rewrite (phase-3 ADR §7).
//
// The system prompt is the LAWS-OF-THE-GAME slot in the per-turn input.
// Phase-3 promotes it from a static blurb to a SCHEMA TEACHER: the prompt
// teaches the digest's typed-id glossary, the action grammar (move arms,
// action arms, overwatch with `overwatch_stance`), the match-shape urgency
// framing, and output discipline. The persona body that follows is the
// CHARACTER; the system prompt is the REFEREE.
//
// Per North Star §1: per-turn input is one rolled context (system + persona
// + scratchpad + digest). The system prompt teaches the digest's vocabulary;
// the digest carries no `Affordances:` block (that band-aid for the prompt
// not teaching the schema is gone).
//
// Branch A (WP-A.1 probe RESOLVED — de-risking.md D-P3-1): Azure DOES
// expose reasoning items in `output[]`. Section 5b (the Branch-B rationale
// ask) is OMITTED to save tokens.
//
// Authoring constraints (locked, ADR §7):
//   - **≤ 500 tokens** by the chars/4 proxy (≤ 2000 chars). Asserted by
//     `tests/llm/systemPrompt.test.ts`.
//   - **Tool-name reminder** — must mention `decide_turn`.
//   - **Typed-id glossary** — `Player_N`, `Chest_NNN`, `Corpse_PlayerN`,
//     `Cover_X_Y`, `Wall_X_Y`, `Evac`. The digest renders these literally;
//     the prompt teaches what they mean.
//   - **Action grammar** — schema literals presented as a *consequence* of
//     teaching the move/action/overwatch options (not a separate cheat
//     sheet).
//   - **Urgency framing** — "outside evac at turn 50, you're incinerated"
//     is the load-bearing late-game driver per ADR §7.
//   - **Persona deference** — the persona body is the character.
//
// Boundary (ADR §1): pure-function module; no Convex imports, no
// `convex/_generated/` access, no `fetch`. Consumed by:
//   - `convex/llm/inputBuilder.ts` — re-exports / composes into
//     `buildAgentInput`.
//   - `convex/runMatch.ts` — sends as the `systemPrompt` arg to
//     `callDecisionTool`; persists `systemPromptText` per-turn for trace
//     introspection.

/**
 * The static system prompt sent on every per-turn LLM call. Frozen so the
 * trace's `systemPromptHash` is stable across the run.
 *
 * Section ordering (phase-3 ADR §7):
 *   1. Identity + tool-name reminder.
 *   2. How to read Visible — typed-id glossary, dist + 8-octant bearing,
 *      per-character observation brackets.
 *   3. How to act on Visible — move grammar, action grammar, overwatch
 *      with `overwatch_stance`.
 *   4. Match shape + urgency framing — 50 turns; turn 30 reveals evac;
 *      turn 50 extracts inside the 3×3 zone, incinerates outside.
 *   5. Output discipline — concrete targets only; safe default replaces
 *      invalid choices.
 *   6. Persona deference.
 *
 * Branch A: NO Section 5b rationale ask.
 *
 * Token budget: targeted ≤ 500 tokens (asserted in
 * `tests/llm/systemPrompt.test.ts`).
 */
export const SYSTEM_PROMPT = `You are an extraction-arena agent. Each turn, emit ONE tool call to \`decide_turn\`.

How to read Visible:
- Typed ids: Player_N (living agents), Chest_NNN (chests), Corpse_PlayerN (corpses), Cover_X_Y (cover), Wall_X_Y (terrain you cannot move through), Evac (3×3 extraction zone, after reveal).
- Each bullet shows \`dist N <bearing>\` with an 8-octant compass (N/NE/E/SE/S/SW/W/NW).
- Brackets carry per-character observations: [HP~low|mid|high, holding <weapon>, attacked Player_X, said "..."]. Chests show [opened]; empty corpses show [drained].

How to act on Visible:
- move arms: \`relative dx,dy\` (integers in [-12,12]); \`toward_entity Player_N\`; \`away_from_entity Player_N\`; \`toward_object <Chest_NNN|Corpse_PlayerN>\`; \`toward_evac\`; \`none\`.
- action arms: \`loot <Visible.id>\` (works for chests AND corpses — copy id verbatim), \`attack Player_N\`, \`none\`.
- Overwatch is a primary value, not an action — set \`primary:"overwatch"\` and \`overwatch_stance\` to "offensive" (fire on first valid in-range enemy after move) or "defensive" (counter-fire each attacker, weapon-range bounded). action MUST be \`none\`.

Match shape:
- 50 turns. Turn 30 reveals evac. Turn 50 extracts living agents inside the 3×3 zone and splits the prize. Outside evac at turn 50 you are incinerated.
- Vision 20 (Chebyshev). Walls block LOS, cover does not. Movement 8 (12 w/ speed). Attack/loot range 2. Speech 20.

Output discipline:
- Concrete targets only — no predicates. Invalid choices are replaced with the safe default (do nothing).
- \`primary:"move"\` resolves the move first, then the action from the new position.
- \`scratchpad_update\` is your only cross-turn memory (≤500 chars). \`say\` reveals you if hidden.

The persona body that follows is your character. Visible state is authoritative.`;
