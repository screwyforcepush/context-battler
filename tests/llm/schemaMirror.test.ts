// Phase-3 WP-A.5 / WP-F.6 — Mirror parity test (live-export comparison).
//
// `convex/_internal_runMatch.ts` carries hand-mirrored copies of the
// agent-record + resolution validators that live canonically in
// `convex/schema.ts`:
//   - `actionValidator`, `decisionValidator`, `agentLlmValidator`,
//     `agentRecordValidator`
//   - `resolutionValidator` — including `actions[]` (with optional
//     `fromOverwatch`+`stance` per ADR §3) and `moves[]` (with optional
//     `blockedBy: "wall"` per ADR §9)
//
// The mirror MUST stay in lockstep with `convex/schema.ts`; any drift
// rejects every new-shape `recordTurn`/`persistTurn` mutation row at
// runtime. Drift is invisible at the convex codegen level because
// `_internal_runMatch.ts` re-declares the validators inline rather than
// re-importing them.
//
// ─── WP-F.6 refactor (Reviewer-B Med fix) ─────────────────────────────────
// The prior version of this test re-declared the expected validator shapes
// inline, then asserted those re-declarations matched themselves — which
// could not detect drift. It just rebroadcast whatever the test author
// wrote.
//
// This version compares the LIVE validator-JSON exported from BOTH source
// modules. Convex `Validator` instances expose a stable `.json` getter
// (see `node_modules/convex/dist/esm/values/validators.js`); `defineSchema`
// preserves each table's row validator at `schema.tables.<name>.validator`,
// and `mutation({ args: ... })` exposes the args validator JSON via the
// `exportArgs()` helper attached to the registered function. We pull the
// agent-record validator and resolution validator from each module via
// these public-Convex surfaces and assert byte-level JSON equality.
//
// ─── Manual regression-direction verification (per WP-F.6 §4) ─────────────
// To confirm this test detects drift, I temporarily edited
// `convex/_internal_runMatch.ts` to drop `fromOverwatch` from the
// `actions[]` mirror element validator. Re-running this suite produced the
// expected RED:
//   `expected: '"fromOverwatch":...'` present in schema JSON,
//   `actual:   '...'` absent in mirror JSON
// Restoring the field returned the suite to GREEN. The structural-
// fingerprint comparison is genuinely load-bearing now — drift in either
// direction (field add, field remove, field rename, optional flip,
// literal-value change, union-member reorder) trips the byte-equality
// assertion.

import { describe, expect, it } from "vitest";
import { v } from "convex/values";
import type { ParsedDecision } from "../../convex/engine/types.js";

import schema from "../../convex/schema.js";
import * as runMatchInternals from "../../convex/_internal_runMatch.js";

// ─── Helpers: pull validator JSON from each source ────────────────────────
//
// `schema.tables.turns.validator` is a `VObject` with `.fields.<name>` on
// the row shape; we descend into `agentRecords.element` and `resolution`
// to get the per-record / per-trace validators.
//
// `runMatchInternals.persistTurn.exportArgs()` returns the JSON-stringified
// args validator object (same `.json` shape: `{ type: "object", value: {
// <name>: { fieldType: <inner>, optional } } }`). The `agentRecords` arg
// is an array; the element is the mirror agentRecord validator.

type ValidatorJson = unknown;

interface ValidatorWithJson {
  json: ValidatorJson;
  kind?: string;
  fields?: Record<string, ValidatorWithJson>;
  element?: ValidatorWithJson;
}

function schemaValidators(): {
  agentRecord: ValidatorJson;
  resolution: ValidatorJson;
} {
  const turnsRow = schema.tables.turns.validator as unknown as ValidatorWithJson;
  const fields = turnsRow.fields;
  if (!fields) {
    throw new Error("schema.tables.turns.validator.fields missing");
  }
  const agentRecordsArr = fields.agentRecords;
  const resolution = fields.resolution;
  if (!agentRecordsArr?.element || !resolution) {
    throw new Error(
      "schema.tables.turns.validator.fields.agentRecords.element or .resolution missing",
    );
  }
  return {
    agentRecord: agentRecordsArr.element.json,
    resolution: resolution.json,
  };
}

interface ConvexFunction {
  exportArgs: () => string;
}

// Convex `mutation({ args })` JSON layout:
//   { type: "object", value: { <argName>: { fieldType: <innerJson>, optional } } }
interface ConvexArgsJson {
  type: "object";
  value: Record<string, { fieldType: ValidatorJson; optional: boolean }>;
}
interface ConvexArrayJson {
  type: "array";
  value: ValidatorJson;
}

function isArrayJson(j: ValidatorJson): j is ConvexArrayJson {
  return (
    typeof j === "object" &&
    j !== null &&
    (j as { type?: string }).type === "array"
  );
}

function mirrorValidators(): {
  agentRecord: ValidatorJson;
  resolution: ValidatorJson;
} {
  const persistTurn = runMatchInternals.persistTurn as unknown as ConvexFunction;
  const argsJson = JSON.parse(persistTurn.exportArgs()) as ConvexArgsJson;
  const agentRecordsField = argsJson.value.agentRecords;
  const resolutionField = argsJson.value.resolution;
  if (!agentRecordsField || !resolutionField) {
    throw new Error(
      "_internal_runMatch.persistTurn args missing agentRecords/resolution",
    );
  }
  const agentRecordsArr = agentRecordsField.fieldType;
  if (!isArrayJson(agentRecordsArr)) {
    throw new Error(
      "_internal_runMatch.persistTurn.args.agentRecords is not an array validator",
    );
  }
  return {
    agentRecord: agentRecordsArr.value,
    resolution: resolutionField.fieldType,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("phase-3 WP-F.6 — schema↔mirror parity (live validator exports)", () => {
  // The load-bearing assertion: byte-level equality of validator JSON
  // between `convex/schema.ts` and `convex/_internal_runMatch.ts`.
  // Drift in either direction (add/remove/rename/optional-flip/
  // literal-change/union-reorder) produces non-equal JSON.

  it("agentRecord validator JSON is identical between schema and mirror", () => {
    const fromSchema = schemaValidators().agentRecord;
    const fromMirror = mirrorValidators().agentRecord;
    expect(JSON.stringify(fromMirror)).toBe(JSON.stringify(fromSchema));
  });

  it("resolution validator JSON is identical between schema and mirror", () => {
    const fromSchema = schemaValidators().resolution;
    const fromMirror = mirrorValidators().resolution;
    expect(JSON.stringify(fromMirror)).toBe(JSON.stringify(fromSchema));
  });

  // ─── Phase-3 contract sentinels (regression-only) ──────────────────────
  // These guard against accidental re-introduction of pre-phase-3 shapes
  // even if BOTH modules are edited consistently. They read the live
  // schema JSON, so they double as "did the schema actually change?" smoke.

  it("decision validator carries phase-3 contract (overwatch_stance, no overwatch_priority, no interact)", () => {
    const turnsRow = schema.tables.turns.validator as unknown as ValidatorWithJson;
    const agentRecordEl = turnsRow.fields?.agentRecords?.element;
    const decisionField = agentRecordEl?.fields?.decision;
    if (!decisionField) {
      throw new Error("schema agentRecord.decision field missing");
    }
    const stringified = JSON.stringify(decisionField.json);

    // ADR §1 — overwatch_priority REMOVED, replaced by overwatch_stance.
    expect(stringified).toContain('"overwatch_stance"');
    expect(stringified).not.toContain('"overwatch_priority"');

    // ADR §1 — loot.targetCorpseId RENAMED to loot.targetId.
    expect(stringified).toContain('"targetId"');
    expect(stringified).not.toContain('"targetCorpseId"');

    // ADR §1 — action union: attack | loot | none. interact arm REMOVED.
    expect(stringified).toContain('"loot"');
    expect(stringified).toContain('"attack"');
    expect(stringified).not.toContain('"interact"');
  });

  it("resolution.actions[] carries optional fromOverwatch + stance per ADR §3", () => {
    const fromSchema = schemaValidators().resolution;
    const stringified = JSON.stringify(fromSchema);
    expect(stringified).toContain('"fromOverwatch"');
    expect(stringified).toContain('"stance"');
    expect(stringified).toContain('"offensive"');
    expect(stringified).toContain('"defensive"');
  });

  it("resolution.moves[] carries optional blockedBy: 'wall' per ADR §9", () => {
    const fromSchema = schemaValidators().resolution;
    const stringified = JSON.stringify(fromSchema);
    expect(stringified).toContain('"blockedBy"');
    // The literal value must be exactly "wall" (single-member literal).
    expect(stringified).toContain('"wall"');
  });

  it("agentLlm.reasoning is required-nullable (string|null), NOT v.optional", () => {
    // Per ADR §2 / PM lock D13. `undefined !== null` counting bugs are
    // avoided by construction: every persisted row carries the field with
    // null as the unambiguous "not captured" sentinel.
    const turnsRow = schema.tables.turns.validator as unknown as ValidatorWithJson;
    const llmField = turnsRow.fields?.agentRecords?.element?.fields?.llm;
    if (!llmField) {
      throw new Error("schema agentRecord.llm field missing");
    }
    const llmJson = llmField.json as {
      type: string;
      value: Record<string, { fieldType: { type: string }; optional: boolean }>;
    };
    const reasoning = llmJson.value.reasoning;
    expect(reasoning).toBeDefined();
    // Required-nullable: optional MUST be false; type MUST be "union".
    expect(reasoning?.optional).toBe(false);
    expect(reasoning?.fieldType.type).toBe("union");
  });
});

// ─── TS-compile-time guard (cheapest mirror-parity for ParsedDecision) ────
//
// If `engine/types.ts` drifts (e.g. someone re-adds `interact` to
// `ActionDecision` or restores `overwatch_priority`), this construction
// fails to compile. The runtime `expect`s are nominal — the value here is
// the TS check.
describe("phase-3 — ParsedDecision shape (TS-compile guard)", () => {
  it("a sample ParsedDecision typechecks against the new-shape contract", () => {
    const sample: ParsedDecision = {
      consume: "none",
      primary: "overwatch",
      move: { kind: "none" },
      action: { kind: "none" },
      say: null,
      overwatch_stance: "defensive",
      scratchpad_update: null,
    };
    expect(sample.overwatch_stance).toBe("defensive");
    expect(sample.action.kind).toBe("none");
    // Touch `v` so the import isn't a dead reference (kept for the
    // rare-but-real future case where this file grows a bespoke fixture
    // validator alongside the live-export comparisons above).
    expect(v).toBeDefined();
  });
});
