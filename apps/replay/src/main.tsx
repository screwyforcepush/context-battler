// Phase 02 / WP-A — Renderer entry point.
//
// Wires the singleton `ConvexReactClient` into a `ConvexProvider` so all
// children can call `useQuery` / `usePaginatedQuery`. Routes between
// MatchPicker and Replay using the hash-route hook (no router lib — see
// architecture-decisions.md §6).
//
// Closure-readiness round 2:
//   - Imports `./index.css` so the global reset (`html, body, #root
//     { margin: 0; min-height: 100% }`) clears the user-agent 16px page-
//     level scroll overhang (AC#4 / Med-1).
//   - Wraps the `<Replay>` mount in a `ReplayErrorBoundary` (defined below)
//     to catch synchronous render-time throws inside the replay subtree.
//     The complementary async path for Convex `ArgumentValidationError`
//     rejections on bogus matchIds (the actual UAT ISSUE-003 trigger) is
//     handled inline at `routes/Replay.tsx:211` via a `.catch()` frame —
//     React error boundaries do not catch promise rejections, so the two
//     layers together form the D-P2-28 dual-layer error-handling pair.

import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { convexClient } from "./lib/convexClient";
import { useHashRoute } from "./lib/useHashRoute";
import { Cards } from "./routes/Cards";
import { Diagnostics } from "./routes/Diagnostics";
import { MatchPicker } from "./routes/MatchPicker";
import { Replay } from "./routes/Replay";
import {
  SYNC_RENDER_ERROR_BODY,
  SYNC_RENDER_ERROR_DETAILS_DEFAULT_OPEN,
} from "./lib/replayErrorCopy";
import "./index.css";

// ─────────────────────────────────────────────────────────────────────────────
// ReplayErrorBoundary — narrow component-level boundary catching SYNCHRONOUS
// render-time throws inside the `<Replay>` subtree (e.g. a malformed bundle
// crashing `reconstruct(bundle, atTurn)` mid-render, or any other render-time
// exception React would otherwise surface as a raw stack trace).
//
// React error boundaries do NOT catch promise rejections — the async path
// for Convex `ArgumentValidationError` rejections (the original UAT ISSUE-003
// trigger when the URL carries a bogus matchId) is handled separately by the
// `.catch()` frame at `routes/Replay.tsx:211` which renders a friendly hint
// inline. This sync class boundary + async `.catch()` pair is the D-P2-28
// dual-layer architecture documented in `phase-2-closure.md` §5.0 round-2 +
// ADR adherence row D-P2-28; the two halves share visual language so the user
// sees the same frame regardless of which path fired.
//
// Modelled on PickerErrorBoundary in `routes/MatchPicker.tsx:155-191`.
// ─────────────────────────────────────────────────────────────────────────────

type ReplayErrorBoundaryState = { error: Error | null };

class ReplayErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ReplayErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): ReplayErrorBoundaryState {
    return { error };
  }
  override componentDidCatch(error: Error): void {
    console.error("Replay route failed:", error);
  }
  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <main style={errorMainStyle}>
          <a href="#/" style={errorLinkStyle}>
            ← back to picker
          </a>
          <div role="alert" style={errorBoxStyle}>
            <p style={errorTitleStyle}>Replay render failed.</p>
            <p style={errorBodyStyle}>{SYNC_RENDER_ERROR_BODY}</p>
            <details
              style={errorDetailStyle}
              open={SYNC_RENDER_ERROR_DETAILS_DEFAULT_OPEN}
            >
              <summary style={errorSummaryStyle}>raw error</summary>
              <code style={errorCodeStyle}>{this.state.error.message}</code>
            </details>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

function App(): React.ReactElement {
  const route = useHashRoute();
  if (route.kind === "replay") {
    return (
      <ReplayErrorBoundary key={route.matchId}>
        <Replay
          matchId={route.matchId}
          turn={route.turn}
          character={route.character}
        />
      </ReplayErrorBoundary>
    );
  }
  return (
    <AppFrame active={route.kind}>
      {route.kind === "diagnostics" ? (
        <Diagnostics last={route.last} />
      ) : route.kind === "cards" ? (
        <Cards />
      ) : (
        <MatchPicker />
      )}
    </AppFrame>
  );
}

function AppFrame(props: {
  active: "picker" | "diagnostics" | "cards";
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <header style={appHeaderStyle}>
        <nav aria-label="Replay app" style={appNavStyle}>
          <a
            href="#/"
            style={{
              ...appTabStyle,
              ...(props.active === "picker" ? appTabActiveStyle : {}),
            }}
          >
            Matches
          </a>
          <a
            href="#/diagnostics?last=20"
            style={{
              ...appTabStyle,
              ...(props.active === "diagnostics" ? appTabActiveStyle : {}),
            }}
          >
            Diagnostics
          </a>
          <a
            href="#/cards"
            style={{
              ...appTabStyle,
              ...(props.active === "cards" ? appTabActiveStyle : {}),
            }}
          >
            Cards
          </a>
        </nav>
      </header>
      {props.children}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Mount point #root not found — check apps/replay/index.html.");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ConvexProvider client={convexClient}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
);

// Inline styles — match the visual language of PickerErrorBoundary
// (routes/MatchPicker.tsx:283-307) so the two failure modes share a frame.

const errorMainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1.5rem 2rem",
  maxWidth: "1100px",
  margin: "0 auto",
  color: "#1a1a1a",
  display: "flex",
  flexDirection: "column",
  gap: "0.875rem",
};

const errorLinkStyle: React.CSSProperties = {
  color: "#0366d6",
  textDecoration: "none",
  fontSize: "0.875rem",
  alignSelf: "flex-start",
};

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

// Round-4: `<summary>` cursor + colour matches the muted-link palette so
// the toggle reads as opt-in detail, not a callout. `<code>` block is
// monospaced and word-broken so very long Convex error messages wrap
// instead of stretching the alert frame. Mirrors Replay.tsx:450-468 so the
// async sibling and this sync boundary share visual language (UAT
// ISSUE-003 round-4 parity fix).
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

const appHeaderStyle: React.CSSProperties = {
  borderBottom: "1px solid #d8dee4",
  background: "#fff",
};

const appNavStyle: React.CSSProperties = {
  maxWidth: "1500px",
  margin: "0 auto",
  padding: "0.75rem 2rem 0 2rem",
  display: "flex",
  gap: "0.25rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const appTabStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "2.25rem",
  padding: "0 0.875rem",
  color: "#444",
  textDecoration: "none",
  border: "1px solid transparent",
  borderBottom: "none",
  borderTopLeftRadius: 4,
  borderTopRightRadius: 4,
  fontSize: "0.875rem",
  fontWeight: 600,
};

const appTabActiveStyle: React.CSSProperties = {
  color: "#1a1a1a",
  background: "#f6f8fa",
  borderColor: "#d8dee4",
};
