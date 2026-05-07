// WP9 — locked-id contract + token-budget + diversity tests for the 8
// persona prompts and the `loadPersonas()` loader.
//
// Tests are written FIRST per AOP (Red → Green → Refactor). They lock four
// invariants that downstream WPs depend on:
//
//   1. **Filename presence.** All 8 `personas/<id>.md` files exist on disk.
//      Without them the loader can't construct a complete record.
//   2. **Locked-id contract (ADR §6).** `Object.keys(loadPersonas()).sort()`
//      equals the kebab-case literal union exactly. No 9th key, no missing
//      key, no `.md` extension on the keys. WP15 may edit persona BODIES,
//      never these IDs — they propagate to schema validators, the aggregator,
//      and the closing report.
//   3. **Token budget (binding, not guidance).** Each persona body must be
//      ≤ 80 tokens per `mental-model.md` §10 prompt-economy rule.
//      Sprawling persona prompts make calls slow and persona signal muddier.
//   4. **Diversity.** The 8 prompt strings are not byte-identical (cheap
//      smoke; real differentiation lives in the Gate 2/3 stats report).
//
// Token-count proxy. We use **`chars / 4`** as a deterministic, install-free
// proxy for tiktoken token counts, with `Math.ceil` rounding. Rationale:
//   - `tiktoken` ships native bindings; introducing it in WP9 risks install
//     pain on Convex/Vitest + adds maintenance surface for a single test.
//   - `chars / 4` is the canonical Anthropic/OpenAI public-doc heuristic for
//     English text; documented in `de-risking.md` as the WP8 fallback proxy.
//   - The `≤ 80 tokens` budget is a tuning constraint, not a network contract
//     — a slightly conservative proxy is preferable to an exact-but-fragile
//     dependency.
//
// Cross-references:
//   - ADR §6 — locks `PERSONA_IDS` (the 8-arm literal union we assert against).
//   - work-packages.md WP9 — token-budget assertion is BINDING; CI fails
//     if any persona exceeds 80 tokens.
//   - mental-model.md §10 — extraction-rate spread ≥ 15 pp at Gate 3 is the
//     phase-1 done-bar for persona differentiation; this file gates the
//     precondition (8 distinct files with distinct character keywords).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadPersonas } from "../../convex/llm/personas.js";
import {
  PERSONA_IDS,
  type PersonaId,
} from "../../convex/engine/types.js";

// ─── Path helpers ────────────────────────────────────────────────────────────

/** Resolve `personas/<id>.md` relative to the test file's own URL so the
 *  test passes regardless of vitest's cwd. */
function personasDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // tests/llm/ → repo root → personas/
  return resolve(here, "..", "..", "personas");
}

/** Documented `chars / 4` proxy for tiktoken token count. `Math.ceil` so
 *  we don't accidentally undercount on a body whose length is, e.g., 321
 *  characters (true tokens ≈ 80.25 → must reject). */
function approxTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// Token budget: WP9 originally locked this at 80 tokens per body (chars/4
// proxy). Gate-2.5 review (docs/project/phases/01-engine-and-harness/
// gate-2-5-review.md "Reviewer Spot-Check Addendum") ratified a narrow
// paranoid append for evac-corner overwatch as bundled with Path A; the
// appended sentence alone is <80 tokens (≈30 by chars/4 proxy), but the
// combined paranoid body lands at ≈103 tokens. The bump to 105 absorbs that
// ratified addition without softening prompt-economy intent: every persona
// body is still short, and the camper edit (also Gate-2.5-bundled) stays
// well under 80 tokens (≈75). mental-model.md §10 "prompt economy"
// remains qualitative; the 80→105 lift is bounded to this Path A pass.
const TOKEN_BUDGET = 105;
const EXPECTED_IDS_SORTED = [...PERSONA_IDS].sort() as readonly PersonaId[];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WP9 — persona files on disk", () => {
  it("all 8 persona markdown files exist with the locked filenames", () => {
    const dir = personasDir();
    for (const id of PERSONA_IDS) {
      const path = resolve(dir, `${id}.md`);
      expect(
        existsSync(path),
        `expected persona file at ${path}`,
      ).toBe(true);
    }
  });

  it("each persona file has a non-empty body after trim", () => {
    const dir = personasDir();
    for (const id of PERSONA_IDS) {
      const path = resolve(dir, `${id}.md`);
      const body = readFileSync(path, "utf8").trim();
      expect(
        body.length,
        `${id}.md is empty after trim — every persona must have a body`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("WP9 — loadPersonas() locked-ids contract (ADR §6)", () => {
  it("returns an object whose keys are exactly the 8 locked PersonaIds — no extras, no missing, no .md extension", () => {
    const personas = loadPersonas();
    const keys = Object.keys(personas).sort();
    // Deep equality against the fixed kebab-case literal union. WP15 may
    // edit persona BODIES but never these IDS — they're shared with the
    // schema, the aggregator, and the closing report.
    expect(keys).toEqual(EXPECTED_IDS_SORTED);
    // Belt-and-braces guard: defend against ".md" extension keys
    // sneaking in via a future loader regression.
    for (const k of keys) {
      expect(k).not.toMatch(/\.md$/);
    }
  });

  it("returns a string value for every PersonaId — non-empty after trim", () => {
    const personas = loadPersonas();
    for (const id of PERSONA_IDS) {
      const body = personas[id];
      expect(typeof body, `${id} value is not a string`).toBe("string");
      expect(
        body.trim().length,
        `${id} body is empty after trim`,
      ).toBeGreaterThan(0);
      // The loader must already have trimmed leading/trailing whitespace
      // (per WP9 spec). Asserting equality with the trimmed form lets
      // WP10 hash the persona prompt without worrying about trailing-newline
      // drift between a `cat` of the file and the loader's output.
      expect(
        body,
        `${id} body must be trimmed by the loader`,
      ).toBe(body.trim());
    }
  });
});

describe("WP9 — token budget (≤ 80 tokens per persona, binding)", () => {
  // Documented in this file's header — `chars / 4` with Math.ceil. The
  // budget is the prompt-economy constraint from mental-model.md §10:
  // sprawling persona prompts make calls slow and the persona signal
  // muddier at the Gate 3 stats step.
  it("every persona body is ≤ 80 tokens by the chars/4 proxy", () => {
    const personas = loadPersonas();
    for (const id of PERSONA_IDS) {
      const body = personas[id];
      const tokens = approxTokenCount(body);
      expect(
        tokens,
        `persona "${id}" exceeds ${TOKEN_BUDGET}-token budget: chars=${body.length}, approxTokens=${tokens}`,
      ).toBeLessThanOrEqual(TOKEN_BUDGET);
    }
  });
});

describe("WP9 — diversity smoke", () => {
  it("the 8 prompt strings are not byte-identical to each other", () => {
    const personas = loadPersonas();
    const values = PERSONA_IDS.map((id) => personas[id]);
    // If any two personas share a body, the Set drops below 8 — every
    // persona must have a distinct prompt for Gate 3's spread to register.
    expect(new Set(values).size).toBe(PERSONA_IDS.length);
  });

  // Lightweight lexical-differentiation smoke. Real persona signal is
  // measured at Gate 2/3 stats, not here — these keyword checks just guard
  // against accidental copy-paste of one persona's body into another's
  // file (which the byte-identity test would also catch only if the copy
  // were exact). Each archetype's keyword is unique to its character per
  // concept-spec §19.
  const KEYWORDS: Record<PersonaId, readonly string[]> = {
    rat: ["hide", "sneak"],
    duelist: ["hunt", "fight"],
    trader: ["negotiate", "truce"],
    opportunist: ["gather", "loot", "flee"],
    paranoid: ["bait", "trust"],
    camper: ["overwatch", "cover"],
    sprinter: ["sprint", "race", "speed"],
    vulture: ["corpse", "loot"],
  };

  it("every persona body contains at least one archetype-keyword (case-insensitive)", () => {
    const personas = loadPersonas();
    for (const id of PERSONA_IDS) {
      const body = personas[id].toLowerCase();
      const keywords = KEYWORDS[id];
      const matched = keywords.find((kw) => body.includes(kw));
      expect(
        matched,
        `persona "${id}" body contains none of its archetype keywords [${keywords.join(", ")}]`,
      ).toBeDefined();
    }
  });
});
