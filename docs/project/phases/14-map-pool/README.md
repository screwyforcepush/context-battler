# Phase 14 — Map Pool (Curated Asymmetric Maps + Renderer Coupling Audit)

> **Status:** planned 2026-05-19. Lightweight substrate carve, **phase-08
> weight class**: no closing-report run, **no second plan-review**, no
> behaviour-tuning. Standard gates only (lint, typecheck, test, build,
> build:replay) plus the harness-parity HARD GATE.
>
> Canonical intent anchors:
> - [`docs/project/spec/mental-model.md`](../../spec/mental-model.md) §10
>   (iteration discipline; RNG sequenced *after* substrate, *before*
>   consumer render; one-variable-at-a-time), §7 (decision filter), §6
>   pillar 7 (state is the contract; engine ↔ renderer meet only at data),
>   §11–§13 (curated-pool RNG direction; daily-seed as RNG home).
> - Phase-12 closure — **BC-1 dual-seam** precedent; **BC-3 two-clock
>   airdrop** semantics.
> - Phase-13 README §2.5 / §3.8 — **harness-parity discipline** precedent
>   (byte-identical for same `rngSeed`; the parity test *is* the gate).
> - Phase-08 README — weight-class precedent (one contained carve, no
>   closing report, no plan-review).

---

## 1. Purpose

The engine is **already descriptor-driven** (pillar 7): `runMatch.ts`
never references a map — it reads `worldStatic` / `worldState` rows. The
*only* thing pinned to the single reference layout is **which JSON
descriptor loads, and it loads through two parallel, hand-mirrored seams**
(`convex/engine/map.ts` and `convex/matches.ts`) — the BC-1 dual-seam
drift trap flagged at phase-12 closure.

The user is heading into the consumer-render era. Rather than litigate
RNG-vs-render ordering, a curated map **pool** added now lets render
proceed *provably layout-agnostic* and becomes the first brick of the
eventual RNG slice (§11–§13: curated-pool seeded selection, **not**
procedural generation).

The point of 4 maps *right now* is **variety, not balance**: (a) kill
prompt-overfitting to one fixed layout; (b) serve as the
renderer / test-fixture **coupling canary**. Maps are **asymmetric and
deliberately un-tuned**. Balance/symmetry/taste is explicitly OUT and
deferred to a separate later loop — **no user taste-gate this round**.

The **strategic deliverable is the coupling audit** (WP3): it de-risks
render-first and pre-scopes the future RNG slice.

## 2. Overview

Three work packages:

- **WP1 — Registry + seam collapse + `mapId` threading + parity gate.**
  A single map registry (`id → MapDescriptor`) becomes the *sole* source
  of truth, feeding **both** expand seams so the BC-1 dual-seam is
  eliminated *by construction*. Optional `mapId` threaded through
  `matches.start`, `matches.startFromCards`, and `harness/run.ts --map`.
  Absent ⇒ `reference`. Harness-parity HARD GATE (phase-13 discipline):
  the no-param path is byte-identical to pre-change for the same
  `rngSeed`; **the parity test is the gate, not deferred to closure.**

- **WP2 — Author 4 asymmetric `MapDescriptor` JSON files.** Validity
  bar only: distinct topology (from reference *and* each other), valid
  8-spawn / evac / cover / wall / crate / airdrop-wave structure, passes
  `expandMap` invariants. Descriptor-validity tests cover **all 5** maps.

- **WP3 — Map-matrix harness run + the coupling-audit writeup.** Run
  every map end-to-end (reasoning low) incl. replay reconstruction, then
  walk and classify the **three coupling vectors**.

## 3. Architecture Design

### 3.1 The two parallel expand seams (traced — the only sharp edge)

**Seam A — `convex/engine/map.ts`** (pure, fs-free; consumed by
`tests/engine/map.test.ts` and the engine test suite):
- `loadReferenceMap()` — JSON-imports `../../maps/reference.json`,
  deep-clones, strips the `_comment` doc field, returns `MapDescriptor`.
- `expandMap(descriptor, _rngSeed)` — pure descriptor → `WorldState`
  (unrolls `coverClusters` → `coverTiles`; coord-encodes crate/airdrop
  ids as `Crate_<x>_<y>`; `evac.revealedAtTurn = null`; `corpses = []`).
- `assignPersonasToSpawns(rngSeed, personas)` — Fisher–Yates on `[0..N)`
  seeded by `makeRng(rngSeed + ":spawnAssign")`.

**Seam B — `convex/matches.ts`** (default Convex runtime; the two live
call sites):
- `getReferenceMapDescriptor()` — JSON-imports the **same** file inline,
  strips `_comment`.
- `expandMapInline(descriptor, _rngSeed)` — **hand-mirrored,
  byte-equivalent copy** of `expandMap`.
- `assignItemsToSpawnsInline` / `assignPersonasToSpawnsInline` — mirrors
  of the Fisher–Yates assigner.
- Call site 1: `matches.start` (mutation) — `getReferenceMapDescriptor()`
  → `expandMapInline` → `insertWorldRows` → 8 `characters`.
- Call site 2: `matches.startFromCards` (mutation) — identical world
  path, card-driven character rows.

The dual-seam is **doubled**: both the *descriptor loader* and the
*expander* are duplicated. Drift in either silently desyncs harness runs
from card runs from engine tests.

> **STALE-COMMENT WARNING (load-bearing for WP1).** `convex/matches.ts`
> (lines ~9–12, ~82–91) claims the inline mirror exists *because*
> `convex/engine/map.ts` has a top-level `node:fs` import unresolvable by
> the default-runtime bundler. **`convex/engine/map.ts` currently imports
> no `node:fs`** — only `./types.js`, `./loot.js` (`makeRng`, declared
> fs-free and *already* imported by `matches.ts`), and a JSON import. The
> historical reason for the duplication **no longer holds**. WP1 must
> verify (real `npm run build` + `convex` codegen) and act on this.

### 3.2 Registry — single source of truth (AC1)

Add a pure registry to **`convex/engine/map.ts`** (it already owns
`loadReferenceMap`/`expandMap`, is fs-free, and is the natural engine
home). It JSON-imports all 5 descriptors and exposes:

```
export const MAP_IDS = ["reference", <4 new ids>] as const;
export type MapId = (typeof MAP_IDS)[number];
export function getMapDescriptor(id: string): MapDescriptor; // unknown id → throw
export const DEFAULT_MAP_ID = "reference";
```

`loadReferenceMap()` stays (back-compat for existing engine callers) and
becomes a thin `getMapDescriptor("reference")`. `_comment` stripping is
centralised in the registry so every descriptor normalises identically.

**Seam-collapse (recommended, AC1 "by construction"):** because
`engine/map.ts` is fs-free and default-runtime-safe, `convex/matches.ts`
imports `getMapDescriptor` **and** `expandMap` **and**
`assignPersonasToSpawns`/`assignItemsToSpawns` directly from
`./engine/map.js`. `expandMapInline` and the inline loader/assigner are
**deleted**. The dual-seam is eliminated *by construction* — there is
only one expander and one registry. WP1 proves this with a build + a
cross-map equality test.

**Fallback (only if WP1's bundler verification fails):** keep
`expandMapInline` as a mirror but make **both** seams resolve descriptors
through the shared registry, and add a test asserting
`expandMap(d) deepEquals expandMapInline(d)` for **all 5** maps. This
still kills the *loader* drift by construction and gates the *expander*
drift with an all-maps equality test. The collapse is preferred; the
fallback is the documented escape hatch, not a default.

### 3.3 `mapId` threading (AC2)

- `matches.start` / `matches.startFromCards`: add
  `mapId: v.optional(v.string())` to args. Resolve
  `const mapId = args.mapId ?? DEFAULT_MAP_ID;`
  `getMapDescriptor(mapId)` (unknown id → throw a clear error).
- `insertMatchScaffold`: replace the hardcoded `mapId: "reference"` with
  the **resolved** `mapId` so the row records the actual map (the
  `matches.mapId: v.string()` column already exists — no schema change).
- `harness/run.ts`: extend the `matches:start` `FunctionReference` arg
  type with `map?: string`; add a `--map <id>` `parseArgs` option
  (default `reference`); plumb through `runOne` → `matchesStart`.
- **`runMatch.ts` is untouched** — it never reads `mapId`; map selection
  fully resolves at match-start and the per-turn engine is already
  data-driven (pillar 7). This is the clean seam that makes the whole
  carve thin.

### 3.4 Parity HARD GATE (AC2, phase-13 discipline)

A regression test (TDD, written first) asserting: for a fixed `rngSeed`,
`matches.start` **with no `mapId`** produces `worldStatic` + `worldState`
+ `characters` **byte-identical** to the pre-change reference path, and
the resolved row `mapId === "reference"`. Pure-layer equivalent: the
registry-default → `expandMap` output deep-equals
`expandMap(loadReferenceMap(), seed)` and `assignPersonasToSpawns` is
unchanged. **This test is the gate.** Zero behavioural drift on the
substrate-proof path is proven here, not at closure.

### 3.5 Descriptor-validity invariants (WP2, AC3)

Every map (all 5) must pass — derived from the existing
`tests/engine/map.test.ts` contract:

1. `size.w/h` match the descriptor; **all 5 maps are 100×100** (see
   Decision D2).
2. Exactly **8 spawns**, all in-bounds, none inside a wall rect, all
   pairwise-distinct (`assignPersonasToSpawns` permutes `[0..8)`;
   `descriptor.spawns[spawnIndex]` must exist for indices 0–7).
3. Every crate reachable from ≥1 spawn via Chebyshev (king-move) BFS.
4. Evac centre reachable from **all 8** spawns.
5. Crate coords pairwise-distinct, and **no airdrop coord equals any
   static-crate coord** (both encode `Crate_<x>_<y>` ids — collision =
   duplicate ids). Airdrop coords not inside walls.
6. Crate/airdrop `contents` use only locked item names
   (`WEAPONS`/`ARMOUR`/`CONSUMABLES` in `convex/engine/types.ts`).
7. Topology distinct from reference **and from each other** (walls /
   cover / spawns materially differ — a structural, not pixel, check).
8. `expandMap` is deterministic & seed-independent for contents (already
   asserted for reference; extend to all 5).

### 3.6 BC-3 two-clock airdrop semantics (WP2 authoring note)

Per phase-12 closure: an airdrop telegraphs with `countdown 3,2,1,0`;
landing + telefrag occur during `resolveTurn(landsAtTurn)`; the first
normal landed-crate loot turn is `landsAtTurn + 1`. Mid-game value curve:
early drops weakest, late drops strongest under the incineration clock.
Author each map's waves with a sane `landsAtTurn` spread within the
50-turn match and coords clear of walls and static crates.

### 3.7 Coupling vectors (WP3 — the strategic deliverable)

| # | Vector | Observed coupling | Likely class |
|---|--------|-------------------|--------------|
| 1 | Magic-number grid dims / camera | `apps/replay/src/components/Grid.tsx:24-25` hardcodes `VIEW_W=100/VIEW_H=100`; `viewBox="0 0 100 100"` | **non-issue this round** (D2 keeps all maps 100×100); audit recommends driving `viewBox` from `worldState.size` and **defers** variable arena size to the RNG slice |
| 2 | Coordinate-pinned test fixtures | `tests/engine/map.test.ts` `EXPECTED_REFERENCE_CRATES/AIRDROPS`; `reconstruct.test.ts` "100×100 reference map" comment | **fixed-now**: reference fixtures stay reference-scoped; new maps get their own non-coord-pinned validity tests (structural, not literal-coord) |
| 3 | Cross-run-comparability UX | replay/overseer implicitly assume one map across runs (regression diagnosis, replay comparison) | **defer-to-RNG-slice**: the RNG slice owns surfacing "which map" in the comparability UX; substrate-proof harness stays pinned to map #1 (§10) so today's comparability holds |

The writeup walks each vector with code-anchored evidence from the
matrix run and assigns the final class. **This is the artifact that
pre-scopes the RNG slice.**

## 4. Dependency Map (parallelization)

```
WP1 (registry + collapse + threading + parity gate)  ─┐
                                                       ├─► WP3 (matrix run + audit)
WP2-authoring (4 JSON files, pure data)  ─────────────┘
WP2-validity-tests ── joins after WP1 registry exists ─┘
```

- **WP1** and **WP2 JSON authoring** run **in parallel** (independent:
  one is code+seam, the other is pure data).
- **WP2 validity tests** consume the WP1 registry (`getMapDescriptor` to
  load all 5) — fold in once WP1's registry lands (rebase, small).
- **WP3** is strictly last (needs `mapId` threading + harness `--map`
  from WP1 **and** the 4 maps from WP2).

## 5. Work Package Breakdown (UAT vertical slices)

### WP1 — Registry, seam collapse, `mapId` threading, parity gate

**Vertical slice:** trigger `matches.start` with `--map reference` (and
no flag) → byte-identical world; trigger with an explicit id → that map
expands end-to-end through the unchanged engine/replay path.

TDD order: parity regression test (§3.4) **first** → registry →
collapse/threading → cross-map equality test → gates.

**Success criteria**
- One registry (`id → MapDescriptor`) is the sole descriptor source;
  both seams resolve through it (AC1).
- Recommended: `expandMapInline` + inline loader/assigner **deleted**,
  `matches.ts` imports the engine expander/registry directly; build +
  `convex` codegen verified green. If bundler verification fails: the
  documented fallback (§3.2) with the all-5-maps `expandMap ==
  expandMapInline` equality test.
- `mapId` optional on `start` + `startFromCards`; absent ⇒ `reference`;
  resolved id recorded on the `matches` row; unknown id throws.
- `harness/run.ts --map <id>` plumbed end-to-end (default `reference`).
- **HARD GATE:** no-param path byte-identical for the same `rngSeed`
  (worldStatic + worldState + characters); resolved `mapId==="reference"`.
- Standard gates green incl. `build:replay`.

### WP2 — Author 4 asymmetric maps + all-5 validity tests

**Vertical slice:** each new map id expands via the registry and runs a
full match through the existing path.

**Success criteria**
- 4 new `MapDescriptor` JSON files under **`maps/`** (see D1), each
  100×100 (D2), each registered in the registry + `MAP_IDS`.
- Each map: topology distinct from reference **and** from each other;
  satisfies all §3.5 invariants; BC-3-aware airdrop waves (§3.6).
- **Balance / symmetry / taste explicitly NOT a criterion** — no user
  taste-gate; the implementing agent authors to the validity bar only.
- Descriptor-validity tests parametrised over **all 5** maps (reference
  fixtures stay reference-scoped; new-map tests are structural, not
  literal-coord — vector 2).
- Standard gates green.

### WP3 — Map-matrix harness run + coupling-audit writeup

**Vertical slice:** a reviewing agent runs the matrix and reads a
committed audit that classifies every coupling vector.

**Success criteria**
- Harness runs a batch across the explicit 5-map set (reasoning low),
  each layout end-to-end **including replay reconstruction** (a
  `reconstruct.ts` integration check over a non-reference world snapshot
  — proves the renderer path is layout-agnostic at the data contract).
  Thin: a small matrix driver reusing `runHarness`/`runOne`, or
  `run.ts --map` looped — implementer's call (A4).
- Coupling-audit writeup committed at
  `docs/project/phases/14-map-pool/COUPLING-AUDIT.md`: the three vectors
  (§3.7) each walked with code-anchored evidence and classified
  fixed-now / defer-to-RNG-slice / non-issue, with an explicit
  "RNG-slice pre-scope" section.
- Any **fixed-now** items actually fixed within WP3 (e.g. vector 2
  fixture scoping) with gates green.

## 6. Assignment-Level Success Criteria

Maps 1:1 to North Star AC1–6:
1. **AC1** — single registry feeds both seams; BC-1 eliminated by
   construction, proven by a test.
2. **AC2** — `mapId` threaded (`start`, `startFromCards`, harness
   `--map`); absent ⇒ reference; parity HARD GATE green (no-param path
   byte-identical for same `rngSeed`).
3. **AC3** — 4 asymmetric 100×100 maps under `maps/`; all §3.5
   invariants; all-5 validity tests; balance NOT a criterion.
4. **AC4** — harness batch across the explicit map set, reasoning low,
   each layout end-to-end incl. replay reconstruction.
5. **AC5** — `COUPLING-AUDIT.md` committed; 3 vectors classified;
   RNG-slice pre-scoped.
6. **AC6** — POC posture (forward-only, no migration shim); standard
   gates green (lint, ts:check, test, build, build:replay); **no
   closing-report run; no second plan-review.**

## 7. Decisions Taken (ratify or override before dispatch)

- **D1 — Descriptor home is repo-root `maps/`, not `convex/maps/`.**
  The North Star / assignment say `convex/maps/`; the *actual* import
  path is repo-root `maps/` (`engine/map.ts` → `../../maps/`,
  `matches.ts` → `../maps/`; `maps/reference.json` is the live exemplar).
  Resolved to `maps/` — the North Star phrasing is path imprecision; the
  intent ("alongside `reference.json`, one registry") is honoured.
- **D2 — All 4 new maps are 100×100 (same as reference).** Variety comes
  from topology, not arena dimensions. Keeps the substrate-proof harness
  comparable (§10), keeps the Grid.tsx camera coupling a clean *non-issue
  this round*, and lets the audit cleanly **defer** variable arena size
  to the RNG slice. Differing sizes are explicitly out of this carve.
- **D3 — Seam fully collapsed (recommended), bundler-verified.** WP1
  deletes the inline mirror and imports the engine expander/registry
  directly (the stale-comment node:fs rationale no longer holds). The
  §3.2 fallback is the documented escape hatch only if real
  build+codegen verification fails — not a default.
- **D4 — Harness matrix surface: `--map` single flag + a thin matrix
  driver reusing `runHarness`/`runOne`.** No new heavy machinery;
  implementer may instead loop `run.ts --map` if cleaner.
- **D5 — "Exercise replay reconstruction" = a `reconstruct.ts`
  integration check over a non-reference world snapshot.** Confirms the
  renderer is layout-agnostic at the data contract without standing up
  the UI.

## 8. Ambiguities / Questions for PM

- **Q1 (D1):** confirm `maps/` (repo root) is the accepted descriptor
  home given the North Star said `convex/maps/`. *Default taken: `maps/`.*
- **Q2 (D2):** confirm all-100×100. The North Star permits distinct
  topology without mandating distinct *size*; 100×100 is the
  audit-friendliest reading. *Default taken: 100×100.*
- **Q3 (D3):** seam-collapse depth is gated on a build/codegen
  verification inside WP1 — flagged so the engineer treats a bundler
  failure as "use documented fallback", not "blocked".

## 9. Recommended Job Sequence

1. **Dispatch in parallel:** WP1 (engineer, TDD — parity test first) +
   WP2 JSON authoring (engineer; validity-test wiring rebases onto WP1's
   registry when it lands).
2. **WP3 after WP1 + WP2 green:** matrix run → `COUPLING-AUDIT.md` →
   fix any *fixed-now* vector items → final gates.
3. **No plan-review gate** (North Star: ratified, phase-08 weight class).
   **No closing-report run.** UAT is lightweight: optional single visual
   replay sanity-check of one non-reference map in the overseer, recorded
   as audit evidence — not a gate.

**Spec artifact:** `docs/project/phases/14-map-pool/README.md`
</content>
</invoke>
