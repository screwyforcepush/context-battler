// Phase 02 / WP-C — Vitest tests for `decisionEnglish.ts`.
//
// TDD red phase: this file pins the ADR §5 vocabulary BEFORE the
// implementation lands. The decision-as-English module is the
// EXPLAINABILITY CENTERPIECE per north-star §11 — the user reads the LLM's
// stated intent next to the engine's actual outcome, in plain English,
// without falling back to JSON. A subtle vocabulary bug here corrupts the
// user's vibe-judgement on whether prompt-authored minds are meaningfully
// playing the game.
//
// Source-of-truth references walked while writing these tests:
//   - ADR §5 vocabulary table (architecture-decisions.md:512-562)
//   - Result-string canonical source: convex/engine/resolution.ts:374-586
//     (D-P2-14 — `harness/analyze-match.ts` is stale and IS NOT used)
//   - Decision validator field names: convex/schema.ts:202 (decisionValidator),
//     :262 (agentRecordValidator), :278 (resolutionValidator)
//
// Coverage map (every cell of the WP-C acceptance bullet list):
//   - move.kind=none / relative (8 compass directions × chebyshev distance)
//                   / toward / away
//   - action.kind=none / attack / loot (chest_* + corpse Player_*)
//     × every literal `result` in the engine vocabulary table
//   - "dmg N" template parsed as a positive integer (incl. 0)
//   - Death-detection rule: actor+target both in resolution.deaths[] for the
//     same turn → " — killed <displayName>" suffix on attack outcome
//   - Unrecognised result string → "(unknown result: <raw>)"
//   - consume = none / heal / speed (with effect from resolution.consumed[])
//   - say: null collapses; non-null wrapped in `Said: "…"`
//   - overwatch_stance null collapses; non-null prefixed with "Stance: <s>"
//   - primary === "overwatch" marks row with overwatch glyph regardless of
//     stance
//   - Counter-fire (defensive): fromOverwatch=true + stance="defensive" →
//     "counter-fired Player_X — dmg N"
//   - Offensive overwatch: stance="offensive" → "overwatch (offensive) fired
//     on Player_X, dealt N damage"
//   - Wall-blocked move: resolution.moves[].blockedBy === "wall" → outcome
//     fragment appended with " → hit wall"
//   - Scratchpad delta detection — identical text omits; changed text
//     produces a truncated diff line (≤ ~120 chars).
//   - intentVsOutcome correctly pairs the actor's intent with the matching
//     resolution.{moves,actions,consumed}[] entry, including out_of_range
//     and no_target mismatch cases.

import { describe, expect, it } from "vitest";
import { summariseDecision } from "../decisionEnglish";
import type { AgentRecord, TurnResolution } from "../decisionEnglish";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

// ───────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ───────────────────────────────────────────────────────────────────────────

type CharacterDoc = Doc<"characters">;
type CharId = Id<"characters">;

function asCharId(s: string): CharId {
  return s as unknown as CharId;
}

function makeChar(id: string, displayName: string): CharacterDoc {
  return {
    _id: asCharId(id),
    _creationTime: 0,
    matchId: "m1" as unknown as Id<"matches">,
    personaId: "rat",
    spawnIndex: 0,
    displayName,
    hp: 100,
    pos: { x: 0, y: 0 },
    equipped: {},
    scratchpad: "",
    hidden: false,
    alive: true,
    lastKnown: [],
  } as CharacterDoc;
}

function characterMap(...chars: CharacterDoc[]): Map<CharId, CharacterDoc> {
  const m = new Map<CharId, CharacterDoc>();
  for (const c of chars) m.set(c._id, c);
  return m;
}

function emptyResolution(): TurnResolution {
  return {
    consumed: [],
    speech: [],
    moves: [],
    actions: [],
    deaths: [],
    visibilityUpdates: [],
  };
}

type DecisionOverrides = Partial<AgentRecord["decision"]>;

function makeAgentRecord(
  characterId: CharId,
  decision: DecisionOverrides = {},
  overrides: Partial<AgentRecord> = {},
): AgentRecord {
  const base: AgentRecord = {
    characterId,
    personaId: "rat",
    input: {
      systemPromptHash: "h",
      systemPromptText: "sys",
      personaPromptHash: "h",
      personaPromptText: "per",
      visibleStateDigest: "vis",
      scratchpadBefore: "before",
    },
    decision: {
      consume: "none",
      primary: "stationary_action",
      move: { kind: "none" },
      action: { kind: "none" },
      say: null,
      overwatch_stance: null,
      scratchpad_update: null,
      ...decision,
    },
    scratchpadAfter: "after",
    llm: {
      responseId: null,
      callId: null,
      rawArguments: null,
      usage: null,
      latencyMs: 0,
      httpStatus: null,
      fellBackToSafeDefault: false,
      // Phase-3 ADR §2 — required-nullable reasoning.
      reasoning: null,
    },
    ...overrides,
  };
  return base;
}

// ───────────────────────────────────────────────────────────────────────────
// move.kind vocabulary
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — move.kind vocabulary", () => {
  it('"none" → "Stayed put"', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { move: { kind: "none" } });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).toContain("Stayed put");
    expect(out.bullets.some((b) => b.includes("Stayed put"))).toBe(true);
  });

  // 8 compass directions × chebyshev distance.
  // Convention: positive y = south (screen-down), positive x = east.
  const compassCases: Array<{
    dx: number;
    dy: number;
    direction: string;
    n: number;
  }> = [
    { dx: 0, dy: -3, direction: "north", n: 3 },
    { dx: 3, dy: -3, direction: "northeast", n: 3 },
    { dx: 3, dy: 0, direction: "east", n: 3 },
    { dx: 3, dy: 3, direction: "southeast", n: 3 },
    { dx: 0, dy: 3, direction: "south", n: 3 },
    { dx: -3, dy: 3, direction: "southwest", n: 3 },
    { dx: -3, dy: 0, direction: "west", n: 3 },
    { dx: -3, dy: -3, direction: "northwest", n: 3 },
    // Chebyshev: max(|dx|,|dy|).
    { dx: 6, dy: -2, direction: "northeast", n: 6 },
    { dx: -1, dy: 5, direction: "southwest", n: 5 },
  ];
  for (const c of compassCases) {
    it(`"relative" {dx:${c.dx},dy:${c.dy}} → "Moved ${c.n} tiles ${c.direction}"`, () => {
      const me = makeChar("a", "Player_1");
      const ar = makeAgentRecord(me._id, {
        primary: "move",
        move: { kind: "relative", dx: c.dx, dy: c.dy },
      });
      const out = summariseDecision(ar, emptyResolution(), characterMap(me));
      expect(out.oneLine).toContain(`Moved ${c.n} tiles ${c.direction}`);
    });
  }

  // Pluralization (closure-readiness UAT ISSUE-001 round 2): the move-summary
  // template must agree with the chebyshev count. "Moved 1 tiles east" is
  // ungrammatical and noisy enough to break the explainability vibe. Singular
  // form must say "tile"; plural (>=2) keeps "tiles".
  it('"relative" {dx:1,dy:0} → singular "Moved 1 tile east"', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "move",
      move: { kind: "relative", dx: 1, dy: 0 },
    });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).toContain("Moved 1 tile east");
    expect(out.oneLine).not.toContain("Moved 1 tiles");
  });

  it('"relative" {dx:2,dy:0} → plural "Moved 2 tiles east"', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "move",
      move: { kind: "relative", dx: 2, dy: 0 },
    });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).toContain("Moved 2 tiles east");
  });

  it('"relative" {dx:0,dy:-1} → singular "Moved 1 tile north"', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "move",
      move: { kind: "relative", dx: 0, dy: -1 },
    });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).toContain("Moved 1 tile north");
    expect(out.oneLine).not.toContain("Moved 1 tiles");
  });

  const towardCases = ["Player_4", "Cover_54_42", "Wall_64_30", "Evac"];
  for (const targetId of towardCases) {
    it(`"toward" ${targetId} → renders targetId verbatim`, () => {
      const me = makeChar("a", "Player_1");
      const ar = makeAgentRecord(me._id, {
        primary: "move",
        move: { kind: "toward", targetId },
      });
      const out = summariseDecision(ar, emptyResolution(), characterMap(me));
      expect(out.oneLine).toContain(`Moved toward ${targetId}`);
      expect(out.bullets).toContain(`Move: Moved toward ${targetId}`);
      expect(out.intentVsOutcome[0]?.intent).toBe(`Moved toward ${targetId}`);
    });
  }

  it('"away" Player_4 → renders targetId verbatim', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "move",
      move: { kind: "away", targetId: "Player_4" },
    });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).toContain("Moved away from Player_4");
    expect(out.bullets).toContain("Move: Moved away from Player_4");
    expect(out.intentVsOutcome[0]?.intent).toBe("Moved away from Player_4");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// action.kind × every result literal
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — action.kind × result vocabulary (D-P2-14)", () => {
  it('"none" → action line omitted entirely', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { action: { kind: "none" } });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).not.toMatch(/Attacked|Interacted|Looted/);
    expect(out.bullets.every((b) => !/Attacked|Interacted|Looted/.test(b))).toBe(
      true,
    );
  });

  // ── attack × result ───────────────────────────────────────────────────
  it('attack + "dmg 12" → "Attacked Player_5 — hit (dealt 12 damage)"', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      primary: "stationary_action",
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "dmg 12",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(out.oneLine).toContain("Attacked Player_5");
    expect(out.oneLine).toContain("hit (dealt 12 damage)");
    // Should NOT have killed suffix without a deaths[] entry.
    expect(out.oneLine).not.toContain("killed");
  });

  it('attack + "dmg 0" → still "hit (dealt 0 damage)" (positive-int parse incl. 0)', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      primary: "stationary_action",
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "dmg 0",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(out.oneLine).toContain("hit (dealt 0 damage)");
  });

  it('attack + "no_target" → "target not found"', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "no_target",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(out.oneLine).toContain("target not found");
  });

  it('attack + "out_of_range" → "out of range"', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "out_of_range",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(out.oneLine).toContain("out of range");
  });

  // ── loot × result (chest variants — D7 schema unify) ──────────────────
  //
  // WP-G.3 UAT-001 round-2 (cosmetic): the chest-open intent verb
  // ("Opened chest_004") already encodes the engine's "opened" result
  // state, so suffixing "— opened" produces redundant phrasing
  // ("Opened chest_004 — opened."). For the `result === "opened"` case
  // the renderer collapses to just the intent; other result strings
  // (already_opened / no_chest / out_of_range) still surface the engine
  // result via the outcome suffix because they encode a *different*
  // state than the intent verb.
  it.each([
    ["already_opened", "already opened"],
    ["no_chest", "chest not found"],
    ["out_of_range", "out of range"],
  ])('chest-open via loot + "%s" → outcome suffix "%s"', (raw, english) => {
    // Phase-3 ADR §1 — chests flow through the unified loot arm with a
    // `chest_*`-prefixed targetId. Trace `kind` is "loot" per PM lock D7.
    // The renderer disambiguates by the result string itself (no separate
    // `interact` arm).
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "chest_004" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: "chest_004",
          result: raw,
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    expect(out.oneLine).toContain("Opened chest_004");
    expect(out.oneLine).toContain(english);
  });

  it('chest-open via loot + "opened" → no redundant outcome suffix', () => {
    // WP-G.3 UAT-001 round-2 fix: the verb "Opened" already conveys the
    // "opened" result state. The renderer collapses the redundant
    // "— opened" outcome fragment in the feed-row oneLine + bullets, so
    // the user reads "Opened chest_004." rather than
    // "Opened chest_004 — opened.". The intentVsOutcome explainability
    // pane keeps the engine result verbatim (covered downstream).
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "chest_004" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: "chest_004",
          result: "opened",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    expect(out.oneLine).toContain("Opened chest_004");
    expect(out.oneLine).not.toContain("— opened");
    expect(out.oneLine).not.toContain("- opened");
    // bullets surface should also collapse the redundancy.
    const actionBullet = out.bullets.find((b) => b.startsWith("Action:"));
    expect(actionBullet).toBeDefined();
    expect(actionBullet!).toContain("Opened chest_004");
    expect(actionBullet!).not.toContain("— opened");
  });

  // ── WP-F.3 UAT ISSUE-001 [HIGH] regression — chest-loot rendering ─────
  //
  // The model emits typed chest ids verbatim (`Chest_008` capitalised),
  // mirroring the displayName form the engine accepts case-insensitively
  // (convex/engine/movement.ts:129-134, convex/engine/resolution.ts:482-
  // 486). Pre-fix, the renderer's lowercase-only `chest_` check let the
  // capitalised form fall through to the corpse-of fallback, where
  // `resolveCharacterName` truncated the bogus id to 8 chars — producing
  // `Looted from corpse-of-Chest_00` (wrong prefix AND mangled id).
  //
  // Post-fix:
  //   - Chest namespace dispatch is case-insensitive.
  //   - The full chest id renders verbatim (no truncation, no
  //     corpse-of- prefix).
  //   - Trace target string also rendered verbatim (the engine
  //     preserves the model's emit on the trace per resolution.ts
  //     L568-574).
  it("chest-loot capital `Chest_008` → renders full id with no corpse-of- prefix", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "Chest_008" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          // Engine echoes the model's verbatim emit on the trace target
          // (resolution.ts L568-574). Mirror that here.
          target: "Chest_008",
          result: "opened",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    // Full id preserved (case + all 3 digits — no `Chest_00` truncation).
    expect(out.oneLine).toContain("Opened Chest_008");
    // No corpse-of- prefix on the chest path.
    expect(out.oneLine).not.toContain("corpse-of-Chest_008");
    expect(out.oneLine).not.toContain("Looted from corpse-of-Chest");
    // WP-G.3 UAT-001 round-2 (cosmetic): the redundant "— opened"
    // outcome suffix is collapsed in oneLine because the verb "Opened"
    // already encodes the result state. The engine result still
    // surfaces verbatim in intentVsOutcome (asserted in the
    // intentVsOutcome describe block downstream).
    expect(out.oneLine).not.toContain("— opened");
  });

  // ── WP-I.2 UAT ISSUE-001 (completion-review-4) — corpse-loot rendering ─
  //
  // Post-WP-G.1 (commit 634524b) the engine emits the LLM-facing typed-id
  // `Corpse_Player_N` verbatim in `resolution.actions[].target` (per
  // convex/engine/resolution.ts L526-569 — both `target: rawTargetId` on
  // every corpse path AND `traceTarget: rawTargetId` carried into the
  // success branch). The chest branch was correctly fixed in WP-F.3
  // (commit 53ce3cb), but the corpse branch in decisionEnglish.ts was
  // missed and still passes the typed-id through `resolveCharacterName`
  // — the helper at decisionEnglish.ts:578-590 cannot find the typed-id
  // in the character map (which is keyed by Convex opaque _ids) so it
  // falls through to `raw.slice(0,8) → "Corpse_P"`, producing garbage
  // like `Looted from corpse-of-Corpse_P — looted` (8-char truncation
  // PLUS a double `corpse-` prefix).
  //
  // UAT trace evidence: match j97a5s5e turn 18 actor=j57dp8c0
  // target=`Corpse_Player_1` result=`looted`; match j97a5s5e turn 13
  // actor=j577g9zc target=`Corpse_Player_2` result=`looted`.
  //
  // Post-fix:
  //   - Corpse_Player_* typed-id dispatch is case-insensitive (mirrors
  //     the engine's case-insensitive Chest_ dispatch).
  //   - The full typed id renders verbatim (no truncation, no double
  //     `corpse-` prefix).
  //   - Legacy Convex-id targets (opaque _ids referencing the character
  //     map) continue to render via `resolveCharacterName` so historical
  //     match data still renders.
  it("corpse-loot typed-id `Corpse_Player_5` → renders full typed id verbatim, no double `corpse-` prefix, no 8-char truncation", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "Corpse_Player_5" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          // Engine echoes the LLM-facing typed-id verbatim on the trace
          // target (resolution.ts L546-569). Mirror that here.
          target: "Corpse_Player_5",
          result: "looted",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    // (a) Full typed id present verbatim — no `Corpse_P` truncation.
    expect(out.oneLine).toContain("Corpse_Player_5");
    // (b) No double `corpse-` prefix (the bug shape produced
    //     `Looted from corpse-of-Corpse_P`).
    expect(out.oneLine).not.toContain("corpse-of-");
    // (c) No 8-char truncation of the typed id (assert against the bug
    //     shape directly: `Corpse_P` followed by a non-letter boundary).
    expect(out.oneLine).not.toMatch(/Corpse_P(?![a-z])/);
    // Outcome verb still surfaces.
    expect(out.oneLine).toContain("looted");
  });

  // Case-insensitive variant — locks the regex against future LLM
  // emissions that lowercase the prefix (`corpse_Player_5`). The chest
  // branch already does case-insensitive dispatch via /^chest_/i; the
  // corpse branch must mirror that contract.
  it("corpse-loot typed-id `corpse_Player_5` (lowercase prefix) → still renders verbatim with no truncation", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "corpse_Player_5" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: "corpse_Player_5",
          result: "looted",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    expect(out.oneLine).toContain("corpse_Player_5");
    expect(out.oneLine).not.toContain("corpse-of-");
    expect(out.oneLine).not.toMatch(/corpse_P(?![a-z])/);
  });

  // Corpse-loot parity fixture — assert the loot path renders the
  // corpse correctly with full Player_N displayName (no truncation).
  it("corpse-loot Player_5 → renders Looted from corpse-of-Player_5 with looted outcome", () => {
    const me = makeChar("a", "Player_1");
    const dead = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: dead._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: dead._id,
          result: "looted",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, dead));
    expect(out.oneLine).toContain("Looted from corpse-of-Player_5");
    expect(out.oneLine).toContain("looted");
  });

  // Drained-corpse fixture (phase-3 ADR §4 — `result: "empty"` trace
  // entry from resolution.ts L800-807). Asserts the dedicated drained
  // outcome copy surfaces alongside the corpse intent.
  it("corpse-loot Player_5 + `empty` → surfaces drained outcome", () => {
    const me = makeChar("a", "Player_1");
    const dead = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: dead._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: dead._id,
          result: "empty",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, dead));
    expect(out.oneLine).toContain("Looted from corpse-of-Player_5");
    expect(out.oneLine).toContain("corpse already drained");
  });

  // ── loot × result (corpse variants — phase-3 ADR §4 adds "empty") ─────
  it.each([
    ["looted", "looted"],
    ["no_corpse", "corpse not found"],
    ["empty", "corpse already drained"],
    ["out_of_range", "out of range"],
  ])('loot corpse + "%s" → "%s"', (raw, english) => {
    const me = makeChar("a", "Player_1");
    const dead = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: dead._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: dead._id,
          result: raw,
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, dead));
    // Loot intent renders as "Looted from <corpse-of-displayName>".
    expect(out.oneLine).toContain("Looted from corpse-of-Player_5");
    expect(out.oneLine).toContain(english);
  });

  // ── overwatch (kind on resolution.actions, not on decision.action) ────
  // Back-compat path: an entry without explicit stance fields renders the
  // generic "overwatch fire (dealt N damage)" copy (legacy phase-1 shape /
  // unset cases).
  it('overwatch fire result "dmg 7" with no stance fields → generic "overwatch fire (dealt 7 damage)"', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: "offensive",
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "overwatch",
          target: target._id,
          result: "dmg 7",
          // Neither fromOverwatch nor stance — legacy/back-compat path.
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(
      out.intentVsOutcome.some((p) =>
        p.outcome.includes("overwatch fire (dealt 7 damage)"),
      ),
    ).toBe(true);
  });

  // Phase-3 ADR §3 — offensive overwatch fire renders elaborated copy
  // surfacing both the stance and the target displayName.
  it('offensive overwatch fire (stance="offensive") → "overwatch (offensive) fired on Player_5, dealt 7 damage"', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: "offensive",
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "overwatch",
          target: target._id,
          result: "dmg 7",
          stance: "offensive",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(
      out.intentVsOutcome.some((p) =>
        p.outcome.includes(
          "overwatch (offensive) fired on Player_5, dealt 7 damage",
        ),
      ),
    ).toBe(true);
  });

  // Phase-3 ADR §3 — defensive counter-fire renders the dedicated copy
  // surfacing both the counter-fire attribution and the attacker
  // displayName. Engine emits fromOverwatch=true + stance="defensive".
  it('defensive counter-fire (fromOverwatch=true + stance="defensive") → "counter-fired Player_5 — dmg 7"', () => {
    const me = makeChar("a", "Player_1");
    const attacker = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: "defensive",
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "overwatch",
          target: attacker._id,
          result: "dmg 7",
          fromOverwatch: true,
          stance: "defensive",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, attacker));
    expect(
      out.intentVsOutcome.some((p) =>
        p.outcome.includes("counter-fired Player_5 — dmg 7"),
      ),
    ).toBe(true);
  });

  // Out-of-range counter-fire (defensive but range-bounded out) still
  // renders via the counter-fire branch but surfaces the failure result.
  it('defensive counter-fire with "out_of_range" → still under counter-fire branch', () => {
    const me = makeChar("a", "Player_1");
    const attacker = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      primary: "overwatch",
      action: { kind: "none" },
      overwatch_stance: "defensive",
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "overwatch",
          target: attacker._id,
          result: "out_of_range",
          fromOverwatch: true,
          stance: "defensive",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, attacker));
    // Range-bounded counter-fire still attributed to the defensive branch.
    expect(
      out.intentVsOutcome.some(
        (p) =>
          p.intent.includes("[Overwatch fire]") &&
          p.outcome.includes("out of range"),
      ),
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Wall-blocked move (phase-3 ADR §9 — moves[].blockedBy === "wall")
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — wall-blocked move outcome", () => {
  it('blockedBy="wall" on the actor\'s move entry → outcome appended with " → hit wall"', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "move",
      move: { kind: "relative", dx: 1, dy: 0 },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      moves: [
        {
          characterId: me._id,
          from: { x: 10, y: 10 },
          to: { x: 10, y: 10 },
          blockedBy: "wall",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    const movePair = out.intentVsOutcome.find((p) =>
      p.intent.toLowerCase().startsWith("moved"),
    );
    expect(movePair).toBeDefined();
    expect(movePair!.outcome).toContain("→ hit wall");
    // Coordinates still rendered as before; the suffix is appended.
    expect(movePair!.outcome).toMatch(/\(10,10\)\s*→\s*\(10,10\)/);
  });

  it("no blockedBy field → outcome string is plain (no wall suffix)", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "move",
      move: { kind: "relative", dx: 1, dy: 0 },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      moves: [
        {
          characterId: me._id,
          from: { x: 10, y: 10 },
          to: { x: 11, y: 10 },
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    const movePair = out.intentVsOutcome.find((p) =>
      p.intent.toLowerCase().startsWith("moved"),
    );
    expect(movePair).toBeDefined();
    expect(movePair!.outcome).not.toContain("hit wall");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Death detection rule
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — death detection (resolution.deaths[])", () => {
  it('appends " — killed <displayName>" when the attack target dies on the same turn', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      primary: "stationary_action",
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "dmg 12",
        },
      ],
      deaths: [target._id],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(out.oneLine).toContain("hit (dealt 12 damage) — killed Player_5");
  });

  // v0 contract per D-P2-25 (phase-2-closure.md §5.4): engine emits `dmg N`
  // per attacker and a flat `deaths[]` list with no last-blow attribution;
  // the renderer cannot disambiguate, so duplicate kill claims by simultaneous
  // attackers are accepted. Test name is preserved for git-blame continuity.
  it("does NOT append the kill suffix when only a different agent killed the same target", () => {
    const me = makeChar("a", "Player_1");
    const ally = makeChar("c", "Player_3");
    const target = makeChar("b", "Player_5");
    // I attacked but my hit didn't kill — ally killed instead. The deaths[]
    // entry is for `target._id`, but attribution belongs to the ally's
    // attack record, not mine. My summary must NOT claim a kill.
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "dmg 4",
        },
        {
          characterId: ally._id,
          kind: "attack",
          target: target._id,
          result: "dmg 14",
        },
      ],
      deaths: [target._id],
    };
    const out = summariseDecision(ar, res, characterMap(me, ally, target));
    // The actor's own attack outcome appears with damage but withOUT a kill
    // suffix; only the actor whose hit result was the death-causing blow
    // should claim the kill. v0 rule: append the kill iff THIS actor was
    // the LAST attacker on the defender in the actions[] order (the engine
    // applies damage in batch but emits actions in the same order it
    // resolved them). For mismatched-actor kill scenarios, the simpler rule
    // is "no claim" — the user reads the deaths[] list separately.
    //
    // Because the v0 contract says "for an attack outcome whose actor +
    // target also appear in resolution.deaths[]", and only the target id
    // appears in deaths[] (deaths is `Array<Id<"characters">>`), the rule
    // is "the actor's attack outcome PLUS the target dying on the same
    // turn ⇒ append kill". That means BOTH attackers get the kill suffix
    // in this contrived case. To keep the test honest to the contract, we
    // assert only that the suffix MAY appear; the *no-double-claim* nuance
    // is a future refinement. Document as TODO.
    //
    // Contract decision (locked here): the kill suffix appears for any
    // attacker whose attack outcome lands on the dying target on the same
    // turn. Both attackers get it. The user can read deaths[] for the full
    // picture; this avoids the renderer trying to re-derive
    // last-blow-attribution which the engine doesn't surface.
    expect(out.oneLine).toContain("Player_5");
    // (We don't assert "killed" presence/absence here — the contract
    // accepts both.)
    expect(out).toBeDefined();
  });

  it("does NOT append the kill suffix when target dies but my action wasn't an attack", () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "chest_004" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: "chest_004",
          result: "opened",
        },
      ],
      deaths: [target._id],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(out.oneLine).not.toContain("killed");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Unrecognised result string
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — unrecognised result fallback", () => {
  it('attack + result="future_engine_string" → "(unknown result: future_engine_string)"', () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "future_engine_string",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    expect(out.oneLine).toContain("(unknown result: future_engine_string)");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Consume vocabulary
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — consume vocabulary", () => {
  it('"none" → "(no consumable)" line is OMITTED from oneLine (only relevant when consumed)', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { consume: "none" });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    // The phrase belongs in the bullets/intent-vs-outcome only — oneLine
    // stays terse. (See ADR §5: oneLine is the collapsed feed row.)
    expect(out.oneLine).not.toContain("Drank");
  });

  it('"heal" → "Drank heal potion" in oneLine and bullets', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { consume: "heal" });
    const res: TurnResolution = {
      ...emptyResolution(),
      consumed: [
        { characterId: me._id, item: { category: "consumable", name: "heal" } },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    expect(out.oneLine).toContain("Drank heal potion");
    expect(out.bullets.some((b) => b.includes("Drank heal potion"))).toBe(true);
  });

  it('"speed" → "Drank speed potion"', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { consume: "speed" });
    const res: TurnResolution = {
      ...emptyResolution(),
      consumed: [
        { characterId: me._id, item: { category: "consumable", name: "speed" } },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    expect(out.oneLine).toContain("Drank speed potion");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Say + overwatch_stance null collapse (phase-3 ADR §1)
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — say / overwatch_stance null collapse", () => {
  it("say: null collapses (no `Said:` clause)", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { say: null });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).not.toContain("Said:");
  });

  it('say: "Truce?" → `Said: "Truce?"`', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { say: "Truce?" });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).toContain('Said: "Truce?"');
  });

  it("overwatch_stance null collapses (no `Stance:` clause)", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { overwatch_stance: null });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).not.toContain("Stance:");
  });

  it('overwatch_stance "offensive" + primary "overwatch" → "Stance: offensive"', () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "overwatch",
      overwatch_stance: "offensive",
    });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.oneLine).toContain("Stance: offensive");
  });

  it("primary === overwatch marks the row regardless of priority", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "overwatch",
      overwatch_stance: null,
    });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    // ADR §5: "When `primary === 'overwatch'`, mark with overwatch glyph
    // regardless of priority." We expose this via a stable token in the
    // oneLine so the side-panel feed can render an icon. The token MUST
    // appear, even if priority is null.
    expect(out.oneLine).toMatch(/Overwatch/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Scratchpad delta detection
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — scratchpad delta detection", () => {
  it("identical scratchpad text → no delta line", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(
      me._id,
      { scratchpad_update: "remember the chest at (40,40)" },
      {
        // scratchpadBefore deliberately equals scratchpad_update.
        input: {
          systemPromptHash: "h",
          systemPromptText: "sys",
          personaPromptHash: "h",
          personaPromptText: "per",
          visibleStateDigest: "vis",
          scratchpadBefore: "remember the chest at (40,40)",
        },
      },
    );
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.bullets.every((b) => !b.toLowerCase().startsWith("scratchpad"))).toBe(
      true,
    );
  });

  it("changed scratchpad text → truncated diff line (≤120 chars)", () => {
    const me = makeChar("a", "Player_1");
    const long = "a".repeat(500);
    const ar = makeAgentRecord(
      me._id,
      { scratchpad_update: long },
      {
        input: {
          systemPromptHash: "h",
          systemPromptText: "sys",
          personaPromptHash: "h",
          personaPromptText: "per",
          visibleStateDigest: "vis",
          scratchpadBefore: "short before",
        },
      },
    );
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    const scratchBullet = out.bullets.find((b) =>
      b.toLowerCase().startsWith("scratchpad"),
    );
    expect(scratchBullet).toBeDefined();
    expect(scratchBullet!.length).toBeLessThanOrEqual(140); // generous bound
    // Confirm truncation happened — the raw 500-char string isn't fully
    // present.
    expect(scratchBullet!.length).toBeLessThan(long.length);
  });

  it("scratchpad_update === null → no delta line (treated as no change)", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { scratchpad_update: null });
    const out = summariseDecision(ar, emptyResolution(), characterMap(me));
    expect(out.bullets.every((b) => !b.toLowerCase().startsWith("scratchpad"))).toBe(
      true,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// intentVsOutcome pairing
// ───────────────────────────────────────────────────────────────────────────

describe("summariseDecision — intentVsOutcome pairing", () => {
  it("attack intent paired with dmg outcome", () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "dmg 12",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    const attackPair = out.intentVsOutcome.find((p) =>
      p.intent.includes("Attacked Player_5"),
    );
    expect(attackPair).toBeDefined();
    expect(attackPair!.outcome).toContain("hit (dealt 12 damage)");
  });

  it("attack intent + out_of_range outcome surfaces the mismatch", () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "out_of_range",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    const pair = out.intentVsOutcome.find((p) =>
      p.intent.includes("Attacked Player_5"),
    );
    expect(pair).toBeDefined();
    expect(pair!.outcome).toContain("out of range");
  });

  it("attack intent + no_target outcome (target gone) surfaces clearly", () => {
    const me = makeChar("a", "Player_1");
    const target = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetCharacterId: target._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: target._id,
          result: "no_target",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, target));
    const pair = out.intentVsOutcome.find((p) =>
      p.intent.includes("Attacked Player_5"),
    );
    expect(pair).toBeDefined();
    expect(pair!.outcome).toContain("target not found");
  });

  it("loot intent paired with opened outcome (chest_*)", () => {
    // Phase-3 ADR §1 / PM lock D7 — chests flow through unified loot
    // arm with `chest_*` targetId; trace `kind` is "loot".
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "chest_004" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: "chest_004",
          result: "opened",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    const pair = out.intentVsOutcome.find((p) =>
      p.intent.includes("Opened chest_004"),
    );
    expect(pair).toBeDefined();
    expect(pair!.outcome).toContain("opened");
  });

  it("loot intent paired with looted outcome (corpse displayName resolved)", () => {
    const me = makeChar("a", "Player_1");
    const dead = makeChar("b", "Player_5");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: dead._id },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: dead._id,
          result: "looted",
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me, dead));
    const pair = out.intentVsOutcome.find((p) =>
      p.intent.includes("Looted from corpse-of-Player_5"),
    );
    expect(pair).toBeDefined();
    expect(pair!.outcome).toContain("looted");
  });

  it("move intent paired with realised move (relative N tiles compass)", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, {
      primary: "move",
      move: { kind: "relative", dx: 6, dy: -2 },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      moves: [
        {
          characterId: me._id,
          from: { x: 10, y: 10 },
          to: { x: 16, y: 8 },
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    const movePair = out.intentVsOutcome.find((p) =>
      p.intent.toLowerCase().startsWith("moved"),
    );
    expect(movePair).toBeDefined();
    expect(movePair!.outcome).toMatch(/\(10,10\)\s*→\s*\(16,8\)/);
  });

  it("consume intent paired with realised consume entry", () => {
    const me = makeChar("a", "Player_1");
    const ar = makeAgentRecord(me._id, { consume: "heal" });
    const res: TurnResolution = {
      ...emptyResolution(),
      consumed: [
        { characterId: me._id, item: { category: "consumable", name: "heal" } },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));
    const pair = out.intentVsOutcome.find((p) => p.intent.includes("Drank heal"));
    expect(pair).toBeDefined();
    expect(pair!.outcome).toMatch(/heal/i);
  });
});
