# Phase 11 — DB Bandwidth Substrate Refinement

> **Status:** v2 dispatched 2026-05-15. Revised 2026-05-15 — review v1
> conditions folded. High-ROI bandwidth slice. Two work packages bundled
> in WP-A (prompt-text dedup AND the `composedUserMessage` drop — the
> drop is a fall-out of the dedup, not an independent move) plus WP-B
> (split static terrain out of the per-turn `worldByMatch` read path)
> plus WP-C (smoke + closure). POC posture applies — Convex dev DB
> wipe authorised, no migration shims, single forward shape.
> Validation bar is a 10-run smoke (NOT a closing report); standard
> gates (lint, ts:check, build, test) must pass.
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
  (~3–5 KB, identical across all 8 agents per turn but turn-bound —
  countdown line changes each turn; cf. `convex/llm/systemPrompt.ts:5-20`
  and Phase 7 closure record), `personaPromptText` (~1 KB, identical
  per persona × 50 turns), and `composedUserMessage` (the rolled-up
  prompt — purely derived from already-persisted fields) on every
  agentRecord. Back-of-envelope: ~4–6 MB per match of pure write
  redundancy. Cardinality is **per-distinct-hash**, not "1 system +
  8 persona" (see §5 WP-A success criteria for corrected math).
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

Three architectural moves land in one slice, bundled into two work
packages (WP-A combines moves 2.1 + 2.2 — see D6 in §7; 2.2 is a
structural fall-out of 2.1, not an independent move):

### 2.1 Prompt-text dedup — new `prompts` table

The `systemPromptHash` + `personaPromptHash` plumbing already exists in
`convex/schema.ts:agentInputValidator` (L225-235). This slice makes the
hashes load-bearing: prompt text moves to a `prompts` table keyed by
hash; `agentRecord.input` carries only hashes.

- New table: `prompts: { hash, kind, text }` indexed by `("hash", "kind")`.
- Write path: idempotent `getOrCreatePrompt({ hash, kind, text })`
  read-then-insert inside the same Convex mutation that writes the
  turn row (so a `persistTurn` transaction never lands an
  agentRecord with an unresolved hash). **Collision-guarded**: if a
  row with `(hash, kind)` exists but `row.text !== text`, throw a
  fatal `DataIntegrityError` (D9 — cross-match scope amplifies the
  blast radius of any silent collision; override signal: user says
  "use crypto" → switch to SHA-256).
- Read path: `prompts.byHash({ hash, kind })` point-lookup; diagnostics
  CLI and replay UI join hash → text at read time. Missing-hash on
  any persisted agentRecord is **fatal** (D12 — forward-only POC; a
  missing row is data corruption, not graceful legacy).
- Cross-match dedup (hash-keyed, NOT scoped by match) — same prompt
  text across matches resolves to the same row. Because
  `buildSystemPrompt(turn)` is turn-bound, the per-match system-prompt
  cardinality is up to ~50 distinct hashes (one per turn); cross-match
  steady state on the same map+timing is also ~50, plus ≤8 persona
  rows. See §5 WP-A for the full math.
- Hash function: keep the existing `hashHex` (DJB2-32) from
  `convex/runMatch.ts:hashHex`. Collision risk for a project
  with <100 distinct prompts is acceptable for POC. The collision
  guard above makes a silent corruption structurally impossible.
  Upgrade to SHA-256 is out of scope (no overfit).

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
  kill-feed) that the builder composed for this turn — POST-FILTER
  (the array the builder ultimately appended, not raw event outputs
  with possible `null` slots). Rationale (reviewer-reframed):
  this is an **intentional exact-text snapshot** with a measured
  byte budget (~500–800 B per agentRecord). The load-bearing value
  is byte-equal user-role reconstruction at read time with no
  recompute-time race-condition risk (pillar 1 — failures
  attributable to the prompt). The earlier "avoid a server-side
  history walk" rationale was wrong — `turns.byMatchSlim` already
  walks adjacent rows in memory. Each array element MUST be a
  complete rendered line; delivery-line scans use
  `narrativeLines.some(line => line.includes(...))`, never
  `narrativeLines.join().includes(...)` (test contract — see §5).
- `agentRecord.input.aliveCount` — **new**. The `M/8 players alive`
  number at decision time. Tiny scalar.

A new pure helper `recomposeUserMessage({ input, turn, displayName,
prompts })` in `convex/llm/inputBuilder.ts` joins these into the exact
composedUserMessage the model saw. **`turn` is mandatory** (D11):
`buildAgentInput` renders `Turn ${state.turn}, ${aliveCount}/8 players
alive` (`convex/llm/inputBuilder.ts:632-644`); without `turn` from the
parent turn row, byte-equality fails. Round-trip invariant: for every
persisted agentRecord,
`recomposeUserMessage({ input, turn, displayName, lookup }) === buildAgentInput(...).composedUserMessage`
byte-for-byte (including blank lines and section order). Missing-hash
lookup throws (D12) — no `null`/sentinel return.

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
   call the in-handler helper `getOrCreatePrompt(ctx, hash, kind, text)`:
   - Query `(hash, kind)` via the `by_hash_kind` index.
   - If no row → insert.
   - If row exists AND `row.text === text` → reuse silently.
   - If row exists AND `row.text !== text` → throw fatal
     `DataIntegrityError` (D9). A forced-collision unit test pins
     this branch — see §5 WP-A scope.

   Idempotent across concurrent writers via Convex single-mutation
   serialisability (the standard read-then-insert pattern; no race).
   Per-turn cardinality: all 8 agents share one system-prompt hash,
   so the system-prompt upsert resolves once per `persistTurn` call;
   persona text resolves up to 8 times (one per persona).
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
  systemText(hash: string): string;   // throws on missing (D12)
  personaText(hash: string): string;  // throws on missing (D12)
};

export function recomposeUserMessage(args: {
  input: AgentInputPersisted;
  turn: number;          // MANDATORY (D11) — `Turn N, M/8 players alive` line
  displayName: string;
  prompts: PromptsLookup;
}): string {
  // Joins persona text + status (re-rendered from input.status via
  // shared `renderStatusBlock`) + Turn-N line (from `args.turn` +
  // `input.aliveCount`) + narrativeLines + visibleStateDigest into
  // the canonical composedUserMessage text. Throws fatal
  // `MissingPromptHashError` on missing lookup (D12 — no sentinel).
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

#### 3.4.1 `convex/turnsDerived.ts:projectSlimTurnRows` — forward sources by field (D16)

`projectSlimTurnRows` derives a wide slim shape from full agentRecord
input; today it parses `composedUserMessage` for several distinct
field families. The forward shape replaces those parsers with
field-specific sources (NOT a single "scan narrativeLines" sweep):

| Slim field family | Today (pre-WP-A) | Forward source (post-WP-A) |
|---|---|---|
| Delivery-line audits (damage feed, speech, loot, body-collision; `:543-737`) | `composedUserMessage.includes(expectedLine)` against cross-turn evidence | `narrativeLines.some(line => line.includes(expectedLine))` — preserves the **cross-turn evidence semantics**; do NOT replace with same-turn resolution counters; do NOT use `narrativeLines.join().includes(...)` (single-line atomicity is load-bearing) |
| `visibleRectKeys`, `insideBearingHere` (`:777-798`) | parsed from `visibleStateDigest` substring matches inside `composedUserMessage` | parsed directly from `input.visibleStateDigest` (already persisted; existing parser logic carries over verbatim — the digest line set is unchanged) |
| `selfHp`, `selfEquipment`, `observerPos` (`convex/turnsDerived.ts:227-289`) | regex parsed from `composedUserMessage` Status block | read directly from `input.status` (`hp`, `equipped`, `pos`); regex parsers (`extractSelfHp` / `extractSelfEquipment` / `extractObserverPos`) deleted |

Consumers downstream of `projectSlimTurnRows` (notably
`harness/diagnostics/mechanics.ts:156-163`) MUST continue to receive
identical counters across all three field families — not just the
delivery lines. WP-A test scope adds focused tests on
`projectSlimTurnRows` covering every derived family, with at least one
test asserting that a single rendered event spans exactly one
`narrativeLines` entry (no cross-element splits).

#### 3.4.2 Replay app reads

- **`apps/replay/src/lib/rawPane.ts:composeUserRole`** — currently
  reads `input.composedUserMessage`. Forward shape: call
  `recomposeUserMessage({ input, turn, displayName, prompts })`. The
  Convex replay bundle (`convex/replay.ts:getReplayBundle`) extends
  to return a `promptsLookup` map (every distinct system + persona
  hash referenced by the match's turns) so the renderer has the join
  material in one round-trip. Missing-hash on lookup must surface as
  a visible error state in the UI (D12 — not silent fallback).
- **`apps/replay/src/components/TurnFeed.tsx:240-242` + `:396-418`** —
  the Status card has its own `parseStatusBlockForReplay` parser
  (separate from `rawPane`'s extractors but the same teardown
  target). Forward shape: read `input.status` directly. Cleaner —
  eliminates the parser entirely; the structured field is the source
  of truth.

#### 3.4.3 Server-side report aggregators

- **`convex/reports/phase6.ts:118-124, :204-207, :397-407, :800-809`** —
  directly reads `composedUserMessage` and `personaPromptText`.
  Engineer decides during WP-A whether the phase6 reports are still
  active and worth porting to recompose+JOIN; if not, delete the
  reads. Flag as an open Q if unclear.
- **`harness/closing/phase9.ts:126-130, :355-400`** — directly reads
  `worldState:byMatchId` and adapts `row.walls` / `row.coverClusters`.
  Switch to the joined `worldStatic` read (paired query). This
  belongs to WP-B; called out here for read-side completeness.
- **`convex/reports/phase9.ts:236-296`** — consumes `world.walls` /
  `world.coverClusters` for rect/LOS evidence; switch to joined
  `worldStatic` (WP-B).
- **Comment-only stale reference** — `convex/llm/personas.ts` mentions
  per-turn `personaPromptText`; clean up the stale comment alongside
  WP-A.

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
- `convex/replay.ts:getReplayBundle` — read worldStatic too AND
  return ONE merged `worldState` field with `{ ...worldStaticRow,
  ...worldStateRow }` shape (D10 lock). Rationale:
  `apps/replay/src/components/Grid.tsx:77,94` reads `worldState?.walls`
  / `?.coverTiles` directly off the bundle; a sibling-field shape
  would silently render an empty map until somebody patches Grid.
  Sibling-field has no benefit and pays a Grid update cost. Engineer
  MUST merge.
- `convex/reports/phase9.ts:236-296` (or any other report aggregator
  that reads `worldRow.walls`) — switch to the joined `worldStatic`
  read. `harness/closing/phase9.ts:126-130, :355-400` likewise.

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

WP-A and WP-B are **parallelisable with an integration owner** (D15).
They touch disjoint files on the schema side (agentInputValidator vs
worldState / worldStatic — `convex/schema.ts` merge is mechanical, no
logic conflict). They also touch disjoint write/read code paths.

**BUT** `convex/runMatch.ts` is a shared integration hotspot:
- WP-A touches `:392-409` (agentInput build), `:734-850`
  (`buildAgentInputRecord` + per-agent slim wiring), `:897-1025`
  (`persistTurn` call-site shape).
- WP-B touches `:198-234`, `:676-696` (`worldByMatch` read + state
  build).

Assign **ONE engineer as final-merge owner for `convex/runMatch.ts`**.
Both WPs ship their respective tests against their own changes; the
integration owner adds an end-to-end test that builds state, calls
the LLM wrapper input, persists the new shape, recomposes round-trip,
and asserts byte-equality — a single assertion covering both WPs at
the integration surface (see §5 WP-A/WP-C test scope).

WP-C strictly depends on both — smoke can't run until both are
landed in the dev DB and the integration owner has reconciled
`convex/runMatch.ts`.

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
   - Upsert prompts via `getOrCreatePrompt(ctx, hash, kind, text)` —
     read-then-insert via `by_hash_kind` index, **with collision
     guard** (D9): existing row text must equal the candidate text or
     throw `DataIntegrityError`. Once per unique `(hash, kind)`.
   - Insert turn row with slim agentRecords.
   - Single Convex transaction (idempotent + race-free under
     Convex single-mutation serialisability).
3. `convex/llm/inputBuilder.ts`:
   - Refactor `renderStatusBlock` to take a plain status object (not
     `CharacterState` + `MatchState`).
   - `buildAgentInput` returns `{ systemPrompt, visibleStateDigest,
     status, narrativeLines, aliveCount, composedUserMessage }` —
     the rolled-up string remains for the runtime LLM call; the
     structured fields are what gets persisted. `narrativeLines`
     is the **post-filter** array (matches what the builder
     appended; no `null` slots).
   - New pure
     `recomposeUserMessage({ input, turn, displayName, prompts })`
     helper (D11 signature — `turn` mandatory). Throws on missing
     hash lookup (D12).
   - Round-trip test: every persisted-shape replay recomposes
     byte-equal to the original `composedUserMessage`, **including
     the `Turn N, M/8` line** (the failure mode if `turn` is
     omitted). Test covers blank-line preservation and section
     ordering.
4. `convex/runMatch.ts:advanceTurn`:
   - Stop persisting `systemPromptText` / `personaPromptText` /
     `composedUserMessage` on `buildAgentInputRecord`.
   - Persist `status` + `narrativeLines` + `aliveCount` instead.
   - Pass `promptTexts` separately to `persistTurn`.
5. Read-side updates (per-field forward sources from §3.4):
   - `convex/turnsDerived.ts:543-737` (delivery audits) — switch
     substring searches from `composedUserMessage` to
     `narrativeLines.some(line => line.includes(...))`. Atomic
     per-line semantics — no `join().includes()`.
   - `convex/turnsDerived.ts:227-289` (status extractors —
     `extractSelfHp` / `extractSelfEquipment` / `extractObserverPos`)
     — read from `input.status` directly; delete regex parsers.
   - `convex/turnsDerived.ts:777-798` (`visibleRectKeys`,
     `insideBearingHere`) — derive from `input.visibleStateDigest`
     (no change to digest parser shape).
   - `apps/replay/src/lib/rawPane.ts:composeUserRole` — call
     `recomposeUserMessage({ input, turn, displayName, prompts })`.
     `turn` available from the parent turn row.
   - `apps/replay/src/components/TurnFeed.tsx:240-242, :396-418`
     (`parseStatusBlockForReplay`) — read `input.status` directly;
     delete the parser.
   - `convex/replay.ts:getReplayBundle` — return a `promptsLookup`
     map alongside the existing fields (every distinct system +
     persona hash referenced by the match's turns); UI surfaces
     missing-hash as a visible error state.
   - `convex/reports/phase6.ts:118-124, :204-207, :397-407, :800-809`
     — port to recompose+JOIN OR delete the reads if phase6 reports
     are no longer active (engineer decides during WP-A; flag as
     open Q if unclear).
   - Comment-only stale cleanup: `convex/llm/personas.ts` per-turn
     `personaPromptText` reference.
   - First-class test update scope:
     `tests/integration/persistAdaptParity.test.ts`,
     `tests/turns.test.ts`, `tests/llm/inputBuilder.test.ts`,
     `tests/llm/systemPrompt.test.ts`, `tests/llm/azure.test.ts`
     (runtime-side `composedUserMessage` is unchanged; persisted-side
     shape is new), `tests/llm/useVariantContract.test.ts`,
     `tests/runMatch.test.ts`, `tests/reports/phase6.test.ts`
     (port-or-delete in lockstep with above),
     `apps/replay/src/lib/__tests__/rawPane.test.ts`,
     `apps/replay/src/components/__tests__/TurnFeed.test.tsx`,
     `apps/replay/src/lib/__tests__/vintageReplay.test.tsx`.

**Success criteria**:
- `agentRecord.input` shape matches new validator; no `systemPromptText`
  / `personaPromptText` / `composedUserMessage` fields persisted.
- `prompts` table cardinality (corrected per D13 — system prompt is
  turn-bound; cf. `convex/llm/systemPrompt.ts:5-20`,
  `tests/llm/systemPrompt.test.ts:53-68`, Phase 7 closure record):
  - Per-match: up to **~50 distinct system-prompt rows** (one per
    turn while the evac/extraction countdown changes) + **≤8
    persona rows**.
  - Cross-match steady state on same map+timing: ~58 rows total
    (50 system + ≤8 persona — turn-N system prompt is identical
    across matches).
  - Per-match write savings: ~88% (240 KB → ~30 KB on first match
    of the cohort).
  - Cohort (10-run smoke) savings: ~98% (~2.4 MB → ~30 KB system
    prompt writes; persona writes similar shape).
  - Do NOT propose stabilising the system prompt to improve dedup
    — that would be prompt-behaviour scope creep.
- **Collision-guard test**: a forced-collision unit test asserts
  `getOrCreatePrompt` throws `DataIntegrityError` when an existing
  `(hash, kind)` row has different text. Required (D9).
- **Round-trip test** (D11 signature): `recomposeUserMessage({ input,
  turn, displayName, lookup })` is byte-equal to the original
  `buildAgentInput(...).composedUserMessage` for every
  (matchId, turn, characterId) tuple in the smoke cohort, including
  the `Turn N, M/8 players alive` line, blank lines, and section
  order. Test fails if `turn` is omitted from the helper signature.
- **Missing-hash fatal test** (D12): forcing a hash to be missing
  from the lookup throws on the server-side recompose path;
  replay UI surfaces a visible error state (NOT silent fallback).
- **`projectSlimTurnRows` field-preservation tests**: covering all
  three derived field families (delivery counters,
  `visibleRectKeys`/`insideBearingHere`, status extractors).
  Includes a regression test asserting each `narrativeLines`
  element is a complete rendered line (not split across array
  entries) — delivery scans depend on per-line atomicity.
- **Integration test** (shared with `convex/runMatch.ts` owner —
  D15): builds state, calls LLM wrapper input, persists new shape
  on a real `persistTurn` call, recomposes round-trip; single
  end-to-end byte-equality assertion.
- Replay raw-pane "Full LLM Input" continues to render the same text
  it rendered pre-slice (manually verified on one replay).
- TurnFeed Status card renders identically pre/post-slice.
- Diagnostics CLI `harness/diagnostics.ts` runs to completion with
  no per-record errors and emits the three families (Critical /
  Mechanics / Behaviour) with non-zero counters where they were
  non-zero pre-slice — specifically `mechanics.ts:156-163`
  consumers continue to receive identical counters.

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
   - `convex/replay.ts:getReplayBundle` — join `worldStatic` and
     return ONE merged `worldState` field (D10 lock —
     `{ ...worldStaticRow, ...worldStateRow }`). Sibling-field is
     explicitly NOT acceptable; `Grid.tsx:77,94` reads
     `worldState?.walls` / `?.coverTiles` directly.
   - `convex/worldState.ts:byMatchId` (used by closing scripts) —
     same treatment; return merged.
   - `convex/reports/phase9.ts:236-296` — `world.walls` /
     `world.coverClusters` switch to joined `worldStatic` read.
   - `harness/closing/phase9.ts:126-130, :355-400` — directly reads
     `worldState:byMatchId` and adapts `row.walls` /
     `row.coverClusters`; switch to joined `worldStatic`.
   - `convex/reports/phase3.ts` — audit; update if it reads static
     fields.
   - Replay grid (`apps/replay/src/components/Grid.tsx` +
     `apps/replay/src/lib/reconstruct.ts:46-49, :130, :168-175`) —
     no change required if the bundle returns merged `worldState`
     (D10). Coordinate type changes if engineer overrides D10
     (NOT recommended).

**Success criteria**:
- `worldState` rows do NOT contain `walls` / `coverClusters` /
  `coverTiles` after a smoke run.
- `worldStatic` rows DO contain those fields, written once at
  match-start (`convex/matches.ts:225-229` rewires to insert both
  tables).
- `runMatch.advanceTurn` reads `worldStaticByMatch` once per turn
  invocation alongside the slim `worldByMatch` (D5 / D14 — per-turn
  double-read; Convex action chain is stateless across
  `scheduler.runAfter`, so true once-per-chain requires a chain
  refactor — explicitly deferred, see §9).
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
2. Bandwidth bench (reframed per D14 + reviewer condition 8):
   - Pick ONE pre-wipe sample match (or use a typed fixture); record:
     - `persistTurn` payload size (sum of stringified
       `agentRecords[]` bytes — the persisted-row shape).
     - **Combined per-turn world-read payload**: stringified
       `worldByMatch` + stringified `worldStaticByMatch` byte sum.
       (NOT slim `worldByMatch` alone — that would overstate the
       win because `worldStaticByMatch` still ships per scheduled
       turn under the action chain.)
   - Run ONE post-wipe match; record the same metrics on the new
     shape (post-wipe has 0 `worldStaticByMatch` because pre-wipe
     used the unified table — so the comparison is pre-wipe full
     `worldByMatch` vs post-wipe `(worldByMatch + worldStaticByMatch)`).
   - **Per-match prompt-write bench** (cross-match dedup): on the
     10-run smoke, record (a) cumulative `prompts` table rows, (b)
     total `persistTurn` bytes across all matches. Compare against
     the pre-wipe baseline cohort to validate the ~98% cohort
     savings claim.
   - Document before/after numbers in the closure record. Claims to
     validate (re-stated per D13/D14):
     - `persistTurn` per-row shape drops ≥ 60% on persisted bytes
       (driven by `composedUserMessage` + `*PromptText` removal).
     - **Combined** per-turn `worldByMatch + worldStaticByMatch`
       payload drops ≥ 80% versus the pre-wipe single-read
       `worldByMatch` payload.
     - Cohort prompt-write bandwidth drops ~98% across 10 runs on
       the same map+timing.
3. 10-run smoke at `--reasoning low --maxOutputTokens 1200` (phase-9
   baseline). Inspect via the diagnostics CLI:
   - **Pass/fail bars (gating)**:
     - Zero engine crashes (`failedMatches: 0`).
     - Zero whole-turn validator zeroes.
     - Extraction > 0, kill > 0, equip > 0, speech > 0 across the
       cohort (behaviour-directionally-intact — NOT held to
       phase-9 closing thresholds).
     - All 8 personas active (per-persona turn-records > 0).
     - No `Player_N` literal regressions in any persisted surface.
     - No `Chest_NNN` literal regressions in any persisted surface.
   - **Data-only drift metrics (NOT gated)** — record alongside the
     pass/fail bars so a severe regression is visible even without
     a hard gate. User can override before closure if drift looks
     pathological:
     - Extraction-rate per match.
     - Kill-rate per match.
     - Equip-rate per match.
     - Speech-rate per match.
     - Alive-at-T-25 distribution.
     - Comparable Phase 7/9 values noted alongside for context.
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
   the closure record show:
   - ≥ 60% drop on `persistTurn` per-row persisted bytes.
   - ≥ 80% drop on **combined** per-turn world-read payload
     (`worldByMatch` + `worldStaticByMatch`, NOT slim-`worldByMatch`
     alone — D14).
   - ~98% drop on cumulative prompt-write bandwidth across the
     10-run cohort (cross-match dedup; matches Reviewer 2 corrected
     math under D13).
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
   - Rationale (reframed per reviewer pass): the structured field
     captures the EXACT rendered status block at decision time, and
     replaces the regex parsers at
     `convex/turnsDerived.ts:227-289` (`extractSelfHp` /
     `extractSelfEquipment` / `extractObserverPos`) AND the separate
     `parseStatusBlockForReplay` in
     `apps/replay/src/components/TurnFeed.tsx:396-418`. The earlier
     "avoid server-side history walk" framing was wrong — both
     parsers operate on the persisted `composedUserMessage` blob,
     not on history. The real value is **eliminating the parsers**
     (code-debt removal) and **byte-equal user-role reconstruction
     without a state-walk race risk** (pillar 1).
   - Override signal: user prefers "pure derive at read time" —
     engineer drops the `status` field and the replay UI / CLI walk
     character history. Trade-off: re-introduces regex parsers,
     no schema additions.

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
   - Lock: per-turn double-read. **Honest framing** (reviewer-
     reframed): this is NOT once-per-chain — `worldStaticByMatch`
     still runs per scheduled `advanceTurn` invocation. The remaining
     static-read cost is real and must be documented in the WP-C
     bench as combined `worldByMatch + worldStaticByMatch` payload
     (D14).
   - Rationale: Convex action chains are stateless across
     `scheduler.runAfter` reschedules. True once-per-chain requires
     a chain refactor (load terrain into an in-action turn loop
     that eliminates `scheduler.runAfter` between turns) — explicitly
     deferred (§9).
   - Override signal: user wants a real once-per-chain — engineer
     scopes a separate slice for the chain refactor (not this slice;
     out of scope unless user lifts the cap).

7. **WP-A bundles A+B from the cucumber (D6 — locked).** The
   `composedUserMessage` drop is a structural fall-out of prompt
   dedup (the rolled-up string adds nothing once its constituents
   are persisted). Bundling A+B in WP-A keeps the persisted-shape
   change atomic — engineers don't ship a transitional state where
   prompts are deduped but `composedUserMessage` still ships.
   Override signal: none expected.

8. **WP-A + WP-B parallelism with integration owner (D15).** See §4
   dependency map and §8 sequence. The disjoint-files claim was
   incorrect; both WPs touch `convex/runMatch.ts` at non-overlapping
   line ranges but the same file. Final-merge owner reconciles the
   shared file and ships an end-to-end integration test.

9. **Collision-guarded `getOrCreatePrompt` (D9).** Cross-match scope
   (D3) amplifies the blast radius of any silent hash collision. The
   `getOrCreatePrompt` helper MUST verify `existing.text === text`
   when an existing `(hash, kind)` row is found, throwing
   `DataIntegrityError` on mismatch. A forced-collision unit test
   pins the branch.
   - Override signal: user prefers SHA-256 — engineer swaps to
     `node:crypto` SHA-256 hex; collision guard remains as
     belt-and-braces (cheap; preserves the integrity invariant).

10. **Merged `worldState` bundle from `getReplayBundle` (D10).** The
    replay bundle returns one merged `{ ...worldStaticRow,
    ...worldStateRow }` `worldState` field. Sibling-field is NOT
    acceptable — `apps/replay/src/components/Grid.tsx:77,94` reads
    `worldState?.walls` / `?.coverTiles` directly; a sibling-field
    shape would silently render an empty map. Locked, not engineer
    choice.

11. **`recomposeUserMessage` requires `turn` (D11).** The helper
    signature is `recomposeUserMessage({ input, turn, displayName,
    prompts })`. Reason: `buildAgentInput` renders
    `Turn ${state.turn}, ${aliveCount}/8 players alive`
    (`convex/llm/inputBuilder.ts:632-644`); without `turn` from the
    parent turn row, byte-equality round-trip tests fail. Engineers
    sourcing `turn` from the parent `turns` row at every call site.

12. **Missing-prompt-hash is FATAL (D12).** Forward-only POC posture
    (no migration shims) means an unresolved hash on any persisted
    agentRecord is data corruption, not graceful legacy. Server-side
    recompose throws; replay UI surfaces a visible error state. NO
    silent fallback, NO sentinel return.

13. **System-prompt cardinality is per-distinct-hash, NOT 1+8
    (D13).** `buildSystemPrompt(turn)` is turn-bound (countdown line
    changes each turn). True cardinality: ~50 distinct system rows
    per match (one per turn while countdown ticks), ~58 cross-match
    steady state. Per-match write savings ~88%; cohort savings ~98%.
    Bench math reframed accordingly (see §5 WP-C). Do NOT propose
    stabilising the system prompt — prompt-behaviour scope creep.

14. **WP-B bench measures COMBINED world payload (D14).** The
    bandwidth bench compares pre-wipe single-read `worldByMatch`
    against post-wipe `worldByMatch + worldStaticByMatch` per turn.
    Slim-`worldByMatch`-alone would overstate the win. True
    once-per-chain savings are deferred to a separate slice (§9).

15. **`convex/runMatch.ts` integration owner (D15).** WPs touch
    non-overlapping line ranges in the same file (WP-A: `:392-409`,
    `:734-850`, `:897-1025`; WP-B: `:198-234`, `:676-696`). ONE
    engineer takes final merge responsibility and ships the
    end-to-end integration test. See §4 and §8.

16. **`projectSlimTurnRows` forward sources by field family (D16).**
    Not a single "scan narrativeLines" sweep — three distinct
    forward sources per the table in §3.4.1: delivery audits →
    `narrativeLines.some(...)`; visible-rect/inside-bearing →
    `visibleStateDigest`; status extractors (`selfHp`,
    `selfEquipment`, `observerPos`) → `input.status`. Focused tests
    cover all three families.

## 8. Recommended Job Sequence

1. **PM records this spec v2 as the canonical artifact** for phase 11
   (replaces v1; review v1 conditions folded in).
2. **PM nominates `convex/runMatch.ts` integration owner (D15)**
   BEFORE dispatching WPs. The owner is one of the WP engineers
   (recommended: WP-A engineer, since the persistTurn call-site
   reshape is the larger surface) and holds final-merge
   responsibility for `convex/runMatch.ts` plus the end-to-end
   integration test.
3. **Engineer dispatches WP-A and WP-B in parallel** (separate
   worktrees recommended). WPs touch disjoint files on the schema
   and write-path sides; `convex/schema.ts` and `convex/runMatch.ts`
   are the two shared surfaces and merge mechanically (schema:
   additive tables + disjoint validator field-sets;
   `runMatch.ts`: non-overlapping line ranges per §4). Each WP
   follows TDD inside its scope:
   - WP-A first tests: schema-mirror parity, collision-guard unit
     (D9), recompose round-trip including `Turn N` line (D11),
     missing-hash fatal (D12), `projectSlimTurnRows` field
     preservation (D16).
   - WP-B first tests: matchState merge correctness, bundle-merge
     shape for `getReplayBundle` (D10), terrain-byte-equivalence.
4. **Integration owner rebases WP-A + WP-B** onto a single branch.
   Resolves `convex/schema.ts` and `convex/runMatch.ts` mechanical
   merges; runs the end-to-end integration test (state build →
   LLM input → persist → recompose round-trip → byte-equality
   assertion).
5. **WP-C runs after** the rebase: dev DB wipe, smoke (with
   data-only drift metrics per §5 WP-C), combined-payload bandwidth
   bench (D14), gates, closure record.
6. **No completion review required** for this slice. POC posture
   + small scope + 10-run smoke is the agreed bar. A user
   step-through of one replay match is the manual UAT. Data-only
   drift metrics surface to the user; user can override before
   closure if drift looks pathological.
7. **`/ultrareview` is optional** at the user's discretion — flag
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
- Once-per-chain world-static read (see §7.6 + §7.14 D14 — Convex
  action chain is stateless across `scheduler.runAfter`; true
  once-per-chain requires a chain refactor that loads terrain into
  an in-action turn loop. Explicitly deferred until a separate
  slice scopes that explicitly. The combined `worldByMatch +
  worldStaticByMatch` per-turn double-read is the floor for this
  slice).
- SHA-256 hash upgrade for the prompts table (see §7.1 — DJB2-32 is
  POC-acceptable).
- Any scope creep onto phase-10's body-collision + overseer-v0-
  refinement work.

## 10. Cross-references

- North Star: planning brief in this conversation; canonical user
  intent capture.
- v1 plan review: [`REVIEW-v1.md`](./REVIEW-v1.md) — three-reviewer
  consolidated pass (2× APPROVE-WITH-CONDITIONS + 1× REQUEST-REVISION).
  This v2 folds all 10 binding conditions plus reviewer 2 supplemental
  notes (file-ref corrections, Lock-D10 merged-bundle, per-line
  round-trip trace).
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
