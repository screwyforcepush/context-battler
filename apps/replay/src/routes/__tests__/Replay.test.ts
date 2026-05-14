import { describe, expect, it, vi } from "vitest";

async function loadGridSnapshotTurnForReplay() {
  vi.resetModules();
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  const mod = await import("../Replay");
  return mod.gridSnapshotTurnForReplay;
}

describe("gridSnapshotTurnForReplay", () => {
  it("keeps turn 0 on the synthetic spawn snapshot", async () => {
    const gridSnapshotTurnForReplay = await loadGridSnapshotTurnForReplay();
    expect(gridSnapshotTurnForReplay(0)).toBe(0);
  });

  it("renders Turn 1 against the start-of-turn snapshot", async () => {
    const gridSnapshotTurnForReplay = await loadGridSnapshotTurnForReplay();
    expect(gridSnapshotTurnForReplay(1)).toBe(0);
  });

  it("maps Turn N to end-of-turn N-1 for the grid", async () => {
    const gridSnapshotTurnForReplay = await loadGridSnapshotTurnForReplay();
    expect(gridSnapshotTurnForReplay(12)).toBe(11);
  });
});
