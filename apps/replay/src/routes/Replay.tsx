// Phase 02 / WP-A — Replay route stub.
//
// WP-A's contract is "match-picker links to #/match/<id> and the replay
// route exists". Everything functional (bundle fetch, grid SVG, position
// reconstruction, stepper, feed, hover/expand) is WP-B/-C/-D scope.
//
// This stub renders enough to confirm the hash router actually navigates,
// which is the only thing the WP-A acceptance criterion at this layer
// asks for.

import React from "react";

export function Replay(props: {
  matchId: string;
  turn: number | null;
}): React.ReactElement {
  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <a href="#/" style={linkStyle}>
          ← back to picker
        </a>
        <h1 style={h1Style}>Replay (stub)</h1>
        <p style={subtitleStyle}>
          WP-B will own the replay view for matchId{" "}
          <code style={codeStyle}>{props.matchId}</code>
          {props.turn !== null
            ? ` at turn ${props.turn}`
            : " (no turn in URL — slider will default to 0)"}
          .
        </p>
      </header>

      <section>
        <p style={mutedStyle}>
          Coming in WP-B: bundle fetch, 100×100 SVG grid, position
          reconstruction, persona-coloured agent tokens, walls, cover,
          chests, corpses, and evac.
        </p>
        <p style={mutedStyle}>
          Coming in WP-C/-D: turn stepper, side-panel decision feed in
          plain English, hover cards, click-to-expand persona-prompt /
          scratchpad / visibleStateDigest / LLM-trace surfaces.
        </p>
      </section>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1.5rem 2rem",
  maxWidth: "900px",
  margin: "0 auto",
  color: "#1a1a1a",
};

const headerStyle: React.CSSProperties = { marginBottom: "1rem" };

const h1Style: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 600,
  margin: "0.5rem 0 0.25rem 0",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#444",
  fontSize: "0.9375rem",
};

const linkStyle: React.CSSProperties = {
  color: "#0366d6",
  textDecoration: "none",
  fontSize: "0.875rem",
};

const codeStyle: React.CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  background: "#f6f8fa",
  padding: "0.0625rem 0.25rem",
  borderRadius: "3px",
};

const mutedStyle: React.CSSProperties = {
  color: "#666",
  fontSize: "0.875rem",
};
