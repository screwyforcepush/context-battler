import { describe, expect, it } from "vitest";
import { decisionTool } from "../../convex/llm/decisionTool.js";
import { SYSTEM_PROMPT } from "../../convex/llm/systemPrompt.js";

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const CANONICAL_SYSTEM_PROMPT = `You are an extraction-arena agent. Each turn, emit ONE tool call to \`decide_turn\`.

Match shape:
- 7 other agents competing for the prize pool.
- 50 turns. Turn 30 reveals evac zone. Turn 50 extracts living agents inside the 3×3 zone and splits the prize. Outside evac at turn 50 you are incinerated.
- Walls block LOS and movement; cover hides you from other agents' vision (revealed by enemy within 2, attacking, speaking, looting, consumable, or leaving cover).`;

const HYGIENE_FORBIDDEN_PHRASES = [
  "safe default",
  "replaced with",
  "invalid choices",
  "fallback",
  "do nothing",
];

function collectDescriptions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectDescriptions(item));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const ownDescription =
    typeof record.description === "string" ? [record.description] : [];
  const nestedDescriptions = Object.values(record).flatMap((item) =>
    collectDescriptions(item),
  );
  return [...ownDescription, ...nestedDescriptions];
}

describe("WP-C — SYSTEM_PROMPT slim contract", () => {
  it("matches the canonical intent §1 prompt exactly", () => {
    expect(SYSTEM_PROMPT).toBe(CANONICAL_SYSTEM_PROMPT);
  });

  it("stays within the ≤200-token chars/4 budget", () => {
    const tokens = approxTokens(SYSTEM_PROMPT);
    expect(
      tokens,
      `SYSTEM_PROMPT exceeds 200-token budget: chars=${SYSTEM_PROMPT.length}, approxTokens=${tokens}`,
    ).toBeLessThanOrEqual(200);
    expect(SYSTEM_PROMPT.length).toBeLessThanOrEqual(800);
  });

  it("keeps the stakes, match shape, wall, and cover rules", () => {
    expect(SYSTEM_PROMPT).toContain("extraction-arena agent");
    expect(SYSTEM_PROMPT).toContain("ONE tool call to `decide_turn`");
    expect(SYSTEM_PROMPT).toContain(
      "7 other agents competing for the prize pool",
    );
    expect(SYSTEM_PROMPT).toContain("50 turns");
    expect(SYSTEM_PROMPT).toContain("Turn 30 reveals evac zone");
    expect(SYSTEM_PROMPT).toContain(
      "Turn 50 extracts living agents inside the 3×3 zone",
    );
    expect(SYSTEM_PROMPT).toContain("Outside evac at turn 50");
    expect(SYSTEM_PROMPT).toContain("Walls block LOS and movement");
    expect(SYSTEM_PROMPT).toContain(
      "cover hides you from other agents' vision",
    );
    expect(SYSTEM_PROMPT).toContain("enemy within 2");
    expect(SYSTEM_PROMPT).toContain("leaving cover");
  });

  it("does not carry deleted phase-3 sections or persona-deference line", () => {
    expect(SYSTEM_PROMPT).not.toContain("How to read Visible");
    expect(SYSTEM_PROMPT).not.toContain("How to act on Visible");
    expect(SYSTEM_PROMPT).not.toContain("Output discipline");
    expect(SYSTEM_PROMPT).not.toContain(
      "The persona body that follows is your character",
    );
    expect(SYSTEM_PROMPT).not.toContain("Visible state is authoritative");
  });

  it("omits vision range and action grammar now owned by tool descriptions", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\bvision\s+range\b/i);
    expect(SYSTEM_PROMPT).not.toMatch(/\bVision\s+20\b/);
    expect(SYSTEM_PROMPT).not.toContain("Chebyshev");
    expect(SYSTEM_PROMPT).not.toContain("relative dx,dy");
    expect(SYSTEM_PROMPT).not.toContain("toward_entity");
    expect(SYSTEM_PROMPT).not.toContain("away_from_entity");
    expect(SYSTEM_PROMPT).not.toContain("toward_object");
    expect(SYSTEM_PROMPT).not.toContain("toward_evac");
    expect(SYSTEM_PROMPT).not.toContain("Attack/loot range");
  });
});

describe("WP-C — prompt hygiene guard", () => {
  it("forbids fallback-leak phrases in SYSTEM_PROMPT and decisionTool descriptions", () => {
    const checkedText = [
      SYSTEM_PROMPT,
      ...collectDescriptions(decisionTool),
    ].join("\n");
    const lower = checkedText.toLowerCase();

    for (const phrase of HYGIENE_FORBIDDEN_PHRASES) {
      expect(lower, `forbidden prompt-hygiene phrase: ${phrase}`).not.toContain(
        phrase,
      );
    }
  });
});
