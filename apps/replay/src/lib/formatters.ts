// Phase 02 / WP-D — Pure formatter helpers consumed by HoverCard.tsx and
// ExpandModal.tsx. No I/O, no React, no DOM. Every helper is round-trip
// covered by `__tests__/formatters.test.ts`.
//
// Why these live in `lib/` and not the components: the formatters are
// trivially unit-testable in isolation, and the components themselves are
// UAT-tested only (per work-packages.md WP-D test strategy).

/**
 * Render a millisecond latency for display.
 *
 * `formatLatencyMs(123)` → `"123 ms"`. `undefined` / `null` collapse to
 * the em-dash glyph (`"—"`) so the field renders as "missing" rather
 * than the awkward `"undefined ms"`. The Azure responses API can return
 * a real `0` for very fast cached completions; we render that as
 * `"0 ms"` because the data is genuinely a measurement.
 */
export function formatLatencyMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) return "—";
  return `${ms} ms`;
}

/**
 * Token-usage formatter. Renders the four optional Azure usage counters
 * as a single human-readable line:
 *
 *   `"prompt: 1.2k · completion: 234 · reasoning: 89 · total: 1.5k"`
 *
 * Absent fields are omitted (no `"undefined"` placeholder leakage). If
 * the entire object is undefined or has no enumerable counters, the
 * em-dash glyph is returned.
 *
 * Numbers >= 1000 are abbreviated to one decimal place + `"k"` to keep
 * the line short. Zero renders as `"0"` (no abbreviation; the
 * abbreviation is purely for visual compactness on large values).
 */
export function formatUsage(
  usage:
    | {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        reasoningTokens?: number;
      }
    | undefined
    | null,
): string {
  if (usage === undefined || usage === null) return "—";

  const parts: string[] = [];
  // Insertion order matches the canonical display order: prompt → completion
  // → reasoning → total. Each `pushIfPresent` is a no-op when the value is
  // `undefined`.
  if (usage.promptTokens !== undefined) {
    parts.push(`prompt: ${abbreviate(usage.promptTokens)}`);
  }
  if (usage.completionTokens !== undefined) {
    parts.push(`completion: ${abbreviate(usage.completionTokens)}`);
  }
  if (usage.reasoningTokens !== undefined) {
    parts.push(`reasoning: ${abbreviate(usage.reasoningTokens)}`);
  }
  if (usage.totalTokens !== undefined) {
    parts.push(`total: ${abbreviate(usage.totalTokens)}`);
  }

  if (parts.length === 0) return "—";
  return parts.join(" · ");
}

/**
 * `formatTurnCount(3, 50)` → `"3 / 50"`. Synthetic pre-game turn renders
 * as `"0 / 50"`; terminal turn renders as `"50 / 50"`. Pure stringify.
 */
export function formatTurnCount(n: number, total: number): string {
  return `${n} / ${total}`;
}

/**
 * Middle-truncate a long id string for compact display.
 *
 *   `truncateMid("abcdefghij", 7)` → `"abc…hij"`.
 *   `truncateMid("abc", 10)`       → `"abc"` (already fits).
 *
 * If `max` is small enough that no head/tail can be shown, the full
 * ellipsis `"…"` is returned. `max <= 0` also collapses to `"…"`.
 */
export function truncateMid(s: string, max: number): string {
  if (s.length <= max) return s;
  // Need room for the ellipsis itself + at least 1 char head + 1 char tail.
  if (max < 3) return "…";
  // Ellipsis takes 1 char (the visual width is 1 since it's a single
  // codepoint). Distribute the remaining `max - 1` between head and tail,
  // favouring the head for odd remainders.
  const remaining = max - 1;
  const headLen = Math.ceil(remaining / 2);
  const tailLen = Math.floor(remaining / 2);
  return `${s.slice(0, headLen)}…${s.slice(s.length - tailLen)}`;
}

/**
 * No-op pass-through. Exists for callsite consistency: HoverCard +
 * ExpandModal want a single helper for "this string will be rendered
 * inside `<pre>`", but React text nodes already escape HTML, so the
 * function returns the input verbatim. If a future change moves to
 * `dangerouslySetInnerHTML`, this is the single point to add real
 * escaping.
 */
export function escapeForPre(s: string): string {
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: number abbreviation. >= 1000 → one decimal + "k", else identity.
// ─────────────────────────────────────────────────────────────────────────────

function abbreviate(n: number): string {
  if (n < 1000) return `${n}`;
  // Round to one decimal. `12345` → `"12.3k"`, `1000` → `"1.0k"`.
  const rounded = Math.round(n / 100) / 10;
  return `${rounded.toFixed(1)}k`;
}
