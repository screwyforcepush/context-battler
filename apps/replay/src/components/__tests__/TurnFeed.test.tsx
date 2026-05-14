// Phase 02 / closure-readiness — Vitest unit tests for the TurnFeed
// scratchpad-preview truncation helper.
//
// Pinned by closure-readiness UAT ISSUE (review-B Med-1): collapsed feed
// rows must show a one-line ~100-char preview of `agentRecord.scratchpadAfter`.
// The helper handles two concerns: collapse newlines so the preview stays
// single-line, and clamp length with an ellipsis suffix.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import type { ReplayBundle } from "../../lib/reconstruct";
import { parseStatusBlockForReplay, truncateOneLine, TurnFeed } from "../TurnFeed";

describe("truncateOneLine — boundary behaviour", () => {
  it("returns the input unchanged when length <= budget", () => {
    const s = "short scratchpad note";
    expect(truncateOneLine(s, 100)).toBe(s);
  });

  it("returns the input unchanged at exactly the budget", () => {
    const s = "x".repeat(100);
    expect(truncateOneLine(s, 100)).toBe(s);
  });

  it("truncates with ellipsis when length > budget", () => {
    const s = "x".repeat(150);
    const out = truncateOneLine(s, 100);
    expect(out.length).toBe(100);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, 99)).toBe("x".repeat(99));
  });

  it("collapses internal newlines into single spaces (single-line preview)", () => {
    const s = "first line\nsecond line\nthird line";
    expect(truncateOneLine(s, 100)).toBe("first line second line third line");
  });

  it("collapses CRLF and tabs to single spaces", () => {
    const s = "a\r\nb\tc";
    expect(truncateOneLine(s, 100)).toBe("a b c");
  });

  it("collapses runs of whitespace introduced by newlines into one space", () => {
    const s = "head\n\n\ntail";
    expect(truncateOneLine(s, 100)).toBe("head tail");
  });

  it("returns empty string unchanged", () => {
    expect(truncateOneLine("", 100)).toBe("");
  });
});

type CharacterDoc = Doc<"characters">;
type MatchDoc = Doc<"matches">;
type TurnDoc = Doc<"turns">;
type WorldStateDoc = Doc<"worldState">;
type AgentRecord = TurnDoc["agentRecords"][number];

function asCharId(s: string): Id<"characters"> {
  return s as unknown as Id<"characters">;
}

function asMatchId(s: string): Id<"matches"> {
  return s as unknown as Id<"matches">;
}

function makeCharacter(
  id: string,
  displayName: string,
  personaId: CharacterDoc["personaId"],
): CharacterDoc {
  return {
    _id: asCharId(id),
    _creationTime: 0,
    matchId: asMatchId("m1"),
    personaId,
    spawnIndex: 0,
    displayName,
    hp: 50,
    pos: { x: 45, y: 47 },
    equipped: {},
    scratchpad: "",
    hidden: false,
    alive: true,
    lastKnown: [],
  } as CharacterDoc;
}

function makeMatch(): MatchDoc {
  return {
    _id: asMatchId("m1"),
    _creationTime: 0,
    status: "completed",
    turn: 1,
    startedAt: 0,
    completedAt: null,
    mapId: "reference",
    rngSeed: "seed-1",
    outcome: { extracted: [], pointsByCharacter: [] },
  } as MatchDoc;
}

function makeWorld(): WorldStateDoc {
  return {
    _id: "ws1" as unknown as Id<"worldState">,
    _creationTime: 0,
    matchId: asMatchId("m1"),
    walls: [],
    coverClusters: [],
    coverTiles: [],
    chests: [],
    corpses: [],
    evac: { centre: { x: 49, y: 50 }, revealedAtTurn: null },
  } as WorldStateDoc;
}

function makeRecord(
  character: CharacterDoc,
  composedUserMessage?: string,
): AgentRecord {
  return {
    characterId: character._id,
    personaId: character.personaId,
    input: {
      systemPromptHash: "system-hash",
      systemPromptText: "System for <Player Name>",
      personaPromptHash: "persona-hash",
      personaPromptText: "Persona",
      visibleStateDigest: "Vision:\n{}",
      scratchpadBefore: "fallback scratchpad",
      ...(composedUserMessage === undefined ? {} : { composedUserMessage }),
      useVariant: "consumable_or_null",
    },
    decision: {
      use: null,
      position: { kind: "move", direction: { kind: "E" }, dist: 1 },
      action: { kind: "none" },
      say: null,
      scratchpad: null,
    },
    scratchpadAfter: "fallback scratchpad",
    llm: {
      responseId: "resp_1",
      callId: "call_1",
      rawArguments: JSON.stringify({
        use: null,
        position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        action: { kind: "none" },
        say: null,
        scratchpad: null,
      }),
      usage: { output_tokens: 42 },
      latencyMs: 10,
      httpStatus: 200,
      fellBackToSafeDefault: false,
      reasoning: null,
    },
  } as AgentRecord;
}

function makeBundle(
  character: CharacterDoc,
  agentRecord: AgentRecord,
): ReplayBundle {
  const turn: TurnDoc = {
    _id: "turn1" as unknown as Id<"turns">,
    _creationTime: 0,
    matchId: asMatchId("m1"),
    turn: 1,
    agentRecords: [agentRecord],
    resolution: {
      consumed: [],
      speech: [],
      moves: [
        {
          characterId: character._id,
          from: { x: 45, y: 47 },
          to: { x: 46, y: 47 },
        },
      ],
      actions: [],
      deaths: [],
      visibilityUpdates: [],
    },
  } as TurnDoc;

  return {
    match: makeMatch(),
    turns: [turn],
    characters: [character],
    worldState: makeWorld(),
  };
}

describe("parseStatusBlockForReplay", () => {
  it("extracts the renderStatusBlock contract verbatim, preserving bracketed stats and evac state", () => {
    const status = parseStatusBlockForReplay(
      [
        "# Duelist",
        "## Status",
        "📍(45,47) Inside Evac",
        "❤️HP: 38/50 HP",
        "⚔️weapon: sword [dmg 15]",
        "🛡️armour: leather [-3 dmg]",
        "🧪consumable: heal [heal 20% max HP]",
        "🗒️scratchpad: two enemies near evac, holding for trader",
        "",
        "Vision:",
        "{}",
      ].join("\n"),
    );

    expect(status.available).toBe(true);
    expect(status.lines).toEqual([
      "📍(45,47) Inside Evac",
      "❤️HP: 38/50 HP",
      "⚔️weapon: sword [dmg 15]",
      "🛡️armour: leather [-3 dmg]",
      "🧪consumable: heal [heal 20% max HP]",
      "🗒️scratchpad: two enemies near evac, holding for trader",
    ]);
  });

  it("returns an unavailable status when composedUserMessage is missing the Status block", () => {
    expect(parseStatusBlockForReplay("Vision:\n{}")).toEqual({
      available: false,
      lines: [],
    });
  });
});

describe("TurnFeed Status card", () => {
  it("renders the per-agent Status block above the decision summary", () => {
    const character = makeCharacter("c_duelist", "Duelist", "duelist");
    const composedUserMessage = [
      "# Duelist",
      "## Status",
      "📍(45,47) Inside Evac",
      "❤️HP: 38/50 HP",
      "⚔️weapon: sword [dmg 15]",
      "🛡️armour: leather [-3 dmg]",
      "🧪consumable: heal [heal 20% max HP]",
      "🗒️scratchpad: two enemies near evac, holding for trader",
      "",
      "Vision:",
      "{}",
    ].join("\n");

    const html = renderToStaticMarkup(
      React.createElement(TurnFeed, {
        bundle: makeBundle(character, makeRecord(character, composedUserMessage)),
        currentTurn: 1,
        onOpenModal: () => undefined,
      }),
    );

    expect(html).toContain("Status (start of turn 1)");
    expect(html).toContain("📍(45,47) Inside Evac");
    expect(html).toContain("❤️HP: 38/50 HP");
    expect(html).toContain("⚔️weapon: sword [dmg 15]");
    expect(html).toContain("🛡️armour: leather [-3 dmg]");
    expect(html).toContain("🧪consumable: heal [heal 20% max HP]");
    expect(html).toContain("🗒️scratchpad: two enemies near evac, holding for trader");
  });

  it("degrades cleanly when composedUserMessage is absent", () => {
    const character = makeCharacter("c_duelist", "Duelist", "duelist");

    const html = renderToStaticMarkup(
      React.createElement(TurnFeed, {
        bundle: makeBundle(character, makeRecord(character)),
        currentTurn: 1,
        onOpenModal: () => undefined,
      }),
    );

    expect(html).toContain("Status (start of turn 1)");
    expect(html).toContain("(status unavailable — vintage record)");
  });
});
