// Phase 02 / WP-B — Replay route.
//
// Single-bundle batch fetch via `convexClient.query(api.replay.getReplayBundle,
// { matchId })` per ADR §3 (NOT `useQuery` — completed matches are terminal,
// no subscription needed). Reconstruction + Grid render derive from the
// bundle and a `currentTurn` state.
//
// WP-B scope:
//   - load bundle ONCE on mount,
//   - render header (matchId/status/total turns/extracted-count),
//   - render Grid for the synthetic turn 0,
//   - provide a TEMPORARY range-input + button so WP-B can be UAT'd before
//     WP-C lands the proper TurnStepper.
//
// WP-C will own the TurnStepper UI; WP-D will own HoverCard / ExpandModal.

import React, { useEffect, useMemo, useState } from "react";
import { convexClient } from "../lib/convexClient";
import { reconstruct, type ReplayBundle } from "../lib/reconstruct";
import { Grid } from "../components/Grid";
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

  // ── Bundle fetch ─────────────────────────────────────────────────────
  // One-shot via `client.query()` — terminal matches don't change, so a
  // reactive subscription would be wasted overhead (ADR §3).
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

  // ── Render ──────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>← back to picker</a>
        <p>Loading match…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>← back to picker</a>
        <p style={errorStyle}>Failed to load match: {error.message}</p>
      </main>
    );
  }
  if (!bundle) {
    return (
      <main style={mainStyle}>
        <a href="#/" style={linkStyle}>← back to picker</a>
        <p>Match not found.</p>
      </main>
    );
  }

  const totalTurns = bundle.match.turn;
  const extractedCount = bundle.match.outcome?.extracted?.length ?? 0;

  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <a href="#/" style={linkStyle}>← back to picker</a>
        <h1 style={h1Style}>
          Match {truncateId(props.matchId)}{" "}
          <span style={badgeStyle}>{bundle.match.status}</span>
        </h1>
        <p style={metaStyle}>
          Total turns: <strong>{totalTurns}</strong>
          {" · "}Extracted:{" "}
          <strong>{extractedCount}</strong>
          {" · "}Current turn:{" "}
          <strong>{snapshot?.turn ?? currentTurn}</strong>
        </p>
      </header>

      {/* WP-B temporary stepper — WP-C will replace with TurnStepper. */}
      <section style={tempStepperStyle}>
        <label style={labelStyle}>
          Turn: {currentTurn}
          <input
            type="range"
            min={0}
            max={totalTurns}
            step={1}
            value={currentTurn}
            onChange={(e) =>
              setCurrentTurn(
                Math.max(
                  0,
                  Math.min(totalTurns, Number(e.currentTarget.value)),
                ),
              )
            }
            style={rangeStyle}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setCurrentTurn((t) => Math.min(totalTurns, t + 1))
          }
          disabled={currentTurn >= totalTurns}
          style={btnStyle}
        >
          +1 turn
        </button>
        <button
          type="button"
          onClick={() => setCurrentTurn(0)}
          style={btnStyle}
        >
          Reset to turn 0
        </button>
      </section>

      <section style={gridSectionStyle}>
        {snapshot ? (
          <Grid snapshot={snapshot} worldState={bundle.worldState} />
        ) : null}
      </section>
    </main>
  );
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1.5rem 2rem",
  maxWidth: "1400px",
  margin: "0 auto",
  color: "#1a1a1a",
};

const headerStyle: React.CSSProperties = { marginBottom: "1rem" };

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
  borderRadius: "4px",
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

const tempStepperStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  marginBottom: "1rem",
  padding: "0.75rem",
  background: "#f6f8fa",
  borderRadius: "4px",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  flex: 1,
};

const rangeStyle: React.CSSProperties = { flex: 1 };

const btnStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  fontSize: "0.8125rem",
  cursor: "pointer",
  border: "1px solid #ccc",
  borderRadius: "4px",
  background: "#fff",
};

const gridSectionStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  width: "100%",
};
