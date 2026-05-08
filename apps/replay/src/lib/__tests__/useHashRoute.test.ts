// Phase 02 / WP-A — Vitest unit tests for the hash-route parser.
//
// TDD red phase: these tests pin the parser's contract before any
// implementation exists. The parser is the only piece of v0 routing that
// merits a unit test (per work-packages.md WP-A "Test strategy"); the
// rest of routing is two-route plumbing exercised by manual UAT.
//
// Contract under test (from architecture-decisions.md §6):
//
//   #/                      → { kind: "picker" }
//   #/match/<id>            → { kind: "replay", matchId: <id>, turn: null }
//   #/match/<id>?turn=N     → { kind: "replay", matchId: <id>, turn: N }
//   anything else           → { kind: "picker" } (graceful fallback)
//
// `parseHash` is exported as a *pure function* so the tests don't have to
// mount React or stub `window.location`. The hook (`useHashRoute`) wraps
// it with a `useState` + `hashchange` listener — that wrapper has no
// branches worth testing.

import { describe, expect, it } from "vitest";
import { parseHash } from "../useHashRoute";

describe("parseHash — picker route", () => {
  it("returns picker for empty hash", () => {
    expect(parseHash("")).toEqual({ kind: "picker" });
  });

  it("returns picker for `#`", () => {
    expect(parseHash("#")).toEqual({ kind: "picker" });
  });

  it("returns picker for `#/`", () => {
    expect(parseHash("#/")).toEqual({ kind: "picker" });
  });

  it("returns picker for malformed input — `#/foo`", () => {
    expect(parseHash("#/foo")).toEqual({ kind: "picker" });
  });

  it("returns picker for malformed input — `#/match` (no id)", () => {
    expect(parseHash("#/match")).toEqual({ kind: "picker" });
  });

  it("returns picker for malformed input — `#/match/` (empty id)", () => {
    expect(parseHash("#/match/")).toEqual({ kind: "picker" });
  });

  it("returns picker for plain text without leading `#`", () => {
    // The browser strips a missing leading hash; the parser still has to
    // be defensive in case it's called with a plain pathname.
    expect(parseHash("/match/abc")).toEqual({ kind: "picker" });
  });
});

describe("parseHash — replay route (no turn query)", () => {
  it("returns replay for `#/match/abc`", () => {
    expect(parseHash("#/match/abc")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: null,
    });
  });

  it("preserves Convex-style ids verbatim (mixed case + digits)", () => {
    expect(parseHash("#/match/jh7d2x9k0bM3p")).toEqual({
      kind: "replay",
      matchId: "jh7d2x9k0bM3p",
      turn: null,
    });
  });
});

describe("parseHash — replay route with `turn=N`", () => {
  it("parses `#/match/abc?turn=23` to numeric turn 23", () => {
    expect(parseHash("#/match/abc?turn=23")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: 23,
    });
  });

  it("parses `#/match/abc?turn=0` to numeric turn 0 (synthetic pre-game)", () => {
    expect(parseHash("#/match/abc?turn=0")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: 0,
    });
  });

  it("falls back to turn=null when `turn` is non-numeric", () => {
    expect(parseHash("#/match/abc?turn=abc")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: null,
    });
  });

  it("falls back to turn=null when `turn` is empty", () => {
    expect(parseHash("#/match/abc?turn=")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: null,
    });
  });

  it("falls back to turn=null when `turn` is negative", () => {
    // The slider range is `0..match.turn`; negative is not a real turn.
    expect(parseHash("#/match/abc?turn=-1")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: null,
    });
  });

  it("ignores unrelated query params alongside turn", () => {
    expect(parseHash("#/match/abc?turn=5&other=x")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: 5,
    });
  });

  it("ignores unrelated query params without a turn key", () => {
    expect(parseHash("#/match/abc?foo=bar")).toEqual({
      kind: "replay",
      matchId: "abc",
      turn: null,
    });
  });
});
