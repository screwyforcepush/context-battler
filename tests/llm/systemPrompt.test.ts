import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decisionTool } from "../../convex/llm/decisionTool.js";
import { buildSystemPrompt } from "../../convex/llm/systemPrompt.js";

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function promptHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const CANONICAL_TURN_5_PROMPT = `You are <Player Name>, extraction-arena agent. Each turn, emit ONE tool call to \`decide_turn\`.
Match shape:
- 7 other agents competing for the prize pool.
- On turn 50, living agents Inside the Evac 3×3 zone are extracted and split the prize. You will be incinerated if outside Evac at turn 50.
- Evac location spawns in 25 turns.
- Walls block LOS and movement.
- Cover hides you from other agents' vision (revealed by enemy within 2, attacking, speaking, looting, consumable).
- Move range max 8 dist + Attack/loot range 2 = move attack/loot 10.`;

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

describe("WP-A5 — system prompt slim contract", () => {
  it("matches the canonical iter-3 turn-bound prompt at turn 5", () => {
    expect(buildSystemPrompt(5)).toBe(CANONICAL_TURN_5_PROMPT);
  });

  it("flips countdown text at turn 30", () => {
    expect(buildSystemPrompt(29)).toContain(
      "Evac location spawns in 1 turns.",
    );
    expect(buildSystemPrompt(30)).toContain("Extraction in 20 turns.");
    expect(buildSystemPrompt(35)).toContain("Extraction in 15 turns.");
  });

  it("produces turn-bound prompt text and hashes", () => {
    const turn5 = buildSystemPrompt(5);
    const turn35 = buildSystemPrompt(35);

    expect(turn5).not.toBe(turn35);
    expect(promptHash(turn5)).not.toBe(promptHash(turn35));
    expect(turn5).toContain("Evac location spawns in 25 turns.");
    expect(turn35).toContain("Extraction in 15 turns.");
  });

  it("stays within the ≤200-token chars/4 budget", () => {
    const prompt = buildSystemPrompt(5);
    const tokens = approxTokens(prompt);
    expect(
      tokens,
      `system prompt exceeds 200-token budget: chars=${prompt.length}, approxTokens=${tokens}`,
    ).toBeLessThanOrEqual(200);
    expect(prompt.length).toBeLessThanOrEqual(800);
  });

  it("keeps the stakes, match shape, wall, and cover rules", () => {
    const prompt = buildSystemPrompt(5);
    expect(prompt).toContain(
      "You are <Player Name>, extraction-arena agent",
    );
    expect(prompt).toContain("ONE tool call to `decide_turn`");
    expect(prompt).toContain(
      "7 other agents competing for the prize pool",
    );
    expect(prompt).toContain(
      "On turn 50, living agents Inside the Evac 3×3 zone are extracted",
    );
    expect(prompt).toContain("incinerated if outside Evac at turn 50");
    expect(prompt).toContain("Evac location spawns in 25 turns");
    expect(prompt).toContain("Walls block LOS and movement");
    expect(prompt).toContain(
      "Cover hides you from other agents' vision",
    );
    expect(prompt).toContain("enemy within 2");
    expect(prompt).not.toContain("leaving cover");
    expect(prompt).toContain(
      "Move range max 8 dist + Attack/loot range 2 = move attack/loot 10.",
    );
  });

  it("does not carry deleted phase-3 sections or persona-deference line", () => {
    const prompt = buildSystemPrompt(5);
    expect(prompt).not.toContain("How to read Visible");
    expect(prompt).not.toContain("How to act on Visible");
    expect(prompt).not.toContain("Output discipline");
    expect(prompt).not.toContain(
      "The persona body that follows is your character",
    );
    expect(prompt).not.toContain("Visible state is authoritative");
  });

  it("omits vision range and detailed action grammar now owned by tool descriptions", () => {
    const prompt = buildSystemPrompt(5);
    expect(prompt).not.toMatch(/\bvision\s+range\b/i);
    expect(prompt).not.toMatch(/\bVision\s+20\b/);
    expect(prompt).not.toContain("Chebyshev");
    expect(prompt).not.toContain("relative dx,dy");
    expect(prompt).not.toContain("toward_entity");
    expect(prompt).not.toContain("away_from_entity");
    expect(prompt).not.toContain("toward_object");
    expect(prompt).not.toContain("toward_evac");
  });
});

describe("WP-A5 — prompt hygiene guard", () => {
  it("forbids fallback-leak phrases in system prompt and decisionTool descriptions", () => {
    const checkedText = [
      buildSystemPrompt(5),
      buildSystemPrompt(35),
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
