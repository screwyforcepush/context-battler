// Phase 02 / WP-C — Replay route (full layout).
//
// Replaces the temporary range-input stepper from WP-B. The Replay route is
// now the orchestrator that wires:
//
//   - One-shot bundle fetch (`api.replay.getReplayBundle`) — kept from WP-B
//     because completed matches are terminal (no subscription needed; ADR §3).
//   - `<TurnStepper>` row at the top of the body — slider + Next button +
//     URL `?turn=N` sync.
//   - Two-column body: ~60% Grid + hover-listener wrapper, ~40% TurnFeed.
//   - Hover-target dispatch via React event delegation on the Grid wrapper —
//     reads `data-token-kind` / `data-character-id` / `data-chest-id` from
//     Grid.tsx (WP-B) and constructs a HoverTarget for WP-D's HoverCard.
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
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function Replay(props: {
  matchId: string;
  turn: number | null;
}): React.ReactElement {
  const matchId = props.matchId as unknown as Id<"matches">;
  const initialTurn = props.turn ?? 0;

  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [currentTurn, setCurrentTurn] = useState<number>(initialTurn);

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
  const snapshot = useMemo(() => {
    if (!bundle) return null;
    return reconstruct(bundle, currentTurn);
  }, [bundle, currentTurn]);

  // ── Hover listener: delegated event handlers on the Grid wrapper. ───
  // Grid.tsx emits `data-token-kind` (background/wall/cover/evac/chest/
  // corpse/agent) plus `data-character-id` / `data-chest-id` on tokens
  // that need them. We read those + the hovered SVG tile's local x/y
  // attributes to construct the HoverTarget union.
  //
  // TODO (Grid.tsx is WP-D's territory): emit `data-px` / `data-py` on
  // each per-tile <rect> so the hover position is always the GRID-LOCAL
  // tile coord. For now we extract x/y from the SVG node's `x`/`y`
  // attribute when available (cover/wall/chest/corpse) and fall back to
  // (-1,-1) for the background/evac tokens that span the viewport.
  const onGridMouseOver = (e: React.MouseEvent): void => {
    const el = (e.target as Element).closest(
      "[data-token-kind]",
    ) as HTMLElement | null;
    if (!el) return;
    const kind = el.dataset.tokenKind;
    const characterId = el.dataset.characterId;
    const chestId = el.dataset.chestId;

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
      case "chest": {
        if (!chestId) break;
        const fromSnap = snapshot?.chests.find((c) => c.id === chestId);
        next = {
          kind: "chest",
          chestId,
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
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>
          ← back to picker
        </a>
        <p style={errorStyle}>Failed to load match: {error.message}</p>
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

  const totalTurns = bundle.match.turn;
  const extractedCount = bundle.match.outcome?.extracted?.length ?? 0;

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
          {" · "}Current turn:{" "}
          <strong>{snapshot?.turn ?? currentTurn}</strong>
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
            <Grid snapshot={snapshot} worldState={bundle.worldState} />
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
    chests: [],
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

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1rem 1.5rem",
  maxWidth: "1600px",
  margin: "0 auto",
  color: "#1a1a1a",
  display: "flex",
  flexDirection: "column",
  gap: "0.875rem",
  minHeight: "100vh",
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

const errorStyle: React.CSSProperties = {
  color: "#a40000",
  fontSize: "0.9375rem",
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
  flex: "0 0 60%",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  minWidth: 0,
};

const feedColStyle: React.CSSProperties = {
  flex: "1 1 40%",
  display: "flex",
  minWidth: 0,
  // Cap feed height to viewport so the inner scroll behaves predictably.
  maxHeight: "calc(100vh - 12rem)",
};
