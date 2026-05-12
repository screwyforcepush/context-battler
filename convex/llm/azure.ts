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
  buildDecisionTool,
  parseDecision,
  SAFE_DEFAULT_DECISION,
  type UseVariant,
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
    /**
     * WP10.5 Pass F — captured response-body string from a non-OK HTTP
     * response (the response that DROVE the fallback; on retried calls
     * this is the second-attempt body). Sanitised (api-keys / bearer
     * tokens scrubbed to `[redacted]`) and truncated to ≤ 2 KB.
     *
     * Set ONLY when `failureReason === "http_non_200"`. Absent on the
     * happy path and on every other failure mode (the 200-OK body is
     * already JSON-decoded into other trace fields).
     *
     * Diagnostic purpose: Azure 400s typically embed the moderation
     * policy / category that tripped (e.g. `ResponsibleAIPolicyViolation`).
     * Without this field, fallback debugging is "moderated by elimination"
     * guesswork — the Phase E.1 cautionary tale documented in
     * `wp10-5-phase-a-findings.md`.
     */
    httpBodyExcerpt?: string;
    /**
     * Phase-3 WP-A.2 / ADR §2 — captured reasoning text.
     *
     * Per de-risking.md D-P3-1 probe outcome (Branch A): the project's
     * Azure deployment exposes reasoning items in `response.output[]`
     * with shape:
     *   { type: "reasoning", id, summary: [{ type: "summary_text",
     *     text: "..." }] }
     *
     * The wrapper extracts the joined `summary[].text` strings as the
     * captured reasoning, sanitises via the existing `sanitiseHttpBody`
     * helper, and truncates to ≤ 4 KB.
     *
     * REQUIRED-NULLABLE (`string | null`), NEVER `undefined`. Persisted
     * as `null` on every non-captured path:
     *   - HTTP/network failures
     *   - Status-not-completed / incomplete_details / content-filter
     *   - Happy-path responses without any reasoning items
     *   - JSON-parse / schema-validation failures
     *
     * Per PM lock D13 the schema validator is `v.union(v.string(),
     * v.null())`, NOT `v.optional(v.string())`, so the closing-10
     * metric `reasoning !== null` is well-defined on every row.
     */
    reasoning: string | null;
  };
};

/** Input to `callDecisionTool`. The four `azure*` fields default to env. */
export type CallDecisionToolInput = {
  systemPrompt: string;
  personaPrompt: string;
  scratchpad: string;
  visibleStateDigest: string;
  composedUserMessage: string;
  playerName?: string;
  useVariant?: UseVariant;
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

export function buildPlayerSystemMessage(
  systemPrompt: string,
  playerName: string,
): string {
  return systemPrompt.replace("<Player Name>", playerName);
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

/** Build the safe-default `CallResult` from a partial — saves boilerplate.
 *
 * Phase-3 ADR §2: every failure path must populate
 * `raw.reasoning: null` (never `undefined`). The shape is required-
 * nullable; persisting `null` on every non-captured path keeps the
 * downstream metric `reasoning !== null` well-defined. */
function safeDefaultResult(args: {
  failureReason: FailureReason;
  callId?: string | null;
  rawArguments?: string | null;
  responseId?: string | null;
  usage?: AzureUsage | null;
  latencyMs: number;
  httpStatus: number | null;
  retried?: boolean;
  /** WP10.5 Pass F — captured non-OK HTTP body (sanitised+truncated). Only
   *  set on `failureReason: "http_non_200"`; absent on every other path. */
  httpBodyExcerpt?: string;
  /** Phase-3 ADR §2 — captured reasoning text (Branch A). Defaults to
   *  null; the wrapper sets it on the happy path when an
   *  `output[].type === "reasoning"` item is present. */
  reasoning?: string | null;
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
      // Conditional spread — `v.optional(...)` accepts absence but never
      // `undefined` as a value (mirrors the `failureReason` pattern).
      ...(args.httpBodyExcerpt !== undefined
        ? { httpBodyExcerpt: args.httpBodyExcerpt }
        : {}),
      // Required-nullable: pass-through with null fallback.
      reasoning: args.reasoning ?? null,
    },
  };
}

// ─── WP10.5 Pass F — non-OK body capture (sanitise + truncate) ───────────────

/** Maximum bytes (chars; we truncate the JS string by code units) of the
 *  captured non-OK response body. 2 KB is plenty for an Azure error envelope
 *  while bounding worst-case storage on a 50-run × 50-turn × 8-agent trace. */
const HTTP_BODY_EXCERPT_MAX_LEN = 2048;

/** Escape a string so it can be embedded as a regex literal. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrub anything that looks like an api-key / bearer token / authorization
 * header value, the configured AZURE_API_KEY value (verbatim, even
 * unlabelled), email addresses, or common phone-number formats out of a
 * string. Replaces matches with structured `[redacted]` / `[REDACTED:<kind>]`
 * markers.
 *
 * Defence-in-depth: production Azure 400 bodies generally do NOT echo our
 * credentials or any PII back, but the trace pipeline is durable so the
 * cost of false negatives compounds. This sanitiser runs BEFORE truncation
 * so the redaction marker can't be split mid-token.
 *
 * Patterns matched (case-insensitive on the leading label):
 *   1. The CONFIGURED `azureApiKey` value, verbatim, anywhere — labelled or
 *      unlabelled. Skipped if no key is configured. Replaced with
 *      `[REDACTED:api-key]`. Per Gate-2.5 medium-severity finding.
 *   2. `api-key="..."` / `api-key: ...` / `apiKey: ...` (Azure-style header).
 *      Replaced with `<label>=[redacted]`.
 *   3. `Authorization: Bearer ...` (JWT/bearer header value).
 *   4. Bare `Bearer <token>` (≥ 16-char token) that didn't have an
 *      Authorization label.
 *   5. Email addresses (RFC-5322 conservative subset). Replaced with
 *      `[REDACTED:email]`.
 *   6. Common phone-number formats (CONSERVATIVE — separators required to
 *      avoid eating timestamps / request IDs):
 *        - `+<1-3 digit cc>[-.\s]NXX[-.\s]NXX[-.\s]XXXX`  (+1-555-123-4567)
 *        - `(NXX) NXX-XXXX`                               ((555) 123-4567)
 *        - `NXX.NXX.XXXX`                                 (555.123.4567)
 *      Replaced with `[REDACTED:phone]`.
 */
function sanitiseHttpBody(body: string, azureApiKey?: string): string {
  let scrubbed = body;

  // 1. Verbatim AZURE_API_KEY value (Gate-2.5 medium-severity). Runs FIRST
  //    so a labelled occurrence (`api-key="<key>"`) gets the structured
  //    [REDACTED:api-key] marker rather than the generic [redacted] from
  //    step 2. Skipped if env is unset (no key configured) or key is short
  //    enough to risk false positives in the body (< 8 chars).
  if (typeof azureApiKey === "string" && azureApiKey.length >= 8) {
    scrubbed = scrubbed.replace(
      new RegExp(escapeRegex(azureApiKey), "g"),
      "[REDACTED:api-key]",
    );
  }

  // 2. `api-key` / `apiKey` / `api_key` quoted-or-bare values.
  //    Greedy-match the value up to a quote, semicolon, comma, or whitespace.
  scrubbed = scrubbed.replace(
    /(api[-_]?key)\s*[:=]\s*"?[A-Za-z0-9._\-+/=]{8,}"?/gi,
    "$1=[redacted]",
  );
  // 3. Authorization: Bearer <token>
  scrubbed = scrubbed.replace(
    /(authorization)\s*:\s*bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi,
    "$1: Bearer [redacted]",
  );
  // 4. Bare bearer-style references (e.g. `Bearer eyJ...`) that didn't
  //    have an Authorization label.
  scrubbed = scrubbed.replace(
    /\bbearer\s+[A-Za-z0-9._\-+/=]{16,}/gi,
    "Bearer [redacted]",
  );

  // 5. Email addresses — conservative RFC-5322 subset.
  scrubbed = scrubbed.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "[REDACTED:email]",
  );

  // 6. Phone numbers — conservative. Separators (dash/dot/space + optional
  //    parens or `+` prefix) are REQUIRED. Bare 10+ digit runs (timestamps,
  //    IDs, traceIds) are deliberately NOT matched.
  //    Order matters: the +<cc> form is broadest, then parens, then dots.
  scrubbed = scrubbed.replace(
    /\+\d{1,3}[-.\s]\d{3}[-.\s]\d{3,4}[-.\s]\d{4}\b/g,
    "[REDACTED:phone]",
  );
  scrubbed = scrubbed.replace(
    /\(\d{3}\)\s?\d{3}[-.\s]\d{4}\b/g,
    "[REDACTED:phone]",
  );
  scrubbed = scrubbed.replace(
    /\b\d{3}\.\d{3}\.\d{4}\b/g,
    "[REDACTED:phone]",
  );

  return scrubbed;
}

/** Defensively read response.text(); returns null on any throw. */
async function readBodySafe(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

/** Sanitise + truncate a captured response body for trace persistence.
 *  Returns `undefined` on a null/empty input so callers can pass through
 *  the value to the conditional-spread on `safeDefaultResult`.
 *
 *  Order is REDACT-then-TRUNCATE: the sanitisation pass runs first against
 *  the full raw body so a redaction marker can never be split by the 2 KB
 *  cap (a partial token leak at the boundary). The 2 KB cap is preserved
 *  AFTER all redactions land — see Gate-2.5 sanitisation tests. */
function buildHttpBodyExcerpt(
  raw: string | null,
  azureApiKey?: string,
): string | undefined {
  if (raw === null || raw.length === 0) return undefined;
  const sanitised = sanitiseHttpBody(raw, azureApiKey);
  if (sanitised.length <= HTTP_BODY_EXCERPT_MAX_LEN) return sanitised;
  return sanitised.slice(0, HTTP_BODY_EXCERPT_MAX_LEN);
}

// ─── Phase-3 WP-A.2 — reasoning extraction (Branch A) ───────────────────────
//
// Per de-risking.md D-P3-1 probe outcome (Branch A): the project's Azure
// deployment exposes reasoning items in `response.output[]` with shape:
//   { type: "reasoning", id, summary: [{ type: "summary_text", text:
//     "..." }] }
//
// Multiple reasoning items concatenate with a double newline. The
// joined text is sanitised through the same `sanitiseHttpBody` helper
// (api-keys / bearer tokens / PII redacted) — Gate-2.5 hardening
// generalises here, and legitimate reasoning prose ("Vulture",
// timestamps, etc.) is preserved by the conservative regex set per
// ADR §2 risk mitigation. Output is truncated to ≤ 4 KB.

/** Maximum bytes (chars; we truncate the JS string by code units) of the
 *  captured reasoning excerpt. 4 KB sits between the 2 KB http-body cap
 *  and the typical per-turn reasoning length seen in the WP-A.1 probe
 *  (~ 500-1000 chars), with headroom for verbose chain-of-thought. */
const REASONING_EXCERPT_MAX_LEN = 4096;

type ReasoningItem = {
  type?: unknown;
  text?: unknown;
  summary?: unknown;
};

function isReasoningItem(item: unknown): item is ReasoningItem {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "reasoning"
  );
}

/** Extract joined reasoning text from `output[]` reasoning items.
 *  Returns `null` when no item carries usable text (Branch A's
 *  no-reasoning-emitted case — a non-error condition that still
 *  persists `null`, never undefined). */
function extractReasoningText(
  output: unknown[],
  azureApiKey?: string,
): string | null {
  const fragments: string[] = [];
  for (const item of output) {
    if (!isReasoningItem(item)) continue;
    // Per the probe's recorded shape, the canonical Azure path is
    // `summary: [{ type: "summary_text", text: "..." }]`. We also
    // accept a direct `item.text` string in case a future deployment
    // exposes that shape.
    if (typeof item.text === "string" && item.text.length > 0) {
      fragments.push(item.text);
      continue;
    }
    if (Array.isArray(item.summary)) {
      const parts: string[] = [];
      for (const s of item.summary) {
        if (
          typeof s === "object" &&
          s !== null &&
          typeof (s as { text?: unknown }).text === "string"
        ) {
          const t = (s as { text: string }).text;
          if (t.length > 0) parts.push(t);
        }
      }
      if (parts.length > 0) fragments.push(parts.join("\n"));
    }
  }
  if (fragments.length === 0) return null;
  const joined = fragments.join("\n\n");
  // Sanitise (defence-in-depth — reasoning prose typically doesn't
  // contain credentials, but the trace is durable so the cost of false
  // negatives compounds), then truncate.
  const sanitised = sanitiseHttpBody(joined, azureApiKey);
  if (sanitised.length <= REASONING_EXCERPT_MAX_LEN) return sanitised;
  return sanitised.slice(0, REASONING_EXCERPT_MAX_LEN);
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
  const playerSystemPrompt = buildPlayerSystemMessage(
    input.systemPrompt,
    input.playerName ?? "Agent",
  );
  const userMessage = input.composedUserMessage;
  const useVariant = input.useVariant ?? "consumable_or_null";
  const decisionTool = buildDecisionTool({ useVariant });

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
      { role: "system", content: playerSystemPrompt },
      {
        role: "user",
        content: userMessage,
      },
    ],
    tools: [decisionTool],
    tool_choice: "required",
    parallel_tool_calls: false,
    // Phase-3 ADR §2 / WP-A.1 probe (Branch A): `reasoning.summary: "auto"`
    // is the parameter that asks Azure to emit reasoning summary text in
    // `output[].type === "reasoning"` items. Without it, Azure returns a
    // reasoning item with empty `summary: []`, the extractor yields null,
    // and the closing-10 reasoning-capture metric reads 0%. The probe
    // (`harness/probe-reasoning.ts:104`) already verified the dev
    // deployment accepts the param (`reasoning_summary_param_accepted:
    // true`); persisting that decision into the production wrapper here.
    reasoning: { effort: input.reasoningEffort, summary: "auto" },
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
      // WP10.5 Pass F — capture body for trace excerpt. The body is the
      // most diagnostically valuable signal on an HTTP failure (Azure 400s
      // embed the policy / category that tripped). Sanitised + truncated
      // before persistence; we still always release the connection.
      const rawBody = await readBodySafe(response);
      // Pass the configured api-key value so sanitiseHttpBody can scrub
      // any UNLABELLED verbatim occurrences (Gate-2.5 medium-severity
      // hardening). Labelled scrubs run regardless.
      const httpBodyExcerpt = buildHttpBodyExcerpt(rawBody, azureApiKey);
      return safeDefaultResult({
        failureReason: "http_non_200",
        latencyMs: Date.now() - start,
        httpStatus,
        retried,
        httpBodyExcerpt,
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

    const parsed = parseDecision(rawArguments, {
      useVariant,
    });
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

    // Phase-3 WP-A.2 — extract reasoning text from output[] reasoning
    // items (Branch A path per de-risking.md D-P3-1). The extractor
    // returns `null` when no usable reasoning content is present —
    // never `undefined` — so the persisted row is unambiguous.
    const reasoning = extractReasoningText(output, azureApiKey);

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
        reasoning,
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
