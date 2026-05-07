import { describe, expect, it } from "vitest";

describe("WP1 sanity — Vitest is wired", () => {
  it("runs a test and 1 + 1 === 2", () => {
    expect(1 + 1).toBe(2);
  });
});
