import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SYNC_RENDER_ERROR_BODY,
  SYNC_RENDER_ERROR_DETAILS_DEFAULT_OPEN,
} from "../replayErrorCopy";

describe("Replay sync render error copy", () => {
  it("uses render-failure copy and defaults raw error details open", () => {
    const mainSource = readFileSync(
      new URL("../../main.tsx", import.meta.url),
      "utf8",
    );

    expect(SYNC_RENDER_ERROR_BODY).toBe(
      "Render failed — open the raw error below for diagnostics.",
    );
    expect(SYNC_RENDER_ERROR_DETAILS_DEFAULT_OPEN).toBe(true);
    expect(mainSource).toContain(
      "<p style={errorBodyStyle}>{SYNC_RENDER_ERROR_BODY}</p>",
    );
    expect(mainSource).toContain(
      "open={SYNC_RENDER_ERROR_DETAILS_DEFAULT_OPEN}",
    );
  });
});
