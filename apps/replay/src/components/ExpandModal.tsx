// Phase 03 / WP-D.1 — Click-to-expand raw-dump modal.
//
// THE EXPLAINABILITY DEEP-DIVE (substrate-refinement variant). When the
// user spots something interesting in the side-panel feed (a counter-fire,
// a wall-blocked move, a chest finally opened), this modal surfaces the
// FULL LLM input + the model's reasoning + the parsed tool-call decision
// for one (turn, agent) tuple — the three sections that let the user
// reason about *why* the model made the call it did.
//
// Render contract (per phase-3 ADR §1, §2 + work-packages.md WP-D.1):
//   - Modal overlay: full-viewport `position: fixed` semi-transparent
//     backdrop. Centered card max-width 1200px, max-height 90vh, internal
//     scroll. Close on backdrop click / Escape / explicit close button.
//   - Look up `agentRecord` by `bundle.turns.find(t=>t.turn===target.turn)
//     ?.agentRecords.find(a=>a.characterId===target.characterId)` —
//     turn-number-keyed, NEVER array-index (D-P2-13).
//   - If no record (agent died/extracted earlier or turn === 0), render a
//     "No agentRecord at turn N for this character" placeholder + back link.
//   - Three vertical raw-dump sections, each a read-only <pre> with a copy
//     button:
//       1. **Full LLM input** — `composeFullLlmInput(agentRecord)` — the
//          system role + user role concatenation that went on the wire.
//       2. **Reasoning text** — `composeReasoningText(agentRecord)` —
//          `agentRecord.llm.reasoning ?? "(no reasoning captured)"`. The
//          phase-3 schema does NOT carry a `decision.rationale` field —
//          Branch A (Azure exposes reasoning items in `output[]`) is
//          confirmed; the fallback is the literal string.
//       3. **Tool call JSON** — `composeDecisionJson(agentRecord)` —
//          pretty-printed `agentRecord.decision`.
//
// Per ADR §7: type-only imports across the slice boundary are allowed.

import React, { useEffect, useMemo, useState } from "react";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { ReplayBundle } from "../lib/reconstruct";
import { truncateMid } from "../lib/formatters";
import {
  composeFullLlmInput,
  composeRawArgumentsVsDecision,
  composeReasoningText,
} from "../lib/rawPane";

// ─────────────────────────────────────────────────────────────────────────────
// Public props (LOCKED contract — must match WP-C's stub).
// ─────────────────────────────────────────────────────────────────────────────

export type ExpandModalProps = {
  target: { turn: number; characterId: Id<"characters"> } | null;
  bundle: ReplayBundle;
  onClose: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// ExpandModal — top-level dispatcher. Returns null when no target.
// ─────────────────────────────────────────────────────────────────────────────

export function ExpandModal(
  props: ExpandModalProps,
): React.ReactElement | null {
  const { target, bundle, onClose } = props;

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
            <RawPane agentRecord={lookup.agentRecord} />
          )}
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RawPane — vertical read-only diagnostic panes (LLM input / reasoning /
// tool call / validator reason), each with its own copy-to-clipboard button.
// ─────────────────────────────────────────────────────────────────────────────

type AgentRecord = Doc<"turns">["agentRecords"][number];

function RawPane(props: { agentRecord: AgentRecord }): React.ReactElement {
  // Memoise the three composition strings — `agentRecord` is stable per
  // open-modal lookup, but JSON.stringify is non-trivial and the user
  // can re-render multiple times via React's strict-mode double-invoke
  // or hover-card-driven re-renders.
  const llmInput = useMemo(
    () => composeFullLlmInput(props.agentRecord),
    [props.agentRecord],
  );
  const reasoning = useMemo(
    () => composeReasoningText(props.agentRecord),
    [props.agentRecord],
  );
  const toolCall = useMemo(
    () => composeRawArgumentsVsDecision(props.agentRecord),
    [props.agentRecord],
  );
  const validatorReason = props.agentRecord.llm.validatorReason ?? null;

  return (
    <div>
      <h3 style={subTitleStyle}>Full LLM Input</h3>
      <CopyablePre text={llmInput} />

      <h3 style={subTitleStyle}>Reasoning text</h3>
      <CopyablePre text={reasoning} />

      <h3 style={subTitleStyle}>Tool call</h3>
      <CopyablePre text={toolCall.rendered} />

      {validatorReason ? (
        <>
          <h3 style={subTitleStyle}>validatorReason</h3>
          <CopyablePre text={validatorReason} />
        </>
      ) : null}
    </div>
  );
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

const contentStyle: React.CSSProperties = {
  padding: "1rem 1.25rem",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
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
