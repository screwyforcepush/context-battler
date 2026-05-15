# Phase 11 — DB Bandwidth Substrate Refinement

> **Status:** v1 dispatched 2026-05-15. High-ROI bandwidth slice. Three
> independent moves bundled: (A) prompt-text dedup, (B) drop
> `composedUserMessage` from the persisted shape, (C) split static
> terrain out of the per-turn `worldByMatch` read path. POC posture
> applies — Convex dev DB wipe authorised, no migration shims, single
> forward shape. Validation bar is a 10-run smoke (NOT a closing
> report); standard gates (lint, ts:check, build, test) must pass.
>
> Canonical anchors:
> - [`mental-model.md` §6 pillar 7](../../spec/mental-model.md#6-design-pillars) — "state is the contract; runtime is swappable"
> - [`mental-model.md` §16 phase-7 closure](../../spec/mental-model.md#16-phase-7--context-payload-iter-3--diagnostics-tooling-closed-2026-05-13) — read-side slimming precedent (`turns.byMatchSlim`); this slice is the write-side counterpart
> - North Star (planning brief, this folder) — the explicit scope caps the user locked

---

## 1. Purpose

The two Convex functions on the per-turn hot path are slamming bandwidth
with structurally-redundant data:

- **`_internal_runMatch.persistTurn`** re-writes `systemPromptText`
  (~3–5 KB, IDENTICAL across all 8 agents × 50 turns), `personaPromptText`
  (~1 KB, identical per persona × 50 turns), and `composedUserMessage`
  (the rolled-up prompt — purely derived from already-persisted fields)
  on every agentRecord. Back-of-envelope: ~4–6 MB per match of pure
  write redundancy.
- **`_internal_runMatch.worldByMatch`** ships immutable `walls[]` +
  `coverClusters[]` + `coverTiles[]` on every per-turn read despite
  terrain never changing post-spawn. ~250–500 KB read redundancy per
  match; a closing-20 burns ~80 MB on dead weight.

The redundancy is structural — fixable with principled
denormalisation, not tuning. The user's scope cap is load-bearing:
*HIGH-ROI moves only, no overfit, no back-into-a-corner*. The
substrate is mid-iteration; this slice must not harden any decision
that constrains the next move.

> **North-star filter test:** does this make prompt-authored behaviour
> more interesting, legible, or exploitable? **No — and that's fine.**
> This is a substrate-bandwidth slice, not a prompt-behaviour slice.
> The pillar served is §6.7 ("state is the contract") — the persisted
> shape stops carrying derived/duplicate values so future moves on
> agentRecord cost less and the contract is sharper.

## 2. Overview — what is being built

Three independent moves land in one slice:

### 2.1 Prompt-text dedup — new `prompts` table

The `systemPromptHash` + `personaPromptHash` plumbing already exists in
`convex/schema.ts:agentInputValidator` (L225-235). This slice makes the
hashes load-bearing: prompt text moves to a `prompts` table keyed by
hash; `agentRecord.input` carries only hashes.

- New table: `prompts: { hash, kind, text }` indexed by `("hash", "kind")`.
- Write path: idempotent `getOrCreatePrompt({ hash, kind, text })`
  read-then-insert inside the same Convex mutation that writes the
  turn row (so a `persistTurn` transaction never lands an
  agentRecord with an unresolved hash).
- Read path: `prompts.byHash({ hash, kind })` point-lookup; diagnostics
  CLI and replay UI join hash → text at read time.
- Cross-match dedup (hash-keyed, NOT scoped by match) — same prompt
  text across matches resolves to the same row.
- Hash function: keep the existing `hashHex` (DJB2-32) from
  `convex/runMatch.ts:hashHex`. Collision risk for a project
  with <100 distinct prompts is ~1e-6 — acceptable for POC. Upgrade
  to SHA-256 is out of scope (no overfit).

### 2.2 Drop `composedUserMessage` from the persisted shape

`composedUserMessage` is purely derived from already-persisted fields
(system text + persona text + scratchpadBefore + visibleStateDigest +
status snapshot + narrative event lines). Persisting it AND its
constituents is structural redundancy.

This slice removes the rendered field and persists the **inputs to
recomposition** instead:

- `agentRecord.input.scratchpadBefore` — kept (already persisted).
- `agentRecord.input.visibleStateDigest` — kept (already persisted).
- `agentRecord.input.systemPromptHash` / `personaPromptHash` — kept
  (already persisted; now JOIN keys, not redundant).
- `agentRecord.input.status` — **new**. Tiny snapshot of the agent
  state at decision time: `{ hp, pos, equipped, insideEvac }`. ~100
  bytes. Needed because the rendered `## Status` block depends on
  start-of-turn-N state which isn't otherwise persisted on agentRecord.
- `agentRecord.input.narrativeLines` — **new**. The `string[]` of
  event lines (own-outcome, damage-feed, own-speech, inbound-speech,
  kill-feed) that the builder composed for this turn. Persisting the
  rendered lines (not the raw events) avoids re-walking prev.resolution
  + state at every diagnostics read; the text the model saw is
  precisely the text persisted.
- `agentRecord.input.aliveCount` — **new**. The `M/8 players alive`
  number at decision time. Tiny scalar.

A new pure helper `recomposeUserMessage(input, promptsLookup)` in
`convex/llm/inputBuilder.ts` joins these into the exact composedUserMessage
the model saw. Round-trip invariant: for every persisted agentRecord,
`recomposeUserMessage(persisted, lookup) === buildAgentInput(...).composedUserMessage`
that was sent at decision time.

### 2.3 Slim `worldByMatch` — split static terrain into its own table

`walls[]` / `coverClusters[]` / `coverTiles[]` are immutable post-spawn;
`chests[]` / `corpses[]` / `evac` mutate every turn. Two concerns,
two tables.

- New table: `worldStatic: { matchId, walls, coverClusters, coverTiles }`
  indexed `by_match`.
- Existing table `worldState` keeps `{ matchId, chests, corpses, evac }`
  (static fields **removed**).
- `matches.start` writes BOTH tables at spawn (one-shot, ~200 KB
  total for the reference map).
- `_internal_runMatch.worldByMatch` is renamed-in-place: keeps the
  current name, returns ONLY dynamic fields (`chests` / `corpses` /
  `evac`). Per-turn read shrinks dramatically.
- New `_internal_runMatch.worldStaticByMatch` returns terrain.
- `runMatch.advanceTurn` reads BOTH per turn (one slim dynamic + one
  small static); `buildMatchState` merges static + dynamic into the
  complete `MatchState.world` shape — zero engine-behaviour change.
- `convex/replay.ts:getReplayBundle` joins `worldStatic` so the grid
  renderer continues to receive terrain in one bundle read.

The "read once per chain" goal in the North Star is structurally
infeasible inside Convex's stateless action chain (each `advanceTurn`
invocation is independent). The pragmatic approximation — two slim
reads per turn, both small — captures the bandwidth win without
restructuring the chain. See §9 for the deferral note.

## 3. Architecture Design

### 3.1 Schema changes (`convex/schema.ts`)

```ts
// NEW table — prompts dedup.
prompts: defineTable({
  hash: v.string(),
  kind: v.union(v.literal("system"), v.literal("persona")),
  text: v.string(),
}).index("by_hash_kind", ["hash", "kind"]),

// NEW table — static terrain (write-once at match spawn).
worldStatic: defineTable({
  matchId: v.id("matches"),
  walls: v.array(wallValidator),
  coverClusters: v.array(wallValidator),
  coverTiles: v.array(tileValidator),
}).index("by_match", ["matchId"]),

// MODIFIED — agentInputValidator drops 3 fields, adds 3 fields.
agentInputValidator: v.object({
  systemPromptHash: v.string(),       // existing — now JOIN key
  personaPromptHash: v.string(),      // existing — now JOIN key
  scratchpadBefore: v.string(),       // existing
  visibleStateDigest: v.string(),     // existing
  useVariant: v.optional(useVariantValidator), // existing
  // REMOVED: systemPromptText, personaPromptText, composedUserMessage
  // NEW:
  status: v.object({
    hp: v.number(),
    pos: tileValidator,
    equipped: equippedValidator,
    insideEvac: v.boolean(),
  }),
  narrativeLines: v.array(v.string()),
  aliveCount: v.number(),
}),

// MODIFIED — worldState drops 3 fields (now in worldStatic).
worldState: defineTable({
  matchId: v.id("matches"),
  // REMOVED: walls, coverClusters, coverTiles
  chests: v.array(chestValidator),
  corpses: v.array(corpseValidator),
  evac: v.object({ ... }),
}),
```

The `_internal_runMatch.ts` agentInputValidator + resolutionValidator
mirrors update in lockstep (single source of truth — ADR §6 invariant
from phase 3 onward). Schema-mirror parity test
(`tests/llm/schemaMirror.test.ts`) gains the new shape.

### 3.2 Write path (`convex/_internal_runMatch.ts:persistTurn`)

`persistTurn`'s mutation handler does, in one Convex transaction:

1. For each unique `(hash, kind)` pair across `args.agentRecords`,
   call the in-handler helper `upsertPrompt(ctx, hash, kind, text)` —
   read-then-insert via `prompts.byHashKind` index. Idempotent across
   concurrent mutations (Convex single-mutation serialisability —
   confirmed in §5 perplexity research). System prompt text resolves
   once (1 hash); persona text resolves up to 8 times (8 personas).
2. Insert the `turns` row with slimmed `agentRecords[]` (no
   `*PromptText`, no `composedUserMessage`; instead `status`,
   `narrativeLines`, `aliveCount`).
3. Patch characters + worldState as today (worldPatch shape unchanged
   — already only touched `chests` / `corpses` / `evac`).

The `prompts` upsert lives inside the same mutation as the turn
insert so a partial-write where an agentRecord references an
unresolved hash is structurally impossible.

`runMatch.advanceTurn` is updated:

- Builds `status` + `narrativeLines` + `aliveCount` per agent (these
  are already computed by `buildAgentInput`; we just stop concatenating
  them into a single string).
- Drops `systemPromptText` / `personaPromptText` / `composedUserMessage`
  from the `agentRecords[].input` object passed to `persistTurn`.
- Passes `systemText` + `personaText` separately so `persistTurn` can
  upsert before inserting the turn row.

### 3.3 Read-side recomposition (`convex/llm/inputBuilder.ts`)

New pure helper:

```ts
export type PromptsLookup = {
  systemText(hash: string): string | null;
  personaText(hash: string): string | null;
};

export function recomposeUserMessage(
  input: AgentInputPersisted,
  displayName: string,
  prompts: PromptsLookup,
): string {
  // Joins persona text + status (re-rendered from input.status)
  // + narrativeLines + visibleStateDigest into the canonical
  // composedUserMessage text. Returns null/sentinel on missing hash.
}
```

The Status block helper (`renderStatusBlock`) is refactored to take a
`{ pos, hp, maxHp, equipped, insideEvac, scratchpad }` plain object so
both `buildAgentInput` (decision time, from `CharacterState`) and
`recomposeUserMessage` (read time, from `input.status` + `scratchpadBefore`)
can call it. The `maxHp` is the existing `CHARACTER_MAX_HP` constant.

The round-trip invariant — `recomposeUserMessage` of the persisted
shape must byte-for-byte match the `composedUserMessage` produced by
`buildAgentInput` at decision time — is the load-bearing test contract
for WP-A.

### 3.4 Diagnostics + replay read paths

- **`convex/turnsDerived.ts:projectSlimTurnRows`** — currently scans
  `composedUserMessage` for delivery-audit signals (damage feed,
  speech feed, loot outcome — L572-740). Forward shape: scan
  `narrativeLines` directly instead. The audit contract preserves;
  the substring searches just look in a `string[]` instead of a `string`.
- **`apps/replay/src/lib/rawPane.ts:composeUserRole`** — currently
  reads `input.composedUserMessage`. Forward shape: call
  `recomposeUserMessage(input, displayName, lookup)`. The Convex
  replay bundle (`convex/replay.ts:getReplayBundle`) extends to
  return a `promptsLookup` map (system + 8 persona texts for that
  match) so the renderer has the join material in one round-trip.
- **`apps/replay/src/components/TurnFeed.tsx`** — the Status card
  currently parses `composedUserMessage` via regex (`rawPane`
  helpers `extractSelfHp` / `extractSelfEquipment` / `extractObserverPos`).
  Forward shape: read `input.status` directly. Cleaner — eliminates
  the parser entirely; the structured field is the source of truth.
- **`harness/diagnostics/*`** + **`convex/reports/phase*.ts`** —
  audit each for `systemPromptText` / `personaPromptText` /
  `composedUserMessage` reads. Where present, swap to the recompose
  helper or read `narrativeLines` directly. Engineer enumerates
  during WP-A.

### 3.5 worldStatic split — write + read wiring

- `matches.start` (`convex/matches.ts:185`) — after expanding the
  map descriptor, insert `worldStatic` row (walls/cover/coverTiles)
  AND `worldState` row (chests/corpses/evac). Same `rngSeed`-derived
  expansion; no behaviour change.
- `_internal_runMatch.worldByMatch` — shape narrows; same name,
  same index, fewer fields returned.
- `_internal_runMatch.worldStaticByMatch` — new query, same `by_match`
  read pattern.
- `runMatch.advanceTurn` (post-Step 1) — read both queries; if
  `worldStaticByMatch` returns null, throw (same defensive shape as
  today's `worldByMatch` null check).
- `buildMatchState` — extend signature to accept `worldStaticRow`;
  merge static + dynamic into `MatchState.world`. Engine code that
  consumes `state.world.walls` / `.coverClusters` / `.coverTiles`
  stays untouched — the merge is invisible to the engine.
- `convex/replay.ts:getReplayBundle` — read worldStatic too; return
  it as a sibling field (or merge into `worldState` for the
  renderer's existing shape — engineer choice; the renderer just
  needs terrain accessible somewhere on the bundle).
- `convex/reports/phase9.ts` (or any other report aggregator that
  reads `worldRow.walls`) — switch to the joined `worldStatic` read.

## 4. Dependency Map — parallelization

```
          ┌──────────────────────────────┐
          │  WP-A: Prompt dedup +        │
          │       composedUserMessage    │
          │       drop (bundled)         │
          │  - prompts table             │
          │  - agentInputValidator break │
          │  - persistTurn upsert+slim   │
          │  - recompose helper          │
          │  - read-side joins (CLI/UI/  │
          │    reports/turnsDerived)     │
          └──────────────────────────────┘
                  parallel with
          ┌──────────────────────────────┐
          │  WP-B: worldStatic split     │
          │  - worldStatic table         │
          │  - worldState slim           │
          │  - matches.start dual-write  │
          │  - advanceTurn dual-read +   │
          │    buildMatchState merge     │
          │  - replay bundle + reports   │
          │    join                      │
          └──────────────────────────────┘
                       │
                       ▼
          ┌──────────────────────────────┐
          │  WP-C: Smoke + validation    │
          │  - dev DB wipe               │
          │  - 10-run smoke at low/1200  │
          │  - bandwidth bench (before / │
          │    after persistTurn payload)│
          │  - lint/ts:check/build/test  │
          │  - closure record            │
          └──────────────────────────────┘
```

WP-A and WP-B are **fully independent** — they touch disjoint files
on the schema side (agentInputValidator vs worldState / worldStatic)
and disjoint files on the call-site side (write path differs;
read path differs). Two engineers can ship them in parallel.

WP-C strictly depends on both — smoke can't run until both are
landed in the dev DB.

## 5. Work Package Breakdown

### WP-A — Prompt dedup + composedUserMessage drop (bundled)

**Vertical slice**: write side stops persisting redundant prompt
text; read side recomposes deterministically. Diagnostics CLI and
replay UI continue to render the EXACT text the model saw at
decision time.

**Scope**:

1. Schema additions to `convex/schema.ts`:
   - `prompts` table with `by_hash_kind` index.
   - `agentInputValidator` field-set change (drop 3, add 3 — see §3.1).
   - Mirror parity in `convex/_internal_runMatch.ts:agentInputValidator`.
   - Schema-mirror parity test extended.
2. `convex/_internal_runMatch.ts:persistTurn`:
   - Accept `agentRecords[].input` with the new shape.
   - Accept extra arg `promptTexts: { systemText, personaTexts: Record<personaId, text> }`.
   - Upsert prompts via `getOrCreatePrompt` helper (read-then-insert
     via `by_hash_kind` index) — once per unique `(hash, kind)`.
   - Insert turn row with slim agentRecords.
   - Single Convex transaction.
3. `convex/llm/inputBuilder.ts`:
   - Refactor `renderStatusBlock` to take a plain status object (not
     `CharacterState` + `MatchState`).
   - `buildAgentInput` returns `{ systemPrompt, visibleStateDigest,
     status, narrativeLines, aliveCount, composedUserMessage }` —
     the rolled-up string remains for the runtime LLM call; the
     structured fields are what gets persisted.
   - New pure `recomposeUserMessage(input, displayName, prompts)`
     helper.
   - Round-trip test: every persisted-shape replay recomposes to the
     exact original composedUserMessage.
4. `convex/runMatch.ts:advanceTurn`:
   - Stop persisting `systemPromptText` / `personaPromptText` /
     `composedUserMessage` on `buildAgentInputRecord`.
   - Persist `status` + `narrativeLines` + `aliveCount` instead.
   - Pass `promptTexts` separately to `persistTurn`.
5. Read-side updates (audit-by-codebase-grep):
   - `convex/turnsDerived.ts:buildDeliverySignals` — switch
     substring searches from `composedUserMessage` to `narrativeLines`
     (the lines array preserves all the substrings the delivery audit
     currently scans for).
   - `apps/replay/src/lib/rawPane.ts:composeUserRole` — call
     `recomposeUserMessage`.
   - `apps/replay/src/lib/rawPane.ts:readPlayerName` /
     `extractSelfHp` / `extractSelfEquipment` /
     `extractObserverPos` — read `input.status` + character displayName
     directly; remove regex parsing.
   - `apps/replay/src/components/TurnFeed.tsx` — Status card reads
     `input.status`, not parsed composedUserMessage.
   - `convex/replay.ts:getReplayBundle` — return a `promptsLookup`
     map alongside the existing fields.
   - Diagnostics CLI (`harness/diagnostics/*`) — engineer enumerates
     the call sites; update consistently.

**Success criteria**:
- `agentRecord.input` shape matches new validator; no `systemPromptText`
  / `personaPromptText` / `composedUserMessage` fields persisted.
- `prompts` table contains exactly 1 system row + ≤ 8 persona rows
  after any single-match smoke run (cross-match dedup means a 10-run
  smoke also caps at 1 + 8 rows iff prompts are stable across runs).
- Round-trip test passes: `recomposeUserMessage(persisted, lookup)`
  byte-equal to `buildAgentInput(...).composedUserMessage` for every
  (matchId, turn, characterId) tuple in the smoke cohort.
- Replay raw-pane "Full LLM Input" continues to render the same text
  it rendered pre-slice (manually verified on one replay).
- TurnFeed Status card renders identically pre/post-slice.
- Diagnostics CLI `harness/diagnostics.ts` runs to completion with
  no per-record errors and emits the three families (Critical /
  Mechanics / Behaviour) with non-zero counters where they were
  non-zero pre-slice.

### WP-B — worldStatic split

**Vertical slice**: per-turn world-read payload shrinks to dynamic
fields only; engine and renderer continue to see complete terrain.

**Scope**:

1. Schema:
   - New `worldStatic` table.
   - `worldState` validator drops `walls` / `coverClusters` / `coverTiles`.
2. `convex/matches.ts:start` — insert both rows at match-start with
   the same `rngSeed`-derived `world` object.
3. `convex/_internal_runMatch.ts`:
   - `worldByMatch` returns slim shape (no static fields).
   - `worldStaticByMatch` new query.
   - `persistTurn.worldPatch` validator already excludes static
     fields (verified — `worldPatchValidator` L284-291 only includes
     chests/corpses/evac). No change.
4. `convex/runMatch.ts:advanceTurn`:
   - Read both queries on turn entry.
   - `buildMatchState` extended to accept `worldStaticRow` and merge
     static + dynamic into the complete `MatchState.world`.
5. Read-side updates:
   - `convex/replay.ts:getReplayBundle` — join `worldStatic`; merge
     into `worldState` on the return shape OR return as a sibling
     field. Engineer's call; renderer's terrain access must work.
   - `convex/worldState.ts:byMatchId` (if used) — same treatment.
   - `convex/reports/phase9.ts` — if it reads worldRow walls/cover,
     update to read `worldStatic`.
   - `convex/reports/phase3.ts` — same audit.
   - Replay grid (`apps/replay/src/components/Grid.tsx` +
     `apps/replay/src/lib/reconstruct.ts`) — works against whatever
     `getReplayBundle` returns; engineer keeps the existing field
     access pattern.

**Success criteria**:
- `worldState` rows do NOT contain `walls` / `coverClusters` /
  `coverTiles` after a smoke run.
- `worldStatic` rows DO contain those fields, written once at
  match-start.
- `runMatch.advanceTurn` reads `worldStaticByMatch` once per turn
  invocation (verifiable in Convex function logs or via a unit test
  asserting the call count).
- `MatchState.world` shape consumed by the engine is byte-equivalent
  to pre-slice — same `walls` / `coverClusters` / `coverTiles` /
  `chests` / `corpses` / `evac` fields populated. No engine
  behaviour-change.
- Replay grid renders terrain identically pre/post-slice.
- Phase-9 rect-Vision tests (`tests/llm/inputBuilder.test.ts`)
  continue to pass.

### WP-C — Smoke + validation + closure

**Vertical slice**: prove the bandwidth claim, verify no engine
regression, close the slice.

**Scope**:

1. Convex dev DB wipe (POC posture). Push the new schema with
   `npx convex dev --once`.
2. Bandwidth bench:
   - Pick ONE pre-wipe sample match (or use a typed fixture); record
     `persistTurn` payload size (sum of stringified `agentRecords[]`
     bytes) and `worldByMatch` payload size.
   - Run ONE post-wipe match; record same metrics.
   - Document the before/after numbers in the closure record. The
     claim to validate: persistTurn shape drops ≥ 60% on persisted-per-
     turn bytes; worldByMatch shape drops ≥ 80%.
3. 10-run smoke at `--reasoning low --maxOutputTokens 1200` (phase-9
   baseline). Inspect via the diagnostics CLI:
   - Zero engine crashes (`failedMatches: 0`).
   - Zero whole-turn validator zeroes.
   - Extraction > 0, kill > 0, equip > 0, speech > 0 across the
     cohort (behaviour-directionally-intact — NOT held to
     phase-9 closing thresholds).
   - All 8 personas active (per-persona turn-records > 0).
   - No `Player_N` literal regressions in any persisted surface.
   - No `Chest_NNN` literal regressions in any persisted surface.
4. Validation gates: `npm run lint`, `npm run ts:check` (or
   `npm run typecheck` per `repo.md`), `npm run build`, `npm test`
   — all green.
5. Manual replay UAT: step through one smoke match in `apps/replay/`;
   confirm Status card + raw-pane Full LLM Input render the same
   text they did pre-slice.
6. Closure record `PHASE-11-CLOSURE.md` — bandwidth numbers, smoke
   gate verdicts, validation gate results, ADR rollup, deferred-
   items list.

**Success criteria**:
- Bench numbers documented; claim validated.
- 10-run smoke passes the 7 light bars.
- All 4 validation gates green.
- Manual replay UAT confirms no UI regression.
- Closure record committed.

## 6. Assignment-Level Success Criteria

1. **Schema break landed cleanly.** `convex/schema.ts` and
   `convex/_internal_runMatch.ts` mirror reflect new
   `agentInputValidator` (3 fields removed, 3 added); new `prompts`
   and `worldStatic` tables present; `worldState` static fields
   removed. Schema-mirror parity test green.
2. **`persistTurn` write shape slimmed.** No `systemPromptText` /
   `personaPromptText` / `composedUserMessage` in persisted
   `agentRecord.input`. Prompt text deduplicated via the `prompts`
   table.
3. **`worldByMatch` per-turn read shape slimmed.** No `walls` /
   `coverClusters` / `coverTiles` on per-turn calls. Terrain
   served via `worldStaticByMatch` one-shot reads.
4. **Read-side recomposition deterministic.** The exact composed
   user message the model saw at decision time is reproducible at
   read time via `recomposeUserMessage`; round-trip byte-equality
   verified across the smoke cohort.
5. **Diagnostics + replay UI continue to work.** `harness/diagnostics.ts`
   emits the three metric families with non-zero counters; replay
   raw-pane renders Full LLM Input identically; TurnFeed Status
   card renders identically; replay grid renders terrain identically.
6. **10-run smoke passes the light bars** (see §5 WP-C).
7. **Validation gates green** — lint, ts:check, build, test.
8. **Bandwidth claim validated quantitatively** — bench numbers in
   the closure record show ≥ 60% drop on `persistTurn` payload and
   ≥ 80% drop on `worldByMatch` payload.
9. **POC posture honoured** — no migration shims, no
   `if-legacy-row-shape` branches, single forward shape.

## 7. Ambiguities / Open Questions

These are decisions the user should confirm or override before WP-A
starts; if no override is given by the time the engineer reaches
the decision, treat the **Lock** as the operating answer.

1. **Hash function — DJB2-32 vs SHA-256.**
   - Lock: keep DJB2-32 (the existing `hashHex` helper). Collision
     risk for <100 prompts is negligible.
   - Rationale: no overfit. SHA-256 upgrade is trivially deferrable.
   - Override signal: user says "use crypto" — engineer swaps to
     `node:crypto` SHA-256 hex inside `convex/runMatch.ts:hashHex`.
     `runMatch.ts` already has `"use node"` so crypto is available.

2. **Persist Status snapshot vs reconstruct from history.**
   - Lock: persist `agentRecord.input.status` (~100 bytes per
     agentRecord — negligible).
   - Rationale: avoids server-side history-walk at every diagnostics
     read; the structured field replaces the
     `extractSelfHp`/`extractSelfEquipment`/`extractObserverPos`
     regex parsers in `rawPane.ts` (a code-debt removal, not
     addition).
   - Override signal: user prefers "pure derive at read time" —
     engineer drops the `status` field and the replay UI / CLI walk
     character history. Trade-off: slower diagnostics, no schema
     additions.

3. **Persist `narrativeLines: string[]` vs re-derive from prev
   resolution at read time.**
   - Lock: persist `narrativeLines`.
   - Rationale: the text the model saw is the diagnostic-load-bearing
     artefact (pillar 1 — failures attributable to the prompt).
     Re-deriving requires re-running the inputBuilder narrative
     section at read time over `prev.resolution + state`; persisting
     ~500–800 bytes captures the exact rendered output. Sufficient
     bandwidth savings on the other axes; this is the cheapest
     diagnostic safety net.
   - Override signal: user prefers pure-recompute. Engineer drops
     the field; `recomposeUserMessage` calls the narrative builder
     against the persisted prev-row + reconstructed state.

4. **`prompts` table scope — cross-match vs per-match.**
   - Lock: cross-match (hash-keyed alone, no matchId).
   - Rationale: maximises dedup; same prompt across multiple
     matches resolves to one row.
   - Override signal: user wants per-match isolation (e.g., for
     future prompt-edit-history debugging). Engineer scopes the
     index `["matchId", "hash", "kind"]`. Small dedup loss across
     matches.

5. **worldStatic split — two tables vs single-row projection.**
   - Lock: two tables (separate `worldStatic`).
   - Rationale: clean structural mapping (immutable vs mutable);
     mutability discipline enforced by the schema, not just by
     convention.
   - Override signal: user prefers single-row + projection query.
     Engineer keeps `worldState` whole; modifies `worldByMatch` to
     return only dynamic fields; adds `worldStaticByMatch` that
     returns only static. Marginally smaller schema diff; less
     principled separation.

6. **Per-turn double-read (static + dynamic) vs once-per-chain.**
   - Lock: per-turn double-read.
   - Rationale: Convex action chains are stateless across
     reschedules; "once per chain" requires either passing terrain
     through the schedule message (bandwidth hit on every reschedule)
     or storing in-memory state outside the action (not supported).
     Two slim reads per turn is the pragmatic floor.
   - Override signal: user wants a real once-per-chain — engineer
     restructures the chain to load terrain into an in-action loop
     (eliminate `scheduler.runAfter` between turns; loop inside one
     action). Bigger refactor; explicitly out of scope here unless
     user lifts the cap.

## 8. Recommended Job Sequence

1. **PM records this spec as the canonical artifact** for phase 11.
2. **Engineer dispatches WP-A and WP-B in parallel** (separate
   worktrees recommended — they touch disjoint files but both
   modify `convex/schema.ts`, so a final rebase is needed before
   smoke). Each WP follows TDD inside its scope: write tests first
   (schema-mirror parity, recompose round-trip for WP-A; matchState
   merge correctness for WP-B), then implementation, then green.
3. **Rebase WP-A + WP-B onto a single branch.** Resolve the
   `convex/schema.ts` merge (both add new tables and modify shared
   validators — the merge is mechanical; no logic conflict).
4. **WP-C runs after** the rebase: dev DB wipe, smoke, bench,
   gates, closure record.
5. **No completion review required** for this slice. POC posture
   + small scope + 10-run smoke is the agreed bar. A user
   step-through of one replay match is the manual UAT.
6. **`/ultrareview` is optional** at the user's discretion — flag
   it only if the user wants a multi-reviewer pre-close pass.
   Default: skip.

## 9. Out of Scope — carry these labels forward

Explicit user-locked scope caps (do NOT pick these up opportunistically):

- Partial chest/corpse array patches (would require schema
  gymnastics; substrate may change).
- `characters.lastKnown[]` bounding (small payoff).
- Sidecar `llm.reasoning` / `llm.rawArguments` / `llm.httpBodyExcerpt`
  tables (per-turn-unique; value/cost unclear).
- `visibleStateDigest` / `scratchpadBefore` dedup (per-turn-unique
  by design).
- Convex paginated reads / materialised rollups (phase-7 deferred).
- Persona behaviour tuning (always out of scope on substrate slices).
- Replay UI redesign (preserve existing surfaces; only swap data-fetch
  path).
- Once-per-chain world-static read (see §7.6 — requires chain-model
  refactor; deferred until a slice scopes that explicitly).
- SHA-256 hash upgrade for the prompts table (see §7.1 — DJB2-32 is
  POC-acceptable).
- Any scope creep onto phase-10's body-collision + overseer-v0-
  refinement work.

## 10. Cross-references

- North Star: planning brief in this conversation; canonical user
  intent capture.
- Predecessor: [Phase 10 closure](../10-body-collision-overseer/PHASE-10-CLOSURE.md)
  — substrate posture this slice is grafted onto.
- Read-side precedent: [Phase 7 closure](../07-context-payload-iter-3/PHASE-7-CLOSURE.md)
  §B — `turns.byMatchSlim` read-side projection pattern; this slice
  is the write-side counterpart.
- Mental model: [§6 pillar 7](../../spec/mental-model.md#6-design-pillars)
  ("state is the contract; runtime is swappable") — the principle
  this slice serves.
- Convex dedup pattern reference: read-then-insert in a single
  mutation is the canonical Convex idempotent-upsert pattern;
  serialisability makes it race-free without an `INSERT IF NOT
  EXISTS` primitive.
