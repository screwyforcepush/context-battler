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
import { buildStatusBlockForReplay, truncateOneLine, TurnFeed } from "../TurnFeed";

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
type TestEquipped = {
  weapon?: { category: "weapon"; name: "rusty_blade" | "sword" | "axe" | "greatsword" };
  armour?: { category: "armour"; name: "cloth" | "leather" | "chain" | "plate" };
  consumable?: { category: "consumable"; name: "heal" | "speed" };
};

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
  statusOverrides: Partial<{
    hp: number;
    pos: { x: number; y: number };
    equipped: TestEquipped;
    insideEvac: boolean;
    scratchpadBefore: string;
  }> = {},
): AgentRecord {
  return {
    characterId: character._id,
    personaId: character.personaId,
    input: {
      systemPromptHash: "system-hash",
      personaPromptHash: "persona-hash",
      visibleStateDigest: "Vision:\n{}",
      scratchpadBefore:
        statusOverrides.scratchpadBefore ?? "fallback scratchpad",
      status: {
        hp: statusOverrides.hp ?? 50,
        pos: statusOverrides.pos ?? { x: 45, y: 47 },
        equipped: statusOverrides.equipped ?? {},
        insideEvac: statusOverrides.insideEvac ?? false,
      },
      narrativeLines: [],
      aliveCount: 8,
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
    promptsLookup: { system: {}, persona: {} },
  };
}

describe("buildStatusBlockForReplay", () => {
  it("renders the structured input.status contract, preserving bracketed stats and evac state", () => {
    const character = makeCharacter("c_duelist", "Duelist", "duelist");
    const status = buildStatusBlockForReplay(
      makeRecord(character, {
        hp: 38,
        insideEvac: true,
        equipped: {
          weapon: { category: "weapon", name: "sword" },
          armour: { category: "armour", name: "leather" },
          consumable: { category: "consumable", name: "heal" },
        },
        scratchpadBefore: "two enemies near evac, holding for trader",
      }).input,
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

  it("returns an unavailable status when structured input.status is missing", () => {
    const character = makeCharacter("c_duelist", "Duelist", "duelist");
    const input = makeRecord(character).input as AgentRecord["input"] & {
      status?: unknown;
    };
    delete (input as { status?: unknown }).status;

    expect(buildStatusBlockForReplay(input)).toEqual({
      available: false,
      lines: [],
    });
  });
});

describe("TurnFeed Status card", () => {
  it("renders the per-agent Status block above the decision summary", () => {
    const character = makeCharacter("c_duelist", "Duelist", "duelist");

    const html = renderToStaticMarkup(
      React.createElement(TurnFeed, {
        bundle: makeBundle(
          character,
          makeRecord(character, {
            hp: 38,
            insideEvac: true,
            equipped: {
              weapon: { category: "weapon", name: "sword" },
              armour: { category: "armour", name: "leather" },
              consumable: { category: "consumable", name: "heal" },
            },
            scratchpadBefore: "two enemies near evac, holding for trader",
          }),
        ),
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

  it("shows a visible status error when input.status is absent", () => {
    const character = makeCharacter("c_duelist", "Duelist", "duelist");
    const record = makeRecord(character) as AgentRecord & {
      input: AgentRecord["input"] & { status?: unknown };
    };
    delete (record.input as { status?: unknown }).status;

    const html = renderToStaticMarkup(
      React.createElement(TurnFeed, {
        bundle: makeBundle(character, record),
        currentTurn: 1,
        onOpenModal: () => undefined,
      }),
    );

    expect(html).toContain("Status (start of turn 1)");
    expect(html).toContain("(status unavailable — input.status missing)");
  });
});
