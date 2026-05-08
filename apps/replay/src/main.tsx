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
import { MatchPicker } from "./routes/MatchPicker";
import { Replay } from "./routes/Replay";
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
            <p style={errorTitleStyle}>Couldn’t load that match.</p>
            <p style={errorBodyStyle}>
              The match id in the URL doesn’t match a completed match in your
              Convex deployment. Double-check the URL or pick a row from the
              list.
            </p>
            <details style={errorDetailStyle}>
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
        <Replay matchId={route.matchId} turn={route.turn} />
      </ReplayErrorBoundary>
    );
  }
  return <MatchPicker />;
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
