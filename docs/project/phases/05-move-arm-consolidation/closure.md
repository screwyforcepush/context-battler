# Phase 05 — Closure record

> Placeholder. Populated when WP-E (substrate smoke) verdicts and
> WP-F (docs) lands. Until then this file documents the close-bar so
> reviewers know what "done" looks like.

Status: **OPEN — refactor in flight.**

---

## What this file will contain when closed

1. **Date** of closure.
2. **Smoke match ids** — the 3-5 match cohort run with
   `--seed-prefix move-arm-smoke`.
3. **Substrate verdict** — per-match cluster-failures output
   summarised:
   - Cover-as-toward_object cluster: retired (count = 0)?
   - Wall-as-toward_object cluster: retired (count = 0)?
   - Legacy-arm schema_validation cluster: count, rate, transient
     window?
   - Chest-re-loot cluster: unchanged (counts and persona spread)?
   - `consume='speed'` cluster: unchanged?
4. **Any in-flight surprises** — corner cases surfaced during
   implementation that warrant memory updates or follow-up scope.
5. **POC wipe confirmation** — date of wipe, push success, single
   end-to-end match verification.
6. **Helper foundation (WP-D.5)** — confirm `resolveTypedEntity`
   landed before WP-B/WP-C, with both call sites consuming it
   (no inline namespace-parsing in `validation.ts` or
   `movement.ts`). Note whether the file was renamed
   `idNormalisation.ts` → `entityResolve.ts` (engineer's call;
   record the decision and rationale either way).
7. **Known divergences (out-of-scope follow-ups)**:
   - **Cap divergence** between `vision.ts` `COVER_TILE_CAP = 12`
     and `inputBuilder.ts` wall safety ceiling. The canonical
     visible-target-id projection inherits the engine-side cap,
     so a `toward Cover_X_Y` for a cover tile past
     `COVER_TILE_CAP` rejects with the canonical
     visibility-first reason. Not a fix this refactor; record
     here for the next time someone audits visibility
     consistency between engine and digest.
   - Any other surprises surfaced during implementation.
8. **Follow-up references** — phase-4 D1 unblock criteria; future
   action-arm refactor mention.

---

## Reviewer checklist (when closing)

- [ ] All WP-A through WP-D acceptance criteria met (lint /
      typecheck / build / test green).
- [ ] Schema wipe + push succeeded against dev deployment.
- [ ] Smoke cohort completed; cluster-failures output archived under
      this folder.
- [ ] Substrate verdict matches README §5.
- [ ] `concept-spec.md` action grammar section updated (WP-F.1).
- [ ] `mental-model.md` §14 verified consistent with landed state
      (WP-F.3).
- [ ] Memory `project_move_arm_consolidation.md` updated to landed
      status with closure date (WP-F.4).
- [ ] Renderer ships only new-arm cases (no legacy shim) — or, if
      shim was scoped, this file documents why wipe was vetoed.
- [ ] `resolveTypedEntity` exists, is unit-tested per WP-D.5, and
      is the only namespace-dispatch / projection authority in
      the codebase (validator and resolver both call it; no
      inline `startsWith("Cover_")` / `=== "Evac"` / cover-or-wall
      id parsing elsewhere in `convex/engine/`).

---

*Update this file at WP-F close. Until then, the smoke verdict is
the close-bar; everything else is mechanical.*
