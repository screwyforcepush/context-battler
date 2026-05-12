// Standalone probe — tool-schema emission behaviour on Azure Responses API.
//
// Question we're answering:
//   When a tool ships some properties as `required` and others not,
//   - does Azure emit the optional ones anyway (i.e. dense fills only)?
//   - or does Azure honour the schema and omit them (sparse fills work)?
//
// And, secondarily: what does the model think the schema looks like?
//
// Two probes, same toy tool:
//   A. Schema-echo  — `tool_choice: "auto"` + a prompt that forbids the
//      tool call and asks for a plain-English description of the tool the
//      model sees. Confirms what the model has visibility into.
//   B. Emission     — `tool_choice: "required"` + a minimal prompt ("Order
//      a pizza."). Run 5x. Inspect each tool call's `arguments` JSON for
//      which fields are present vs. omitted.
//
// Independent of project code. Uses the same .env Azure deployment.
// Dumps everything to harness/probe-schema-emission-output.json.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_PATH = resolve(
  new URL(".", import.meta.url).pathname,
  "probe-schema-emission-output.json",
);

// ─── Toy tool ──────────────────────────────────────────────────────────────
// One required field, four optional. Each optional has a clear default
// semantic ("none" / null). If Azure honours `required[]`, the model
// should be free to omit any of `appetizer`, `dessert`, `drink`, `notes`.
const toyTool = {
  type: "function" as const,
  name: "submit_dinner_order",
  description:
    "Submit a dinner order. Only `entree` is required. Omit other fields if the customer didn't specify them — do NOT invent values.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["entree"],
    properties: {
      entree: {
        enum: ["pizza", "pasta", "salad"],
        description: "The main course. Required.",
      },
      appetizer: {
        enum: ["bread", "soup", "none"],
        description: "Optional starter. Omit if customer didn't mention one.",
      },
      dessert: {
        enum: ["cake", "ice_cream", "none"],
        description: "Optional dessert. Omit if customer didn't mention one.",
      },
      drink: {
        enum: ["water", "soda", "none"],
        description: "Optional drink. Omit if customer didn't mention one.",
      },
      notes: {
        type: ["string", "null"],
        maxLength: 200,
        description:
          "Optional free-form note from the customer. Omit if no note.",
      },
    },
  },
};

type AzureRequestBody = {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  tools: unknown[];
  tool_choice: "auto" | "required" | "none";
  parallel_tool_calls: boolean;
  reasoning: { effort: "low" | "medium" | "high"; summary?: "auto" };
  store: boolean;
  max_output_tokens: number;
};

async function callAzure(
  azureUri: string,
  azureApiKey: string,
  body: AzureRequestBody,
): Promise<{ httpStatus: number; rawText: string; json: unknown }> {
  const response = await fetch(azureUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureApiKey,
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    /* leave json null */
  }
  return { httpStatus: response.status, rawText, json };
}

type FnCall = { type: "function_call"; name?: string; arguments?: string };
function isFnCall(item: unknown): item is FnCall {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "function_call"
  );
}

type MessageItem = {
  type: "message";
  content?: Array<{ type?: unknown; text?: unknown }>;
};
function isMessage(item: unknown): item is MessageItem {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "message"
  );
}

function extractMessageText(output: unknown[]): string | null {
  const fragments: string[] = [];
  for (const item of output) {
    if (!isMessage(item)) continue;
    if (!Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (
        typeof c === "object" &&
        c !== null &&
        typeof (c as { text?: unknown }).text === "string"
      ) {
        fragments.push((c as { text: string }).text);
      }
    }
  }
  if (fragments.length === 0) return null;
  return fragments.join("\n");
}

function extractToolCall(
  output: unknown[],
): { arguments: string; parsed: unknown; presentKeys: string[] } | null {
  for (const item of output) {
    if (!isFnCall(item)) continue;
    if (typeof item.arguments !== "string") continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(item.arguments);
    } catch {
      /* leave null */
    }
    const presentKeys =
      typeof parsed === "object" && parsed !== null
        ? Object.keys(parsed as Record<string, unknown>)
        : [];
    return { arguments: item.arguments, parsed, presentKeys };
  }
  return null;
}

async function main(): Promise<void> {
  const azureUri = process.env.AZURE_URI;
  const azureApiKey = process.env.AZURE_API_KEY;
  const azureModel = process.env.AZURE_MODEL;
  if (!azureUri || !azureApiKey || !azureModel) {
    console.error("Missing AZURE_URI / AZURE_API_KEY / AZURE_MODEL.");
    process.exit(2);
  }

  const dump: {
    probedAt: string;
    azureModel: string;
    toolShipped: typeof toyTool;
    probeA_schemaEcho: unknown;
    probeB_emissionRuns: unknown[];
  } = {
    probedAt: new Date().toISOString(),
    azureModel,
    toolShipped: toyTool,
    probeA_schemaEcho: null,
    probeB_emissionRuns: [],
  };

  // ── Probe A — Schema-echo. ──────────────────────────────────────────────
  // Goal: see the tool from the model's vantage. tool_choice: "auto" plus
  // explicit "do not call the tool" instruction. If the deployment ignores
  // that and still emits a tool call, we'll fall back to tool_choice:
  // "none".
  console.log("[probe A] schema-echo …");
  const probeABody: AzureRequestBody = {
    model: azureModel,
    input: [
      {
        role: "system",
        content:
          "You have one tool available, `submit_dinner_order`. " +
          "Do NOT call the tool. Instead, respond with a plain-text description " +
          "of the tool's JSON Schema EXACTLY as you see it: " +
          "list the tool name, its top-level description, every property, " +
          "each property's type/enum, each property's own description, and which " +
          "properties are required vs. optional. Be exhaustive and verbatim.",
      },
      { role: "user", content: "Describe the tool you have." },
    ],
    tools: [toyTool],
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: "low", summary: "auto" },
    store: false,
    max_output_tokens: 2000,
  };
  const probeAResult = await callAzure(azureUri, azureApiKey, probeABody);
  let probeAText: string | null = null;
  let probeAToolCall: ReturnType<typeof extractToolCall> = null;
  if (probeAResult.httpStatus === 200 && probeAResult.json) {
    const output = Array.isArray(
      (probeAResult.json as { output?: unknown }).output,
    )
      ? ((probeAResult.json as { output: unknown[] }).output as unknown[])
      : [];
    probeAText = extractMessageText(output);
    probeAToolCall = extractToolCall(output);
  }
  dump.probeA_schemaEcho = {
    httpStatus: probeAResult.httpStatus,
    bodyJson: probeAResult.json,
    messageText: probeAText,
    toolCallEmitted: probeAToolCall, // expected: null
  };

  // ── Probe B — Emission. ─────────────────────────────────────────────────
  // Goal: does Azure honour `required[]` and let the model omit optional
  // fields, or does it emit them all anyway?
  // 5 runs against the same minimal prompt.
  console.log("[probe B] emission x5 …");
  const promptVariants: Array<{ label: string; user: string }> = [
    { label: "minimal", user: "Order a pizza." },
    { label: "minimal_repeat_1", user: "Order a pizza." },
    { label: "minimal_repeat_2", user: "Order a pizza." },
    {
      label: "pizza_with_one_extra",
      user: "Order a pizza. Add a soda.",
    },
    {
      label: "pasta_no_extras",
      user: "Order pasta. Nothing else.",
    },
  ];
  for (const variant of promptVariants) {
    const body: AzureRequestBody = {
      model: azureModel,
      input: [
        {
          role: "system",
          content:
            "You are an order-entry assistant. Submit the customer's order " +
            "by calling `submit_dinner_order` exactly once. " +
            "Only set fields the customer explicitly mentioned. " +
            "Do not invent values for fields the customer did not specify.",
        },
        { role: "user", content: variant.user },
      ],
      tools: [toyTool],
      tool_choice: "required",
      parallel_tool_calls: false,
      reasoning: { effort: "low", summary: "auto" },
      store: false,
      max_output_tokens: 800,
    };
    const result = await callAzure(azureUri, azureApiKey, body);
    let toolCall: ReturnType<typeof extractToolCall> = null;
    const httpStatus = result.httpStatus;
    if (httpStatus === 200 && result.json) {
      const output = Array.isArray((result.json as { output?: unknown }).output)
        ? ((result.json as { output: unknown[] }).output as unknown[])
        : [];
      toolCall = extractToolCall(output);
    }
    dump.probeB_emissionRuns.push({
      label: variant.label,
      userPrompt: variant.user,
      httpStatus,
      toolCall,
      // keep the full body for any post-hoc inspection
      bodyJson: result.json,
    });
    console.log(
      `  - ${variant.label}: status=${httpStatus}, keys=${
        toolCall ? JSON.stringify(toolCall.presentKeys) : "<none>"
      }`,
    );
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(dump, null, 2), "utf8");
  console.log(`\nDump written to: ${OUTPUT_PATH}`);

  // Compact verdict to stdout.
  const allKeysAcrossRuns = new Set<string>();
  const perRunKeys: string[][] = [];
  for (const r of dump.probeB_emissionRuns) {
    const tc = (r as { toolCall: ReturnType<typeof extractToolCall> })
      .toolCall;
    const keys = tc ? tc.presentKeys : [];
    perRunKeys.push(keys);
    for (const k of keys) allKeysAcrossRuns.add(k);
  }
  console.log("\nVerdict:");
  console.log(`  union of keys emitted: ${[...allKeysAcrossRuns].join(", ")}`);
  perRunKeys.forEach((keys, i) => {
    console.log(`  run ${i}: ${keys.join(", ") || "<none>"}`);
  });
  const declared = Object.keys(toyTool.parameters.properties);
  const required = toyTool.parameters.required;
  const optional = declared.filter((d) => !required.includes(d));
  const anyRunOmittedAnOptional = perRunKeys.some((keys) =>
    optional.some((opt) => !keys.includes(opt)),
  );
  const everyRunIncludedAllOptionals = perRunKeys.every((keys) =>
    optional.every((opt) => keys.includes(opt)),
  );
  console.log(
    `  optional fields: ${optional.join(", ")}; required: ${required.join(", ")}`,
  );
  console.log(
    `  any run omitted any optional: ${anyRunOmittedAnOptional} (true = sparse fills work)`,
  );
  console.log(
    `  every run emitted every optional: ${everyRunIncludedAllOptionals} (true = dense fills forced)`,
  );
}

main().catch((e) => {
  console.error("Probe crashed:", e);
  process.exit(1);
});
