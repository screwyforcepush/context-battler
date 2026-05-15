import { describe, expect, it } from "vitest";
import {
  countEnvironmentalDeaths,
  parseTelefragFrequencyArgs,
} from "../../harness/telefrag-frequency.js";

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
});
