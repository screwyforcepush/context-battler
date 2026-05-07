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

import { buildHeardForObserver } from "../convex/runMatch.js";
import { callDecisionTool } from "../convex/llm/azure.js";
import type {
  CharacterState,
  ParsedDecision,
} from "../convex/engine/types.js";

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
