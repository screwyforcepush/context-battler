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
    // Pass F: even when the body is short, it MUST be captured into
    // `httpBodyExcerpt` so trace consumers see the actual error shape
    // (Azure 400 bodies typically embed the policy/category that was
    // tripped — see `azure-llm.md` §2.6 / WP10.5 Phase E.1 cautionary tale).
    expect(result.raw.httpBodyExcerpt).toBe("bad request");
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

// ─── WP10.5 Pass F — HTTP non-OK response body persistence ─────────────────
//
// On any non-OK HTTP response (after retry policy is exhausted), the
// wrapper MUST capture the response body string into
// `CallResult.raw.httpBodyExcerpt` so post-mortem analysis can see the
// actual Azure error shape (typically a content-moderation 400 with the
// tripped policy/category embedded). Without this, fallback rate
// debugging is "moderated by elimination" guesswork — the Phase E.1
// cautionary tale documented in WP10.5 findings.
//
// Invariants pinned by these tests:
//   1. The captured string is set on `failureReason: "http_non_200"`.
//   2. The string is truncated to ≤ 2 KB (defensive against pathological
//      Azure responses).
//   3. Any token-shaped substring (api-key, bearer, authorization header
//      value) is scrubbed to `[redacted]` before persistence.
//   4. Happy path (200 OK) does NOT set the field (stays undefined).

describe("WP10.5 Pass F — HTTP 400 body persistence on non-OK responses", () => {
  it("captures the response body string into raw.httpBodyExcerpt on a content-moderation HTTP 400", async () => {
    const moderationBody = JSON.stringify({
      error: {
        code: "content_filter",
        message:
          "The response was filtered due to the prompt triggering Azure OpenAI's content management policy. Please modify your prompt and retry.",
        innererror: {
          code: "ResponsibleAIPolicyViolation",
          content_filter_result: {
            violence: { filtered: true, severity: "medium" },
          },
        },
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(moderationBody, {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    // Behaviour regression: the existing wrapper invariants are unchanged.
    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    expect(result.raw.httpStatus).toBe(400);

    // Pass F: the body string is persisted verbatim (no JSON re-parse
    // needed — we want the raw string the trace can grep).
    expect(typeof result.raw.httpBodyExcerpt).toBe("string");
    expect(result.raw.httpBodyExcerpt!).toBe(moderationBody);
    // Sanity-check it actually contains the diagnostic substring callers
    // care about — this is the bit Phase E.1 was missing.
    expect(result.raw.httpBodyExcerpt!).toContain("ResponsibleAIPolicyViolation");
  });

  it("truncates the captured body to <= 2 KB on pathological response sizes", async () => {
    // 10 KB of payload — well over the 2 KB cap. Use a known tail
    // sentinel; if truncation kept the head, the sentinel must be gone.
    const head = "AZURE_BODY_HEAD_";
    const tail = "_AZURE_BODY_TAIL";
    const filler = "x".repeat(10 * 1024);
    const huge = head + filler + tail;
    const fetchImpl = vi.fn(
      async () => new Response(huge, { status: 400 }),
    );

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    expect(typeof result.raw.httpBodyExcerpt).toBe("string");
    // ≤ 2 KB. We allow up to 2048 chars (the truncation budget).
    expect(result.raw.httpBodyExcerpt!.length).toBeLessThanOrEqual(2048);
    // Head is present, tail is gone (truncation keeps the prefix —
    // Azure's diagnostic info is at the start of error bodies).
    expect(result.raw.httpBodyExcerpt!.startsWith(head)).toBe(true);
    expect(result.raw.httpBodyExcerpt!.includes(tail)).toBe(false);
  });

  it("scrubs api-key / bearer / authorization tokens from the captured body", async () => {
    // Body that contains every token shape we sanitise. Production Azure
    // 400 bodies generally don't echo our credentials back, but this is
    // free defence-in-depth: if the persona prompt ever embeds an
    // accidental key (it doesn't — but this is the trace-stays-safe
    // invariant), the trace stays clean.
    const dirty =
      'Error: api-key="abcd1234SECRETKEY5678ZZZ"; ' +
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payloadpayloadpayload.sigsig; ' +
      'apiKey: 0123456789ABCDEFFEDCBA9876543210; ' +
      "the rest of the body is fine";
    const fetchImpl = vi.fn(
      async () => new Response(dirty, { status: 400 }),
    );

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    const excerpt = result.raw.httpBodyExcerpt!;
    expect(typeof excerpt).toBe("string");

    // None of the secret values survive.
    expect(excerpt).not.toContain("abcd1234SECRETKEY5678ZZZ");
    expect(excerpt).not.toContain(
      "eyJhbGciOiJIUzI1NiJ9.payloadpayloadpayload.sigsig",
    );
    expect(excerpt).not.toContain("0123456789ABCDEFFEDCBA9876543210");
    // Redaction marker is present.
    expect(excerpt).toContain("[redacted]");
    // Non-secret tail of the body is preserved (sanitisation is local,
    // not nuke-the-string).
    expect(excerpt).toContain("the rest of the body is fine");
  });

  it("does NOT set httpBodyExcerpt on a 200 OK happy path", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(happyResponseBody()));
    const result = await callDecisionTool({ ...baseInput, fetchImpl });

    expect(result.fellBackToSafeDefault).toBe(false);
    // Field is absent (or explicitly undefined) on the success path —
    // present-but-undefined and absent are equivalent at the trace shape
    // boundary because the schema validator is `v.optional(...)`.
    expect(result.raw.httpBodyExcerpt).toBeUndefined();
  });

  it("captures the body of the SECOND attempt when a retryable status is followed by another non-OK", async () => {
    // First attempt: 503 (retryable). Second attempt: 400 with a
    // moderation-style body. The captured excerpt must reflect the
    // SECOND attempt — that's the response that drove the fallback.
    const secondBody =
      '{"error":{"code":"content_filter","message":"second attempt body"}}';
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("first transient", { status: 503 });
      return new Response(secondBody, { status: 400 });
    });

    const result = await callDecisionTool({
      ...baseInput,
      fetchImpl,
      retryDelayMs: 5,
    });

    expect(calls).toBe(2);
    expect(result.fellBackToSafeDefault).toBe(true);
    expect(result.failureReason).toBe("http_non_200");
    expect(result.raw.retried).toBe(true);
    expect(result.raw.httpStatus).toBe(400);
    // The persisted excerpt is the SECOND-attempt body, not the first.
    expect(result.raw.httpBodyExcerpt).toBe(secondBody);
    expect(result.raw.httpBodyExcerpt).not.toContain("first transient");
  });
});

// ─── Gate-2.5 medium-severity — sanitiser hardening ─────────────────────────
//
// Per `gate-2-5-review.md` (Medium-severity: Trace hygiene), the existing
// sanitiser scrubs LABELLED token shapes (api-key:, Bearer, Authorization)
// but does NOT handle:
//   (a) the configured `AZURE_API_KEY` value appearing UNLABELLED in body
//       text (e.g., if Azure ever echoed prompt metadata back),
//   (b) PII — emails and phone numbers.
//
// Invariants pinned by these tests:
//   1. The configured `azureApiKey` value is replaced by `[REDACTED:api-key]`
//      anywhere in the body, even without a label, BEFORE truncation.
//   2. Email addresses are replaced with `[REDACTED:email]`.
//   3. Common phone-number formats are replaced with `[REDACTED:phone]`.
//   4. Phone redaction is CONSERVATIVE — bare numeric strings (timestamps,
//      IDs) must not be redacted.
//   5. The 2KB cap is preserved AFTER redaction.
//   6. Order is redact-then-truncate — a marker can never be split mid-token
//      by truncation (the redaction substitution happens before slice).

describe("Gate-2.5 — httpBodyExcerpt sanitisation hardening", () => {
  describe("(a) unlabelled AZURE_API_KEY value scrub", () => {
    it("redacts a verbatim AZURE_API_KEY value occurring without a label", async () => {
      const apiKey = "Sk-Verbatim-Secret-Value-1234567890abcdef";
      // Body containing the raw key value with no `api-key:` / `Bearer`
      // label preceding it. The existing labelled-pattern scrub doesn't
      // catch this; the new unlabelled-value scrub must.
      const body = `Some Azure error envelope mentioning ${apiKey} inline; rest of body.`;
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        azureApiKey: apiKey,
        fetchImpl,
        retryDelayMs: 5,
      });

      expect(result.failureReason).toBe("http_non_200");
      const excerpt = result.raw.httpBodyExcerpt!;
      expect(typeof excerpt).toBe("string");
      // The raw key value is gone.
      expect(excerpt).not.toContain(apiKey);
      // The redaction marker is present.
      expect(excerpt).toContain("[REDACTED:api-key]");
      // Surrounding context is preserved.
      expect(excerpt).toContain("Some Azure error envelope mentioning");
      expect(excerpt).toContain("rest of body");
    });

    it("does not redact unrelated content when AZURE_API_KEY is unset (env-only path)", async () => {
      // Snapshot + clear env to drive the wrapper through the env-only
      // path with no configured key. Because we still pass `azureApiKey`
      // via input, the wrapper's read in this test is the input value;
      // we test the SKIP semantic by setting the input key to empty.
      // The dirty body contains a long token-like string that COULD be
      // a key but isn't the configured one.
      const body =
        "Body with a long pseudo-token QQQ-Long-Random-Value-NOT-A-KEY-987654321 inline.";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        // azureApiKey is required for the wrapper not to short-circuit on
        // missing-env; use a value that does NOT appear in the body.
        azureApiKey: "different-key-not-in-body-xxxxxxxxxxxxxxxxx",
        fetchImpl,
        retryDelayMs: 5,
      });

      expect(result.failureReason).toBe("http_non_200");
      const excerpt = result.raw.httpBodyExcerpt!;
      // The pseudo-token survives because it isn't the configured key
      // and has no token label preceding it.
      expect(excerpt).toContain("QQQ-Long-Random-Value-NOT-A-KEY-987654321");
    });

    it("redacts ALL occurrences of the configured key value in the body", async () => {
      const apiKey = "MultiHitSecret-abcdef0123456789";
      const body = `${apiKey} appears here, again here ${apiKey}, and here ${apiKey}.`;
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        azureApiKey: apiKey,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain(apiKey);
      // Three occurrences should have produced three markers.
      const markerCount = (excerpt.match(/\[REDACTED:api-key\]/g) ?? []).length;
      expect(markerCount).toBe(3);
    });
  });

  describe("(b) email redaction", () => {
    it("redacts a basic email address", async () => {
      const body = "Contact john.doe@example.com for support.";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain("john.doe@example.com");
      expect(excerpt).toContain("[REDACTED:email]");
      expect(excerpt).toContain("Contact ");
      expect(excerpt).toContain(" for support.");
    });

    it("redacts a plus-tagged email address", async () => {
      const body = "User: alice+tag@sub.example.co.uk did the thing.";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain("alice+tag@sub.example.co.uk");
      expect(excerpt).toContain("[REDACTED:email]");
    });

    it("redacts emails with subdomains", async () => {
      const body = "From: ops-team@internal.staging.example.com logged out.";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain("ops-team@internal.staging.example.com");
      expect(excerpt).toContain("[REDACTED:email]");
    });

    it("redacts multiple emails in the same body", async () => {
      const body = "CC: a@b.com, c.d@e-f.org, plus+only@x.io";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain("a@b.com");
      expect(excerpt).not.toContain("c.d@e-f.org");
      expect(excerpt).not.toContain("plus+only@x.io");
      const markerCount = (excerpt.match(/\[REDACTED:email\]/g) ?? []).length;
      expect(markerCount).toBe(3);
    });
  });

  describe("(c) phone redaction (conservative)", () => {
    it("redacts a +country-coded dash-separated phone", async () => {
      const body = "Call +1-555-123-4567 for help.";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain("+1-555-123-4567");
      expect(excerpt).toContain("[REDACTED:phone]");
      expect(excerpt).toContain("Call ");
      expect(excerpt).toContain(" for help.");
    });

    it("redacts a US (NPA) parens phone", async () => {
      const body = "Reach us at (555) 123-4567 anytime.";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain("(555) 123-4567");
      expect(excerpt).toContain("[REDACTED:phone]");
    });

    it("redacts a dot-separated phone", async () => {
      const body = "Hotline: 555.123.4567 — please call.";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt).not.toContain("555.123.4567");
      expect(excerpt).toContain("[REDACTED:phone]");
    });

    it("does NOT redact bare numeric content (timestamps, IDs)", async () => {
      // Critical conservative-regex test: timestamps, request IDs, and
      // long digit runs without phone-shaped separators MUST survive.
      const body =
        "Timestamp 1714694400 traceId 1234567890123 requestId 9876543210 turn 42 hp 50";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      // Every numeric ID-shape survives.
      expect(excerpt).toContain("1714694400");
      expect(excerpt).toContain("1234567890123");
      expect(excerpt).toContain("9876543210");
      expect(excerpt).toContain("turn 42");
      expect(excerpt).toContain("hp 50");
      // No marker was emitted.
      expect(excerpt).not.toContain("[REDACTED:phone]");
    });
  });

  describe("(d) 2KB cap preserved after redactions, redact-then-truncate order", () => {
    it("truncates to <= 2048 chars even when body has redactable content", async () => {
      // 5 KB body with a leading email; final length must still be <= 2048.
      const head = "Contact john.doe@example.com immediately. ";
      const filler = "y".repeat(5 * 1024);
      const body = head + filler;
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(typeof excerpt).toBe("string");
      expect(excerpt.length).toBeLessThanOrEqual(2048);
      // Email was redacted (head sits at offset 0; well under the cap).
      expect(excerpt).not.toContain("john.doe@example.com");
      expect(excerpt).toContain("[REDACTED:email]");
    });

    it("redact-then-truncate: an email straddling the 2KB boundary is fully redacted, not partially leaked", async () => {
      // Place an email so that, if truncation ran FIRST at 2048 chars,
      // the email would be sliced mid-string and the partial (e.g.
      // `alice.long.local@examp`) would not match the email regex —
      // leaking a partial PII fragment in the persisted excerpt.
      //
      // With the correct order (redact-then-truncate) the sanitiser runs
      // against the FULL body, the email is matched intact and replaced
      // with `[REDACTED:email]`, and only THEN is the cap applied. The
      // resulting excerpt contains zero local-part residue.
      //
      // The leading whitespace before the email gives the email regex
      // a clean left boundary so the prefix x's aren't swallowed.
      const prefix = "x".repeat(2040) + " ";
      const body = prefix + "alice.long.local@example.com" + "tail";
      const fetchImpl = vi.fn(
        async () => new Response(body, { status: 400 }),
      );

      const result = await callDecisionTool({
        ...baseInput,
        fetchImpl,
        retryDelayMs: 5,
      });

      const excerpt = result.raw.httpBodyExcerpt!;
      expect(excerpt.length).toBeLessThanOrEqual(2048);
      // The full email is gone.
      expect(excerpt).not.toContain("alice.long.local@example.com");
      // No partial-email leak: even the head of the local-part is absent,
      // proving the regex matched the whole email BEFORE the cap fired.
      expect(excerpt).not.toContain("alice.long.local@");
      expect(excerpt).not.toContain("alice.long.local");
      // The pre-email prefix is preserved up to the boundary.
      expect(excerpt.startsWith(prefix)).toBe(true);
    });
  });
});
