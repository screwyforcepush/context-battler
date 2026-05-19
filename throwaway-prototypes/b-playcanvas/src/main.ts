import "./styles.css";

import { createPlayCanvasApp } from "./engine";
import { createTelefragScene } from "./scene";
import { loadReplaySnapshot } from "./snapshot";

declare global {
  interface Window {
    __telefragReady?: boolean;
    __telefragReadyAt?: number;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const backendLabel = document.querySelector<HTMLElement>("#backendLabel");
const snapshotLabel = document.querySelector<HTMLElement>("#snapshotLabel");
const errorPanel = document.querySelector<HTMLElement>("#errorPanel");
const cameraToggle = document.querySelector<HTMLButtonElement>("#cameraToggle");

if (!canvas || !backendLabel || !snapshotLabel || !errorPanel || !cameraToggle) {
  throw new Error("Prototype DOM shell is missing required elements.");
}

const dom = {
  canvas,
  backendLabel,
  snapshotLabel,
  errorPanel,
  cameraToggle,
};

function getPlaybackSpeed(): number {
  const raw = new URLSearchParams(window.location.search).get("speed");
  const parsed = raw === null ? 1 : Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(6, Math.max(0.25, parsed));
}

async function boot(): Promise<void> {
  const playbackSpeed = getPlaybackSpeed();
  const loadResult = await loadReplaySnapshot();
  dom.snapshotLabel.textContent =
    loadResult.source === "shared-harness"
      ? "Snapshot: shared harness"
      : "Snapshot: fallback";

  if (loadResult.warning) {
    dom.errorPanel.hidden = false;
    dom.errorPanel.textContent = loadResult.warning;
  }

  const { app, label } = await createPlayCanvasApp(dom.canvas);
  dom.backendLabel.textContent = `Backend: ${label}`;

  const controller = await createTelefragScene(app, dom.canvas, loadResult.snapshot);

  function syncCameraButton(): void {
    const locked = controller.isFollowLocked();
    dom.cameraToggle.textContent = locked ? "[*] Follow" : "[ ] Director";
    dom.cameraToggle.title = locked ? "Release follow anchor" : "Reacquire follow anchor";
  }

  dom.cameraToggle.addEventListener("click", () => {
    controller.setFollowLocked(!controller.isFollowLocked());
    syncCameraButton();
  });
  syncCameraButton();

  app.on("update", (dt: number) => {
    controller.update(Math.min(dt, 0.18) * playbackSpeed);
  });

  window.addEventListener("resize", () => {
    app.resizeCanvas();
    app.updateCanvasSize();
  });

  window.__telefragReady = true;
  window.__telefragReadyAt = performance.now();
  document.documentElement.dataset.ready = "true";

  app.start();
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  dom.errorPanel.hidden = false;
  dom.errorPanel.textContent = `PlayCanvas prototype failed to start: ${message}`;
  dom.backendLabel.textContent = "Backend: failed";
  console.warn(error);
});
