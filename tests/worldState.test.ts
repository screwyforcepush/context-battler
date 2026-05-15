import { describe, expect, it } from "vitest";
import { mergeWorldStateRows } from "../convex/worldState.js";

describe("worldState merged terrain shape", () => {
  it("returns one worldState-shaped object with static terrain and dynamic entities", () => {
    const dynamicRow = {
      _id: "dynamic-world-row",
      _creationTime: 200,
      matchId: "match-1",
      chests: [
        {
          id: "Chest_10_10",
          pos: { x: 10, y: 10 },
          contents: null,
          opened: false,
        },
      ],
      corpses: [],
      evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null },
    };
    const staticRow = {
      _id: "static-world-row",
      _creationTime: 100,
      matchId: "match-1",
      walls: [{ x: 4, y: 5, w: 3, h: 1 }],
      coverClusters: [{ x: 8, y: 9, w: 2, h: 2 }],
      coverTiles: [
        { x: 8, y: 9 },
        { x: 9, y: 9 },
        { x: 8, y: 10 },
        { x: 9, y: 10 },
      ],
    };

    const merged = mergeWorldStateRows(dynamicRow, staticRow, "match-1");

    expect(merged).toEqual({
      ...staticRow,
      ...dynamicRow,
      walls: staticRow.walls,
      coverClusters: staticRow.coverClusters,
      coverTiles: staticRow.coverTiles,
    });
    expect(merged?._id).toBe(dynamicRow._id);
    expect(JSON.stringify(merged?.walls)).toBe(JSON.stringify(staticRow.walls));
    expect(JSON.stringify(merged?.coverClusters)).toBe(
      JSON.stringify(staticRow.coverClusters),
    );
    expect(JSON.stringify(merged?.coverTiles)).toBe(
      JSON.stringify(staticRow.coverTiles),
    );
  });

  it("returns null when the dynamic worldState row is absent", () => {
    const merged = mergeWorldStateRows(
      null,
      {
        matchId: "match-1",
        walls: [],
        coverClusters: [],
        coverTiles: [],
      },
      "match-1",
    );

    expect(merged).toBeNull();
  });

  it("throws when dynamic worldState exists without static terrain", () => {
    expect(() =>
      mergeWorldStateRows(
        {
          matchId: "match-1",
          chests: [],
          corpses: [],
          evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null },
        },
        null,
        "match-1",
      ),
    ).toThrow("Missing worldStatic row for match match-1");
  });
});
