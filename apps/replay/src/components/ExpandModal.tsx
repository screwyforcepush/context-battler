// Phase 02 / WP-D — Click-to-expand verbose modal.
//
// THE EXPLAINABILITY DEEP-DIVE. When the user spots something interesting in
// the side-panel feed (a persona acting against type, a "Truce?" said before
// an attack, an out_of_range failure), this modal surfaces the FULL persona
// prompt + scratchpad + visibleStateDigest + LLM trace for one (turn, agent)
// tuple — so they can read the agent's mind without falling back to ad-hoc
// `npx convex run` queries.
//
// Render contract (per work-packages.md WP-D + ADR §7 / §11):
//   - Modal overlay: full-viewport `position: fixed` semi-transparent
//     backdrop. Centered card max-width 1200px, max-height 90vh, internal
//     scroll. Close on backdrop click / Escape / explicit close button.
//   - Look up `agentRecord` by `bundle.turns.find(t=>t.turn===target.turn)
//     ?.agentRecords.find(a=>a.characterId===target.characterId)` —
//     turn-number-keyed, NEVER array-index (D-P2-13).
//   - If no record (agent died/extracted earlier or turn === 0), render a
//     "No agentRecord at turn N for this character" placeholder + back link.
//   - Five tabs (default = Persona):
//       1. Persona prompt — `agentRecord.input.personaPromptText` (per ADR §7
//          per-row capture; NOT live `personas/*.md`). Header note explains
//          why historical replays may differ from current personas.
//       2. System prompt — `agentRecord.input.systemPromptText` collapsed
//          via <details>. `systemPromptHash` shown alongside.
//       3. Visible state digest — `agentRecord.input.visibleStateDigest`
//          (the agent's own view incl. equipped + HP at start of turn).
//       4. Scratchpad — `scratchpadBefore` and `scratchpadAfter` side-by-side
//          (or stacked on narrow widths). Diff highlight: identical lines
//          greyed; differing lines highlighted.
//       5. LLM trace — `responseId`, `callId`, `latencyMs`, `httpStatus`,
//          `usage`, `fellBackToSafeDefault`, `failureReason`,
//          `validatorReason`, `httpBodyExcerpt`, AND full `rawArguments`
//          pretty-printed JSON (critical for failure-mode debugging).
//   - All verbose content rendered as read-only <pre> blocks with copy-to-
//     clipboard buttons (`navigator.clipboard.writeText`) + "copied!" feedback.
//
// Per ADR §7: type-only imports across the slice boundary are allowed.

import React, { useEffect, useMemo, useState } from "react";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { ReplayBundle } from "../lib/reconstruct";
import {
  formatLatencyMs,
  formatUsage,
  truncateMid,
} from "../lib/formatters";

// ─────────────────────────────────────────────────────────────────────────────
// Public props (LOCKED contract — must match WP-C's stub).
// ─────────────────────────────────────────────────────────────────────────────

export type ExpandModalProps = {
  target: { turn: number; characterId: Id<"characters"> } | null;
  bundle: ReplayBundle;
  onClose: () => void;
};

type TabId = "persona" | "system" | "digest" | "scratchpad" | "llm";
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "persona", label: "Persona prompt" },
  { id: "system", label: "System prompt" },
  { id: "digest", label: "Visible state digest" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "llm", label: "LLM trace" },
];

// ─────────────────────────────────────────────────────────────────────────────
// ExpandModal — top-level dispatcher. Returns null when no target.
// ─────────────────────────────────────────────────────────────────────────────

export function ExpandModal(
  props: ExpandModalProps,
): React.ReactElement | null {
  const { target, bundle, onClose } = props;
  const [activeTab, setActiveTab] = useState<TabId>("persona");

  const targetTurn = target?.turn ?? null;
  const targetCharId = target?.characterId ?? null;

  // Reset to default tab whenever the (turn, character) target changes so
  // the user's last-tab choice doesn't bleed across rows.
  useEffect(() => {
    if (target) setActiveTab("persona");
  }, [targetTurn, targetCharId, target]);

  // Escape key closes the modal. Handler is attached/detached only while
  // the modal is open (target !== null) to avoid hijacking other key
  // handlers in the page.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  // Lookup must be turn-number-keyed (D-P2-13).
  const lookup = useMemo(() => {
    if (!target) return null;
    const row = bundle.turns.find((t) => t.turn === target.turn);
    if (!row) return { row: null, agentRecord: null };
    const agentRecord = row.agentRecords.find(
      (a) => a.characterId === target.characterId,
    );
    return { row, agentRecord: agentRecord ?? null };
  }, [target, bundle]);

  if (!target) return null;

  const character = bundle.characters.find(
    (c) => c._id === target.characterId,
  );

  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Expand details for turn ${target.turn}`}
    >
      <div style={cardStyle}>
        <header style={headerStyle}>
          <div>
            <div style={headerTitleStyle}>
              {character?.displayName ?? "?"}{" "}
              <span style={headerPersonaStyle}>{character?.personaId ?? "?"}</span>
            </div>
            <div style={headerSubtitleStyle}>
              Turn {target.turn} · character {truncateMid(target.characterId, 14)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeBtnStyle}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <nav style={tabBarStyle} role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...tabBtnStyle,
                ...(activeTab === tab.id ? tabBtnActiveStyle : null),
              }}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section style={contentStyle}>
          {!lookup?.agentRecord ? (
            <div style={emptyStyle}>
              <p>
                No agentRecord at turn {target.turn} for this character.
                {target.turn === 0
                  ? " (Turn 0 is the synthetic pre-game snapshot — no decisions exist yet.)"
                  : " The agent likely died or extracted before this turn."}
              </p>
              <button
                type="button"
                onClick={onClose}
                style={inlineBtnStyle}
              >
                ← back
              </button>
            </div>
          ) : (
            <TabContent tab={activeTab} agentRecord={lookup.agentRecord} />
          )}
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabContent dispatcher.
// ─────────────────────────────────────────────────────────────────────────────

type AgentRecord = Doc<"turns">["agentRecords"][number];

function TabContent(props: {
  tab: TabId;
  agentRecord: AgentRecord;
}): React.ReactElement {
  const { tab, agentRecord } = props;
  switch (tab) {
    case "persona":
      return <PersonaTab agentRecord={agentRecord} />;
    case "system":
      return <SystemTab agentRecord={agentRecord} />;
    case "digest":
      return <DigestTab agentRecord={agentRecord} />;
    case "scratchpad":
      return <ScratchpadTab agentRecord={agentRecord} />;
    case "llm":
      return <LlmTab agentRecord={agentRecord} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1 — Persona prompt. From `agentRecord.input.personaPromptText` (per-row
// capture per ADR §7 — NOT live `personas/*.md`).
// ─────────────────────────────────────────────────────────────────────────────

function PersonaTab(props: { agentRecord: AgentRecord }): React.ReactElement {
  const text = props.agentRecord.input.personaPromptText;
  const hash = props.agentRecord.input.personaPromptHash;
  return (
    <div>
      <p style={tabHeaderNoteStyle}>
        Captured at match-start — may differ from current{" "}
        <code>personas/*.md</code>. This is intentional: historical replays
        stay valid after persona edits.
      </p>
      <div style={hashRowStyle}>hash: {truncateMid(hash, 24)}</div>
      <CopyablePre text={text} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2 — System prompt. Collapsed by default via <details> (large content).
// `systemPromptHash` shown alongside.
// ─────────────────────────────────────────────────────────────────────────────

function SystemTab(props: { agentRecord: AgentRecord }): React.ReactElement {
  const text = props.agentRecord.input.systemPromptText;
  const hash = props.agentRecord.input.systemPromptHash;
  return (
    <div>
      <div style={hashRowStyle}>hash: {truncateMid(hash, 24)}</div>
      <details style={detailsStyle}>
        <summary style={summaryStyle}>
          Click to expand system prompt ({text.length} chars)
        </summary>
        <CopyablePre text={text} />
      </details>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3 — Visible state digest. `agentRecord.input.visibleStateDigest` —
// agent's own view (incl. equipped + HP at start of turn).
// ─────────────────────────────────────────────────────────────────────────────

function DigestTab(props: { agentRecord: AgentRecord }): React.ReactElement {
  const text = props.agentRecord.input.visibleStateDigest;
  return (
    <div>
      <p style={tabHeaderNoteStyle}>
        The agent's own view of the world at the start of this turn —
        includes equipped items and HP from the agent's perspective (per
        D-P2-11; substrate doesn't persist these globally).
      </p>
      <CopyablePre text={text} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4 — Scratchpad. Side-by-side `scratchpadBefore` / `scratchpadAfter` with
// line-by-line equality highlight. Identical lines greyed, differing lines
// highlighted. No diff library — line-equality check is sufficient for v0.
// ─────────────────────────────────────────────────────────────────────────────

function ScratchpadTab(props: { agentRecord: AgentRecord }): React.ReactElement {
  const before = props.agentRecord.input.scratchpadBefore;
  const after = props.agentRecord.scratchpadAfter;
  return (
    <div>
      <p style={tabHeaderNoteStyle}>
        Side-by-side comparison: differing lines highlighted, identical lines
        greyed. Truncation (≤500 chars per side) is enforced upstream by the
        engine.
      </p>
      <div style={diffSplitStyle}>
        <DiffPane label="scratchpadBefore" text={before} other={after} />
        <DiffPane label="scratchpadAfter" text={after} other={before} />
      </div>
    </div>
  );
}

function DiffPane(props: {
  label: string;
  text: string;
  other: string;
}): React.ReactElement {
  const myLines = props.text.split("\n");
  const otherLines = props.other.split("\n");
  const otherSet = new Set(otherLines);
  return (
    <div style={diffPaneStyle}>
      <div style={diffPaneHeaderStyle}>
        <span>{props.label}</span>
        <CopyButton text={props.text} />
      </div>
      <pre style={diffPreStyle}>
        {myLines.map((line, i) => {
          const same = otherSet.has(line);
          return (
            <div key={i} style={same ? diffLineSameStyle : diffLineDiffStyle}>
              {line === "" ? " " : line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 5 — LLM trace. `responseId`, `callId`, `latencyMs`, `httpStatus`,
// `usage`, flags, failure-mode keys, AND full `rawArguments` (parsed +
// pretty-printed). Critical for substrate-debugging.
// ─────────────────────────────────────────────────────────────────────────────

function LlmTab(props: { agentRecord: AgentRecord }): React.ReactElement {
  const llm = props.agentRecord.llm;
  // rawArguments is stored as a string (per schema — `v.union(v.string(),
  // v.null())`). We parse + pretty-print for readability; if it's not
  // valid JSON (engine never emitted parsed content), fall back to the
  // raw string.
  const prettyRawArgs = useMemo(() => {
    if (llm.rawArguments === null) return null;
    try {
      const parsed = JSON.parse(llm.rawArguments);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return llm.rawArguments;
    }
  }, [llm.rawArguments]);

  const usageLine = llm.usage ? formatUsage(coerceUsage(llm.usage)) : "—";

  return (
    <div>
      <h3 style={subTitleStyle}>Identifiers</h3>
      <div style={kvBlockStyle}>
        {llm.responseId !== null ? (
          <KvRow label="responseId" value={llm.responseId} />
        ) : null}
        {llm.callId !== null ? (
          <KvRow label="callId" value={llm.callId} />
        ) : null}
      </div>

      <h3 style={subTitleStyle}>Timing &amp; usage</h3>
      <div style={kvBlockStyle}>
        <KvRow label="latencyMs" value={formatLatencyMs(llm.latencyMs)} />
        <KvRow
          label="httpStatus"
          value={llm.httpStatus !== null ? String(llm.httpStatus) : "—"}
        />
        <KvRow label="usage" value={usageLine} />
      </div>

      <h3 style={subTitleStyle}>Failure-mode flags</h3>
      <div style={kvBlockStyle}>
        <KvRow
          label="fellBackToSafeDefault"
          value={String(llm.fellBackToSafeDefault)}
        />
        {llm.failureReason !== undefined ? (
          <KvRow label="failureReason" value={llm.failureReason} />
        ) : null}
        {llm.validatorReason !== undefined ? (
          <KvRow label="validatorReason" value={llm.validatorReason} />
        ) : null}
      </div>

      {llm.httpBodyExcerpt !== undefined ? (
        <>
          <h3 style={subTitleStyle}>HTTP body excerpt</h3>
          <CopyablePre text={llm.httpBodyExcerpt} />
        </>
      ) : null}

      <h3 style={subTitleStyle}>rawArguments (pre-validator LLM tool input)</h3>
      {prettyRawArgs !== null ? (
        <CopyablePre text={prettyRawArgs} />
      ) : (
        <p style={mutedStyle}>(no rawArguments captured)</p>
      )}
    </div>
  );
}

/**
 * Coerce the schema's `v.any()` usage payload into the shape `formatUsage`
 * expects. The Azure responses API returns usage with snake_case keys
 * (`prompt_tokens`, `completion_tokens`, `total_tokens`,
 * `reasoning_tokens` nested under `output_tokens_details`); we fall back
 * across both naming conventions defensively. Anything we can't recognise
 * is dropped (formatUsage will render "—" if all fields are absent).
 */
function coerceUsage(usage: unknown): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
} {
  if (!usage || typeof usage !== "object") return {};
  const u = usage as Record<string, unknown>;
  const pick = (k: string): number | undefined => {
    const v = u[k];
    return typeof v === "number" ? v : undefined;
  };
  const promptTokens =
    pick("promptTokens") ?? pick("prompt_tokens") ?? pick("input_tokens");
  const completionTokens =
    pick("completionTokens") ??
    pick("completion_tokens") ??
    pick("output_tokens");
  const totalTokens = pick("totalTokens") ?? pick("total_tokens");
  let reasoningTokens =
    pick("reasoningTokens") ?? pick("reasoning_tokens");
  if (reasoningTokens === undefined) {
    const detail = u["output_tokens_details"];
    if (detail && typeof detail === "object") {
      const d = detail as Record<string, unknown>;
      const r = d["reasoning_tokens"];
      if (typeof r === "number") reasoningTokens = r;
    }
  }
  // Strip undefined keys so formatUsage's "no fields → em-dash" path triggers.
  const clean: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  } = {};
  if (promptTokens !== undefined) clean.promptTokens = promptTokens;
  if (completionTokens !== undefined) clean.completionTokens = completionTokens;
  if (reasoningTokens !== undefined) clean.reasoningTokens = reasoningTokens;
  if (totalTokens !== undefined) clean.totalTokens = totalTokens;
  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable: read-only <pre> block with copy-to-clipboard button.
// ─────────────────────────────────────────────────────────────────────────────

function CopyablePre(props: { text: string }): React.ReactElement {
  return (
    <div style={preWrapStyle}>
      <div style={preToolbarStyle}>
        <CopyButton text={props.text} />
      </div>
      <pre style={preStyle}>{props.text}</pre>
    </div>
  );
}

function CopyButton(props: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState<boolean>(false);
  const onClick = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(props.text);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context, etc.) — silently ignore.
    }
  };
  return (
    <button type="button" onClick={onClick} style={copyBtnStyle}>
      {copied ? "copied!" : "copy"}
    </button>
  );
}

function KvRow(props: { label: string; value: string }): React.ReactElement {
  return (
    <div style={kvRowStyle}>
      <span style={kvLabelStyle}>{props.label}</span>
      <span style={kvValueStyle}>{props.value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline styles
// ─────────────────────────────────────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
  padding: "1rem",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 1200,
  maxHeight: "90vh",
  background: "#fff",
  borderRadius: 6,
  boxShadow: "0 12px 40px rgba(0,0,0,0.30)",
  display: "flex",
  flexDirection: "column",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#1a1a1a",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  padding: "1rem 1.25rem 0.75rem 1.25rem",
  borderBottom: "1px solid #eee",
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: "1.125rem",
  fontWeight: 600,
};

const headerPersonaStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 400,
  color: "#666",
  marginLeft: "0.5rem",
};

const headerSubtitleStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#666",
  marginTop: "0.125rem",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const closeBtnStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  width: "2rem",
  height: "2rem",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#666",
  lineHeight: 1,
  padding: 0,
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.25rem",
  padding: "0.5rem 1.25rem 0 1.25rem",
  borderBottom: "1px solid #eee",
  flexWrap: "wrap",
};

const tabBtnStyle: React.CSSProperties = {
  border: "1px solid transparent",
  borderBottom: "none",
  background: "transparent",
  padding: "0.5rem 0.875rem",
  cursor: "pointer",
  fontSize: "0.8125rem",
  borderRadius: "4px 4px 0 0",
  color: "#444",
};

const tabBtnActiveStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderBottom: "1px solid #fff",
  background: "#fff",
  marginBottom: -1,
  fontWeight: 600,
  color: "#1a1a1a",
};

const contentStyle: React.CSSProperties = {
  padding: "1rem 1.25rem",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
};

const tabHeaderNoteStyle: React.CSSProperties = {
  margin: "0 0 0.75rem 0",
  fontSize: "0.8125rem",
  color: "#555",
  background: "#fffbe6",
  border: "1px solid #ffe58f",
  borderRadius: 4,
  padding: "0.5rem 0.75rem",
};

const hashRowStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#666",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  marginBottom: "0.5rem",
};

const detailsStyle: React.CSSProperties = { marginTop: "0.5rem" };

const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  padding: "0.375rem 0.5rem",
  background: "#f6f8fa",
  borderRadius: 4,
  fontSize: "0.8125rem",
  marginBottom: "0.5rem",
};

const preWrapStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 4,
  background: "#f6f8fa",
  position: "relative",
};

const preToolbarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "0.25rem 0.5rem",
  borderBottom: "1px solid #e1e4e8",
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "0.75rem",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  fontSize: "0.8125rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  lineHeight: 1.4,
  maxHeight: 480,
  overflowY: "auto",
};

const copyBtnStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  padding: "0.125rem 0.5rem",
  border: "1px solid #ccc",
  borderRadius: 3,
  background: "#fff",
  cursor: "pointer",
};

const inlineBtnStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  padding: "0.25rem 0.625rem",
  border: "1px solid #ccc",
  borderRadius: 3,
  background: "#fff",
  cursor: "pointer",
  marginTop: "0.5rem",
};

const emptyStyle: React.CSSProperties = {
  padding: "2rem",
  textAlign: "center",
  color: "#666",
  fontSize: "0.9375rem",
  lineHeight: 1.5,
};

const subTitleStyle: React.CSSProperties = {
  margin: "1rem 0 0.5rem 0",
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "#1a1a1a",
};

const kvBlockStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  background: "#f6f8fa",
  padding: "0.5rem 0.75rem",
  borderRadius: 4,
  border: "1px solid #e1e4e8",
};

const kvRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  fontSize: "0.8125rem",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const kvLabelStyle: React.CSSProperties = {
  color: "#666",
  minWidth: 160,
};

const kvValueStyle: React.CSSProperties = {
  color: "#1a1a1a",
  flex: 1,
  wordBreak: "break-all",
};

const mutedStyle: React.CSSProperties = {
  color: "#888",
  fontStyle: "italic",
  fontSize: "0.875rem",
};

const diffSplitStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0.5rem",
};

const diffPaneStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 4,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const diffPaneHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.25rem 0.5rem",
  borderBottom: "1px solid #e1e4e8",
  background: "#f6f8fa",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#444",
};

const diffPreStyle: React.CSSProperties = {
  margin: 0,
  padding: "0.5rem",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  fontSize: "0.75rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 480,
  overflowY: "auto",
};

const diffLineSameStyle: React.CSSProperties = {
  color: "#999",
};

const diffLineDiffStyle: React.CSSProperties = {
  color: "#1a1a1a",
  background: "#fff8c5",
  borderLeft: "3px solid #f9c513",
  paddingLeft: "0.25rem",
};
