import "./styles.css";

import { createPreferredEngine } from "./engine";
import { createTelefragScene } from "./scene";
import { loadReplaySnapshot } from "./snapshot";

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

async function boot(): Promise<void> {
  const loadResult = await loadReplaySnapshot();
  dom.snapshotLabel.textContent =
    loadResult.source === "shared-harness"
      ? "Snapshot: shared harness"
      : "Snapshot: fallback";

  if (loadResult.warning) {
    dom.errorPanel.hidden = false;
    dom.errorPanel.textContent = loadResult.warning;
  }

  const { engine, label } = await createPreferredEngine(dom.canvas);
  dom.backendLabel.textContent = `Backend: ${label}`;

  const controller = await createTelefragScene(engine, dom.canvas, loadResult.snapshot);

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

  engine.runRenderLoop(() => {
    controller.scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  dom.errorPanel.hidden = false;
  dom.errorPanel.textContent = `Babylon prototype failed to start: ${message}`;
  dom.backendLabel.textContent = "Backend: failed";
  console.warn(error);
});
