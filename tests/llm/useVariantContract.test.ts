import { describe, expect, it, vi } from "vitest";
import type { CharacterState, ParsedDecision } from "../../convex/engine/types.js";
import { callDecisionTool } from "../../convex/llm/azure.js";
import {
  buildAgentInputRecord,
  useVariantForActor,
} from "../../convex/runMatch.js";

const DECISION: ParsedDecision = {
  use: null,
  position: { kind: "move", direction: { kind: "N" }, dist: 0 },
  action: { kind: "none" },
  say: null,
  scratchpad: null,
};

function character(
  equipped: CharacterState["equipped"],
): Pick<CharacterState, "equipped"> {
  return { equipped };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function responseBody(decision: ParsedDecision = DECISION) {
  return {
    id: "resp_use_variant",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "function_call",
        name: "decide_turn",
        call_id: "call_use_variant",
        arguments: JSON.stringify(decision),
      },
    ],
    usage: null,
  };
}

describe("phase-6 useVariant contract", () => {
  it("computes runMatch useVariant from equipped consumable state", () => {
    expect(useVariantForActor(character({}))).toBe("null_only");
    expect(
      useVariantForActor(
        character({ consumable: { category: "consumable", name: "speed" } }),
      ),
    ).toBe("consumable_or_null");
  });

  it("persists the same useVariant in the agent input record", () => {
    const useVariant = useVariantForActor(character({}));
          const input = buildAgentInputRecord({
            systemPrompt: "You are <Player Name>.",
            personaPromptText: "Persona.",
            visibleStateDigest: "{}",
            scratchpadBefore: "",
            useVariant,
            status: {
              hp: 50,
              pos: { x: 1, y: 1 },
              equipped: {},
              insideEvac: false,
            },
            narrativeLines: [],
            aliveCount: 8,
          });

    expect(input.useVariant).toBe(useVariant);
  });

  it("ships the matching Azure tool schema variant", async () => {
    let capturedBody: { tools?: unknown[] } | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      capturedBody = JSON.parse((init as { body: string }).body) as {
        tools?: unknown[];
      };
      return jsonResponse(responseBody());
    });

    await callDecisionTool({
      systemPrompt: "You are <Player Name>.",
      personaPrompt: "Persona.",
      scratchpad: "",
      visibleStateDigest: "{}",
      composedUserMessage: "# Rat",
      playerName: "Rat",
      useVariant: "null_only",
      reasoningEffort: "low",
      maxOutputTokens: 1200,
      azureUri: "https://example.test/responses",
      azureApiKey: "test-key",
      azureModel: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as unknown as { tools: unknown[] };
    expect(body.tools).toHaveLength(1);
    const tool = body.tools[0] as {
      parameters: { properties: { use: { type: unknown[]; enum: unknown[] } } };
    };
    expect(tool.parameters.properties.use.type).toEqual(["null"]);
    expect(tool.parameters.properties.use.enum).toEqual([null]);
  });
});
