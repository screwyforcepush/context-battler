// Phase 02 / WP-C — Replay route (full layout).
//
// Replaces the temporary range-input stepper from WP-B. The Replay route is
// now the coordinator that wires:
//
//   - One-shot bundle fetch (`api.replay.getReplayBundle`) — kept from WP-B
//     because completed matches are terminal (no subscription needed; ADR §3).
//   - `<TurnStepper>` row at the top of the body — slider + Next button +
//     URL `?turn=N` sync.
//   - Two-column body: square Grid + hover-listener wrapper, TurnFeed takes
//     the remaining widescreen width.
//   - Hover-target dispatch via React event delegation on the Grid wrapper —
//     reads `data-token-kind` / `data-character-id` / `data-crate-id` /
//     `data-airdrop-id` from Grid.tsx (WP-B) and constructs a HoverTarget for
//     WP-D's HoverCard.
//   - Modal state (`modalTarget`) — fed to WP-D's ExpandModal; opened by
//     TurnFeed's "..." button.
//
// File ownership: WP-C OWNS Replay.tsx, TurnStepper.tsx, TurnFeed.tsx,
// decisionEnglish.ts, hoverTypes.ts. Grid.tsx is WP-B; HoverCard /
// ExpandModal / formatters are WP-D. We never modify those.

import React, { useEffect, useMemo, useState } from "react";
import { convexClient } from "../lib/convexClient";
import { reconstruct, type ReplayBundle } from "../lib/reconstruct";
import { Grid } from "../components/Grid";
import { TurnStepper } from "../components/TurnStepper";
import { TurnFeed } from "../components/TurnFeed";
import { HoverCard } from "../components/HoverCard";
import { ExpandModal } from "../components/ExpandModal";
import type { HoverTarget } from "../lib/hoverTypes";
import {
  hasPreIter2AgentRecords,
  VintageReplayNotice,
} from "../lib/vintageReplay";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function Replay(props: {
  matchId: string;
  turn: number | null;
  character: string | null;
}): React.ReactElement {
  const matchId = props.matchId as unknown as Id<"matches">;
  const initialTurn = props.turn ?? 0;

  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [currentTurn, setCurrentTurn] = useState<number>(initialTurn);

  // Mirror prop.turn (driven by useHashRoute) into local state so browser
  // back/forward and direct URL edits update the rendered turn. Closure-
  // readiness UAT ISSUE-002 — without this effect the initial useState seed
  // is the only path from URL into state. The TurnStepper's own URL writes
  // use history.replaceState, which doesn't fire hashchange, so this effect
  // is only triggered by user-driven navigation (popstate / direct edit).
  useEffect(() => {
    if (props.turn === null) return;
    setCurrentTurn(props.turn);
  }, [props.turn]);

  // Hover state — owned by the wrapping div around the Grid; a delegated
  // mouseover listener reads the data-* attributes Grid.tsx emits.
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Modal state — opened by TurnFeed row's "..." button. WP-D's
  // ExpandModal is rendered as a sibling of the layout.
  const [modalTarget, setModalTarget] = useState<{
    turn: number;
    characterId: Id<"characters">;
  } | null>(null);

  useEffect(() => {
    if (!bundle || props.turn === null || props.character === null) return;
    const targetName = normaliseDisplayName(props.character);
    const character = bundle.characters.find(
      (candidate) => normaliseDisplayName(candidate.displayName) === targetName,
    );
    if (!character) return;
    setModalTarget({ turn: props.turn, characterId: character._id });
  }, [bundle, props.turn, props.character]);

  // ── Bundle fetch (one-shot per ADR §3) ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setBundle(null);
    convexClient
      .query(api.replay.getReplayBundle, { matchId })
      .then((result) => {
        if (cancelled) return;
        setBundle(result as ReplayBundle | null);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // ── Snapshot derivation ─────────────────────────────────────────────
  const hasVintageAgentRecords = useMemo(() => {
    if (!bundle) return false;
    return hasPreIter2AgentRecords(bundle);
  }, [bundle]);

  const snapshot = useMemo(() => {
    if (!bundle || hasVintageAgentRecords) return null;
    return reconstruct(bundle, gridSnapshotTurnForReplay(currentTurn));
  }, [bundle, currentTurn, hasVintageAgentRecords]);

  // ── Hover listener: delegated event handlers on the Grid wrapper. ───
  // Grid.tsx emits `data-token-kind` (background/wall/cover/evac/airdrop/
  // crate/corpse/agent) plus `data-character-id` / `data-crate-id` /
  // `data-airdrop-id` on tokens that need them. We read those + the hovered
  // SVG tile's local x/y attributes to construct the HoverTarget union.
  //
  // TODO (Grid.tsx is WP-D's territory): emit `data-px` / `data-py` on
  // each per-tile <rect> so the hover position is always the GRID-LOCAL
  // tile coord. For now we extract x/y from the SVG node's `x`/`y`
  // attribute when available (cover/wall/crate/corpse) and fall back to
  // (-1,-1) for the background/evac tokens that span the viewport.
  const onGridMouseOver = (e: React.MouseEvent): void => {
    const el = (e.target as Element).closest(
      "[data-token-kind]",
    ) as HTMLElement | null;
    if (!el) return;
    const kind = el.dataset.tokenKind;
    const characterId = el.dataset.characterId;
    const crateId = el.dataset.crateId;
    const airdropId = el.dataset.airdropId;

    // Try to read px/py from data-* (preferred) then fall back to SVG x/y.
    const px = parseLocalCoord(el, "px") ?? parseLocalCoord(el, "x") ?? 0;
    const py = parseLocalCoord(el, "py") ?? parseLocalCoord(el, "y") ?? 0;
    const pos = { x: Math.floor(px), y: Math.floor(py) };

    let next: HoverTarget | null = null;
    switch (kind) {
      case "agent": {
        if (!characterId) break;
        // For agent tokens, read pos from the snapshot — the SVG circle's
        // cx/cy are at pos+0.5 which doesn't survive parseLocalCoord cleanly.
        const fromSnap = snapshot?.characters.find(
          (c) => c.characterId === characterId,
        );
        next = {
          kind: "agent",
          characterId: characterId as unknown as Id<"characters">,
          pos: fromSnap ? fromSnap.pos : pos,
        };
        break;
      }
      case "crate": {
        if (!crateId) break;
        const fromSnap = snapshot?.crates.find((c) => c.id === crateId);
        next = {
          kind: "crate",
          crateId,
          pos: fromSnap ? fromSnap.pos : pos,
        };
        break;
      }
      case "airdrop": {
        if (!airdropId) break;
        const fromSnap = snapshot?.airdrops.find(
          (drop) => drop.id === airdropId,
        );
        next = {
          kind: "airdrop",
          airdropId,
          pos: fromSnap ? fromSnap.pos : pos,
        };
        break;
      }
      case "corpse": {
        if (!characterId) break;
        const fromSnap = snapshot?.corpses.find(
          (c) => c.characterId === characterId,
        );
        next = {
          kind: "corpse",
          characterId: characterId as unknown as Id<"characters">,
          pos: fromSnap ? fromSnap.pos : pos,
        };
        break;
      }
      case "wall":
        next = { kind: "wall", pos };
        break;
      case "cover":
        next = { kind: "cover", pos };
        break;
      case "evac":
        next = { kind: "evac", pos };
        break;
      default:
        // background and any future kinds we don't surface.
        return;
    }
    if (next === null) return;
    setHoverTarget(next);
    setCursorPos({ x: e.clientX, y: e.clientY });
  };

  const onGridMouseMove = (e: React.MouseEvent): void => {
    // Update cursor position only; target stays stable until mouseover
    // bubbles from a different token.
    if (hoverTarget) {
      setCursorPos({ x: e.clientX, y: e.clientY });
    }
  };

  const onGridMouseOut = (e: React.MouseEvent): void => {
    const next = e.relatedTarget;
    if (
      !next ||
      !(next instanceof Element) ||
      !next.closest("[data-token-kind]")
    ) {
      setHoverTarget(null);
      setCursorPos(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>
          ← back to picker
        </a>
        <p>Loading match…</p>
      </main>
    );
  }
  if (error) {
    // Closure-readiness round 2 / UAT ISSUE-003: a bogus matchId in the URL
    // makes Convex's `v.id("matches")` validator reject the
    // `client.query(api.replay.getReplayBundle, { matchId })` call with an
    // `ArgumentValidationError`. The promise rejection is captured here
    // (it doesn't reach the route-level `ReplayErrorBoundary` in main.tsx —
    // boundaries don't catch async rejections), so we render a friendly
    // hint inline that mirrors the boundary's copy.
    // Closure-readiness round-3: the raw Convex error message is gated
    // behind a `<details>` toggle so the friendly hint is the main
    // copy and the verbose `ArgumentValidationError` dump is opt-in.
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>
          ← back to picker
        </a>
        <div role="alert" style={errorBoxStyle}>
          <p style={errorTitleStyle}>Couldn’t load that match.</p>
          <p style={errorBodyStyle}>
            The match id in the URL doesn’t match a completed match in your
            Convex deployment. Double-check the URL or pick a row from the
            list.
          </p>
          <details style={errorDetailStyle}>
            <summary style={errorSummaryStyle}>raw error</summary>
            <code style={errorCodeStyle}>{error.message}</code>
          </details>
        </div>
      </main>
    );
  }
  if (!bundle) {
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>
          ← back to picker
        </a>
        <p>Match not found.</p>
      </main>
    );
  }

  if (hasVintageAgentRecords) {
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>
          ← back to picker
        </a>
        <VintageReplayNotice />
      </main>
    );
  }

  const totalTurns = bundle.match.turn;
  const extractedCount = bundle.match.outcome?.extracted?.length ?? 0;
  const gridLabel =
    currentTurn <= 0 ? "spawn positions" : `start of turn ${currentTurn}`;

  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <a href="#/" style={linkStyle}>
          ← back to picker
        </a>
        <h1 style={h1Style}>
          Match {truncateId(props.matchId)}{" "}
          <span style={badgeStyle}>{bundle.match.status}</span>
        </h1>
        <p style={metaStyle}>
          Total turns: <strong>{totalTurns}</strong>
          {" · "}Extracted: <strong>{extractedCount}</strong>
          {" · "}Inspecting turn: <strong>{currentTurn}</strong>
          {" · "}Grid: <strong>{gridLabel}</strong>
        </p>
      </header>

      <section style={stepperSectionStyle}>
        <TurnStepper
          currentTurn={currentTurn}
          totalTurns={totalTurns}
          onTurnChange={setCurrentTurn}
        />
      </section>

      <section style={bodyLayoutStyle}>
        <div
          style={gridColStyle}
          onMouseOver={onGridMouseOver}
          onMouseMove={onGridMouseMove}
          onMouseOut={onGridMouseOut}
        >
          {snapshot ? (
            <div style={gridSquareStyle}>
              <Grid snapshot={snapshot} worldState={bundle.worldState} />
            </div>
          ) : null}
        </div>
        <div style={feedColStyle}>
          <TurnFeed
            bundle={bundle}
            currentTurn={currentTurn}
            onOpenModal={setModalTarget}
          />
        </div>
      </section>

      <HoverCard
        target={hoverTarget}
        bundle={bundle}
        snapshot={snapshot ?? emptySnapshotFallback()}
        currentTurn={currentTurn}
        cursorPos={cursorPos}
      />
      <ExpandModal
        target={modalTarget}
        bundle={bundle}
        onClose={() => setModalTarget(null)}
      />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defensive empty snapshot for the brief window between bundle resolve and
 * snapshot useMemo settling. HoverCard never renders before snapshot exists
 * in practice (it fires on mouseover, and the wrapper div doesn't paint
 * until the bundle is loaded), but the prop type wants a non-null value.
 */
function emptySnapshotFallback() {
  return {
    turn: 0,
    characters: [],
    corpses: [],
    crates: [],
    airdrops: [],
    evacRevealed: false,
  };
}

/**
 * Parse a numeric attribute from a DOM element. Returns null if missing or
 * unparseable. Used by the hover-target dispatcher to read either
 * `data-px` (preferred — emitted by WP-D's future Grid attributes) or
 * the SVG `x`/`y` attribute as a fallback.
 */
function parseLocalCoord(el: HTMLElement, name: string): number | null {
  const v =
    name === "px" || name === "py"
      ? el.dataset[name]
      : el.getAttribute(name);
  if (v == null) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function normaliseDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

export function gridSnapshotTurnForReplay(currentTurn: number): number {
  return Math.max(0, currentTurn - 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1rem 1.5rem",
  maxWidth: "1920px",
  margin: "0 auto",
  color: "#1a1a1a",
  display: "flex",
  flexDirection: "column",
  gap: "0.875rem",
  // Cap to viewport so the body row has a bounded height for the
  // square grid + scrollable feed (AC#4 — fit-to-viewport; closure-
  // readiness round-1 Med-1).
  height: "100vh",
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  marginBottom: 0,
};

const h1Style: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 600,
  margin: "0.5rem 0 0.25rem 0",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const badgeStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: 4,
  background: "#e6f4ea",
  color: "#1f7a1f",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const metaStyle: React.CSSProperties = {
  margin: "0.25rem 0 0 0",
  fontSize: "0.875rem",
  color: "#444",
};

const linkStyle: React.CSSProperties = {
  color: "#0366d6",
  textDecoration: "none",
  fontSize: "0.875rem",
};

// Friendly inline error styles — mirror the visual language of
// PickerErrorBoundary (routes/MatchPicker.tsx:283-307) and ReplayErrorBoundary
// (main.tsx) so the three failure modes share a frame (UAT ISSUE-003 round 2).

const errorBoxStyle: React.CSSProperties = {
  padding: "1rem 1.25rem",
  border: "1px solid #d73a49",
  borderLeft: "4px solid #d73a49",
  borderRadius: "4px",
  background: "#fff5f6",
  color: "#1a1a1a",
};

const errorTitleStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontWeight: 600,
  fontSize: "0.9375rem",
};

const errorBodyStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontSize: "0.875rem",
  lineHeight: 1.45,
};

const errorDetailStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
};

// Round-3: `<summary>` cursor + colour matches the muted-link palette so
// the toggle reads as opt-in detail, not a callout. `<code>` block is
// monospaced and word-broken so very long Convex error messages wrap
// instead of stretching the alert frame.
const errorSummaryStyle: React.CSSProperties = {
  color: "#888",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const errorCodeStyle: React.CSSProperties = {
  display: "block",
  marginTop: "0.375rem",
  padding: "0.375rem 0.5rem",
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 4,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  fontSize: "0.75rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const stepperSectionStyle: React.CSSProperties = {
  width: "100%",
};

const bodyLayoutStyle: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  flex: 1,
  minHeight: 0,
};

const gridColStyle: React.CSSProperties = {
  flex: "0 0 auto",
  height: "100%",
  aspectRatio: "1 / 1",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  minHeight: 0,
};

// Square wrapper that fills the smaller of the grid column's width / height.
// `height: 100%` + `aspect-ratio: 1/1` gives a square as tall as the cell;
// `max-width: 100%` clamps the square to the column's width when the column
// is narrower than the available height. Net: the grid is always square and
// always fits within the remaining viewport (AC#4 — fit-to-viewport;
// closure-readiness round-1 Med-1).
const gridSquareStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  aspectRatio: "1 / 1",
  maxWidth: "100%",
  display: "flex",
};

const feedColStyle: React.CSSProperties = {
  flex: "1 1 auto",
  display: "flex",
  minWidth: 0,
  minHeight: 0,
};
