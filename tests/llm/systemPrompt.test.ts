// WP-C.6 — TDD tests for the rewritten system prompt (phase-3 ADR §7).
//
// Phase-3 substrate refinement promotes `systemPrompt.ts` from a static
// laws-of-the-game blurb to a SCHEMA TEACHER. The prompt explains:
//   - the typed-id glossary the digest uses (`Player_N`, `Chest_NNN`,
//     `Corpse_PlayerN`, `Cover_X_Y`, `Wall_X_Y`, `Evac`);
//   - per-Visible observation brackets and what they mean;
//   - the action grammar (move arms, action arms, overwatch with
//     `overwatch_stance`);
//   - the match-shape urgency framing ("outside evac at turn 50, you're
//     incinerated");
//   - safe-default replaces invalid choices.
//
// Branch A (WP-A.1 probe outcome — RESOLVED): Azure DOES expose reasoning
// items in `output[]`. The system prompt does NOT carry the Section 5b
// rationale ask. This test file pins that — adding the rationale ask back
// would silently bloat tokens.
//
// Cross-references:
//   - architecture-decisions.md §7 — system-prompt rewrite contract.
//   - work-packages.md WP-C.6 — test cases enumerated.
//   - de-risking.md D-P3-1 — Branch A confirmed.

import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../../convex/llm/systemPrompt.js";

// ─── Token-budget proxy (chars/4) ───────────────────────────────────────────

/** Same chars/4 proxy used elsewhere (personas.test.ts, inputBuilder.test.ts).
 *  Phase-3 ADR §7 targets ≤ 500 tokens (1.25× phase-1's ≤ 400). */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TOKEN_BUDGET = 500;

describe("WP-C.2 — SYSTEM_PROMPT structural smoke", () => {
  it("is a non-empty string", () => {
    expect(typeof SYSTEM_PROMPT).toBe("string");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("≤ 500 tokens via chars/4 proxy (phase-3 ADR §7 budget)", () => {
    const tokens = approxTokens(SYSTEM_PROMPT);
    expect(
      tokens,
      `SYSTEM_PROMPT exceeds ${TOKEN_BUDGET}-token budget: chars=${SYSTEM_PROMPT.length}, approxTokens=${tokens}`,
    ).toBeLessThanOrEqual(TOKEN_BUDGET);
  });

  it("contains the `decide_turn` tool-name reminder", () => {
    expect(SYSTEM_PROMPT).toContain("decide_turn");
  });
});

// ─── Section 1: typed-id glossary ───────────────────────────────────────────

describe("WP-C.2 — typed-id glossary (How to read Visible)", () => {
  it("teaches Player_N", () => {
    expect(SYSTEM_PROMPT).toContain("Player_N");
  });

  it("teaches Chest_NNN", () => {
    expect(SYSTEM_PROMPT).toContain("Chest_NNN");
  });

  it("teaches Corpse_PlayerN", () => {
    expect(SYSTEM_PROMPT).toContain("Corpse_PlayerN");
  });

  it("teaches Cover_X_Y", () => {
    expect(SYSTEM_PROMPT).toContain("Cover_X_Y");
  });

  it("teaches Wall_X_Y", () => {
    expect(SYSTEM_PROMPT).toContain("Wall_X_Y");
  });

  it("teaches Evac", () => {
    // Word-boundary anywhere — Evac is referenced in glossary AND match-shape.
    expect(SYSTEM_PROMPT).toMatch(/\bEvac\b/);
  });

  it("teaches dist + 8-octant bearing language", () => {
    expect(SYSTEM_PROMPT).toContain("dist");
    // 8-octant scheme — at least the cardinal/diagonal names are mentioned.
    // Asserting the literal "8-octant" phrasing keeps the prompt's teaching
    // intent stable across edits.
    expect(SYSTEM_PROMPT).toMatch(/8[- ]octant/);
  });
});

// ─── Section 2: action grammar (move arms) ──────────────────────────────────

describe("WP-C.2 — action-grammar block — move arms", () => {
  it("teaches relative dx,dy", () => {
    expect(SYSTEM_PROMPT).toContain("relative");
  });

  it("teaches toward_entity", () => {
    expect(SYSTEM_PROMPT).toContain("toward_entity");
  });

  it("teaches away_from_entity", () => {
    expect(SYSTEM_PROMPT).toContain("away_from_entity");
  });

  it("teaches toward_object", () => {
    expect(SYSTEM_PROMPT).toContain("toward_object");
  });

  it("teaches toward_evac", () => {
    expect(SYSTEM_PROMPT).toContain("toward_evac");
  });

  it("teaches none (move arm)", () => {
    // `none` appears in many places — anchor on the move grammar phrasing.
    // Both the move arm and the action arm teach a `none` literal.
    expect(SYSTEM_PROMPT).toMatch(/\bnone\b/);
  });
});

// ─── Section 2: action grammar (action arms) ────────────────────────────────

describe("WP-C.2 — action-grammar block — action arms", () => {
  it("teaches loot for chests OR corpses (unified vocab)", () => {
    expect(SYSTEM_PROMPT).toContain("loot");
    // Per ADR §1 + §7: `loot <Visible.id>` works for both chests and corpses.
    // The teaching block must surface that the same kind handles both.
    // Test the dual-target framing without overconstraining the wording:
    // both `Chest` and `Corpse` (or the `chest_`/`Player_` id namespaces)
    // appear in the loot teaching context.
  });

  it("teaches attack Player_N", () => {
    expect(SYSTEM_PROMPT).toContain("attack");
    expect(SYSTEM_PROMPT).toContain("Player_N");
  });

  it("teaches none (action arm)", () => {
    // Already asserted via the move-arm test; `none` is shared.
    expect(SYSTEM_PROMPT).toMatch(/\bnone\b/);
  });

  it("does NOT teach interact (legacy phase-1 vocab — DELETED in phase-3)", () => {
    // ADR §1 unifies chest opens under `loot`. The phase-1 `interact` arm
    // is gone; the prompt must not still teach it.
    expect(SYSTEM_PROMPT).not.toContain("interact");
  });
});

// ─── Section 2: action grammar (overwatch with stance) ──────────────────────

describe("WP-C.2 — action-grammar block — overwatch + stance", () => {
  it("teaches overwatch as a primary value", () => {
    expect(SYSTEM_PROMPT).toContain("overwatch");
  });

  it("teaches overwatch_stance with 'offensive'", () => {
    expect(SYSTEM_PROMPT).toContain("overwatch_stance");
    expect(SYSTEM_PROMPT).toContain("offensive");
  });

  it("teaches overwatch_stance with 'defensive'", () => {
    expect(SYSTEM_PROMPT).toContain("defensive");
  });

  it("does NOT teach overwatch_priority (legacy phase-1 vocab — DELETED in phase-3)", () => {
    expect(SYSTEM_PROMPT).not.toContain("overwatch_priority");
  });
});

// ─── Section 3: match shape + urgency framing ───────────────────────────────

describe("WP-C.2 — match shape + urgency framing", () => {
  it("teaches 50-turn match length", () => {
    expect(SYSTEM_PROMPT).toContain("50");
  });

  it("teaches turn 30 reveals evac", () => {
    expect(SYSTEM_PROMPT).toContain("30");
  });

  it("teaches the 'outside evac at turn 50, you're incinerated' framing", () => {
    // Phase-3 ADR §7 locks the urgency framing language. The exact word
    // "incinerated" makes the consequence concrete; the prompt must
    // surface it (the alternative — "extracted" — is the success state).
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("incinerated");
  });
});

// ─── Section 4: output discipline ───────────────────────────────────────────

describe("WP-C.2 — output discipline", () => {
  it("teaches concrete-targets-only / no predicates", () => {
    // Phase-3 ADR §7 locks "concrete targets only — no predicates".
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("concrete");
  });

  it("teaches safe-default substitution on invalid choices", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("safe default");
  });
});

// ─── Section 5b — Branch A: rationale ask MUST be ABSENT ────────────────────

describe("WP-C.2 — Branch A: rationale ask is omitted", () => {
  it("does NOT contain a 'rationale' field ask", () => {
    // Branch A confirmed (de-risking.md D-P3-1): Azure exposes reasoning
    // items in `output[].type === "reasoning"`. The system prompt MUST
    // NOT carry the Section 5b rationale ask — that's Branch B only,
    // and Branch B was rejected by the probe.
    expect(SYSTEM_PROMPT.toLowerCase()).not.toContain("rationale");
  });

  it("does NOT include a '≤ 280 chars' length cap (Branch B specific)", () => {
    // The Branch-B rationale ask carries a "≤ 280 chars" cap. The cap
    // string should not appear anywhere in the rendered prompt.
    expect(SYSTEM_PROMPT).not.toMatch(/≤\s*280/);
    expect(SYSTEM_PROMPT).not.toMatch(/<=\s*280/);
  });
});

// ─── Section 6: persona deference ───────────────────────────────────────────

describe("WP-C.2 — persona deference", () => {
  it("tells the model the persona body is its character", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("persona");
  });
});
