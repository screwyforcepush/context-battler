// WP6 — `callDecisionTool`: the only function in the codebase that talks
// to Azure for a per-turn decision. Wrapper contract is locked in ADR §4:
//
//   - NEVER throws. Every failure path resolves to `SAFE_DEFAULT_DECISION`
//     with a populated `failureReason` (one of the 9 in `FailureReason`).
//     The exception: `multiple_function_calls` keeps the FIRST decision
//     (it's still usable) but populates `failureReason` for telemetry so
//     WP12 stats can surface the rate.
//   - 60 s `AbortController` lives INSIDE the wrapper (configurable via
//     `abortTimeoutMs`). No caller forgets the timeout.
//   - Sends `tool_choice: "required"`, `parallel_tool_calls: false`,
//     `reasoning.effort` per arg, `store: false`.
//   - Surfaces `latencyMs`, `usage`, `responseId`, `httpStatus` on the
//     trace fields so WP10 can persist them per-row (ADR §6/§7).
//
// Cross-references:
//   - `azure-llm.md` §1 (credentials), §5 (response shape), §7 (tool-use
//     end-to-end). The `arguments` field is a JSON-encoded STRING per §7.
//   - WP10 (`runMatch.advanceTurn`) calls this once per agent per turn via
//     Promise.all; per-agent fallbacks are visible via `failureReason`.

import {
  decisionTool,
  parseDecision,
  SAFE_DEFAULT_DECISION,
} from "./decisionTool.js";
import type {
  FailureReason,
  ParsedDecision,
} from "../engine/types.js";

// ─── Public types (locked per ADR §4) ────────────────────────────────────────

/**
 * Azure usage bag — best-effort shape per `azure-llm.md` §5. Stored
 * verbatim in the trace; downstream consumers (WP12 cost reports) read it
 * out as needed.
 */
export type AzureUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
};

/** Wrapper result — every failure mode resolves to this same shape. */
export type CallResult = {
  decision: ParsedDecision;
  callId: string | null;
  rawArguments: string | null;
  fellBackToSafeDefault: boolean;
  failureReason?: FailureReason;
  raw: {
    responseId: string | null;
    usage: AzureUsage | null;
    latencyMs: number;
    httpStatus: number | null;
    /**
     * WP10.5 Pass D — `true` when the wrapper made a second HTTP attempt
     * after a transient retryable status ({429, 500, 502, 503, 504}); the
     * value of `httpStatus` then reflects the SECOND attempt. Surfaced on
     * every successful and failed return so harness/analyze-match.ts can
     * count retried calls. See `de-risking.md` Measurement C / WP13 and
     * `wp10-5-phase-a-findings.md` Bucket 3.
     */
    retried: boolean;
  };
};

/** Input to `callDecisionTool`. The four `azure*` fields default to env. */
export type CallDecisionToolInput = {
  systemPrompt: string;
  personaPrompt: string;
  scratchpad: string;
  visibleStateDigest: string;
  reasoningEffort: "low" | "medium" | "high";
  maxOutputTokens: number;
  abortTimeoutMs?: number;
  /**
   * WP10.5 Pass D — milliseconds to wait between the original HTTP attempt
   * and the single retry on transient retryable statuses. Production
   * default is 1000 ms (per `de-risking.md` Measurement C "minimal backoff
   * — base 1 s"). Test callers override this with a small value to keep
   * the suite fast.
   */
  retryDelayMs?: number;
  // Test injection points — production callers should leave these unset.
  fetchImpl?: typeof fetch;
  azureUri?: string;
  azureApiKey?: string;
  azureModel?: string;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Compose the user message body. The system prompt is sent verbatim as
 * the system role; persona + scratchpad + visible state digest are joined
 * with section labels into the user role. We use clear, terse labels so
 * the model can parse the structure even at `reasoning.effort: "low"`.
 *
 * Section labels are stable — WP8 builds the digest body separately and
 * we DO NOT reformat it here (the digest is plain text per ADR §7).
 */
function buildUserMessage(
  personaPrompt: string,
  scratchpad: string,
  visibleStateDigest: string,
): string {
  return [
    "## Persona",
    personaPrompt,
    "",
    "## Scratchpad",
    scratchpad,
    "",
    "## Visible state",
    visibleStateDigest,
  ].join("\n");
}

/** Find every function_call item in a response output array. */
type FunctionCallItem = {
  type: "function_call";
  name?: string;
  call_id?: string;
  arguments?: string;
};

function isFunctionCall(item: unknown): item is FunctionCallItem {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "function_call"
  );
}

/** Detect a content-filter block in the response body.
 *
 * Azure surfaces this in two shapes per `azure-llm.md` §2.6:
 *   - `content_filters: [{ blocked: true, ... }, ...]`
 *   - `status === "content_filter"` (less common but possible)
 *
 * We treat either as a block and return true.
 */
function isContentFilterBlocked(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { status?: unknown; content_filters?: unknown };
  if (b.status === "content_filter") return true;
  if (Array.isArray(b.content_filters)) {
    for (const cf of b.content_filters) {
      if (
        typeof cf === "object" &&
        cf !== null &&
        (cf as { blocked?: unknown }).blocked === true
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Build the safe-default `CallResult` from a partial — saves boilerplate. */
function safeDefaultResult(args: {
  failureReason: FailureReason;
  callId?: string | null;
  rawArguments?: string | null;
  responseId?: string | null;
  usage?: AzureUsage | null;
  latencyMs: number;
  httpStatus: number | null;
  retried?: boolean;
}): CallResult {
  return {
    decision: SAFE_DEFAULT_DECISION,
    callId: args.callId ?? null,
    rawArguments: args.rawArguments ?? null,
    fellBackToSafeDefault: true,
    failureReason: args.failureReason,
    raw: {
      responseId: args.responseId ?? null,
      usage: args.usage ?? null,
      latencyMs: args.latencyMs,
      httpStatus: args.httpStatus,
      retried: args.retried ?? false,
    },
  };
}

// ─── WP10.5 Pass D — minimal retry policy ────────────────────────────────────
//
// One retry on transient HTTP statuses. Per `de-risking.md` Measurement C
// / WP13 derisking-md: the policy is *minimal* — single retry, 1 s
// exponential delay (i.e. just 1 s; no jitter, no token bucket, no
// >1 retry). Larger retry machinery is explicitly out of scope until
// rate-limit characterisation justifies it.

/** HTTP statuses we retry once on. Everything else falls through. */
const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504,
]);

/**
 * Sleep for `ms` milliseconds, but resolve immediately if `signal` aborts.
 * We honour the wrapper-internal AbortController so a long retry delay
 * cannot keep a per-turn call alive past the 60 s timeout.
 */
function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Call the per-turn decision tool against Azure's Responses API.
 *
 * Never throws. Returns a `CallResult` with `fellBackToSafeDefault` and
 * a populated `failureReason` on every failure mode (except
 * `multiple_function_calls`, which keeps the first call's parsed decision
 * and surfaces the failure for telemetry).
 */
export async function callDecisionTool(
  input: CallDecisionToolInput,
): Promise<CallResult> {
  const start = Date.now();
  const fetchImpl: typeof fetch = input.fetchImpl ?? globalThis.fetch;
  const azureUri = input.azureUri ?? process.env.AZURE_URI;
  const azureApiKey = input.azureApiKey ?? process.env.AZURE_API_KEY;
  const azureModel = input.azureModel ?? process.env.AZURE_MODEL;
  const abortTimeoutMs = input.abortTimeoutMs ?? 60_000;
  const retryDelayMs = input.retryDelayMs ?? 1_000;

  // Defensive: missing env or fetch implementation is surfaced as
  // http_non_200 (no HTTP call happened, but the caller's "request did not
  // succeed" expectation is the same). We never throw out of this function.
  if (!azureUri || !azureApiKey || !azureModel) {
    return safeDefaultResult({
      failureReason: "http_non_200",
      latencyMs: Date.now() - start,
      httpStatus: null,
      retried: false,
    });
  }
  if (typeof fetchImpl !== "function") {
    return safeDefaultResult({
      failureReason: "http_non_200",
      latencyMs: Date.now() - start,
      httpStatus: null,
      retried: false,
    });
  }

  // 60s AbortController per ADR §4. Cleared on completion via finally.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortTimeoutMs);

  const requestBody = {
    model: azureModel,
    input: [
      { role: "system", content: input.systemPrompt },
      {
        role: "user",
        content: buildUserMessage(
          input.personaPrompt,
          input.scratchpad,
          input.visibleStateDigest,
        ),
      },
    ],
    tools: [decisionTool],
    tool_choice: "required",
    parallel_tool_calls: false,
    reasoning: { effort: input.reasoningEffort },
    store: false,
    max_output_tokens: input.maxOutputTokens,
  };

  let httpStatus: number | null = null;
  // WP10.5 Pass D — true once a retry has been attempted. Surfaced on
  // every return path (success, http_non_200 fallback, abort) so the
  // harness can later count retried calls.
  let retried = false;
  try {
    // ── Inner: one fetch attempt. Returns the Response or signals the
    // failure mode the caller should surface.
    type AttemptOutcome =
      | { kind: "response"; response: Response }
      | { kind: "abort" }
      | { kind: "network_error" };

    const attemptFetch = async (): Promise<AttemptOutcome> => {
      try {
        const response = await fetchImpl(azureUri, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": azureApiKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        return { kind: "response", response };
      } catch (e) {
        // Distinguish abort from network/sync-throw. Abort wins because
        // the wrapper-internal timeout is the dominant failure shape
        // under load.
        if (
          controller.signal.aborted ||
          (e instanceof Error && e.name === "AbortError")
        ) {
          return { kind: "abort" };
        }
        return { kind: "network_error" };
      }
    };

    // First attempt.
    let outcome = await attemptFetch();

    // WP10.5 Pass D — minimal retry on transient retryable HTTP statuses.
    // ONE retry only; any non-retryable status (or success) falls through
    // unchanged. Non-`response` outcomes (abort, network error) are NOT
    // retried — the existing fallback paths handle them.
    if (
      outcome.kind === "response" &&
      !outcome.response.ok &&
      RETRYABLE_HTTP_STATUSES.has(outcome.response.status)
    ) {
      // Drain the first response body so the connection is released
      // before we sleep + retry.
      try {
        await outcome.response.text();
      } catch {
        // ignore
      }
      // Sleep with abort awareness — a long retry delay must not block
      // past the wrapper-internal timeout.
      await sleepWithAbort(retryDelayMs, controller.signal);
      // If abort fired during the sleep, surface as abort_timeout below.
      if (controller.signal.aborted) {
        return safeDefaultResult({
          failureReason: "abort_timeout",
          latencyMs: Date.now() - start,
          httpStatus: outcome.response.status,
          retried: true,
        });
      }
      retried = true;
      outcome = await attemptFetch();
    }

    if (outcome.kind === "abort") {
      return safeDefaultResult({
        failureReason: "abort_timeout",
        latencyMs: Date.now() - start,
        httpStatus: null,
        retried,
      });
    }
    if (outcome.kind === "network_error") {
      return safeDefaultResult({
        failureReason: "http_non_200",
        latencyMs: Date.now() - start,
        httpStatus: null,
        retried,
      });
    }

    const response = outcome.response;
    httpStatus = response.status;

    if (!response.ok) {
      // Drain body for trace excerpt; we don't currently surface the body
      // text on `CallResult` (`raw` only carries httpStatus), but we read
      // it to release the connection cleanly.
      try {
        await response.text();
      } catch {
        // ignore
      }
      return safeDefaultResult({
        failureReason: "http_non_200",
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      // 200 OK but body wasn't JSON — treat as http_non_200 (the response
      // contract is broken). This keeps the FailureReason set tight.
      void e;
      return safeDefaultResult({
        failureReason: "http_non_200",
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    // Pull common metadata for trace fields.
    const b = body as {
      id?: unknown;
      status?: unknown;
      incomplete_details?: unknown;
      output?: unknown;
      usage?: unknown;
    };
    const responseId = typeof b.id === "string" ? b.id : null;
    const usage =
      typeof b.usage === "object" && b.usage !== null
        ? (b.usage as AzureUsage)
        : null;

    // Failure-mode dispatch — order matters per ADR §4.
    if (isContentFilterBlocked(body)) {
      return safeDefaultResult({
        failureReason: "content_filter_blocked",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    if (b.status !== "completed") {
      return safeDefaultResult({
        failureReason: "status_not_completed",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    if (b.incomplete_details) {
      return safeDefaultResult({
        failureReason: "incomplete_details",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    const output = Array.isArray(b.output) ? b.output : [];
    const functionCalls = output.filter(isFunctionCall);

    if (functionCalls.length === 0) {
      return safeDefaultResult({
        failureReason: "no_function_call",
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    // Even on `multiple_function_calls`, ADR §4 keeps the FIRST call's
    // parsed decision (still usable). Telemetry-only: failureReason is
    // populated, but `fellBackToSafeDefault` is FALSE.
    const isMultiple = functionCalls.length > 1;
    const first = functionCalls[0]!;
    const rawArguments = typeof first.arguments === "string" ? first.arguments : null;
    const callId = typeof first.call_id === "string" ? first.call_id : null;

    if (rawArguments === null) {
      // Defensive: function_call without an arguments string is a parser
      // failure even though `arguments` is technically a string per spec.
      return safeDefaultResult({
        failureReason: "json_parse_failed",
        callId,
        rawArguments: null,
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    const parsed = parseDecision(rawArguments);
    if (!parsed.ok) {
      const failureReason: FailureReason =
        parsed.error === "json_parse"
          ? "json_parse_failed"
          : "schema_validation_failed";
      return safeDefaultResult({
        failureReason,
        callId,
        rawArguments,
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }

    // Happy path (or multiple_function_calls — same return shape but
    // failureReason is set for telemetry).
    return {
      decision: parsed.decision,
      callId,
      rawArguments,
      fellBackToSafeDefault: false,
      ...(isMultiple ? { failureReason: "multiple_function_calls" as const } : {}),
      raw: {
        responseId,
        usage,
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      },
    };
  } catch (e) {
    // Catch-all for anything we missed. Distinguish abort one more time
    // in case AbortController fired during a code path above without
    // surfacing its own AbortError.
    if (
      controller.signal.aborted ||
      (e instanceof Error && e.name === "AbortError")
    ) {
      return safeDefaultResult({
        failureReason: "abort_timeout",
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
      });
    }
    return safeDefaultResult({
      failureReason: "http_non_200",
      latencyMs: Date.now() - start,
      httpStatus,
      retried,
    });
  } finally {
    clearTimeout(timer);
  }
}
