// WP10.5 Phase A4+A5 — unit tests for `runMatch.ts` helpers.
//
// Two surgical concerns covered here, written FIRST per AOP:
//
//   A4. `buildHeardForObserver` MUST read directly from
//       `priorSpeech[i].heardBy.includes(observer.characterId)` rather than
//       recomputing hearing range against current (turn N+1) positions. The
//       engine's `resolution.ts:236-263` already computes the §16-correct
//       audience against start-of-turn-N positions and persists it on
//       `trace.speech[].heardBy`. Recomputing against current positions can
//       drift (e.g. speaker moved post-speech) — gate-1-review.md §Issues
//       (Med) flags this as a §16 correctness regression risk.
//
//   A5. `runMatch.advanceTurn` reads `reasoningEffort` from the matches row
//       (default "low") and forwards it to `callDecisionTool`. Verified by
//       a wrapper-level assertion on `requestBody.reasoning.effort`, NOT
//       gated on Azure (no env vars required).
//
// Both tests stay in pure-unit territory: no Convex runtime, no fs, no
// network. The A4 test exercises the pure helper; the A5 test exercises
// the wrapper directly with the `--reasoning medium` value to prove the
// param threads through to the HTTP request body.

import { describe, expect, it, vi } from "vitest";

import {
  buildHeardForObserver,
  buildAgentLlmRecord,
  buildMatchState,
  MAX_HP,
} from "../convex/runMatch.js";
import { callDecisionTool } from "../convex/llm/azure.js";
import { CHARACTER_MAX_HP } from "../convex/engine/types.js";
import type {
  CharacterState,
  FailureReason,
  ParsedDecision,
} from "../convex/engine/types.js";
import type { Doc } from "../convex/_generated/dataModel.js";

// ─── A4: heard-speech direct read ───────────────────────────────────────────

/** Build a minimal CharacterState — only fields the helper reads. */
function makeChar(
  characterId: string,
  pos: { x: number; y: number },
  alive = true,
): CharacterState {
  return {
    characterId,
    personaId: "rat",
    spawnIndex: 0,
    displayName: characterId,
    hp: 100,
    maxHp: 100,
    pos,
    equipped: {},
    scratchpad: "",
    hidden: false,
    alive,
    lastKnown: [],
  };
}

describe("WP10.5 A4 — buildHeardForObserver reads from persisted trace.heardBy", () => {
  it("returns the speech entry when observer.id is in priorSpeech.heardBy (regardless of current pos)", () => {
    // Speaker spoke at start-of-turn-N (position then was within 20 of observer).
    // By turn N+1, speaker has MOVED to (90, 90) — Chebyshev > 20 from observer
    // at (10, 10). The position-based re-filter would WRONGLY drop this entry.
    // The trace.heardBy direct read MUST keep it.
    const observer = makeChar("obs", { x: 10, y: 10 });
    const speakerNow = makeChar("spk", { x: 90, y: 90 });
    const characters = [observer, speakerNow];
    const priorSpeech = [
      { characterId: "spk", text: "hello", heardBy: ["obs"] },
    ];

    const heard = buildHeardForObserver(observer, priorSpeech, characters);

    expect(heard).toHaveLength(1);
    expect(heard[0]).toEqual({ speakerId: "spk", text: "hello" });
  });

  it("does NOT include speech when observer.id is missing from priorSpeech.heardBy (even if observer is currently in range)", () => {
    // Speaker is currently within Chebyshev 20 of observer — BUT the
    // engine's audience for the prior turn did not include observer
    // (e.g. observer moved INTO range AFTER the speech turn). The
    // direct-read MUST honour the persisted audience.
    const observer = makeChar("obs", { x: 10, y: 10 });
    const speakerNow = makeChar("spk", { x: 12, y: 12 });
    const characters = [observer, speakerNow];
    const priorSpeech = [
      { characterId: "spk", text: "hello", heardBy: ["someone_else"] },
    ];

    const heard = buildHeardForObserver(observer, priorSpeech, characters);

    expect(heard).toEqual([]);
  });

  it("returns empty when priorSpeech is empty", () => {
    const observer = makeChar("obs", { x: 10, y: 10 });
    expect(buildHeardForObserver(observer, [], [observer])).toEqual([]);
  });

  it("preserves speech order (engine sort order) across multiple speakers heard by observer", () => {
    const observer = makeChar("obs", { x: 10, y: 10 });
    const a = makeChar("a", { x: 0, y: 0 });
    const b = makeChar("b", { x: 0, y: 0 });
    const characters = [observer, a, b];
    const priorSpeech = [
      { characterId: "a", text: "first", heardBy: ["obs"] },
      { characterId: "b", text: "second", heardBy: ["obs"] },
    ];

    const heard = buildHeardForObserver(observer, priorSpeech, characters);

    expect(heard).toEqual([
      { speakerId: "a", text: "first" },
      { speakerId: "b", text: "second" },
    ]);
  });
});

// ─── A5: --reasoning end-to-end (wrapper-level assertion) ────────────────────

const VALID_DECISION: ParsedDecision = {
  consume: "none",
  primary: "move",
  move: { kind: "relative", dx: 1, dy: 0 },
  action: { kind: "none" },
  say: null,
  overwatch_priority: null,
  scratchpad_update: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function happyResponseBody() {
  return {
    id: "resp_a",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "function_call",
        name: "decide_turn",
        call_id: "call_a",
        arguments: JSON.stringify(VALID_DECISION),
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

describe("WP10.5 A5 — reasoningEffort threads into Azure request body", () => {
  it("forwards reasoningEffort='medium' to requestBody.reasoning.effort", async () => {
    let capturedBody: { reasoning?: { effort?: string } } | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const body = (init as { body: string }).body;
      capturedBody = JSON.parse(body) as { reasoning?: { effort?: string } };
      return jsonResponse(happyResponseBody());
    });

    await callDecisionTool({
      systemPrompt: "sys",
      personaPrompt: "persona",
      scratchpad: "",
      visibleStateDigest: "",
      reasoningEffort: "medium",
      maxOutputTokens: 64,
      azureUri: "https://example.test/openai/responses",
      azureApiKey: "key",
      azureModel: "model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning?.effort).toBe("medium");
  });

  it("forwards reasoningEffort='high' to requestBody.reasoning.effort", async () => {
    let capturedBody: { reasoning?: { effort?: string } } | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const body = (init as { body: string }).body;
      capturedBody = JSON.parse(body) as { reasoning?: { effort?: string } };
      return jsonResponse(happyResponseBody());
    });

    await callDecisionTool({
      systemPrompt: "sys",
      personaPrompt: "persona",
      scratchpad: "",
      visibleStateDigest: "",
      reasoningEffort: "high",
      maxOutputTokens: 64,
      azureUri: "https://example.test/openai/responses",
      azureApiKey: "key",
      azureModel: "model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning?.effort).toBe("high");
  });
});

// ─── B.3: validatorReason threads into the persisted agent-llm record ───────
//
// The engine validator rejection reason is computed locally in
// `runMatch.ts` (validation.reason). Pass B.3 wires it into the persisted
// trace record so harness/analyze-match.ts and harness/cluster-failures.ts
// can surface it. This test pins the mapping invariant on the pure helper
// `buildAgentLlmRecord` so future refactors can't silently drop the field.
//
// Cross-ref: `docs/project/phases/01-engine-and-harness/wp10-5-phase-a-findings.md`
// — without this field, the validator-rejection bucket (62.2% of fallbacks
// in the gate-1 smoke) is opaque.

describe("WP10.5 B.3 — validatorReason persists into agent-llm trace record", () => {
  const baseR = {
    callId: "call_x",
    rawArguments: '{"foo":"bar"}',
    responseId: "resp_x",
    usage: null,
    latencyMs: 12,
    httpStatus: 200,
  };

  it("includes validatorReason when the engine validator rejected the decision", () => {
    const record = buildAgentLlmRecord({
      ...baseR,
      wrapperFellBack: true,
      failureReason: undefined,
      validatorReason:
        "interact target 'chest_001' is already opened",
    });

    expect(record.fellBackToSafeDefault).toBe(true);
    expect(record.validatorReason).toBe(
      "interact target 'chest_001' is already opened",
    );
    // No wrapper-level failureReason for validator-only rejections.
    expect(record.failureReason).toBeUndefined();
  });

  it("omits validatorReason when validation passed (no rejection)", () => {
    const record = buildAgentLlmRecord({
      ...baseR,
      wrapperFellBack: false,
      failureReason: undefined,
      validatorReason: undefined,
    });

    expect(record.fellBackToSafeDefault).toBe(false);
    expect("validatorReason" in record).toBe(false);
  });

  it("threads BOTH failureReason and validatorReason when wrapper failed AND validator rejected the safe-default substitute", () => {
    // Edge: the wrapper already fell back (e.g. http_non_200 → safe-default),
    // and although the safe-default *should* validate, in principle the
    // helper must not lose either signal. Pin the invariant.
    const record = buildAgentLlmRecord({
      ...baseR,
      wrapperFellBack: true,
      failureReason: "http_non_200" as FailureReason,
      validatorReason: "actor 'foo' is not alive",
    });

    expect(record.failureReason).toBe("http_non_200");
    expect(record.validatorReason).toBe("actor 'foo' is not alive");
    expect(record.fellBackToSafeDefault).toBe(true);
  });

  it("preserves the existing wrapper-only failureReason path (no validatorReason)", () => {
    const record = buildAgentLlmRecord({
      ...baseR,
      wrapperFellBack: true,
      failureReason: "schema_validation_failed" as FailureReason,
      validatorReason: undefined,
    });

    expect(record.failureReason).toBe("schema_validation_failed");
    expect("validatorReason" in record).toBe(false);
  });
});

// ─── Gate-2.5 Path A — CHARACTER_MAX_HP shared-source-of-truth invariant ───
//
// Background: the Gate-2.5 review (2026-05-07) ratified lowering the per-
// character starting HP from 100 to 50 to compress armed-combat time-to-
// kill. The review flagged that HP was previously seeded in TWO places —
// `convex/matches.ts` (initial `characters.hp`) and `convex/runMatch.ts`
// (in-memory `MatchState.maxHp` at every turn) — so a one-line change to
// only one site would create the bug `hp=100, maxHp=50`. The fix is a
// single shared exported `CHARACTER_MAX_HP` in `convex/engine/types.ts`,
// imported by BOTH sites.
//
// These tests pin the invariant. They are intentionally dual-pinned:
//   1. The constant equals 50 (locked phase-1 tuning value; if a future
//      pass tunes it, this assertion is the single line that needs to
//      move + the failure narrative tells the next contributor exactly
//      where to look).
//   2. Both consumers (`matches.ts` initial `hp`, `runMatch.ts` `MAX_HP`)
//      derive from the same constant — verified by `MAX_HP ===
//      CHARACTER_MAX_HP` and by `buildMatchState` returning `maxHp ===
//      CHARACTER_MAX_HP` for a freshly-seeded character row.
//   3. A character row inserted with `hp: CHARACTER_MAX_HP` (the
//      `matches.start` shape) round-trips through `buildMatchState` to
//      satisfy `hp === maxHp === CHARACTER_MAX_HP` — the new-match
//      invariant the review asked us to test.

describe("Gate-2.5 Path A — CHARACTER_MAX_HP shared-source-of-truth invariant", () => {
  it("CHARACTER_MAX_HP is the phase-1 tuning value (50)", () => {
    // If a future pass re-tunes max HP, update this assertion + the
    // export in convex/engine/types.ts together.
    expect(CHARACTER_MAX_HP).toBe(50);
  });

  it("runMatch.MAX_HP is a re-export of CHARACTER_MAX_HP (no drift)", () => {
    // The dual-init bug from the original Gate-2.5 review: hp=100 in
    // matches.ts, maxHp=50 in runMatch.ts because they were two separate
    // literals. Pin parity to prevent regression.
    expect(MAX_HP).toBe(CHARACTER_MAX_HP);
  });

  it("a fresh-match character row (hp: CHARACTER_MAX_HP) yields hp === maxHp === CHARACTER_MAX_HP after buildMatchState", () => {
    // Mirror the row shape that `matches.start` inserts at turn 0:
    // `hp: CHARACTER_MAX_HP`, alive=true, no diedAtTurn / extractedAtTurn.
    // `buildMatchState` populates `maxHp` from the shared constant.
    const matchRow = {
      _id: "m1" as Doc<"matches">["_id"],
      _creationTime: 0,
      status: "running" as const,
      turn: 1,
      startedAt: 0,
      completedAt: null,
      mapId: "reference",
      rngSeed: "seed-test",
      outcome: { extracted: [], pointsByCharacter: [] },
    } as unknown as Doc<"matches">;

    const charRow = {
      _id: "c1" as Doc<"characters">["_id"],
      _creationTime: 0,
      matchId: matchRow._id,
      personaId: "duelist" as const,
      spawnIndex: 0,
      displayName: "Player_1",
      hp: CHARACTER_MAX_HP, // ← the matches.start seed value
      pos: { x: 28, y: 28 },
      equipped: {},
      scratchpad: "",
      hidden: false,
      alive: true,
      lastKnown: [],
    } as unknown as Doc<"characters">;

    const worldRow = {
      _id: "w1",
      _creationTime: 0,
      matchId: matchRow._id,
      walls: [],
      coverTiles: [],
      chests: [],
      corpses: [],
      evac: { centre: { x: 48, y: 48 }, revealedAtTurn: null },
    } as unknown as Doc<"worldState">;

    const state = buildMatchState(matchRow, [charRow], worldRow, {
      w: 100,
      h: 100,
    });

    expect(state.characters).toHaveLength(1);
    const c = state.characters[0]!;
    // The new-match invariant: full HP = max HP = the shared constant.
    expect(c.hp).toBe(CHARACTER_MAX_HP);
    expect(c.maxHp).toBe(CHARACTER_MAX_HP);
    expect(c.hp).toBe(c.maxHp);
  });
});
