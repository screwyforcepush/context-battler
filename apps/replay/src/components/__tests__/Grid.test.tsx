import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { EntitySnapshot, ReplayBundle } from "../../lib/reconstruct";
import { Grid } from "../Grid";
import { renderHoverBody } from "../HoverCard";

function makeSnapshot(
  overrides: Partial<EntitySnapshot> = {},
): EntitySnapshot {
  return {
    turn: 7,
    characters: [],
    corpses: [],
    crates: [],
    airdrops: [],
    evacRevealed: false,
    ...overrides,
  };
}

function makeBundle(): ReplayBundle {
  return {
    match: {
      _id: "match1" as unknown as Id<"matches">,
      _creationTime: 0,
      status: "completed",
      turn: 7,
      startedAt: 0,
      completedAt: null,
      mapId: "reference",
      rngSeed: "seed-1",
      outcome: { extracted: [], pointsByCharacter: [] },
    },
    turns: [],
    worldState: null,
    characters: [],
    promptsLookup: { system: {}, persona: {} },
  } as ReplayBundle;
}

describe("Grid airdrop rendering", () => {
  it("renders inbound airdrops as hoverable markers and landed drops through the crate layer", () => {
    const snapshot = makeSnapshot({
      crates: [
        {
          id: "Crate_20_20",
          pos: { x: 20, y: 20 },
          opened: false,
        },
      ],
      airdrops: [
        {
          id: "Crate_10_10",
          pos: { x: 10, y: 10 },
          landsAtTurn: 9,
          state: "telegraphed",
          looted: false,
          countdown: 2,
        },
        {
          id: "Crate_15_15",
          pos: { x: 15, y: 15 },
          landsAtTurn: 7,
          state: "telegraphed",
          looted: false,
          countdown: 0,
        },
        {
          id: "Crate_20_20",
          pos: { x: 20, y: 20 },
          landsAtTurn: 6,
          state: "landed",
          looted: false,
        },
        {
          id: "Crate_25_25",
          pos: { x: 25, y: 25 },
          landsAtTurn: 6,
          state: "landed",
          looted: false,
        },
        {
          id: "Crate_30_30",
          pos: { x: 30, y: 30 },
          landsAtTurn: 6,
          state: "spent",
          looted: true,
        },
        {
          id: "Crate_40_40",
          pos: { x: 40, y: 40 },
          landsAtTurn: 20,
          state: "pre",
          looted: false,
        },
      ],
    });

    const html = renderToStaticMarkup(
      React.createElement(Grid, { snapshot, worldState: null }),
    );

    expect(html).toContain('data-layer="airdrops"');
    expect(html).toContain('data-token-kind="airdrop"');
    expect(html).toContain('data-airdrop-id="Crate_10_10"');
    expect(html).toContain("Airdrop Crate_10_10");
    expect(html).toContain("lands in 2 turns");
    expect(html).toContain(">2</text>");
    expect(html).toContain('data-token-kind="crate"');
    expect(html).toContain('data-crate-id="Crate_15_15"');
    expect(html).toContain('data-crate-id="Crate_20_20"');
    expect(html).toContain('data-crate-id="Crate_25_25"');

    expect(html).not.toContain('data-airdrop-id="Crate_15_15"');
    expect(html).not.toContain('data-airdrop-id="Crate_20_20"');
    expect(html).not.toContain('data-airdrop-id="Crate_25_25"');
    expect(html).not.toContain('data-airdrop-id="Crate_30_30"');
    expect(html).not.toContain('data-airdrop-id="Crate_40_40"');
  });
});

describe("HoverCard airdrop body", () => {
  it("shows airdrop id, position, state, and countdown", () => {
    const snapshot = makeSnapshot({
      airdrops: [
        {
          id: "Crate_10_10",
          pos: { x: 10, y: 10 },
          landsAtTurn: 9,
          state: "telegraphed",
          looted: false,
          countdown: 2,
        },
      ],
    });

    const html = renderToStaticMarkup(
      renderHoverBody(
        {
          kind: "airdrop",
          airdropId: "Crate_10_10",
          pos: { x: 10, y: 10 },
        },
        makeBundle(),
        snapshot,
        7,
      ),
    );

    expect(html).toContain("Airdrop Crate_10_10");
    expect(html).toContain("(10, 10)");
    expect(html).toContain("telegraphed");
    expect(html).toContain("2 turns");
  });
});
