// Phase-3 WP-A.1 — Azure reasoning-text probe.
//
// Sends ONE per-turn-shape tool-use request to the dev Azure deployment
// with `reasoning.effort: "low"` (and optionally `reasoning.summary: "auto"`)
// and dumps the full `response.output[]` + `response.usage` to a JSON file
// for inspection.
//
// Branch decision (per de-risking.md D-P3-1):
//   - Branch A — `output[]` contains items with `type === "reasoning"`
//     bearing text/summary content.
//   - Branch B — only `usage.output_tokens_details.reasoning_tokens` is
//     populated; no reasoning items in `output[]`.
//
// The probe writes a JSON dump to `harness/probe-reasoning-output.json` and
// prints a one-line verdict to stdout. Run via:
//   npx tsx harness/probe-reasoning.ts
//
// This file is a one-call diagnostic harness. It does not import the
// production wrapper (`convex/llm/azure.ts`) because the wrapper does not
// (yet) expose `output[]` raw — the probe needs to inspect the unfiltered
// response shape to make the branch call.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDecisionTool } from "../convex/llm/decisionTool.js";

const OUTPUT_PATH = resolve(
  new URL(".", import.meta.url).pathname,
  "probe-reasoning-output.json",
);

type ReasoningItemShape = {
  type: string;
  // OpenAI-direct shape: `summary: [{type: "summary_text", text: "..."}]`.
  summary?: Array<{ type?: unknown; text?: unknown }>;
  // Some deployments may expose plain text on the item.
  text?: unknown;
  // Catch-all for anything else.
  [k: string]: unknown;
};

type RawAzureResponse = {
  id?: unknown;
  status?: unknown;
  output?: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  } & Record<string, unknown>;
  [k: string]: unknown;
};

async function main(): Promise<void> {
  const azureUri = process.env.AZURE_URI;
  const azureApiKey = process.env.AZURE_API_KEY;
  const azureModel = process.env.AZURE_MODEL;
  if (!azureUri || !azureApiKey || !azureModel) {
    console.error(
      "Missing AZURE_URI / AZURE_API_KEY / AZURE_MODEL in env. Aborting probe.",
    );
    process.exit(2);
  }

  // Per-turn-shape body. We use the Phase 6 null-only use variant because
  // this synthetic status block has no equipped consumable.
  const decisionTool = buildDecisionTool({ useVariant: "null_only" });
  const requestBody = {
    model: azureModel,
    input: [
      {
        role: "system",
        content:
          "You are Duelist, extraction-arena agent. Each turn, emit ONE tool call to `decide_turn`.",
      },
      {
        role: "user",
        content: [
          "# Duelist",
          "You adopt Duelist persona:",
          "Pragmatic. Scavenge cautiously, retreat from heavy fire.",
          "",
          "## Status",
          "📍(15,15)",
          "❤️HP: 50/50 HP",
          "⚔️weapon: rusty_blade [dmg 10]",
          "🛡️armour: none",
          "🧪consumable: none",
          "🗒️scratchpad: Turn 1. No prior observations.",
          "",
          "# Current Game State",
          "Turn 1, 8/8 players alive",
          JSON.stringify(
            {
              Camper: {
                kind: "character",
                pos: { x: 22, y: 22 },
                dist: 7,
                bearing: "SE",
                hp: "high",
                equipped: {
                  weapon: "rusty_blade",
                  armour: null,
                  consumable: null,
                },
              },
              Chest_005: {
                kind: "chest",
                pos: { x: 11, y: 19 },
                dist: 4,
                bearing: "SW",
                opened: false,
                contents: null,
              },
            },
            null,
            2,
          ),
        ].join("\n"),
      },
    ],
    tools: [decisionTool],
    tool_choice: "required",
    parallel_tool_calls: false,
    // The probe — `reasoning.effort: "low"` plus the optional `summary: "auto"`
    // request parameter (some OpenAI-direct deployments honour it; Azure may
    // or may not). If Azure rejects the unknown field, we fall back to
    // effort-only and try again.
    reasoning: { effort: "low", summary: "auto" },
    store: false,
    max_output_tokens: 256,
  };

  let response: Response;
  let attempt: "with_summary" | "effort_only" = "with_summary";
  try {
    response = await fetch(azureUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureApiKey,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    console.error("Network error reaching Azure:", e);
    process.exit(2);
  }

  // If Azure rejects the unknown `reasoning.summary` parameter, retry
  // without it.
  if (!response.ok && response.status === 400) {
    const errBody = await response.text().catch(() => "");
    if (errBody.toLowerCase().includes("summary")) {
      const fallbackBody = {
        ...requestBody,
        reasoning: { effort: "low" as const },
      };
      response = await fetch(azureUri, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": azureApiKey,
        },
        body: JSON.stringify(fallbackBody),
      });
      attempt = "effort_only";
    } else {
      console.error("Azure 400 (non-summary):", errBody);
      process.exit(2);
    }
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    console.error(`Azure returned HTTP ${response.status}: ${errBody}`);
    process.exit(2);
  }

  const body = (await response.json()) as RawAzureResponse;

  // Branch decision logic.
  const output = Array.isArray(body.output) ? body.output : [];
  const reasoningItems: ReasoningItemShape[] = [];
  for (const item of output) {
    if (
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "reasoning"
    ) {
      reasoningItems.push(item as ReasoningItemShape);
    }
  }

  let hasText = false;
  for (const item of reasoningItems) {
    if (typeof item.text === "string" && item.text.length > 0) {
      hasText = true;
      break;
    }
    if (Array.isArray(item.summary)) {
      for (const s of item.summary) {
        if (typeof s.text === "string" && s.text.length > 0) {
          hasText = true;
          break;
        }
      }
    }
    if (hasText) break;
  }

  const reasoningTokens =
    body.usage?.output_tokens_details?.reasoning_tokens ?? null;

  const branch = hasText ? "A" : "B";
  const dump = {
    probedAt: new Date().toISOString(),
    requestAttempt: attempt,
    azureModel,
    httpStatus: response.status,
    branch,
    reasoning_summary_param_accepted: attempt === "with_summary",
    reasoningItemCount: reasoningItems.length,
    reasoningHasText: hasText,
    reasoning_tokens: reasoningTokens,
    output_types: output
      .filter(
        (i): i is { type?: unknown } =>
          typeof i === "object" && i !== null,
      )
      .map((i) => (typeof i.type === "string" ? i.type : "(unknown)")),
    fullResponse: body,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(dump, null, 2), "utf8");
  console.log(`Probe complete: Branch ${branch}.`);
  console.log(`  - reasoning items in output[]: ${reasoningItems.length}`);
  console.log(`  - reasoning text exposed: ${hasText}`);
  console.log(`  - reasoning_tokens: ${reasoningTokens}`);
  console.log(`  - dump written to: ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error("Probe crashed:", e);
  process.exit(1);
});
