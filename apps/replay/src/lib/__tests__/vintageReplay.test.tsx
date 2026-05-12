import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import type { ReplayBundle } from "../reconstruct";
import {
  hasPreIter2AgentRecords,
  VINTAGE_REPLAY_NOTICE,
  VintageReplayNotice,
} from "../vintageReplay";

type TurnDoc = Doc<"turns">;
type AgentRecord = TurnDoc["agentRecords"][number];

function makeBundle(agentRecords: AgentRecord[]): ReplayBundle {
  return {
    match: {
      _id: "m1" as unknown as Id<"matches">,
      _creationTime: 0,
      status: "completed",
      turn: 1,
      startedAt: 0,
      completedAt: 0,
      mapId: "reference",
      rngSeed: "seed",
      outcome: { extracted: [], pointsByCharacter: [] },
    } as unknown as Doc<"matches">,
    turns: [
      {
        _id: "t1" as unknown as Id<"turns">,
        _creationTime: 0,
        matchId: "m1" as unknown as Id<"matches">,
        turn: 1,
        agentRecords,
        resolution: {
          speech: [],
          moves: [],
          actions: [],
          deaths: [],
          visibilityUpdates: [],
          consumed: [],
        },
      } as unknown as TurnDoc,
    ],
    worldState: null,
    characters: [],
  };
}

function makeIter2Record(): AgentRecord {
  return {
    characterId: "Rat" as unknown as Id<"characters">,
    personaId: "rat",
    input: {
      systemPromptHash: "h",
      systemPromptText: "sys",
      personaPromptHash: "h",
      personaPromptText: "persona",
      visibleStateDigest: "{}",
      scratchpadBefore: "",
      useVariant: "null_only",
      composedUserMessage: "# Rat\n\n## Status\n...\n\n# Current Game State\n...",
    },
    decision: {
      use: null,
      position: { kind: "move", direction: { kind: "N" }, dist: 0 },
      action: { kind: "none" },
      say: null,
      scratchpad: null,
    },
    scratchpadAfter: "",
    llm: {
      responseId: null,
      callId: null,
      rawArguments: null,
      usage: null,
      latencyMs: 0,
      httpStatus: null,
      fellBackToSafeDefault: false,
      reasoning: null,
    },
  } as AgentRecord;
}

function makePhase3Record(): AgentRecord {
  const record = makeIter2Record();
  (record as unknown as { decision: unknown }).decision = {
    primary: "stationary_action",
    move: { kind: "none" },
    action: { kind: "none" },
    overwatch_stance: null,
    consume: null,
    say: null,
    scratchpad_update: null,
  };
  return record;
}

describe("vintage replay detector", () => {
  it("flags a phase-3-shaped agentRecord so Replay can render the vintage notice", () => {
    const bundle = makeBundle([makePhase3Record()]);

    expect(hasPreIter2AgentRecords(bundle)).toBe(true);
    expect(renderToStaticMarkup(<VintageReplayNotice />)).toContain(
      VINTAGE_REPLAY_NOTICE,
    );
  });

  it("does not flag an iter-2-shaped agentRecord", () => {
    expect(hasPreIter2AgentRecords(makeBundle([makeIter2Record()]))).toBe(false);
  });
});
