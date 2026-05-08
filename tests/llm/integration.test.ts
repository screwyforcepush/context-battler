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
// Each test uses the production `SYSTEM_PROMPT` (phase-3 schema teacher) +
// a phase-3-shaped persona prompt + scratchpad + visibleStateDigest — a
// realistic "mid-game" frame to flex the 7-field decision contract end to
// end against the live Azure deployment.
//
// WP-H.3 (phase-3 corrective slice 3): refreshed from the deleted phase-1
// vocabulary fixture (interact / targetCorpseId / overwatch_priority /
// Heard / Last-known / Evac: digest header / Affordances). The prior
// synthetic system prompt duplicated a now-stale schema cheat-sheet; this
// rewrite imports the canonical SYSTEM_PROMPT verbatim so the live test
// can never again drift from production.

import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import { callDecisionTool } from "../../convex/llm/azure.js";
import { parseDecision } from "../../convex/llm/decisionTool.js";
import { SYSTEM_PROMPT } from "../../convex/llm/systemPrompt.js";

// Load .env once at module init so AZURE_* vars are available when the
// describe block evaluates `skipIf`. Idempotent — safe to call repeatedly.
loadDotenv();

const SHOULD_RUN = !!process.env.VITEST_LLM;

// Synthetic phase-3 input. The system prompt is the production
// `SYSTEM_PROMPT` verbatim (it teaches the digest's typed-id glossary +
// the 7-field decision schema), and the user-frame is shaped exactly like
// `convex/llm/inputBuilder.ts#buildVisibleStateDigest` emits per WP-C.6.
//
// Phase-3 digest shape (no `Heard`/`Last-known`/`Evac:` blocks; per-Visible
// observation brackets carry last-turn speech):
//
//   You: at (X,Y), HP/maxHP, weapon/armour/consumable, in evac zone
//   Last turn (you): <move outcome>, <action outcome>, <damage from whom>, said "..."
//   Visible:
//   - Player_N, dist N <bearing> [HP~mid, holding axe, attacked Player_X]
//   - Chest_NNN, dist N <bearing> [opened]
//   - Corpse_PlayerN, dist N <bearing> [drained]
//   - Cover_X_Y, dist N <bearing>
//   - Wall_X_Y, dist N <bearing>
//   - Evac, dist N <bearing>
const SYNTHETIC_INPUT = {
  systemPrompt: SYSTEM_PROMPT,
  personaPrompt: [
    "Persona: rat.",
    "You hide in cover, avoid combat, and head for evac when revealed.",
  ].join(" "),
  scratchpad: "Turn 9. Saw Player_3 SE last turn. Hidden in cover.",
  visibleStateDigest: [
    "You: at (32,28), 85/100, rusty_blade/cloth/heal, outside evac",
    "Last turn (you): moved SE (3 tiles), no action, no damage",
    "Visible:",
    "- Player_3, dist 4 SE [HP~mid, holding sword]",
    "- Chest_003, dist 5 N",
    "- Cover_32_28, dist 0 here",
    "- Wall_31_28, dist 1 W",
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

  it("rawArguments JSON-parses and validates against the phase-3 7-field Zod schema", async () => {
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
      // Phase-3 ADR §1 / WP-G.2 D39 PM-lock: all 7 declared properties
      // are required. Sanity-check structure: every required key present.
      expect(parsed.decision).toHaveProperty("consume");
      expect(parsed.decision).toHaveProperty("primary");
      expect(parsed.decision).toHaveProperty("move");
      expect(parsed.decision).toHaveProperty("action");
      expect(parsed.decision).toHaveProperty("say");
      expect(parsed.decision).toHaveProperty("overwatch_stance");
      expect(parsed.decision).toHaveProperty("scratchpad_update");
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
