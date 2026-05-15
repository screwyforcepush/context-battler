import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import {
  countEnvironmentalDeaths,
  parseTelefragFrequencyArgs,
  runTelefragFrequencyExperiment,
} from "../../harness/telefrag-frequency.js";

function refName(ref: unknown): string {
  if (typeof ref === "string") return ref;
  try {
    return getFunctionName(ref as never);
  } catch {
    return "";
  }
}

describe("telefrag-frequency harness", () => {
  it("counts optional environmentalDeaths defensively", () => {
    expect(
      countEnvironmentalDeaths([
        { resolution: { environmentalDeaths: ["a", "b"] } },
        { resolution: {} },
        { resolution: { environmentalDeaths: ["c"] } },
      ]),
    ).toBe(3);
  });

  it("defaults to the 10-run stopAtRange 0 vs 2 experiment", () => {
    expect(parseTelefragFrequencyArgs([])).toMatchObject({
      runsPerCohort: 10,
      concurrency: 1,
      reasoning: "low",
      cohorts: [0, 2],
    });
  });

  it("nudges a stale running match instead of polling forever", async () => {
    let now = 0;
    let actionCalls = 0;
    const events: unknown[] = [];
    const client = {
      mutation: async () => "match_1",
      action: async (ref: unknown, args: unknown) => {
        expect(refName(ref)).toBe("runMatch:advanceTurn");
        expect(args).toEqual({ matchId: "match_1" });
        actionCalls += 1;
        return null;
      },
      query: async (ref: unknown) => {
        const name = refName(ref);
        if (name === "matches:status") {
          return actionCalls === 0
            ? { status: "running", turn: 40, completedAt: null }
            : { status: "completed", turn: 50, completedAt: 1 };
        }
        if (name === "turns:byMatchSlim") {
          return [
            { resolution: { environmentalDeaths: ["char_1"] } },
            { resolution: {} },
          ];
        }
        return null;
      },
    };

    const result = await runTelefragFrequencyExperiment(
      {
        runsPerCohort: 1,
        concurrency: 1,
        reasoning: "low",
        seedPrefix: "stale",
        cohorts: [0],
        help: false,
      },
      {
        client,
        emitEvent: (event) => events.push(event),
        writeStderr: () => {},
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        poll: {
          intervalMs: 1,
          staleTurnAdvanceAfterMs: 2,
          matchWallClockCapMs: 100,
          maxStaleAdvanceAttempts: 1,
        },
      },
    );

    expect(actionCalls).toBe(1);
    expect(result).toMatchObject({
      exitCode: 0,
      cohorts: [
        {
          completed: 1,
          failed: 0,
          environmentalDeaths: 1,
          telefragDeaths: 1,
          matchIds: ["match_1"],
        },
      ],
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "stale_match_advance",
        matchId: "match_1",
        turn: 40,
        attempt: 1,
      }),
    );
  });

  it("fails loudly when a stale running match cannot be advanced", async () => {
    let now = 0;
    const events: unknown[] = [];
    const stderr: string[] = [];
    const client = {
      mutation: async () => "match_1",
      query: async (ref: unknown) =>
        refName(ref) === "matches:status"
          ? { status: "running", turn: 46, completedAt: null }
          : null,
    };

    const result = await runTelefragFrequencyExperiment(
      {
        runsPerCohort: 1,
        concurrency: 1,
        reasoning: "low",
        seedPrefix: "no-action",
        cohorts: [0],
        help: false,
      },
      {
        client,
        emitEvent: (event) => events.push(event),
        writeStderr: (line) => stderr.push(line),
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        poll: {
          intervalMs: 1,
          staleTurnAdvanceAfterMs: 2,
          matchWallClockCapMs: 100,
          maxStaleAdvanceAttempts: 1,
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.cohorts[0]).toMatchObject({ completed: 0, failed: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "run_end",
        matchId: "match_1",
        status: "failed",
        turn: 46,
        reason: expect.stringContaining("runMatch:advanceTurn"),
      }),
    );
    expect(stderr.join("")).toContain("stale_match_unadvanceable");
  });

  it("reports timeout with the last observed turn and reason", async () => {
    let now = 0;
    const events: unknown[] = [];
    const client = {
      mutation: async () => "match_1",
      action: async () => null,
      query: async (ref: unknown) =>
        refName(ref) === "matches:status"
          ? { status: "running", turn: 46, completedAt: null }
          : null,
    };

    const result = await runTelefragFrequencyExperiment(
      {
        runsPerCohort: 1,
        concurrency: 1,
        reasoning: "low",
        seedPrefix: "timeout",
        cohorts: [0],
        help: false,
      },
      {
        client,
        emitEvent: (event) => events.push(event),
        writeStderr: () => {},
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        poll: {
          intervalMs: 1,
          staleTurnAdvanceAfterMs: 1_000,
          matchWallClockCapMs: 3,
          maxStaleAdvanceAttempts: 1,
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "run_end",
        matchId: "match_1",
        status: "timeout",
        turn: 46,
        reason: expect.stringContaining("timed out"),
      }),
    );
  });
});
