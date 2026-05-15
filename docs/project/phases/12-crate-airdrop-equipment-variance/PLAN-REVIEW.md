## Review Summary
- Overall assessment: **Pass (APPROVE-WITH-BINDING-CONDITIONS)**
- **What is solid:** The rename blast-radius is correctly scoped and the decision to wipe the DB without migration shims is sound. The telefrag sub-phase placement correctly exploits the existing `resolution.ts` logic to achieve an environmental death that avoids `trace.deaths` and requires no kill-rate formula tweaks. The `runStats.ts` kill-attribution bug diagnosis is spot-on. The dependency map provides an efficient and safe parallel execution plan.
- **What is risky or unclear:** The plan's citations to `mental-model.md` are stale, as the document has been slimmed down to 12 sections.

## Issues
| Severity | Area | Description | Evidence | Recommendation |
|----------|------|-------------|----------|----------------|
| Med | Citations | The plan cites `mental-model.md` §§16–20. The `mental-model.md` file has been slimmed to 12 sections. The Phase 12 intent is already captured in §11. | `docs/project/spec/mental-model.md` ends at §12. | Update the plan to remove references to §16-20. Q5 is moot as §11 already captures the intent. Verify runStats known-issue against `turnsDerived.ts` and closure docs instead of §16. |

## Detailed Focus Area Findings

1. **Rename Blast-Radius COMPLETENESS**
   - **Finding:** A workspace-wide grep for `[cC]hest` yields 147 files, which perfectly matches the §3.1 inventory list (including `apps/replay`, tests, schemas, and `resolution.ts`).
   - **Validation:** The loot-dispatch path (`convex/engine/resolution.ts:517`) currently gates on `isChestId(rawTargetId)`. Migrating this to `isCrateId` will cleanly route `Crate_<x>_<y>` identifiers while leaving corpse-loot logic untouched. Freezing historical phase payloads is correct per established AOP.

2. **Telefrag Correctness**
   - **Finding:** Placing the telefrag sub-phase between Phase 5 (Action) and Phase 6 (Death + Corpse Formation) in `convex/engine/resolution.ts` is mechanically flawless.
   - **Validation:** By setting `alive = false` in the new sub-phase, the victim is explicitly skipped by the Phase 6 check (`if (ch.alive && ch.hp <= 0)`). This guarantees *no corpse is pushed* and the victim is *not added* to `trace.deaths`. Because `runStats.ts:133` computes `kills += t.resolution.deaths.length`, keeping telefrag victims out of `trace.deaths` automatically excludes them from the kill-rate threshold. The tile-exclusivity invariant guarantees ≤ 1 victim.

3. **runStats Rider**
   - **Finding:** The diagnosis is correct. `convex/engine/runStats.ts:147` checks `deathSet.has(a.target)`, where `a.target` is the `displayName`, but `deathSet` is populated with `characterId`s.
   - **Validation:** Mirroring `buildTargetIdLookup` from `convex/turnsDerived.ts:137` is the correct fix. Updating `runStats.test.ts` is required because the existing test fixtures currently pass against the broken shape.

4. **Citation Integrity**
   - **Finding:** The plan references `mental-model.md` sections §16, §17-19, and §20. The current `mental-model.md` has been refactored and ends at §12.
   - **Validation:** Phase 12 intent is fully captured in §11. Q5 is therefore moot. The plan must correct these citations before dispatch.

5. **Q1/Q2 Ratification Check**
   - **Finding:** The proposed wave-to-coords-to-contents table and static crate placements are ratified.
   - **Validation:** The value curve is strictly monotonic (`T10: leather` → `T20: axe` → `T30: plate` → `T40: greatsword`). `T40 @ (48,48)` correctly lands inside the 3x3 evac zone, providing the requested late-loot-vs-incineration tension. The `equip >= 80%` gate is highly feasible given the total gear count. No RNG is introduced, maintaining strict adherence to the North Star. WP-B and WP-C are unblocked.

6. **Dependency Map / Parallelization**
   - **Finding:** Critical path `A -> C -> D -> G` is sound. `WP-F` is isolated enough to execute immediately alongside `WP-A`.

## Spec / Guide Deviations
- **Stale Citations:** As noted, the plan expects to append to §20 in `mental-model.md`, which is no longer applicable.

## Decision Notes
- **Q1/Q2 are RATIFIED:** The engineering team may proceed with the proposed static plain-name catalog and airdrop coordinate/value table.
- **Q3 is CONFIRMED:** Turn-40 airdrop at the evac bullseye is exactly what is intended.
- **Q4 is CONFIRMED:** Full deletion of `rollLoot` and `LOOT_TABLES` from the crate path is approved.
- **Q5 is MOOT:** The `mental-model.md` document already contains §11 with the Phase 12 intent. No new §20 needs to be authored.

## Final Verdict
**APPROVE-WITH-BINDING-CONDITIONS**. Please correct the `mental-model.md` citations in the plan doc, then immediately dispatch `WP-A` and `WP-F` in parallel.