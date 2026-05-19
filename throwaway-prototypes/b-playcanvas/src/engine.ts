import {
  Application,
  DEVICETYPE_WEBGL2,
  FILLMODE_FILL_WINDOW,
  RESOLUTION_AUTO,
  createGraphicsDevice,
  version,
} from "playcanvas";

export type EngineResult = {
  app: Application;
  label: string;
};

export async function createPlayCanvasApp(
  canvas: HTMLCanvasElement,
): Promise<EngineResult> {
  const graphicsDevice = await createGraphicsDevice(canvas, {
    deviceTypes: [DEVICETYPE_WEBGL2],
    antialias: true,
    depth: true,
    stencil: true,
    powerPreference: "high-performance",
  });

  const app = new Application(canvas, { graphicsDevice });
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(RESOLUTION_AUTO);

  const backend = app.graphicsDevice.deviceType === DEVICETYPE_WEBGL2 ? "WebGL2" : app.graphicsDevice.deviceType;
  return {
    app,
    label: `PlayCanvas ${version} / ${backend}`,
  };
}
