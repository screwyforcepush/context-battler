# Godot WASM Telefrag Control Arm

Throwaway Godot 4.6.2 web export of the same shared replay slice used by
`a-babylon` and `b-playcanvas`: an airdrop warning, crate fall, telefrag, and
red mist/no corpse loop. This is intentionally a control arm for WASM payload
and JS<->WASM data-binding friction, not a production direction.

## 1. Compressed Cold-Load + Time-To-First-Frame

Measured with `node scripts/measure-scorecard.mjs --out scorecard-measurement.json --timeout-ms 120000 --network-idle-ms 2000 --ready-grace-ms 5000` against the committed `dist/` export, served gzip with COOP/COEP headers.

- Profile: 390x844 CSS px, DPR 2, 150 ms latency, 200 KiB/s download, 75 KiB/s upload, 4x CPU slowdown.
- Full `dist/` payload if gzip-compressed: `10,684,838` bytes (`39,858,192` raw).
- Main payloads: `index.wasm` `37,695,054` raw / `9,469,248` gzip; `index.pck` `713,336` raw / `639,266` gzip; `index.js` `315,759` raw / `78,949` gzip.
- First non-blank canvas and app ready marker: `51,021 ms`.

CDP reported `encodedDataLength: 0` for the WASM/PCK `Fetch` bodies even though the server delivered them, so the payload headline above uses the deterministic gzip analysis of `dist/`, not the incomplete CDP transfer sum. That underreport is also why the control-arm finding is the size/TTF pair, not the `encodedBytes` field.

## 2. WebGPU vs WebGL2

N/A by substrate. Godot 4 Web exports target WebGL2 through the Compatibility renderer and do not provide a WebGPU backend for this path. I first tried the threaded web export to match the classic SharedArrayBuffer requirement; in headless Chromium it stalled at Emscripten `loading-workers` despite COOP/COEP. The committed export uses Godot 4.6's single-thread web template so it actually opens, while `npm run serve` still sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` because that header ceremony is part of the control-arm friction.

## 3. Convex/JSON-Binding Effort

The runtime data path is deliberately awkward: `src/Main.gd::_load_snapshot_via_js_bridge()` calls `JavaScriptBridge.eval()` with a synchronous browser `XMLHttpRequest` for `/shared-harness/replay-snapshot.json`, returns the raw JSON string across the JS<->WASM boundary, then parses and normalizes it in GDScript. The web export also writes `window.__telefragBridge` and `window.__telefragReadyAt` for measurement. This proved the pillar-7 contract shape can cross into Godot, but the glue is blocking, stringly, and much less natural than the JS-native prototypes' `fetch()` + typed normalization path.

Actual glue path: `throwaway-prototypes/c-godot-wasm/src/Main.gd`; served fixture path: `throwaway-prototypes/c-godot-wasm/dist/shared-harness/replay-snapshot.json`, byte-identical to `throwaway-prototypes/shared-harness/replay-snapshot.json`.

## 4. Did The Telefrag Land?

Capture artifacts:

- `telefrag-capture.png`
- `telefrag-capture.gif`

Subjective call: yes, but it feels like a control arm. The beat is legible: the warning beam anchors the tile, the crate lands, Sprinter disappears, and red mist fills the impact zone with no corpse. It is less slick than Babylon/PlayCanvas: red mist reads as chunky billboard-like spheres, the camera gets cramped around the imported astronaut scale, and the lighting/post stack is more blunt. It still gives the intended felt read on Godot WASM: openable, visually viable enough, but heavier and clumsier for this guest-on-phone replay surface.

## 5. Productionization + Asset-License Posture

Assets are the same fixed CC0 Quaternius Ultimate Space Kit subset documented in `shared-harness/art-kit/manifest.json`:

- `Astronaut.glb`
- `Pickup Crate.glb`
- `Base Large.glb`
- `Building L.glb`

Productionizing this path would require a real Godot export pipeline, a decision on threaded vs single-thread web exports, explicit browser/mobile QA, asset import hygiene, and a non-blocking bridge from Convex JSON into GDScript. The engine/license posture is workable for a prototype, but the `9.47 MB` gzip WASM floor and bridge friction are the central negative findings.

## 6. Run Command

From the repo root:

```bash
cd throwaway-prototypes/c-godot-wasm && npm run serve -- --open
```

The committed `dist/` opens directly from that command. To rebuild the export, install Godot 4.6.2 plus matching web export templates, then run:

```bash
cd throwaway-prototypes/c-godot-wasm && GODOT_BIN=/path/to/Godot_v4.6.2-stable_linux.arm64 npm run build
```

The local server always serves with COOP/COEP and `application/wasm` for `.wasm`.
