// WP6 — unit tests for `callDecisionTool` (the Azure tool-use wrapper).
//
// Tests are written FIRST per AOP. Coverage target: HAPPY-path + every
// `FailureReason` from ADR §4 (9 modes), each as its own `it(...)`. Total:
// 10+ tests in this file. Each test injects a fake `fetchImpl` that returns
// the response shape needed to drive the wrapper down the matching branch.
//
// Spec:
//   - ADR §4 — full wrapper contract: never-throws, populated `failureReason`
//     on every failure mode, AbortController is INTERNAL, wrapper returns
//     SAFE_DEFAULT_DECISION on every failure mode EXCEPT
//     `multiple_function_calls` (which keeps the FIRST decision and merely
//     surfaces `failureReason` for telemetry).
//   - `azure-llm.md` §7 — `output[]` filtering for `type === "function_call"`,
//     `arguments` is a JSON-encoded string, `parallel_tool_calls: false`.
//
// Test design: every test owns its own minimal `fetchImpl`. We don't share
// fetch fixtures across tests because each test exercises a distinct
// failure path and a shared fixture would obscure intent.

import { describe, expect, it, vi } from "vitest";
import { callDecisionTool } from "../../convex/llm/azure.js";
import { SAFE_DEFAULT_DECISION } from "../../convex/llm/decisionTool.js";
import type { ParsedDecision } from "../../convex/engine/types.js";

// ─── Fixture builders ──────────────────────────────────────────────────────

const VALID_DECISION: ParsedDecision = {
  consume: "none",
  primary: "move",
  move: { kind: "relative", dx: 1, dy: 0 },
  action: { kind: "none" },
  say: null,
  overwatch_priority: null,
  scratchpad_update: null,
};

/** Default input — every test reuses this and overrides only what matters. */
const baseInput = {
  systemPrompt: "You are an agent.",
  personaPrompt: "Persona: rat.",
  scratchpad: "Last turn I hid.",
  visibleStateDigest: "Visible: nothing.",
  reasoningEffort: "low" as const,
  maxOutputTokens: 256,
  azureUri: "https://example.test/openai/responses",
  azureApiKey: "test-key",
  azureModel: "test-model",
};

/** Construct a Response-like object with a JSON body and HTTP status 200. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a fake Azure response with one valid function_call item. */
function happyResponseBody(
  decision: ParsedDecision = VALID_DECISION,
  responseId = "resp_abc",
  callId = "call_xyz",
) {
  return {
    id: responseId,
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "function_call",
        name: "decide_turn",
        call_id: callId,
        arguments: JSON.stringify(decision),
      },
    ],
    usage: {
      input_tokens: 50,
      output_tokens: 30,
      total_tokens: 80,
      output_tokens_details: { reasoning_tokens: 10 },
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("WP6 callDecisionTool — happy path", () => {
  it("returns the parsed decision on a single valid function_call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(happyResponseBody()));
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(false);
    expect(result.failureReason).toBeUndefined();
    expect(result.decision).toEqual(VALID_DECISION);
    expect(result.callId).toBe("call_xyz");
    expect(result.rawArguments).toBe(JSON.stringify(VALID_DECISION));
    expect(result.raw.responseId).toBe("resp_abc");
    expect(result.raw.httpStatus).toBe(200);
    expect(result.raw.usage).toMatchObject({
      input_tokens: 50,
      output_tokens: 30,
    });
    expect(result.raw.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the locked request body shape (tool_choice required, parallel_tool_calls false, reasoning.effort, store false)", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const body = (init as { body: string }).body;
      capturedBody = JSON.parse(body) as Record<string, unknown>;
      return jsonResponse(happyResponseBody());
    });
    await callDecisionTool({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(capturedBody).not.toBeNull();
    const body = capturedBody! as {
      model: string;
      input: Array<{ role: string; content: string }>;
      tools: Array<{ name: string }>;
      tool_choice: string;
      parallel_tool_calls: boolean;
      reasoning: { effort: string };
      store: boolean;
      max_output_tokens: number;
    };
    expect(body.model).toBe("test-model");
    expect(body.tool_choice).toBe("required");
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.reasoning.effort).toBe("low");
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(256);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]!.name).toBe("decide_turn");
    expect(body.input).toHaveLength(2);
    expect(body.input[0]!.role).toBe("system");
    expect(body.input[1]!.role).toBe("user");
    // System prompt verbatim, user message contains persona + scratchpad + digest.
    expect(body.input[0]!.content).toBe("You are an agent.");
    expect(body.input[1]!.content).toContain("Persona: rat.");
    expect(body.input[1]!.content).toContain("Last turn I hid.");
    expect(body.input[1]!.content).toContain("Visible: nothing.");
  });

  it("sends the api-key header (Azure-style, NOT Bearer)", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const headers = (init as { headers: Record<string, string> }).headers;
      capturedHeaders = headers;
      return jsonResponse(happyResponseBody());
    });
    await callDecisionTool({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!["api-key"]).toBe("test-key");
    expect(capturedHeaders!["Content-Type"]).toBe("application/json");
    // No Bearer auth header.
    expect(capturedHeaders!["Authorization"]).toBeUndefined();
  });
});

describe("WP6 callDecisionTool — FailureReason coverage", () => {
  it("http_non_200: returns safe-default with httpStatus surfaced", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("internal server error body", { status: 500 }),
    );
    // Status 500 is retryable per WP10.5 Pass D; pass a small retryDelayMs
    // so the test still exercises the second-attempt-also-fails fallthrough
    // without paying the 1 s production default.
    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
    expect(result.raw.httpStatus).toBe(500);
    expect(result.callId).toBeNull();
  });

  it("status_not_completed: response.status !== 'completed' → safe-default", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "resp_x",
        status: "failed",
        incomplete_details: null,
        output: [],
      }),
    );
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("status_not_completed");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
  });

  it("incomplete_details: response.incomplete_details populated → safe-default", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "resp_x",
        status: "completed",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      }),
    );
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("incomplete_details");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
  });

  it("content_filter_blocked: a blocked content filter result → safe-default", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "resp_x",
        status: "completed",
        incomplete_details: null,
        content_filters: [{ blocked: true, category: "violence" }],
        output: [],
      }),
    );
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("content_filter_blocked");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
  });

  it("no_function_call: output has only a message item → safe-default", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "resp_x",
        status: "completed",
        incomplete_details: null,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I refuse." }],
          },
        ],
      }),
    );
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("no_function_call");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
  });

  it("multiple_function_calls: takes FIRST, fellBack=false, telemetry-only", async () => {
    const firstDecision: ParsedDecision = {
      ...VALID_DECISION,
      scratchpad_update: "first",
    };
    const secondDecision: ParsedDecision = {
      ...VALID_DECISION,
      scratchpad_update: "second",
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "resp_x",
        status: "completed",
        incomplete_details: null,
        output: [
          {
            type: "function_call",
            name: "decide_turn",
            call_id: "call_first",
            arguments: JSON.stringify(firstDecision),
          },
          {
            type: "function_call",
            name: "decide_turn",
            call_id: "call_second",
            arguments: JSON.stringify(secondDecision),
          },
        ],
      }),
    );
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    // Per ADR §4: FIRST decision is kept, fellBack=false, but failureReason
    // is populated for telemetry so WP12 can surface the rate.
    expect(result.fellBackToSafeDefault).toBe(false);
    expect(result.failureReason).toBe("multiple_function_calls");
    expect(result.decision).toEqual(firstDecision);
    expect(result.callId).toBe("call_first");
  });

  it("json_parse_failed: arguments is invalid JSON → safe-default + rawArguments preserved", async () => {
    const garbage = "{not valid json,,,";
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "resp_x",
        status: "completed",
        incomplete_details: null,
        output: [
          {
            type: "function_call",
            name: "decide_turn",
            call_id: "call_x",
            arguments: garbage,
          },
        ],
      }),
    );
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("json_parse_failed");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
    expect(result.rawArguments).toBe(garbage);
    expect(result.callId).toBe("call_x");
  });

  it("schema_validation_failed: arguments is valid JSON but breaks the schema → safe-default + rawArguments preserved", async () => {
    // toward_entity arm without targetCharacterId — passes JSON.parse but
    // fails Zod's discriminated-union arm.
    const bad = JSON.stringify({
      ...VALID_DECISION,
      move: { kind: "toward_entity" },
    });
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: "resp_x",
        status: "completed",
        incomplete_details: null,
        output: [
          {
            type: "function_call",
            name: "decide_turn",
            call_id: "call_x",
            arguments: bad,
          },
        ],
      }),
    );
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("schema_validation_failed");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
    expect(result.rawArguments).toBe(bad);
  });

  it("abort_timeout: AbortController fires when fetch never resolves before timeout", async () => {
    // fetchImpl that resolves only AFTER abort, simulating a long-poll hang.
    // We honour the AbortSignal: as soon as it aborts, reject with an
    // AbortError-shaped exception so the wrapper's catch path runs.
    const fetchImpl = vi.fn(
      (_url: unknown, init: unknown) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as { signal: AbortSignal }).signal;
          if (signal.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          // Otherwise: never resolve. Wrapper's setTimeout will abort us.
        }),
    );

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      abortTimeoutMs: 50,
    });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("abort_timeout");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
  });
});

describe("WP6 callDecisionTool — never-throws contract", () => {
  it("catches a fetchImpl that throws synchronously (network error)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network glitch");
    });
    // MUST NOT throw — wrapper resolves to safe-default.
    const result = await callDecisionTool({ ...baseInput, fetchImpl });
    expect(result.fellBackToSafeDefault).toBe(true);
    // Network errors that aren't AbortError surface as one of the safe-default
    // FailureReasons. We accept any populated failureReason here — the
    // dedicated FailureReason tests above cover the specific paths.
    expect(result.failureReason).toBeDefined();
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
  });
});

// ─── WP10.5 Pass D — minimal retry on transient HTTP failures ────────────
//
// Per `wp10-5-phase-a-findings.md` Bucket 3 (~9 % of Phase-A LLM calls
// hit `http_non_200`, ~one per turn — Azure TPM/RPM transients).
// Per `de-risking.md` Measurement C / WP13 the policy is *minimal* backoff:
// ONE retry, 1 s exponential delay, on status ∈ {429, 500, 502, 503, 504}.
// Non-retryable statuses (4xx other than 429) fall through unchanged.
//
// Tests use a small `retryDelayMs` so the suite stays fast.

describe("WP10.5 Pass D — minimal retry on transient HTTP failures", () => {
  // Each retryable status gets a dedicated test so a regression on any one
  // is immediately localisable.
  const RETRYABLE_STATUSES = [429, 500, 502, 503, 504] as const;

  for (const status of RETRYABLE_STATUSES) {
    it(`retries once on HTTP ${status} and returns success on the second attempt`, async () => {
      let calls = 0;
      const fetchImpl = vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("transient", { status });
        }
        return jsonResponse(happyResponseBody());
      });

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      expect(calls).toBe(2);
      expect(result.fellBackToSafeDefault).toBe(false);
      expect(result.failureReason).toBeUndefined();
      expect(result.decision).toEqual(VALID_DECISION);
      // Retry telemetry is set so harness/analyze-match.ts can later count
      // retried calls without changing the schema validator.
      expect(result.raw.retried).toBe(true);
      // httpStatus reflects the SUCCESSFUL second attempt.
      expect(result.raw.httpStatus).toBe(200);
    });
  }

  it("retries once on HTTP 429 and falls through to http_non_200 fallback when the second attempt also fails", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response("still rate-limited", { status: 429 });
    });

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    // Exactly two attempts: original + ONE retry. No third attempt.
    expect(calls).toBe(2);
    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
    // retried=true even on the failure path: we DID attempt the retry.
    expect(result.raw.retried).toBe(true);
    expect(result.raw.httpStatus).toBe(429);
  });

  it("does NOT retry on a non-retryable HTTP 400 (bad request)", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    });

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    // 4xx other than 429 is not retried — single attempt.
    expect(calls).toBe(1);
    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    expect(result.raw.retried).toBe(false);
    expect(result.raw.httpStatus).toBe(400);
  });

  it("does NOT retry on a non-retryable HTTP 401 (auth)", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    });

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    expect(calls).toBe(1);
    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    expect(result.raw.retried).toBe(false);
    expect(result.raw.httpStatus).toBe(401);
  });

  it("does NOT retry on the happy path (single attempt)", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return jsonResponse(happyResponseBody());
    });

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    expect(calls).toBe(1);
    expect(result.fellBackToSafeDefault).toBe(false);
    // retried=false on the happy path so the harness can distinguish
    // "succeeded first try" from "succeeded after retry".
    expect(result.raw.retried).toBe(false);
  });

  it("waits at least retryDelayMs between attempts", async () => {
    const delayMs = 30;
    const timestamps: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      timestamps.push(Date.now());
      calls += 1;
      if (calls === 1) return new Response("transient", { status: 503 });
      return jsonResponse(happyResponseBody());
    });

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: delayMs,
    });

    expect(result.fellBackToSafeDefault).toBe(false);
    expect(timestamps).toHaveLength(2);
    // Allow a small scheduler-jitter slack (4 ms) below the nominal delay.
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(delayMs - 4);
  });
});
