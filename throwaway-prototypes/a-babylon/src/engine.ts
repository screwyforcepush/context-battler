import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";

export type BackendResult = {
  engine: AbstractEngine;
  label: string;
};

export async function createPreferredEngine(
  canvas: HTMLCanvasElement,
): Promise<BackendResult> {
  try {
    if (await WebGPUEngine.IsSupportedAsync) {
      const engine = new WebGPUEngine(canvas, {
        adaptToDeviceRatio: true,
        antialias: true,
        powerPreference: "high-performance",
        stencil: true,
      });
      await engine.initAsync();
      return { engine, label: "WebGPU" };
    }
  } catch (error) {
    console.warn("WebGPU engine init failed; falling back to WebGL2.", error);
  }

  const engine = new Engine(
    canvas,
    true,
    {
      antialias: true,
      preserveDrawingBuffer: false,
      stencil: true,
    },
    true,
  );

  const version = engine.webGLVersion === 2 ? "WebGL2" : "WebGL";
  return { engine, label: version };
}
