// Phase 02 / WP-D — Hover-detail card.
//
// Renders a position-pinned card near the cursor with per-kind details for
// the currently-hovered token on the grid. The dispatcher in Replay.tsx
// (WP-C territory) reads `data-token-kind` / `data-character-id` /
// `data-chest-id` from the SVG (emitted by Grid.tsx — WP-B territory),
// resolves the DOM target → `HoverTarget`, and passes it here as a prop.
//
// Render contract (per `work-packages.md` WP-D + ADR §9 D-P2-11 / §10 D-P2-12):
//   - agent (live): persona, displayName, position, alive/hidden flags, and
//     the one-line decision summary for `currentTurn`. Equipment + HP rows
//     literally read "see expand panel" — substrate doesn't persist them
//     per turn, the agent's own view lives in `agentRecord.input.visibleStateDigest`
//     surfaced by ExpandModal.
//   - agent (dead/extracted): grey-out marker with "died turn N" /
//     "extracted turn N".
//   - chest (closed): id, position, "closed".
//   - chest (opened): id, position, "opened (turn N)" + literal
//     "contents not persisted" line — engine clears
//     `worldState.chests[i].contents` on open (`resolution.ts:537`).
//   - corpse: deceased displayName + persona + death turn + remaining loot
//     from `worldState.corpses[]` (engine-authored truth — only ledger-free
//     fallback per ADR §4).
//   - wall / cover / evac: trivial single-word labels with position.
//
// Position-pinning: `position: fixed; left = cursor.x + 12; top = cursor.y + 12`.
// Card flips horizontally / vertically when it would overflow the viewport
// (basic clamp; no library). Card width/height are bounded by max-width +
// max-height with internal scroll for overflow content.
//
// Per ADR §7: type-only imports across the slice boundary are allowed.

import React, { useLayoutEffect, useRef, useState } from "react";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { HoverTarget } from "../lib/hoverTypes";
import type { ReplayBundle, EntitySnapshot } from "../lib/reconstruct";
import { summariseDecision } from "../lib/decisionEnglish";

// ─────────────────────────────────────────────────────────────────────────────
// Public props (LOCKED contract — must match WP-C's stub).
// ─────────────────────────────────────────────────────────────────────────────

export type HoverCardProps = {
  target: HoverTarget | null;
  bundle: ReplayBundle;
  snapshot: EntitySnapshot;
  currentTurn: number;
  /** Viewport pixels (`MouseEvent.clientX/Y`). Null = no cursor → render nothing. */
  cursorPos: { x: number; y: number } | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// HoverCard — top-level dispatcher. Returns null when no target / no cursor.
// ─────────────────────────────────────────────────────────────────────────────

export function HoverCard(props: HoverCardProps): React.ReactElement | null {
  const { target, bundle, snapshot, currentTurn, cursorPos } = props;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  // Reposition the card whenever cursor or target changes. Use
  // `useLayoutEffect` so the measurement happens before paint and the user
  // never sees a one-frame flicker at the wrong position. Falls back to
  // assumed dimensions (220 × 320) if ref isn't measured yet (first
  // render).
  useLayoutEffect(() => {
    if (!cursorPos || !target) {
      setPosition(null);
      return;
    }
    const cardEl = cardRef.current;
    const cardW = cardEl?.offsetWidth ?? 220;
    const cardH = cardEl?.offsetHeight ?? 320;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const OFFSET = 12;

    let left = cursorPos.x + OFFSET;
    let top = cursorPos.y + OFFSET;
    // Flip horizontal if the card would overflow the right edge.
    if (left + cardW > vw) left = Math.max(4, cursorPos.x - cardW - OFFSET);
    // Flip vertical if the card would overflow the bottom edge.
    if (top + cardH > vh) top = Math.max(4, cursorPos.y - cardH - OFFSET);
    setPosition({ left, top });
  }, [cursorPos, target]);

  if (!target || !cursorPos) return null;

  // First render — show off-screen until measured to avoid the
  // pre-clamp flash (see useLayoutEffect above).
  const style: React.CSSProperties = {
    position: "fixed",
    left: position?.left ?? -9999,
    top: position?.top ?? -9999,
    pointerEvents: "none", // never steal hover events from the grid
    zIndex: 1000,
  };

  return (
    <div ref={cardRef} style={{ ...style, ...cardStyle }} role="tooltip">
      {renderHoverBody(target, bundle, snapshot, currentTurn)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind body dispatch.
// ─────────────────────────────────────────────────────────────────────────────

function renderHoverBody(
  target: HoverTarget,
  bundle: ReplayBundle,
  snapshot: EntitySnapshot,
  currentTurn: number,
): React.ReactElement {
  switch (target.kind) {
    case "agent":
      return (
        <AgentHover
          characterId={target.characterId}
          bundle={bundle}
          snapshot={snapshot}
          currentTurn={currentTurn}
        />
      );
    case "chest":
      return (
        <ChestHover
          chestId={target.chestId}
          pos={target.pos}
          bundle={bundle}
          snapshot={snapshot}
        />
      );
    case "corpse":
      return (
        <CorpseHover
          characterId={target.characterId}
          pos={target.pos}
          bundle={bundle}
        />
      );
    case "wall":
      return <SimpleHover label="Wall" pos={target.pos} />;
    case "cover":
      return <SimpleHover label="Cover" pos={target.pos} />;
    case "evac":
      return <SimpleHover label="Evac zone" pos={target.pos} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent body. Dead → tombstone marker. Live → persona / pos / flags / decision.
// Equipment + HP rows render literal "see expand panel" per D-P2-11.
// ─────────────────────────────────────────────────────────────────────────────

function AgentHover(props: {
  characterId: Id<"characters">;
  bundle: ReplayBundle;
  snapshot: EntitySnapshot;
  currentTurn: number;
}): React.ReactElement {
  const { characterId, bundle, snapshot, currentTurn } = props;
  const character = bundle.characters.find((c) => c._id === characterId);
  if (!character) {
    return <Block title="Agent" body={<Row label="error" value="Character not found" />} />;
  }
  const snapEntry = snapshot.characters.find(
    (c) => c.characterId === characterId,
  );

  // Dead: render tombstone with death turn.
  if (snapEntry && !snapEntry.alive && snapEntry.diedAtTurn !== null) {
    return (
      <Block
        title={`${character.displayName} (deceased)`}
        body={
          <>
            <Row label="persona" value={character.personaId} />
            <Row label="status" value={`died turn ${snapEntry.diedAtTurn}`} />
            <Row
              label="position"
              value={`(${snapEntry.pos.x}, ${snapEntry.pos.y})`}
            />
          </>
        }
      />
    );
  }
  // Extracted: render extracted marker. The grid hides extracted tokens, so
  // this branch fires only if a hover lands somewhere weird; defensive.
  if (
    snapEntry &&
    snapEntry.extractedAtTurn !== null &&
    snapEntry.extractedAtTurn <= currentTurn
  ) {
    return (
      <Block
        title={`${character.displayName} (extracted)`}
        body={
          <>
            <Row label="persona" value={character.personaId} />
            <Row
              label="status"
              value={`extracted turn ${snapEntry.extractedAtTurn}`}
            />
          </>
        }
      />
    );
  }

  const oneLine = lookupOneLineSummary(bundle, currentTurn, characterId);
  const pos = snapEntry?.pos ?? character.pos;
  return (
    <Block
      title={character.displayName}
      body={
        <>
          <Row label="persona" value={character.personaId} />
          <Row label="position" value={`(${pos.x}, ${pos.y})`} />
          <Row label="alive" value={snapEntry?.alive ? "yes" : "no"} />
          <Row
            label="hidden"
            value={snapEntry?.hidden ? "yes" : "no"}
          />
          <Row label="hp" value="see expand panel" />
          <Row label="equipped" value="see expand panel" />
          <div style={oneLineStyle}>{oneLine}</div>
        </>
      }
    />
  );
}

/**
 * Look up the agent's one-line decision summary for `currentTurn`. Returns a
 * sensible fallback for synthetic turn 0 (no agentRecord) and for turns where
 * the agent has no record (died/extracted earlier).
 */
function lookupOneLineSummary(
  bundle: ReplayBundle,
  currentTurn: number,
  characterId: Id<"characters">,
): string {
  if (currentTurn <= 0) return "Pre-game / no decision yet";
  // D-P2-13: lookup turns by `.turn`, NEVER by array index.
  const row = bundle.turns.find((t) => t.turn === currentTurn);
  if (!row) return `(no turn-${currentTurn} ledger row)`;
  const agentRecord = row.agentRecords.find(
    (a) => a.characterId === characterId,
  );
  if (!agentRecord) {
    return `(no agentRecord at turn ${currentTurn} for this character)`;
  }
  const characterById = new Map<Id<"characters">, Doc<"characters">>();
  for (const c of bundle.characters) characterById.set(c._id, c);
  return summariseDecision(agentRecord, row.resolution, characterById).oneLine;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chest body. Closed → id + pos + "closed". Opened → id + pos + "opened
// (turn N)" + literal "contents not persisted" (D-P2-12).
// ─────────────────────────────────────────────────────────────────────────────

function ChestHover(props: {
  chestId: string;
  pos: { x: number; y: number };
  bundle: ReplayBundle;
  snapshot: EntitySnapshot;
}): React.ReactElement {
  const { chestId, pos, bundle, snapshot } = props;
  const snapChest = snapshot.chests.find((c) => c.id === chestId);
  const opened = snapChest?.opened ?? false;
  const openedAtTurn = opened ? findChestOpenTurn(bundle, chestId) : null;

  return (
    <Block
      title={`Chest ${chestId}`}
      body={
        <>
          <Row label="position" value={`(${pos.x}, ${pos.y})`} />
          {opened ? (
            <>
              <Row
                label="status"
                value={
                  openedAtTurn !== null
                    ? `opened (turn ${openedAtTurn})`
                    : "opened"
                }
              />
              <Row label="contents" value="contents not persisted" />
            </>
          ) : (
            <Row label="status" value="closed" />
          )}
        </>
      }
    />
  );
}

/**
 * Walk `bundle.turns` for the action that opened this chest. Returns the
 * turn-number, or null if not found (e.g. inconsistent terminal state).
 * Per D-P2-13, lookup is by `row.turn` not array index.
 */
function findChestOpenTurn(
  bundle: ReplayBundle,
  chestId: string,
): number | null {
  for (const row of bundle.turns) {
    for (const a of row.resolution.actions) {
      if (a.kind === "interact" && a.target === chestId && a.result === "opened") {
        return row.turn;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpse body. displayName + persona + death turn + remaining loot from
// `worldState.corpses[]` (engine-authored truth per ADR §4 fallback).
// ─────────────────────────────────────────────────────────────────────────────

function CorpseHover(props: {
  characterId: Id<"characters">;
  pos: { x: number; y: number };
  bundle: ReplayBundle;
}): React.ReactElement {
  const { characterId, pos, bundle } = props;
  const character = bundle.characters.find((c) => c._id === characterId);
  const corpse = bundle.worldState?.corpses.find(
    (c) => c.characterId === characterId,
  );
  const diedAtTurn =
    character?.diedAtTurn ?? null;

  return (
    <Block
      title={`Corpse — ${character?.displayName ?? "?"}`}
      body={
        <>
          <Row label="persona" value={character?.personaId ?? "?"} />
          <Row label="position" value={`(${pos.x}, ${pos.y})`} />
          <Row
            label="died"
            value={diedAtTurn !== null ? `turn ${diedAtTurn}` : "—"}
          />
          <Row
            label="remaining loot"
            value={formatCorpseContents(corpse?.contents)}
          />
        </>
      }
    />
  );
}

function formatCorpseContents(
  contents:
    | {
        weapon?: { name: string };
        armour?: { name: string };
        consumable?: { name: string };
      }
    | undefined,
): string {
  if (!contents) return "(no corpse data)";
  const parts: string[] = [];
  if (contents.weapon) parts.push(`weapon: ${contents.weapon.name}`);
  if (contents.armour) parts.push(`armour: ${contents.armour.name}`);
  if (contents.consumable)
    parts.push(`consumable: ${contents.consumable.name}`);
  if (parts.length === 0) return "(empty)";
  return parts.join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Trivial single-word hovers for wall / cover / evac.
// ─────────────────────────────────────────────────────────────────────────────

function SimpleHover(props: {
  label: string;
  pos: { x: number; y: number };
}): React.ReactElement {
  return (
    <Block
      title={props.label}
      body={<Row label="position" value={`(${props.pos.x}, ${props.pos.y})`} />}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout primitives: Block (title + body) and Row (label + value pair).
// Inline-styled — no CSS module / library.
// ─────────────────────────────────────────────────────────────────────────────

function Block(props: {
  title: string;
  body: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <div style={titleStyle}>{props.title}</div>
      <div style={bodyStyle}>{props.body}</div>
    </>
  );
}

function Row(props: { label: string; value: string }): React.ReactElement {
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{props.label}</span>
      <span style={rowValueStyle}>{props.value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline styles
// ─────────────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  width: 220,
  maxWidth: 260,
  maxHeight: 360,
  overflowY: "auto",
  padding: "0.5rem 0.75rem",
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: "0.8125rem",
  color: "#1a1a1a",
};

const titleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: "0.875rem",
  marginBottom: "0.375rem",
  paddingBottom: "0.25rem",
  borderBottom: "1px solid #eee",
};

const bodyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  fontSize: "0.8125rem",
};

const rowLabelStyle: React.CSSProperties = {
  color: "#666",
  minWidth: 64,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  fontSize: "0.75rem",
};

const rowValueStyle: React.CSSProperties = {
  color: "#1a1a1a",
  flex: 1,
  wordBreak: "break-word",
};

const oneLineStyle: React.CSSProperties = {
  marginTop: "0.5rem",
  paddingTop: "0.375rem",
  borderTop: "1px solid #eee",
  fontStyle: "italic",
  color: "#333",
  fontSize: "0.8125rem",
};
