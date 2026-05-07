// WP6 — env-gated live integration tests against the real Azure deployment.
//
// Skipped by default. Run with:
//   set -a; source .env; set +a; VITEST_LLM=1 npm test -- integration
//
// Coverage (absorbed Spike A sanity per `de-risking.md` v1.2 + WP6 acceptance):
//   1. function_call emitted on the live happy path.
//   2. latencyMs <= 30_000 for reasoning.effort: "low".
//   3. JSON.parse(rawArguments) + Zod validation round-trip.
//   4. reasoning.effort: "low" plumbed end-to-end.
//
// Each test uses a synthetic system prompt + persona prompt + scratchpad +
// visibleStateDigest — a realistic "mid-game" frame to flex the contract.

import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import { callDecisionTool } from "../../convex/llm/azure.js";
import { parseDecision } from "../../convex/llm/decisionTool.js";

// Load .env once at module init so AZURE_* vars are available when the
// describe block evaluates `skipIf`. Idempotent — safe to call repeatedly.
loadDotenv();

const SHOULD_RUN = !!process.env.VITEST_LLM;

// Synthetic prompt for the live test. We deliberately enumerate the
// valid `kind` discriminators (move/action) so the model uses the locked
// vocabulary. Without this, gpt-5.4-mini at reasoning=low substitutes
// natural-language synonyms ("stay", "wait", "hide") that fail Zod's
// strict discriminated union — which would falsely look like a wrapper
// bug. The wrapper is correct; the prompt is what teaches the schema.
//
// WP8 (input builder) and WP9 (personas) will own the production version
// of this hint set; here we use it to test wrapper mechanics in isolation.
const SYNTHETIC_INPUT = {
  systemPrompt: [
    "You are an agent in a turn-based simulation. Each turn, call the `decide_turn` tool exactly once with a structured decision.",
    "",
    "Move kinds (use exactly one):",
    '- "relative" with integer dx,dy in [-12,12]',
    '- "toward_entity" with targetCharacterId',
    '- "away_from_entity" with targetCharacterId',
    '- "toward_object" with targetObjectId (chest or corpse id)',
    '- "toward_evac" (only meaningful after evac is revealed)',
    '- "none" (stand still)',
    "",
    "Action kinds (use exactly one):",
    '- "attack" with targetCharacterId',
    '- "interact" with targetObjectId',
    '- "loot" with targetCorpseId',
    '- "none"',
    "",
    'consume must be one of: "none" | "heal" | "speed".',
    'primary must be one of: "move" | "stationary_action" | "overwatch".',
    "",
    "Pick concrete ids. Use null for say/overwatch_priority/scratchpad_update if unused. Never ask questions.",
  ].join("\n"),
  personaPrompt: [
    "Persona: rat.",
    "You hide in cover, avoid combat, and head for evac when revealed.",
  ].join(" "),
  scratchpad: "Turn 9. Saw Player_3 SE last turn. Hidden in cover.",
  visibleStateDigest: [
    "Turn: 10/50  HP: 85  Equipped: rusty_blade / cloth / heal",
    "Visible:",
    "- Cover cluster, dist 0 here",
    "- Chest_3, dist 5 N",
    "Heard (last turn): (none)",
    "Last-known:",
    "- Player_3 last seen 4 tiles SE at turn 9",
    "Evac:",
    "- Hidden until turn 30",
    "Affordances:",
    "- overwatch, say <= 280",
  ].join("\n"),
  reasoningEffort: "low" as const,
  maxOutputTokens: 512,
};

describe.skipIf(!SHOULD_RUN)("WP6 Azure live integration (VITEST_LLM=1)", () => {
  it("emits a function_call on the happy path; wrapper does NOT fall back", async () => {
    const result = await callDecisionTool(SYNTHETIC_INPUT);

    if (result.fellBackToSafeDefault) {
      // Surface the failure reason + raw HTTP status in the assertion message.
      throw new Error(
        `wrapper fell back to safe-default; failureReason=${result.failureReason}, httpStatus=${result.raw.httpStatus}, rawArguments=${result.rawArguments}`,
      );
    }
    expect(result.fellBackToSafeDefault).toBe(false);
    expect(result.failureReason).toBeUndefined();
    expect(result.callId).not.toBeNull();
    expect(result.rawArguments).not.toBeNull();
    expect(result.raw.responseId).not.toBeNull();
    expect(result.raw.httpStatus).toBe(200);
  }, 60_000);

  it("latencyMs <= 30_000 (sanity bound for reasoning.effort=low)", async () => {
    const result = await callDecisionTool(SYNTHETIC_INPUT);
    // Always log for the required final-summary capture, even on pass.
    process.stdout.write(
      `[WP6 integration] observed latencyMs=${result.raw.latencyMs} fellBack=${result.fellBackToSafeDefault} failureReason=${result.failureReason ?? "<none>"}\n`,
    );
    expect(result.raw.latencyMs).toBeLessThanOrEqual(30_000);
  }, 60_000);

  it("rawArguments JSON-parses and validates against the Zod schema", async () => {
    const result = await callDecisionTool(SYNTHETIC_INPUT);
    if (result.fellBackToSafeDefault) {
      throw new Error(
        `wrapper fell back; cannot test parseDecision: failureReason=${result.failureReason}, rawArguments=${result.rawArguments}`,
      );
    }
    expect(result.rawArguments).not.toBeNull();
    const parsed = parseDecision(result.rawArguments!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // Sanity-check structure: every required key present.
      expect(parsed.decision).toHaveProperty("consume");
      expect(parsed.decision).toHaveProperty("primary");
      expect(parsed.decision).toHaveProperty("move");
      expect(parsed.decision).toHaveProperty("action");
    }
  }, 60_000);

  it("reasoning.effort=low produces a usable decision (no incomplete_details)", async () => {
    const result = await callDecisionTool({
      ...SYNTHETIC_INPUT,
      reasoningEffort: "low",
    });
    // The phase 1 binding policy (de-risking.md "Reasoning policy"): low is
    // the default and must be workable. If this test starts failing, the
    // policy escalation kicks in (lower concurrency / shrink prompt /
    // escalate to user) — NOT bumping to medium silently.
    expect(result.fellBackToSafeDefault).toBe(false);
    expect(result.failureReason).toBeUndefined();
  }, 60_000);
});
