# Round-6 Showroom Spec — Plan Review Readout

**Verdict: APPROVED** (proceed to WP-A implement, subject to minor implementation refinements below).

## Review Summary
- **Overall assessment:** Pass
- **What is solid:** The architectural boundary is well-respected (no Convex/HTTP/snapshot pollution). The curator-diagnostic framing perfectly matches the `mental-model.md` §10 update. The deterministic AABB-median calibration method elegantly replaces subjective visual UAT while adhering to the Round-4/5 D4 discipline.
- **What is risky or unclear:** Moving instantiation to a factory while preserving the `CHARACTER_MODEL_SCALE` constant inside `EntityRenderer.gd` (to keep scaffold-verify green) could cause coupling or duplicate hardcoding if not handled explicitly.

## Focus Areas & Refinements

1. **SUBSTRATE (Factory vs Pass-through):** Ratified **Factory extraction**. To maintain the `EntityRenderer.CHARACTER_MODEL_SCALE` constant as the single source of truth (and keep `verify-scaffold.mjs` green), update the factory signature to take `base_scale: float`. `EntityRenderer` passes its constant. `Showroom.gd` can `preload("res://src/EntityRenderer.gd")` and pass `EntityRenderer.CHARACTER_MODEL_SCALE` to the factory.
2. **CALIBRATION RIGOR:** Ratified. Ensure the `audit-character-scales.gd` script multiplies the AABB by the `MeshInstance3D`'s global transform to catch any local scale baked into the GLB root node. 
3. **REPLAY-PATH REGRESSION RISK:** Minimal, provided the factory injection above is followed.
4. **CLIP FALLBACK CHAINS:** Ratified. The `death -> idle` fallback combined with the `loop_mode = ANIMATION_LOOP_NONE` override means a missing death clip results in a frozen idle frame—an excellent, highly visible diagnostic signal.
5. **SCAFFOLD-VERIFY COVERAGE:** Ratified. Recommendation: Instead of parsing Godot output in JS for the AABB band check, have `scripts/audit-character-scales.gd` assert the ±15% band internally and return a non-zero exit code on failure. Add this script execution to the throwaway-prototypes `test` script in `package.json`.

## §7 Open Questions Decisions
- **Q1 schemaVersion bump 3→4:** **Ratified (Bump to 4).** POC-posture forward-only; additive fields should trigger a bump.
- **Q2 factory vs pass-through:** **Ratified (Factory extraction).**
- **Q3 tier→asset mapping:** **Ratified (Engineer's discretion).**
- **Q4 death loop-mode override safety:** **Ratified (Safe).** Replay uses corpse swap, not death clips.
- **Q5 row vs grid layout:** **Ratified (Row).** Matches the user's mental model for a line-up.
- **Q6 gore exclusion from Take hit / Death:** **Ratified (Excluded).** Matches user's explicit ask.
- **Q7 fixed spacing under outlier multipliers:** **Ratified (Fixed).** Overlaps serve as diagnostic signals of anomalously wide assets.
- **Q8 keyboard shortcuts:** **Deferred.** Engineer may add as optional polish.

## Scope Boundary
Confirmed. No Convex, HTTP, or snapshot schema work is present in the plan. No new character packs are being snuck in. Zero UAT footprint.

---
*This readout acts as the plan ratification. Proceed to WP-A implementation.*