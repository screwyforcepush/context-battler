// Phase 02 / closure-readiness — Vitest unit tests for the TurnFeed
// scratchpad-preview truncation helper.
//
// Pinned by closure-readiness UAT ISSUE (review-B Med-1): collapsed feed
// rows must show a one-line ~100-char preview of `agentRecord.scratchpadAfter`.
// The helper handles two concerns: collapse newlines so the preview stays
// single-line, and clamp length with an ellipsis suffix.

import { describe, expect, it } from "vitest";
import { truncateOneLine } from "../TurnFeed";

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
