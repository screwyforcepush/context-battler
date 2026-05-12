// Phase 02 / WP-D — Vitest unit tests for the formatter helpers.
//
// TDD red phase: these tests pin the contracts of the small pure formatters
// used by HoverCard + ExpandModal. Each formatter's "happy path",
// null/undefined input, and edge values (zero, very large numbers) are
// covered per the WP-D scope in `work-packages.md`.

import { describe, expect, it } from "vitest";
import {
  formatLatencyMs,
  formatUsage,
  formatTurnCount,
  truncateMid,
  escapeForPre,
} from "../formatters";

describe("formatLatencyMs", () => {
  it("renders a positive integer ms", () => {
    expect(formatLatencyMs(123)).toBe("123 ms");
  });

  it("renders zero as `0 ms` (still a real measurement)", () => {
    expect(formatLatencyMs(0)).toBe("0 ms");
  });

  it("renders very large values", () => {
    expect(formatLatencyMs(1234567)).toBe("1234567 ms");
  });

  it("renders undefined as em-dash", () => {
    expect(formatLatencyMs(undefined)).toBe("—");
  });

  it("renders null as em-dash", () => {
    // The runtime type says `number | undefined`, but defensive code may
    // pass `null` through; we treat it identically to `undefined`.
    expect(formatLatencyMs(null as unknown as number | undefined)).toBe("—");
  });
});

describe("formatUsage", () => {
  it("renders all four fields when present", () => {
    expect(
      formatUsage({
        promptTokens: 1234,
        completionTokens: 234,
        reasoningTokens: 89,
        totalTokens: 1557,
      }),
    ).toBe("prompt: 1.2k · completion: 234 · reasoning: 89 · total: 1.6k");
  });

  it("omits absent fields and joins with the bullet separator", () => {
    expect(
      formatUsage({ promptTokens: 100, totalTokens: 200 }),
    ).toBe("prompt: 100 · total: 200");
  });

  it("renders undefined as em-dash", () => {
    expect(formatUsage(undefined)).toBe("—");
  });

  it("renders empty object as em-dash (no fields to show)", () => {
    expect(formatUsage({})).toBe("—");
  });

  it("formats zero as `0` (no abbreviation)", () => {
    expect(formatUsage({ promptTokens: 0, totalTokens: 0 })).toBe(
      "prompt: 0 · total: 0",
    );
  });

  it("abbreviates >= 1000 to one decimal `k`, exact 1000 → 1.0k", () => {
    expect(formatUsage({ promptTokens: 1000 })).toBe("prompt: 1.0k");
  });

  it("abbreviates large values rounded to one decimal", () => {
    expect(formatUsage({ promptTokens: 12345 })).toBe("prompt: 12.3k");
  });
});

describe("formatTurnCount", () => {
  it("renders `N / total`", () => {
    expect(formatTurnCount(3, 50)).toBe("3 / 50");
  });

  it("renders zero correctly (synthetic pre-game turn)", () => {
    expect(formatTurnCount(0, 50)).toBe("0 / 50");
  });

  it("renders the equal case", () => {
    expect(formatTurnCount(50, 50)).toBe("50 / 50");
  });
});

describe("truncateMid", () => {
  it("returns the input verbatim when it fits", () => {
    expect(truncateMid("abc", 10)).toBe("abc");
  });

  it("truncates middle with ellipsis when too long", () => {
    // For "abcdefghij" max=7 → 3 head + ellipsis + 3 tail = "abc…hij"
    expect(truncateMid("abcdefghij", 7)).toBe("abc…hij");
  });

  it("handles empty string", () => {
    expect(truncateMid("", 10)).toBe("");
  });

  it("handles tiny `max` gracefully (returns ellipsis only when max < 2)", () => {
    expect(truncateMid("abcdef", 1)).toBe("…");
  });

  it("handles a max equal to length (no truncation)", () => {
    expect(truncateMid("abcdef", 6)).toBe("abcdef");
  });
});

describe("escapeForPre", () => {
  it("returns the input string verbatim (HTML escape is React's job)", () => {
    expect(escapeForPre("hello <world> & 'friends'")).toBe(
      "hello <world> & 'friends'",
    );
  });

  it("returns empty string verbatim", () => {
    expect(escapeForPre("")).toBe("");
  });

  it("preserves whitespace and newlines for `<pre>` rendering", () => {
    const s = "line 1\n  line 2\n\tline 3";
    expect(escapeForPre(s)).toBe(s);
  });
});
