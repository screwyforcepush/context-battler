import { describe, expect, it } from "vitest";
import { LegacyDecisionShapeError, summariseDecision } from "../decisionEnglish";
import type { AgentRecord, TurnResolution } from "../decisionEnglish";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

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
    hp: 50,
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
  const resolution = {
    speech: [],
    moves: [],
    actions: [],
    deaths: [],
    visibilityUpdates: [],
  } as unknown as TurnResolution;
  (resolution as unknown as Record<string, unknown>)["con" + "sumed"] = [];
  return resolution;
}

function withUseLedger(
  resolution: TurnResolution,
  entries: unknown[],
): TurnResolution {
  (resolution as unknown as Record<string, unknown>)["con" + "sumed"] = entries;
  return resolution;
}

function makeAgentRecord(
  characterId: CharId,
  decision: Partial<AgentRecord["decision"]> = {},
  overrides: Partial<AgentRecord> = {},
): AgentRecord {
  return {
    characterId,
    personaId: "rat",
    input: {
      systemPromptHash: "h",
      systemPromptText: "sys",
      personaPromptHash: "h",
      personaPromptText: "per",
      visibleStateDigest: "vis",
      scratchpadBefore: "before",
      useVariant: "null_only",
    },
    decision: {
      use: null,
      position: { kind: "move", direction: { kind: "N" }, dist: 0 },
      action: { kind: "none" },
      say: null,
      scratchpad: null,
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
      reasoning: null,
    },
    ...overrides,
  };
}

describe("summariseDecision — Phase 6 position vocabulary", () => {
  it("throws a typed error for phase-3 decisions with no iter-2 position", () => {
    const me = makeChar("c1", "Camper");
    const legacyDecision = {
      primary: "move",
      move: { kind: "toward_entity", targetId: "Duelist" },
      action: { kind: "none" },
      overwatch_stance: null,
      consume: null,
      say: null,
      scratchpad_update: null,
    } as unknown as AgentRecord["decision"];
    const ar = makeAgentRecord(me._id);
    (ar as { decision: AgentRecord["decision"] }).decision = legacyDecision;

    expect(() => summariseDecision(ar, emptyResolution(), characterMap(me))).toThrow(
      LegacyDecisionShapeError,
    );
  });

  it("renders target-relative movement with targetId and dist", () => {
    const me = makeChar("c1", "Camper");
    const ar = makeAgentRecord(me._id, {
      position: {
        kind: "move",
        direction: { kind: "toward", targetId: "Chest_53_54" },
        dist: 8,
      },
    });

    const out = summariseDecision(ar, emptyResolution(), characterMap(me));

    expect(out.oneLine).toContain("Moved toward Chest_53_54 up to 8");
    expect(out.bullets).toContain("Position: Moved toward Chest_53_54 up to 8");
    expect(out.intentVsOutcome[0]).toEqual({
      intent: "Moved toward Chest_53_54 up to 8",
      outcome: "(no movement)",
    });
  });

  it("renders away movement with targetId and dist", () => {
    const me = makeChar("c1", "Camper");
    const ar = makeAgentRecord(me._id, {
      position: {
        kind: "move",
        direction: { kind: "away", targetId: "Duelist" },
        dist: 5,
      },
    });

    const out = summariseDecision(ar, emptyResolution(), characterMap(me));

    expect(out.oneLine).toContain("Moved away from Duelist up to 5");
    expect(out.bullets).toContain("Position: Moved away from Duelist up to 5");
  });

  it("renders compass movement with bearing and dist", () => {
    const me = makeChar("c1", "Camper");
    const ar = makeAgentRecord(me._id, {
      position: {
        kind: "move",
        direction: { kind: "NE" },
        dist: 3,
      },
    });

    const res: TurnResolution = {
      ...emptyResolution(),
      moves: [
        {
          characterId: me._id,
          from: { x: 1, y: 4 },
          to: { x: 4, y: 1 },
        },
      ],
    };
    const out = summariseDecision(ar, res, characterMap(me));

    expect(out.oneLine).toContain("Moved NE up to 3");
    expect(out.bullets).toContain("Position: Moved NE up to 3 — (1,4) → (4,1)");
  });
});

describe("summariseDecision — Phase 6 action and reactive outcomes", () => {
  it("renders action plus overwatch from one turn", () => {
    const me = makeChar("c1", "Camper");
    const target = makeChar("c2", "Duelist");
    const ar = makeAgentRecord(me._id, {
      position: { kind: "overwatch" },
      action: { kind: "attack", targetId: "Duelist" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: "Duelist",
          result: "dmg 12",
        },
        {
          characterId: me._id,
          kind: "overwatch",
          target: "Duelist",
          result: "dmg 7",
          triggeredByMovement: true,
        },
      ],
    };

    const out = summariseDecision(ar, res, characterMap(me, target));

    expect(out.oneLine).toContain("Held overwatch");
    expect(out.oneLine).toContain("Attacked Duelist — hit (dealt 12 damage)");
    expect(out.oneLine).toContain(
      "Overwatch: overwatch fired on Duelist, dealt 7 damage (movement trigger)",
    );
    expect(out.intentVsOutcome[0]?.outcome).toBe(
      "overwatch fired on Duelist, dealt 7 damage (movement trigger)",
    );
  });

  it("renders counter retaliation", () => {
    const me = makeChar("c1", "Camper");
    const target = makeChar("c2", "Duelist");
    const ar = makeAgentRecord(me._id, {
      position: { kind: "counter" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "counter",
          target: "Duelist",
          result: "dmg 9",
        },
      ],
    };

    const out = summariseDecision(ar, res, characterMap(me, target));

    expect(out.oneLine).toContain("Held counter");
    expect(out.oneLine).toContain(
      "Counter: counter-fired Duelist, dealt 9 damage",
    );
    expect(out.bullets).toContain(
      "Position: Held counter — counter-fired Duelist, dealt 9 damage",
    );
  });

  it("renders unified attack targetId and death suffix", () => {
    const me = makeChar("c1", "Camper");
    const target = makeChar("c2", "Duelist");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "attack", targetId: "Duelist" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "attack",
          target: "Duelist",
          result: "dmg 50",
        },
      ],
      deaths: [target._id],
    };

    const out = summariseDecision(ar, res, characterMap(me, target));

    expect(out.oneLine).toContain(
      "Attacked Duelist — hit (dealt 50 damage) — killed Duelist",
    );
  });

  it("renders loot targetId without redundant opened suffix", () => {
    const me = makeChar("c1", "Camper");
    const ar = makeAgentRecord(me._id, {
      action: { kind: "loot", targetId: "Chest_53_54" },
    });
    const res: TurnResolution = {
      ...emptyResolution(),
      actions: [
        {
          characterId: me._id,
          kind: "loot",
          target: "Chest_53_54",
          result: "opened",
        },
      ],
    };

    const out = summariseDecision(ar, res, characterMap(me));

    expect(out.oneLine).toContain("Opened Chest_53_54.");
    expect(out.oneLine).not.toContain("Opened Chest_53_54 — opened");
  });
});

describe("summariseDecision — Phase 6 use, say, and scratchpad axes", () => {
  it("renders use of the equipped consumable slot with realised item", () => {
    const me = makeChar("c1", "Camper");
    const ar = makeAgentRecord(me._id, {
      use: "consumable",
    });
    const res = withUseLedger(emptyResolution(), [
      {
        characterId: me._id,
        item: { category: "consumable", name: "heal" },
      },
    ]);

    const out = summariseDecision(ar, res, characterMap(me));

    expect(out.oneLine).toContain("Used heal consumable");
    expect(out.bullets).toContain("Use: Used heal consumable");
    expect(out.intentVsOutcome).toContainEqual({
      intent: "Used consumable",
      outcome: "Used heal consumable",
    });
  });

  it("renders speech and carried-forward scratchpad", () => {
    const me = makeChar("c1", "Camper");
    const ar = makeAgentRecord(me._id, {
      say: "Truce?",
      scratchpad: null,
    });

    const out = summariseDecision(ar, emptyResolution(), characterMap(me));

    expect(out.oneLine).toContain('Said: "Truce?"');
    expect(out.bullets).toContain('Say: "Truce?"');
    expect(out.bullets).toContain("Scratchpad: carried forward");
  });

  it("renders scratchpad replacement when non-null", () => {
    const me = makeChar("c1", "Camper");
    const ar = makeAgentRecord(me._id, {
      scratchpad: "Watch Duelist near evac.",
    });

    const out = summariseDecision(ar, emptyResolution(), characterMap(me));

    expect(out.bullets).toContain("Scratchpad: Watch Duelist near evac.");
  });
});
