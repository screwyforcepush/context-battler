# Phase 9 — Closure Record

> Single-file handoff for Phase 10 planning. Records what the
> walls + vision rect-grained substrate slice produced, what proves it,
> and which North Star thresholds are met.
> Closure date: 2026-05-14. Source commit at close: `1b9693b`.
>
> This is a closure RECORD, not a retrospective and not a phase-10 plan.

---

## 1. What we set out to build

Phase 9 shipped three connected substrate threads in one backend-only
slice:

- **Uniform wall LOS:** Delete the vision.ts carve-out that skipped LOS
  for walls. Walls now route through `hasLineOfSight` exactly like
  characters, chests, corpses, and cover. Wall-on-wall occlusion is real:
  a wall behind another wall is not visible. The only non-LOS-gated entry
  is Evac post-reveal (intentionally match-meta / minimap-style).
- **Wall-slide as substrate affordance:** When a diagonal `toward` /
  `away` / compass move is blocked by a wall on the diagonal step, the
  engine slides along the unblocked cardinal axis instead of
  dead-stopping. Cardinal-direct hits (N/E/S/W into a wall) still stop.
  Outcome line: `hugged Wall_<rect-id> <dir>` with toward/away variants.
  X-axis preferred on tie-break (both cardinals clear).
- **Rect-grained Vision emission:** Walls, cover patches, and the evac
  zone surface as the rectangles the substrate stores them as. Keys are
  coordinate-encoded (`Wall_39_70_to_35_70`, `Cover_46_73_to_48_75`,
  `Evac_45_47_to_47_49`). Single-tile entries keep the single-coord form
  (`Wall_30_60`). Each entry carries `dist`, `bearing`, and a `shape`
  discriminator. Inside-state is `dist: 0, bearing: "here"` uniformly.

The proof target was a persisted 20-match `phase-9-closing-20` report,
plus slice-specific evidence (rect-keyed Vision, slide traces,
wall-on-wall occlusion, inside-bearing-here, evac out-of-Chebyshev-20).

---

## 2. Canonical Source

- `reportId` = `jd764w578jwvxm41xjv6d1z07n86qkfc`
- `reportType` = `phase-9-closing-20`
- `runCount` = 20
- `metBar` = `true`
- `missingRunsForMatchIds` = `[]`
- `failedMatches` = 0

The canonical report is queryable with:

```bash
npx convex run reports:byId '{"id":"jd764w578jwvxm41xjv6d1z07n86qkfc"}'
```

The canonical metric payload is `phase9Payload`. The report follows the
sibling-payload pattern established by phases 3/6/7 (D11).

Harness invocation:

```bash
npm run harness -- --runs 20 --concurrency 10 --reasoning low \
  --seed-prefix phase9-20260514
```

Report driver:

```bash
npx tsx harness/closing/phase9.ts --matchIds <closing-20 ids> --overwrite
```

### 2.1 OCC Substitution Policy

**Policy:** No OCC substitutions were required. All 20 matches completed
successfully with zero Convex optimistic-concurrency storage-layer
failures. `failedMatches: 0`, `missingRunsForMatchIds: []`.

---

## 3. Threshold Verdict

### 3.1 Preserved Phase-7 Thresholds

| Gate | Threshold | Measured | Verdict |
|---|---:|---:|---|
| Runs with extraction | >= 30% | 95% | PASS |
| Runs with kill | >= 80% | 95% | PASS |
| Runs with equip | >= 80% | 100% | PASS |
| Runs with speech | >= 50% | 100% | PASS |
| Persona extraction spread | >= 15 pp | 50 pp | PASS |
| Failed matches in canonical set | 0 | 0 | PASS |
| `null_only` raw `use:"consumable"` emissions | 0 | 0 | PASS |
| `Player_N` surfaced literals | 0 | 0 | PASS |
| Whole-turn validator zeroes | 0 | 0 | PASS |
| Per-field rejection rate | <= 10% | 0.112% | PASS |

**10 / 10 preserved threshold checks pass.** All comparable phase-7
gates preserved without regression.

### 3.2 Phase-9 Slice-Specific Evidence

| Counter | Measured | Evidence |
|---|---:|---|
| `wallRectKeyCount` | 50,830 | Rect-keyed walls present across all 20 runs |
| `coverRectKeyCount` | 21,882 | Rect-keyed cover patches present across all 20 runs |
| `evacRectKeyCount` | 2,311 | Rect-keyed evac present across all 20 runs |
| `singleTileKeyForMultiTileRectCount` | 0 | No single-tile keys derived from multi-tile rects |
| `slideOutcomeCount` | 120 | Wall-slide fires measurably (6 per run avg) |
| `wallOnWallOcclusionCount` | 7,796 | Wall-on-wall LOS occlusion observed |
| `evacOutOfChebyshev20Count` | 450 | Evac visible beyond Chebyshev-20 range |
| `insideBearingHereCount` | 3,214 | Inside-state `bearing: "here"` encoding active |

**Slide distribution by persona:** Rat 2, Duelist 16, Trader 26,
Opportunist 27, Paranoid 1, Camper 4, Sprinter 23, Vulture 21. All 8
personas observed at least one slide across the 20 runs — the slide
substrate is exercised broadly, not concentrated on a single archetype.

---

## 4. Schema Wipe and Report Pipeline

The schema break (`coverClusters` on `worldState`, `slide` on `moves[]`,
`phase9Payload` on `reports`) was exercised under POC posture
(`project_poc_schema_wipe_acceptable`). Dev DB wipe before schema push:

- `turns`: 500 deleted
- `characters`: 80 deleted
- `worldState`: 10 deleted
- `runs`: 10 deleted
- `reports`: 2 deleted
- `matches`: 10 deleted

Schema pushed with `npx convex dev --once --typecheck=disable`.

The report pipeline used the same Path-2 pattern as phase 7:

1. Harness completed 20 live matches at `--reasoning low`.
2. `harness/closing/phase9.ts` fanned out one `turns.byMatchSlim` read
   per match id.
3. The CLI computed metrics locally via `computePhase9Metrics`.
4. The CLI persisted only the small computed payload through
   `reports/phase9:persistComputedPhase9Report`.

---

## 5. Implementation Summary

All changes are backend-only. Landed as commit `1b9693b` (36 files,
3,403 insertions).

### 5.1 Engine Substrate (WP-A + WP-B)

- **`convex/engine/vision.ts`** — Uniform wall+cover LOS; rect-grained
  emission for `wall_rect`, `cover_rect`, `evac_rect`. Wall LOS
  carve-out deleted. Helpers: `rectMinChebyshev`, `rectHasAnyTileWithLos`,
  `shapeOfRect`. Evac always emits post-reveal regardless of
  Chebyshev/LOS. LOS aggregation: wall rect emits if at least one tile
  has LOS (D8).
- **`convex/engine/movement.ts`** — Diagonal wall-slide with
  `tryResolveSlide()`. X-axis preferred tie-break (D2). Slide trace:
  `{ wallRectId, axis, intent }` per substep (D9). Engine writes
  `targetId` verbatim into `intent` (D6). Rect-target dynamic resolution
  via `mover.resolvedTarget.rect` per substep (D3/D10).
- **`convex/engine/types.ts`** — `WorldState.coverClusters: Wall[]` (D1).
  `RectShape` type. `wall_rect` / `cover_rect` / `evac_rect` variants on
  `VisibleEntity`.
- **`convex/engine/map.ts`** — `expandMap` preserves `coverClusters`
  from descriptor.

### 5.2 LLM Projection (WP-C)

- **`convex/llm/inputBuilder.ts`** — Rect-keyed Vision JSON with `shape`
  and `bearing: "here"` inside-convention. `renderSlideFragment` for
  `hugged Wall_*` outcome lines. Evac emitted by engine (D7), removed
  from manual LLM-projection append.
- **`convex/llm/idNormalisation.ts`** — Rect-id parser. `ResolvedEntity.rect`
  for wall/cover/evac (D10). `visibleTargetIds` emits rect-key form.
  Single-tile rects use single-coord form; parser accepts both (D5).

### 5.3 Persistence (WP-B/D12)

- **`convex/schema.ts`** — `coverClusters` on `worldState`, `slide` on
  `moves[]`, `phase9Payload` on `reports`.
- **`convex/runMatch.ts`** — Slide persistence through schema adapters
  and prior-turn row.
- **`harness/diagnostics/types.ts`** — `ResolutionMove.slide` extended.

### 5.4 Closing Infrastructure (WP-E)

- **`convex/reports/phase9.ts`** — `computePhase9Metrics`, `phase9PayloadValidator`,
  `persistComputedPhase9Report` mutation.
- **`harness/closing/phase9.ts`** — CLI driver (mirrors phase-7 driver).

### 5.5 Persona Scrub (WP-D)

Mechanical scrub of persona prompts for dead field references. No
behaviour tuning.

---

## 6. ADR Rollup

All decisions D1–D13 from the spec and review rounds were honoured:

- **D1:** `coverClusters` added alongside `coverTiles` (additive; hiding
  unchanged).
- **D2:** Slide tie-break = X-axis preferred when both cardinals clear.
- **D3:** Rect-target nearest-tile resolved dynamically per substep.
- **D4:** Evac always emits when revealed regardless of LOS/Chebyshev.
- **D5:** Single-tile rects use single-coord form; parser accepts both.
- **D6:** Engine writes `targetId` verbatim into slide trace; LLM
  projection renders display name.
- **D7:** Evac as `VisibleEntity` emitted by engine, not LLM projection.
- **D8:** Wall-on-LOS-rect aggregation: emits if >= 1 tile has LOS.
- **D9:** Slide trace = `{wallRectId, axis, intent}` per substep; no
  aggregate delta derivation.
- **D10:** `ResolvedEntity.rect?: Wall`; WP-B reads it per substep.
- **D11:** Phase 9 closing report uses `phase9Payload` sibling pattern.
- **D12:** `MoveTraceEntry.slide` persisted end-to-end through schema,
  adapters, PrevTurnRow, slim projection, diagnostics types.
- **D13:** Skip re-review of spec v2 refinement (verified guides are
  contracts).

---

## 7. Validation Gates

- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS (670 passed, 2 skipped)
- `npm run build` — PASS

Working tree clean at close.

---

## 8. Test Coverage

| File | Phase-9 tests | Coverage |
|---|---:|---|
| `tests/engine/vision.test.ts` | ~17 | Wall-on-wall LOS occlusion (1×1 and multi-tile), rect-keyed emission for wall/cover/evac, LOS aggregation, inside-state propagation, evac uncapped emit, point-keying preserved for chests/corpses/characters |
| `tests/engine/movement.test.ts` | 10 | Diagonal slide (X/Y fallback), toward/away intent, cardinal dead-stop, both-blocked dead-stop, X-axis tie-break, multi-substep slide, rect-target dynamic resolution (toward + away), persistence roundtrip |

All tests are unit-level (pure-function engine logic). Integration
exercised by the closing-20 end-to-end.

---

## 9. Deferred Items

1. **Persona behaviour-tuning** — Out of scope. Diagnostics view exposes
   the surfaces a future tuning pass would read (slide distribution by
   persona, armed-stance pause, true stationary, saw-enemy/no-op).
2. **Replay UI changes** — Backend-only slice. The existing replay UI
   renders the closing-20 for user step-through; no renderer changes.
3. **`convex/runStats.ts` per-persona kill attribution** — Known issue
   from phase-7 diagnostic addendum; structurally zero since phase 6.
   Separately backlogged.
4. **Harness auto-retry for Convex OCC transients** — No OCC failures
   observed in this closing-20, but the manual replacement policy
   (phase-6 precedent) remains the fallback.

---

## 10. Cross-references

- Canonical intent: [`mental-model.md` §17](../../spec/mental-model.md#17-walls--vision-rect-grained-substrate-dispatched-2026-05-14)
- Predecessor: [Phase 8 — Vision Affordance Filter](../08-vision-affordance-filter/README.md)
- Phase spec: [Phase 9 README](./README.md) (spec v2 + §12 implementation attestation)
- Phase 7 closure: [PHASE-7-CLOSURE.md](../07-context-payload-iter-3/PHASE-7-CLOSURE.md) (threshold baseline)
