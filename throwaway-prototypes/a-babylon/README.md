# Babylon Telefrag Prototype Scorecard

Throwaway Babylon.js substrate bet for the shared airdrop telefrag -> red mist
money-shot. This is not production code and is not wired to live Convex.

## 1. Compressed Cold-Load Size + Time-To-First-Frame

Measured on May 19, 2026 in headless Chromium 147 using Chrome DevTools
Protocol throttling: 390x844 mobile viewport, DPR 2, 150 ms latency,
200 KiB/s download, 75 KiB/s upload, and 4x CPU slowdown. The renderer in
this environment was WebGL2 over ANGLE/SwiftShader, so the frame-rate number is
a software-renderer caveat, not a real phone GPU result.

- Build output: `npm run build` passed; main JS bundle
  `dist/assets/index-B02zo4Y4.js` is 2,292,805 bytes raw / 542,224 bytes gzip.
- Full built `dist/` payload if every file is gzip-compressed:
  4,918,563 bytes raw / 1,409,716 bytes gzip.
- Cold-load transfer measured from a gzip static server: 1,040,265 encoded
  bytes over 74 requests, with first non-blank canvas frame at 8,190 ms.
- Vite preview cross-check, where GLB assets were served uncompressed:
  1,513,893 encoded bytes over 74 requests, first ready frame at 3,524.7 ms,
  and 7.06 fps over a 3.12 s sample under the same throttle profile.

## 2. WebGPU vs WebGL2

Default startup in this environment fell back to WebGL2. `navigator.gpu` was
present, but `requestAdapter()` returned no adapter and Babylon logged
`No available adapters.` The observed default path reported `Backend: WebGL2`.

Forced WebGL2 fallback, by hiding `navigator.gpu`, matched the default result:
1,513,893 encoded bytes, first ready frame at 3,497.2 ms, and 7.10 fps over a
3.10 s sample. A separate forced WebGPU browser-flag attempt did reach the
`Backend: WebGPU` label, but the headless compositor produced a blank canvas
with swap-chain/shared-image errors, so there is no valid WebGPU visual or perf
delta from this environment.

## 3. Convex / JSON Binding Effort

Binding effort is light. The prototype has no live Convex dependency:
`src/snapshot.ts` fetches `/shared-harness/replay-snapshot.json` in
`loadReplaySnapshot()`, then `normalizeSnapshot()` adapts the static harness
into the local `ReplaySnapshot` shape. It accepts
`timeline.frames[].snapshot` objects shaped like the `EntitySnapshot` contract
from `apps/replay/src/lib/reconstruct.ts`: `turn`, `characters`, `corpses`,
`crates`, `airdrops`, and `evacRevealed`. `normalizeMoneyShot()` maps the
harness `highlightedEvent` / `playback` fields into the local `moneyShot`
object. `fallbackSnapshot` is only a degraded-mode safety net when the shared
harness cannot be loaded; it is not the bound path.

Actual glue-code path: `throwaway-prototypes/a-babylon/src/snapshot.ts`.

## 4. Did The Telefrag Land?

Yes, enough for this substrate R&D pass. The beat reads as a public airdrop
warning beam, the crate lands on the occupied tile, the victim disappears, and
the impact throws a red glow / shockwave / mist burst into the scene. It is
slick in the pipeline sense: glow, bloom, chromatic aberration, particles,
impact light, and camera anchoring do the work. The honest caveat is that the
mist still reads more like an arcade shockwave than a fully visceral red cloud,
but it is directionally on-brief for cyberpunk x Diablo.

- Still capture: `telefrag-capture.png`
- Loop capture: `telefrag-capture.gif`

![Babylon telefrag capture](./telefrag-capture.png)

## 5. Productionization + Asset-License Posture

Asset posture is clean for a throwaway prototype. The shared fixed art kit is a
minimal subset of Quaternius' Ultimate Space Kit, sourced from OpenGameArt /
Quaternius and documented in `../shared-harness/art-kit/manifest.json` as
`CC0-1.0`; attribution is not required, though provenance is retained.

Productionization work would include real device profiling, bundle splitting or
more selective Babylon imports, optimized GLB / texture delivery, an explicit
debug backend switch, removal of the fallback snapshot, live Convex query
binding, and a more intentional asset/VFX pass. None of that belongs in this
throwaway comparison artifact.

## 6. Run Command

From `throwaway-prototypes/a-babylon`:

```bash
npm run dev
```

`predev` runs `npm run sync:harness`, copying `../shared-harness` into
`public/shared-harness`, then Vite serves the browser prototype at
`http://localhost:5174/` unless that port is occupied. Clean-state verification
was `npm install` followed by the dev command; the shared snapshot loaded with
`Snapshot: shared harness`.
