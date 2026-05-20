# Round-2 Closing Readout — Render R&D Bake-Off

Round 2 of a throwaway 3-arm bake-off de-risking the mental-model §10 consumer-render gate. Each arm ran an identical scripted duel (Sprinter kills Vulture) followed by the existing airdrop telefrag, from a byte-identical shared-harness fixture. Round 2 pushed each prototype against its own Round-1 felt weakness — not a uniform polish list — so the next watch reveals each substrate's ceiling, not where its Round-1 corners were cut. This readout summarises the output; it does not pick a winner. The user does.

## Per-Arm Summary

| Arm | Round-1 felt weakness | Round-2 polish executed | Scorecard delta |
|---|---|---|---|
| **a-babylon** | VFX "felt like CSS" (flat/cheap); missing red-mist animation that b and c had | VFX uplift: particle systems, GlowLayer, DefaultRenderingPipeline bloom/chromatic pulses, camera shake/punch, kill-cam framing, telefrag red-mist cloud added | Cold-load 1,042,641 enc bytes, first non-blank 3,252 ms (slight improvement over R1 despite VFX additions); main bundle 545,938 gzip |
| **b-playcanvas** | Walls hard to see from follow-cam angle (contrast/legibility) | Lighting + material contrast: darker floor, brighter wall caps, cyan rim strips, orange neon cover accents, stronger fog separation; lean cheap-effect duel (traces, hit flashes, spark/blood bursts, camera punch) | Cold-load 858,337 enc bytes (+4,641 vs R1), first non-blank 2,997 ms (unchanged); main bundle 536,119 gzip — lean budget held |
| **c-godot-wasm** | Default Godot splash screen on boot; WASM cost penalty | Custom cyberpunk-register HTML loader replaces engine branding (project.godot + export-web.mjs dual suppression); kill-cam Camera3D move + FOV punch on duel finisher | First visible frame (loader) at 724 ms (was engine splash); app-ready 51,005 ms; WASM floor 9,469,248 gzip — unchanged by design (control arm) |

## Shared Fixture

Duel + telefrag choreography is byte-identical across all three arms (`diff -q` clean between `shared-harness/`, `a-babylon/public/shared-harness/`, `b-playcanvas/public/shared-harness/`, and `c-godot-wasm/shared-harness/`). `apps/` was not touched. No cross-prototype shared library exists — each arm remains fully isolated and throwaway.

## Directional Read Hints

These are trade-offs surfaced by Round-2 polish, stated neutrally:

- **a-babylon** proved the pipeline ceiling is high: Babylon's built-in GlowLayer, particle systems, and post-process pipeline delivered the richest VFX pass without hand-rolled shaders or new assets. The trade-off is a heavier runtime and wider API surface to own.
- **b-playcanvas** proved lean can still be slick: the contrast/lighting pass made walls readable and the scene more legible while adding only +4,641 encoded bytes to cold-load. The trade-off is a lower VFX ceiling if the product eventually needs pipeline-grade effects.
- **c-godot-wasm** proved engine-native model fidelity and kill-cam quality — the Quaternius models read best here, and the camera work landed cleanly. The trade-off is structural: the 9.5 MB gzip WASM floor is a hard cost, and the JS-to-WASM bridge for Convex JSON binding is blocking and stringly-typed compared to JS-native `fetch()`.

## What's Next

User re-watches all three prototypes and picks a substrate direction. Round-3 features (real combat logic, side pane, perception overlay, scrubbable timeline, audio) are explicitly out of scope until a substrate is picked.
