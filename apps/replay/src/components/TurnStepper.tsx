// Phase 02 / WP-C — Turn stepper UI.
//
// Slider input — range `0..totalTurns` inclusive (turn 0 = synthetic
// pre-game per D-P2-13). Up/down/left/right arrow keys step ±1 turn within
// that range. "Next turn" button only — NO Previous button (D-P2-7: the
// slider gives arbitrary backward jump for free; a separate button would
// be redundant UI).
//
// Display: "Turn N / totalTurns" prominently. Renders turn 0 as
// "Pre-turn / spawn positions". Updates URL `?turn=N` on change via
// `history.replaceState` so users can copy-paste a deep link without
// polluting browser history.
//
// Per ADR §6: routing state is URL-as-state. The replaceState call is
// idempotent and keeps the back-button useful for the previous match
// rather than every individual turn step.

import React, { useEffect, useRef } from "react";

export type TurnStepperProps = {
  currentTurn: number;
  totalTurns: number;
  onTurnChange: (turn: number) => void;
};

/**
 * Compute a clamped turn value within `[0, totalTurns]`.
 *
 * NaN / non-finite inputs collapse to the lower bound (0). Pure helper —
 * no React state.
 */
function clampTurn(t: number, totalTurns: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(totalTurns, Math.trunc(t)));
}

/**
 * Update the URL `?turn=N` shallowly via `history.replaceState`. Keeps the
 * fragment intact (we use `#/match/<id>?turn=N` per ADR §6) and never
 * pushes history entries.
 */
function syncUrlTurn(turn: number): void {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  // Hash format: `#/match/<id>` or `#/match/<id>?turn=N`. Split at first `?`.
  const hashCore = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIndex = hashCore.indexOf("?");
  const path = qIndex === -1 ? hashCore : hashCore.slice(0, qIndex);
  const queryString = qIndex === -1 ? "" : hashCore.slice(qIndex + 1);
  const params = new URLSearchParams(queryString);
  params.set("turn", String(turn));
  const nextHash = `#${path}?${params.toString()}`;
  // No-op if the hash is already correct — avoids an unnecessary history
  // tick on listener-driven navigation events.
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, "", nextHash);
}

export function TurnStepper(props: TurnStepperProps): React.ReactElement {
  const { currentTurn, totalTurns, onTurnChange } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── URL sync ──────────────────────────────────────────────────────────
  // Whenever currentTurn changes, reflect into `?turn=N`. The Replay
  // component is the source of truth (it owns `currentTurn` via useState
  // hydrated from the route on mount); this hook ensures the URL stays in
  // sync as the user scrubs.
  useEffect(() => {
    syncUrlTurn(currentTurn);
  }, [currentTurn]);

  // ── Keyboard handling: arrow keys ±1 turn ─────────────────────────────
  // We attach to a wrapping div with `tabIndex={0}` so the key listener
  // fires when the stepper is focused. Native range-input keystrokes
  // already step the slider, so for native focus on the slider we let the
  // browser handle it — our handler is a no-op because the wrapping div
  // doesn't get the event when an inner control owns focus. (This means
  // both the slider AND the wrapping container support arrow keys; either
  // works for the user.)
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      next = clampTurn(currentTurn + 1, totalTurns);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      next = clampTurn(currentTurn - 1, totalTurns);
    }
    if (next !== null && next !== currentTurn) {
      e.preventDefault();
      onTurnChange(next);
    }
  };

  const onSliderChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const next = clampTurn(Number(e.currentTarget.value), totalTurns);
    if (next !== currentTurn) onTurnChange(next);
  };

  const onNextClick = (): void => {
    const next = clampTurn(currentTurn + 1, totalTurns);
    if (next !== currentTurn) onTurnChange(next);
  };

  const display =
    currentTurn === 0
      ? "Pre-turn / spawn positions"
      : `Turn ${currentTurn} / ${totalTurns}`;

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="group"
      aria-label="Turn stepper"
    >
      <div style={displayStyle}>{display}</div>
      <input
        type="range"
        min={0}
        max={totalTurns}
        step={1}
        value={currentTurn}
        onChange={onSliderChange}
        aria-label="Turn slider"
        aria-valuemin={0}
        aria-valuemax={totalTurns}
        aria-valuenow={currentTurn}
        style={sliderStyle}
      />
      <button
        type="button"
        onClick={onNextClick}
        disabled={currentTurn >= totalTurns}
        style={nextBtnStyle}
        aria-label="Next turn"
      >
        Next turn →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  padding: "0.625rem 0.875rem",
  background: "#f6f8fa",
  borderRadius: 4,
  border: "1px solid #ddd",
  outline: "none",
};

const displayStyle: React.CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  fontSize: "0.9375rem",
  fontWeight: 600,
  minWidth: "16rem",
  whiteSpace: "nowrap",
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  cursor: "pointer",
};

const nextBtnStyle: React.CSSProperties = {
  padding: "0.375rem 0.875rem",
  fontSize: "0.875rem",
  cursor: "pointer",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "#fff",
};
