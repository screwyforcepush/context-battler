// Phase 02 / WP-C — Side-panel turn feed.
//
// For currentTurn === 0 → render "Pre-game / no decisions yet" placeholder.
// For currentTurn >= 1 → look up `row = turnRowByTurn.get(currentTurn)` and
// render one row per agent in `row.agentRecords[]`. Each row shows persona
// swatch + displayName + persona id + one-line decision summary +
// say text + scratchpad-delta indicator. Click row → expand inline.
//
// "..." button on each row triggers `onOpenModal({ turn, characterId })` —
// the actual modal is rendered by Replay.tsx (WP-D's ExpandModal).
//
// Dead/extracted agents on later turns (no agentRecord): render a greyed
// marker pulled from `bundle.characters[c]` terminal data.
//
// Per D-P2-13: lookup turns by `.turn`, NEVER by array index. Build the
// `turnRowByTurn` map ONCE per bundle via `useMemo`.

import React, { useMemo, useState } from "react";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { ReplayBundle } from "../lib/reconstruct";
import { summariseDecision } from "../lib/decisionEnglish";
import { hasReasoningIndicator } from "../lib/rawPane";

export type TurnFeedProps = {
  bundle: ReplayBundle;
  currentTurn: number;
  onOpenModal: (target: {
    turn: number;
    characterId: Id<"characters">;
  }) => void;
};

// Same persona-colour palette as Grid.tsx. Duplicated by intent — the
// renderer slice is thin enough that two copies of an 8-entry table is
// cheaper to maintain than a shared module + import + colour-system
// abstraction. If a third surface ever needs the palette, extract.
const PERSONA_COLOURS: Record<string, string> = {
  rat: "#1f77b4",
  duelist: "#ff7f0e",
  trader: "#2ca02c",
  opportunist: "#d62728",
  paranoid: "#9467bd",
  camper: "#8c564b",
  sprinter: "#e377c2",
  vulture: "#7f7f7f",
};

const FALLBACK_COLOUR = "#444";

const SCRATCHPAD_AFTER_BUDGET = 500;
const SCRATCHPAD_PREVIEW_BUDGET = 100;

export function TurnFeed(props: TurnFeedProps): React.ReactElement {
  const { bundle, currentTurn, onOpenModal } = props;

  // Build turn-row map ONCE per bundle. Keyed by `row.turn` (D-P2-13).
  const turnRowByTurn = useMemo(() => {
    const m = new Map<number, Doc<"turns">>();
    for (const r of bundle.turns) m.set(r.turn, r);
    return m;
  }, [bundle.turns]);

  const characterById = useMemo(() => {
    const m = new Map<Id<"characters">, Doc<"characters">>();
    for (const c of bundle.characters) m.set(c._id, c);
    return m;
  }, [bundle.characters]);

  // Ordering for the feed: stable by displayName. Same agents appear in the
  // same vertical slot every turn, which makes scrubbing visually coherent.
  const orderedCharacters = useMemo(() => {
    return [...bundle.characters].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }, [bundle.characters]);

  // Track which agent rows are expanded inline. Keyed by characterId so
  // the expansion persists across turn changes (the user scrubs through
  // turns and keeps the row they're inspecting open).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (currentTurn === 0) {
    return (
      <aside style={feedStyle} aria-label="Turn feed">
        <header style={feedHeaderStyle}>
          <span style={feedTitleStyle}>Turn 0</span>
          <span style={feedSubtitleStyle}>spawn positions</span>
        </header>
        <div style={placeholderStyle}>Pre-game / no decisions yet</div>
      </aside>
    );
  }

  const row = turnRowByTurn.get(currentTurn);

  return (
    <aside style={feedStyle} aria-label="Turn feed">
      <header style={feedHeaderStyle}>
        <span style={feedTitleStyle}>Turn {currentTurn}</span>
        <span style={feedSubtitleStyle}>
          {row ? `${row.agentRecords.length} decisions` : "no ledger row"}
        </span>
      </header>

      {!row ? (
        <div style={placeholderStyle}>
          (No turns row at turn {currentTurn} — match likely ended earlier.)
        </div>
      ) : (
        <div style={feedListStyle}>
          {orderedCharacters.map((c) => {
            const agentRecord = row.agentRecords.find(
              (a) => a.characterId === c._id,
            );
            const isExpanded = expanded.has(c._id);
            const onToggle = (): void => {
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(c._id)) next.delete(c._id);
                else next.add(c._id);
                return next;
              });
            };
            const onExpandClick = (e: React.MouseEvent): void => {
              e.stopPropagation();
              onOpenModal({ turn: currentTurn, characterId: c._id });
            };
            return (
              <FeedRow
                key={c._id}
                character={c}
                agentRecord={agentRecord ?? null}
                row={row}
                characterById={characterById}
                currentTurn={currentTurn}
                expanded={isExpanded}
                onToggle={onToggle}
                onExpandClick={onExpandClick}
              />
            );
          })}
        </div>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeedRow — one agent's slot for the current turn.
// ─────────────────────────────────────────────────────────────────────────────

function FeedRow(props: {
  character: Doc<"characters">;
  agentRecord: Doc<"turns">["agentRecords"][number] | null;
  row: Doc<"turns">;
  characterById: Map<Id<"characters">, Doc<"characters">>;
  currentTurn: number;
  expanded: boolean;
  onToggle: () => void;
  onExpandClick: (e: React.MouseEvent) => void;
}): React.ReactElement {
  const {
    character,
    agentRecord,
    row,
    characterById,
    currentTurn,
    expanded,
    onToggle,
    onExpandClick,
  } = props;

  const colour = PERSONA_COLOURS[character.personaId] ?? FALLBACK_COLOUR;

  // Dead/extracted state — terminal markers when the agent has no record
  // for the current turn. Read from terminal `characters` row.
  if (!agentRecord) {
    const diedAtTurn = character.diedAtTurn ?? null;
    const extractedAtTurn = character.extractedAtTurn ?? null;
    const marker = (() => {
      if (diedAtTurn !== null && diedAtTurn <= currentTurn) {
        return `died turn ${diedAtTurn}`;
      }
      if (extractedAtTurn !== null && extractedAtTurn <= currentTurn) {
        return `extracted turn ${extractedAtTurn}`;
      }
      return "(no record this turn)";
    })();
    return (
      <div style={{ ...rowStyle, ...inactiveRowStyle }}>
        <Swatch colour={colour} dimmed />
        <div style={rowMainStyle}>
          <div style={rowHeaderStyle}>
            <strong style={dimmedNameStyle}>{character.displayName}</strong>
            <span style={personaIdStyle}>{character.personaId}</span>
          </div>
          <div style={inactiveMarkerStyle}>{marker}</div>
        </div>
      </div>
    );
  }

  const summary = summariseDecision(agentRecord, row.resolution, characterById);
  const sayText = agentRecord.decision.say;
  const scratchpadChanged =
    agentRecord.decision.scratchpad_update !== null &&
    agentRecord.decision.scratchpad_update !== agentRecord.input.scratchpadBefore;
  // Phase-3 ADR §2 — reasoning indicator. Lights up when reasoning text
  // is present so the user knows the raw-pane modal has substrate-mind
  // content to surface.
  const reasoningPresent = hasReasoningIndicator(agentRecord);
  // Phase-3 ADR §3 — stance display when the agent is overwatching.
  const overwatchStance =
    agentRecord.decision.primary === "overwatch"
      ? agentRecord.decision.overwatch_stance
      : null;

  return (
    <div
      style={rowStyle}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
    >
      <Swatch colour={colour} />
      <div style={rowMainStyle}>
        <div style={rowHeaderStyle}>
          <strong style={nameStyle}>{character.displayName}</strong>
          <span style={personaIdStyle}>{character.personaId}</span>
          {scratchpadChanged ? (
            <span style={scratchpadDeltaIndicatorStyle} title="Scratchpad changed">
              ✎
            </span>
          ) : null}
          {reasoningPresent ? (
            <span
              style={reasoningIndicatorStyle}
              title="Reasoning text captured — open raw-pane to read"
              aria-label="Reasoning captured"
            >
              🧠
            </span>
          ) : null}
          <button
            type="button"
            onClick={onExpandClick}
            style={dotsBtnStyle}
            aria-label={`Open expand modal for ${character.displayName}`}
            title="Open full agent details"
          >
            …
          </button>
        </div>
        <div style={oneLineStyle}>{summary.oneLine}</div>
        {sayText ? <div style={sayStyle}>“{sayText}”</div> : null}
        {agentRecord.scratchpadAfter.length > 0 ? (
          <div style={scratchpadPreviewStyle} title="scratchpadAfter (preview)">
            {truncateOneLine(
              agentRecord.scratchpadAfter,
              SCRATCHPAD_PREVIEW_BUDGET,
            )}
          </div>
        ) : null}

        {expanded ? (
          <div style={expandedBodyStyle}>
            {overwatchStance !== null ? (
              <div style={expandedSectionStyle}>
                <div style={expandedSectionTitleStyle}>Overwatch stance</div>
                <div style={stanceLineStyle}>Stance: {overwatchStance}</div>
              </div>
            ) : null}
            <div style={expandedSectionStyle}>
              <div style={expandedSectionTitleStyle}>Decision bullets</div>
              <ul style={bulletsListStyle}>
                {summary.bullets.map((b, i) => (
                  <li key={`bullet-${i}`} style={bulletItemStyle}>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div style={expandedSectionStyle}>
              <div style={expandedSectionTitleStyle}>Intent vs outcome</div>
              <ul style={pairsListStyle}>
                {summary.intentVsOutcome.map((p, i) => (
                  <li key={`pair-${i}`} style={pairItemStyle}>
                    <span style={pairIntentStyle}>{p.intent}</span>
                    <span style={pairArrowStyle}>→</span>
                    <span style={pairOutcomeStyle}>{p.outcome}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div style={expandedSectionStyle}>
              <div style={expandedSectionTitleStyle}>
                Scratchpad (after — truncated to {SCRATCHPAD_AFTER_BUDGET} chars)
              </div>
              <pre style={scratchpadPreStyle}>
                {truncateToBudget(
                  agentRecord.scratchpadAfter,
                  SCRATCHPAD_AFTER_BUDGET,
                )}
              </pre>
            </div>
            {sayText ? (
              <div style={expandedSectionStyle}>
                <div style={expandedSectionTitleStyle}>Said (full)</div>
                <pre style={scratchpadPreStyle}>{sayText}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers + presentational primitives
// ─────────────────────────────────────────────────────────────────────────────

function truncateToBudget(s: string, budget: number): string {
  if (s.length <= budget) return s;
  return s.slice(0, Math.max(0, budget - 1)) + "…";
}

/**
 * Single-line preview helper: collapses any whitespace runs (newlines, tabs,
 * CRLF) into one space, then clamps to `budget` with an ellipsis suffix when
 * over. Used for the collapsed feed row's scratchpadAfter preview so a
 * multi-line scratchpad never breaks row alignment.
 */
export function truncateOneLine(s: string, budget: number): string {
  const oneLine = s.replace(/\s+/g, " ");
  return truncateToBudget(oneLine, budget);
}

function Swatch(props: { colour: string; dimmed?: boolean }): React.ReactElement {
  return (
    <span
      style={{
        ...swatchStyle,
        background: props.colour,
        opacity: props.dimmed ? 0.45 : 1,
      }}
      aria-hidden="true"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

// Layout invariant (closure-readiness round-3, AC#7): the aside itself
// owns `overflow-y: auto` so the agent rows are reachable via the page-
// level scroll affordance even when the nested-flex chain leaves the
// inner list with no visible scrollbar (Linux Chromium overlay-style).
// `min-height: 0` propagates the shrink permission from `feedColStyle`.
// `overscroll-behavior: contain` keeps wheel scroll local to the panel.
const feedStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 4,
  overflowY: "auto",
  overscrollBehavior: "contain",
};

// Sticky header keeps the "Turn N · M decisions" caption visible while
// the rows scroll inside the aside (closure-readiness round-3, AC#7).
const feedHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  padding: "0.625rem 0.875rem",
  borderBottom: "1px solid #eee",
  background: "#f6f8fa",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const feedTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: "0.9375rem",
};

const feedSubtitleStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#666",
};

// Inner row container — the scroll affordance is on the aside (see
// `feedStyle`); this div just stacks rows. `flex-shrink: 0` prevents flex
// from collapsing rows when the aside's intrinsic height is short.
const feedListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const placeholderStyle: React.CSSProperties = {
  padding: "1rem",
  color: "#777",
  fontStyle: "italic",
  textAlign: "center",
  fontSize: "0.875rem",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  padding: "0.625rem 0.875rem",
  borderBottom: "1px solid #f3f3f3",
  cursor: "pointer",
  alignItems: "flex-start",
  outline: "none",
};

const inactiveRowStyle: React.CSSProperties = {
  background: "#fafafa",
  cursor: "default",
};

const rowMainStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "0.1875rem",
  minWidth: 0,
};

const rowHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const nameStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "#1a1a1a",
};

const dimmedNameStyle: React.CSSProperties = {
  ...nameStyle,
  color: "#888",
};

const personaIdStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#666",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const scratchpadDeltaIndicatorStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "#aa5500",
  marginLeft: "0.125rem",
};

const reasoningIndicatorStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  marginLeft: "0.125rem",
  // Visible-but-subtle to signal "raw-pane has content" without competing
  // with the scratchpad-delta affordance.
};

const stanceLineStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#1a1a1a",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const dotsBtnStyle: React.CSSProperties = {
  marginLeft: "auto",
  padding: "0.125rem 0.5rem",
  fontSize: "0.875rem",
  cursor: "pointer",
  border: "1px solid #ddd",
  borderRadius: 4,
  background: "#fff",
  color: "#666",
};

const oneLineStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#1a1a1a",
  lineHeight: 1.4,
};

const sayStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#444",
  fontStyle: "italic",
};

const scratchpadPreviewStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#888",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const inactiveMarkerStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#999",
  fontStyle: "italic",
};

const swatchStyle: React.CSSProperties = {
  display: "inline-block",
  width: 12,
  height: 12,
  borderRadius: "50%",
  flex: "0 0 auto",
  marginTop: 4,
  border: "1px solid #1a1a1a",
};

const expandedBodyStyle: React.CSSProperties = {
  marginTop: "0.5rem",
  padding: "0.5rem 0.625rem",
  background: "#f6f8fa",
  borderRadius: 4,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const expandedSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};

const expandedSectionTitleStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const bulletsListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "disc inside",
  fontSize: "0.8125rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
};

const bulletItemStyle: React.CSSProperties = {
  color: "#1a1a1a",
};

const pairsListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
};

const pairItemStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.375rem",
  fontSize: "0.8125rem",
  alignItems: "baseline",
};

const pairIntentStyle: React.CSSProperties = {
  color: "#1a1a1a",
};

const pairArrowStyle: React.CSSProperties = {
  color: "#888",
};

const pairOutcomeStyle: React.CSSProperties = {
  color: "#0366d6",
  flex: 1,
};

const scratchpadPreStyle: React.CSSProperties = {
  margin: 0,
  padding: "0.375rem 0.5rem",
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 4,
  fontSize: "0.75rem",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 240,
  overflowY: "auto",
};
