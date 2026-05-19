# Phase 14 Coupling Audit

Audit date: 2026-05-19.

Scope: renderer and test-fixture layout coupling found while adding the
curated asymmetric map pool. This is a coupling canary, not a closing
report and not a balance/taste review.

## Summary

| Vector | Class | Result |
|---|---|---|
| Single map source / expand seam | fixed-now | Implemented in `convex/engine/map.ts`; `convex/matches.ts` resolves descriptors and expansion through that engine module. |
| Magic-number grid dimensions / camera | non-issue this round | All five descriptors are 100x100, so `Grid.tsx`'s 100x100 SVG camera still frames every phase-14 map. Variable arena size belongs to the RNG slice. |
| Coordinate-pinned test fixtures | fixed-now | Reference literal fixtures remain reference-scoped. New-map coverage is structural and parametrized over the registry. |
| Replay reconstruction turn-zero spawns | fixed-now | Fixed: `reconstruct.ts` now resolves spawns from `bundle.match.mapId`, with a non-reference reconstruction test. A stricter renderer boundary can move this into replay state during the RNG slice. |
| Cross-run-comparability UX | defer-to-RNG-slice | The substrate default stays pinned to `reference`; future seeded curated-pool selection owns map labels, comparison grouping, and daily-seed UX. |

## Registry And Seam Evidence

Phase 14's loader/expander coupling is fixed by construction in the
current implementation:

- `convex/engine/map.ts:47-63` imports the five descriptor JSON files and
  exposes the fixed `MAP_IDS` order.
- `convex/engine/map.ts:69-100` owns the single `MAP_REGISTRY`,
  `getMapDescriptor(id)`, unknown-id error, and `_comment` normalization.
- `convex/engine/map.ts:144-185` remains the sole `expandMap` implementation.
- `convex/matches.ts:24-30` imports `DEFAULT_MAP_ID`,
  `getMapDescriptor`, `expandMap`, and spawn assignment helpers from
  `./engine/map.js`; the old inline expander is gone.
- `convex/matches.ts:235-250` and `convex/matches.ts:310-323` thread
  optional `mapId` through `matches.start` and `matches.startFromCards`.
- `convex/matches.ts:55-69` records the resolved `mapId` on the match row.
- `tests/matches.test.ts:305-331` pins the no-`mapId` reference scaffold
  parity gate; `tests/matches.test.ts:352-378` covers an explicit
  non-reference map.

Class: fixed-now.

## Vector 1: Grid Dimensions / Camera

Observed coupling:

- `apps/replay/src/components/Grid.tsx:24-25` hardcodes
  `VIEW_W = 100` and `VIEW_H = 100`.
- `apps/replay/src/components/Grid.tsx:67-78` uses those constants for
  `viewBox` and the background rect.
- All descriptors are 100x100 at `maps/reference.json:3`,
  `maps/split-basin.json:3`, `maps/crosswind.json:3`,
  `maps/market-maze.json:3`, and `maps/faultline.json:3`.

Decision:

Class: non-issue this round.

Rationale: phase 14 deliberately keeps variety in topology, not arena
size. The hardcoded 100x100 camera does not distort or clip any map in
the current pool. Driving the SVG `viewBox` and background rect from
`worldState.size` is still the correct future shape, but doing it now
would add a second variable after D2 explicitly fixed all maps at the
reference size.

Deferred owner: RNG slice, if and when variable arena sizes become part
of seeded curated-pool selection.

Extra non-issue found: `apps/replay/src/routes/Diagnostics.tsx:849`
uses `viewBox="0 0 100 10"` for an inline metric bar chart. That is not
arena-coordinate coupling.

## Vector 2: Coordinate-Pinned Test Fixtures

Observed coupling:

- `tests/engine/map.test.ts:119-168` defines literal
  `EXPECTED_REFERENCE_CRATES` and `EXPECTED_REFERENCE_AIRDROPS`.
- `tests/engine/map.test.ts:492-551` asserts those literal reference
  crate and airdrop placements through `loadReferenceMap()`.
- `apps/replay/src/lib/__tests__/reconstruct.test.ts:151-181` and
  `apps/replay/src/lib/__tests__/reconstruct.test.ts:246-270` assert
  reference spawn coordinates directly.

Decision:

Class: fixed-now.

Reference literal-coordinate fixtures are acceptable only when their
names and setup are explicitly reference-scoped. They preserve the
substrate-proof path and replay comparability for map #1.

New-map coverage is structural:

- `tests/engine/map.test.ts:287-399` iterates through `MAP_IDS`, loading
  via `getMapDescriptor(id)`.
- `tests/engine/map.test.ts:287-313` asserts 100x100 descriptors,
  in-bounds walls/cover, exactly eight distinct in-bounds spawns, and
  walkable spawns.
- `tests/engine/map.test.ts:315-342` asserts crate and evac reachability.
- `tests/engine/map.test.ts:344-380` asserts crate/airdrop id collision
  avoidance, wall avoidance, sane `landsAtTurn`, and locked item names.
- `tests/engine/map.test.ts:382-398` asserts deterministic expansion and
  distinct registered topologies.

This satisfies the intended fixture split: literal coordinates remain
only for the reference map, while new maps are covered structurally.

## Vector 3: Replay Reconstruction Spawn Lookup

Observed coupling:

- `apps/replay/src/lib/reconstruct.ts:37-41` imports the five canonical
  descriptor JSON files from `maps/`.
- `apps/replay/src/lib/reconstruct.ts:110-128` maintains a replay-local
  `mapId -> spawns[]` lookup because the renderer lint boundary blocks
  runtime imports from `convex/engine/**`.
- `apps/replay/src/lib/reconstruct.ts:170-188` resolves
  `const mapId = bundle.match.mapId`, uses that map's `spawns`, and
  validates `spawnIndex` against the selected map.
- `apps/replay/src/lib/__tests__/reconstruct.test.ts:274-300` proves a
  `split-basin` replay synthesizes turn-zero positions from the
  non-reference descriptor.
- `apps/replay/vite.config.ts:3-8` and `apps/replay/vite.config.ts:25-28`
  document the cross-root JSON import allowance for `maps/*.json`.

Decision:

Class: fixed-now.

Impact: the hardcoded reference-spawn assumption is fixed. Non-reference
matches now reconstruct turn zero from the selected descriptor rather
than from `maps/reference.json`, satisfying the replay reconstruction
canary for the data contract.

Residual note: this is still a small renderer-side descriptor lookup,
not replay state. It is acceptable for phase 14 because it consumes the
same canonical JSON descriptors and proves every current map reconstructs
correctly. If the future RNG slice wants a stricter pillar-7 split, move
the selected map's spawn list, or the selected descriptor id plus a
replay-local descriptor facade generated from the same registry, into the
replay bundle contract.

## Vector 4: Cross-Run Comparability UX

Observed coupling:

- `convex/schema.ts:998-1021` has `matches.mapId`, and phase 14 records
  the resolved id.
- `convex/replay.ts:44-52` returns completed match rows through
  `replay.listMatches`; the data includes `mapId`.
- `apps/replay/src/routes/MatchPicker.tsx:8-15`,
  `apps/replay/src/routes/MatchPicker.tsx:61-82`, and
  `apps/replay/src/routes/MatchPicker.tsx:112-120` define and render the
  picker columns without map identity.
- `apps/replay/src/routes/Replay.tsx:299-319` renders replay header
  metadata without map identity.
- `harness/run.ts:181-222` parses `--map`; `harness/run.ts:402-422`
  passes explicit `mapId` to `matches.start`; `harness/run.ts:815-828`
  emits it in config telemetry only when supplied.
- `tests/harness/run.test.ts:514-550` asserts explicit map forwarding and
  omission on the default path.

Decision:

Class: defer-to-RNG-slice.

Rationale: phase 14 does not introduce automatic map variance. The
default harness path still omits `mapId`, resolves to `reference`, and
keeps historical substrate runs comparable for the same `rngSeed`.
Explicit map runs are opt-in canary/matrix runs.

Future comparability UX should belong to the seeded curated-pool RNG
slice, because that slice changes the default player experience from
"one map unless explicitly requested" to "seed chooses a map." At that
point the replay picker, replay header, harness summaries, reports, and
daily-seed mode should surface map identity and support grouping or
filtering by map.

No consumer-render UI is implemented in this phase.

## Matrix Evidence

Five explicit low-reasoning harness runs completed, one per registered
map:

| Map | Log | Match | Result |
|---|---|---|---|
| `reference` | `/tmp/phase14-harness-reference.jsonl` | `j97fmgf18czb3rmhrw70r0qa9x870zcq` | completed turn 50 |
| `split-basin` | `/tmp/phase14-harness-split_basin.jsonl` | `j97ak4gwehp7yzedvvgtvkks25870s7a` | completed turn 50 |
| `crosswind` | `/tmp/phase14-harness-crosswind.jsonl` | `j97bx31jw54p0e5j6dfp1ne2c5870ym2` | completed turn 46 |
| `market-maze` | `/tmp/phase14-harness-market_maze.jsonl` | `j9715kktj1wq2whp8t46ewzmxd8718xk` | completed turn 50 |
| `faultline` | `/tmp/phase14-harness-faultline.jsonl` | `j97b82x6gk8avjg53rq300fndd871cpv` | completed turn 50 |

Each run emitted `run_aggregate`, `multi_run_summary`, and
`report_created` with `missingRunsForMatchIds: []`. The `crosswind`
single-run report did not meet closing thresholds, which is expected and
non-blocking: phase 14's map criterion is validity/end-to-end execution,
not balance or behavior tuning.

Replay reconstruction was exercised against the live `split-basin`
bundle via `/tmp/phase14-reconstruct-live.log`: `mapId: "split-basin"`,
8 characters, 12 crates, 4 airdrops, and turn-0 first position
`{"x":10,"y":8}`.

## RNG-Slice Pre-Scope

Future seeded curated-pool selection should own:

- deterministic seed-to-map selection over the hand-authored registry;
- any daily-seed or cohort-comparison rule for pinning the selected map;
- surfacing `mapId` in picker/replay/report/harness comparability UX;
- dynamic renderer camera work if variable arena sizes are admitted;
- matrix coverage that treats map identity as a first-class run axis;
- any later spawn or loot permutation layered on top of selected maps.

This phase deliberately does not build:

- procedural or random geometry generation;
- automatic map selection;
- map balance, symmetry, or taste tuning;
- consumer-render UI beyond this audit's observations;
- migrations or compatibility shims.

## Final Note

Changed file: `docs/project/phases/14-map-pool/COUPLING-AUDIT.md`.

Commands/searches run for this audit included:

- `sed` reads of `.agents/AGENTS.md`, `.agents/repo.md`,
  `docs/project/spec/mental-model.md`,
  `docs/project/spec/architecture.md`,
  `docs/project/guides/README.md`,
  `docs/project/guides/convex-backend.md`,
  `docs/project/guides/eval-pipeline.md`, and
  `docs/project/phases/14-map-pool/README.md`.
- `tree --gitignore -L 3` for repository shape.
- `nl -ba ... | sed -n ...` reads of `Grid.tsx`, `reconstruct.ts`,
  `reconstruct.test.ts`, `tests/engine/map.test.ts`, `harness/run.ts`,
  `tests/harness/run.test.ts`, `convex/engine/map.ts`,
  `convex/matches.ts`, `tests/matches.test.ts`, `convex/replay.ts`,
  `MatchPicker.tsx`, `Replay.tsx`, `convex/schema.ts`,
  `apps/replay/vite.config.ts`, and `Diagnostics.tsx`.
- `rg` searches for `mapId`, map ids, `reference.json`, `spawnIndex`,
  `viewBox`, and replay reconstruction references.
- `git status --short`, `git diff -- ...`, and `find /tmp ...` for
  current-change and validation-log evidence.
