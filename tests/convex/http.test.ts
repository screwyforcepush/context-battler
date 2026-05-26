import { describe, expect, it } from "vitest";
import type { Doc, Id, TableNames } from "../../convex/_generated/dataModel.js";
import {
  handleExportMatch,
  handleListMatches,
  json,
  preflight,
} from "../../convex/http.js";
import { getMapDescriptor, expandMap } from "../../convex/engine/map.js";
import type { ReplayBundle, ReplayWorldState } from "../../convex/replay/reconstruct.js";

function id<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

function request(path: string): Request {
  return new Request(`https://example.test${path}`);
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function expectCors(response: Response) {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  // Regression lock: Godot's WASM HTTPRequest sends Cache-Control and Pragma
  // on every cross-origin fetch, and the browser rejects the preflight with
  // "Request header field cache-control is not allowed" unless the response
  // lists them. Surfaced during blind UAT of the d-full-match prototype.
  const allowHeaders = response.headers.get("Access-Control-Allow-Headers") ?? "";
  expect(allowHeaders).toMatch(/Cache-Control/i);
  expect(allowHeaders).toMatch(/Pragma/i);
}

function minimalBundle(status: Doc<"matches">["status"] = "completed"): ReplayBundle {
  const descriptor = getMapDescriptor("reference");
  const world = expandMap(descriptor, "http-test");
  const character = {
    _id: id<"characters">("char_alpha"),
    _creationTime: 1,
    matchId: id<"matches">("match_http"),
    personaId: "rat",
    spawnIndex: 0,
    displayName: "Alpha",
    hp: 50,
    pos: descriptor.spawns[0]!,
    equipped: {},
    scratchpad: "",
    hidden: false,
    alive: true,
    lastKnown: [],
  } as unknown as Doc<"characters">;
  return {
    match: {
      _id: id<"matches">("match_http"),
      _creationTime: 1,
      status,
      turn: 1,
      startedAt: 100,
      completedAt: status === "completed" ? 200 : null,
      mapId: "reference",
      rngSeed: "http-test",
      outcome: { extracted: [], pointsByCharacter: [] },
    } as unknown as Doc<"matches">,
    turns: [
      {
        _id: id<"turns">("turn_1"),
        _creationTime: 1,
        matchId: id<"matches">("match_http"),
        turn: 1,
        agentRecords: [],
        resolution: {
          consumed: [],
          speech: [],
          moves: [],
          actions: [],
          deaths: [],
          environmentalDeaths: [],
          visibilityUpdates: [],
        },
      } as unknown as Doc<"turns">,
    ],
    characters: [character],
    worldState: {
      _id: id<"worldState">("world_http"),
      _creationTime: 1,
      matchId: id<"matches">("match_http"),
      ...world,
    } as unknown as ReplayWorldState,
    promptsLookup: { system: {}, persona: {} },
  };
}

function ctxReturning(value: unknown) {
  return {
    runQuery: async () => value,
  };
}

describe("Convex replay HTTP helpers", () => {
  it("serialises JSON with CORS headers", async () => {
    const response = json({ ok: true }, 202);

    expect(response.status).toBe(202);
    expectCors(response);
    expect(await body(response)).toEqual({ ok: true });
  });

  it("returns CORS preflight responses", () => {
    const response = preflight();

    expect(response.status).toBe(204);
    expectCors(response);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("lists completed matches as joined summaries", async () => {
    const bundle = minimalBundle();
    const response = await handleListMatches(
      ctxReturning([{ match: bundle.match, characters: bundle.characters }]),
    );
    const parsed = (await response.json()) as Array<{
      matchId: string;
      characterIds: string[];
      characterCount: number;
    }>;

    expect(response.status).toBe(200);
    expectCors(response);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.matchId).toBe("match_http");
    expect(parsed[0]?.characterIds).toEqual(["char_alpha"]);
    expect(parsed[0]?.characterIds).toHaveLength(parsed[0]?.characterCount ?? 0);
  });

  it("returns 400 when matchId is missing", async () => {
    const response = await handleExportMatch(ctxReturning(null), request("/replay/exportMatch"));

    expect(response.status).toBe(400);
    expectCors(response);
    expect(await body(response)).toEqual({ error: "missing_match_id" });
  });

  it("returns 400 when Convex id validation rejects a malformed matchId", async () => {
    const response = await handleExportMatch(
      {
        runQuery: async () => {
          throw new Error("Invalid id");
        },
      },
      request("/replay/exportMatch?matchId=not-a-real-id"),
    );

    expect(response.status).toBe(400);
    expectCors(response);
    expect(await body(response)).toEqual({ error: "bad_match_id" });
  });

  it("returns 404 for a well-formed but absent match", async () => {
    const response = await handleExportMatch(
      ctxReturning(null),
      request("/replay/exportMatch?matchId=match_absent"),
    );

    expect(response.status).toBe(404);
    expectCors(response);
    expect(await body(response)).toEqual({ error: "not_found" });
  });

  it("returns 409 for in-progress matches", async () => {
    const response = await handleExportMatch(
      ctxReturning(minimalBundle("running")),
      request("/replay/exportMatch?matchId=match_http"),
    );

    expect(response.status).toBe(409);
    expectCors(response);
    expect(await body(response)).toEqual({
      error: "match_not_completed",
      status: "running",
    });
  });

  it("exports completed matches with CORS headers", async () => {
    const response = await handleExportMatch(
      ctxReturning(minimalBundle()),
      request("/replay/exportMatch?matchId=match_http"),
    );
    const parsed = (await response.json()) as {
      schemaVersion: number;
      movements: unknown[];
      attacks: unknown[];
      loots: unknown[];
    };

    expect(response.status).toBe(200);
    expectCors(response);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.movements).toEqual([]);
    expect(parsed.attacks).toEqual([]);
    expect(parsed.loots).toEqual([]);
  });
});
