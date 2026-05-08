// Phase 02 / WP-A — Renderer entry point.
//
// Wires the singleton `ConvexReactClient` into a `ConvexProvider` so all
// children can call `useQuery` / `usePaginatedQuery`. Routes between
// MatchPicker and Replay using the hash-route hook (no router lib — see
// architecture-decisions.md §6).

import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { convexClient } from "./lib/convexClient";
import { useHashRoute } from "./lib/useHashRoute";
import { MatchPicker } from "./routes/MatchPicker";
import { Replay } from "./routes/Replay";

function App(): React.ReactElement {
  const route = useHashRoute();
  if (route.kind === "replay") {
    return <Replay matchId={route.matchId} turn={route.turn} />;
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
