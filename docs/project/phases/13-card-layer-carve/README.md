# Phase 13 — Card Layer Carve

> **Status:** Spec dispatched 2026-05-16. Planning architect artifact.
> Deliberately thin foundation: **Cards, NOT accounts**. The substrate-
> proof harness and its locked 8-persona union stay UNTOUCHED — the Card
> path is strictly parallel. POC posture applies (schema break + Convex
> dev-state reset authorised; no migration shims; single forward shape).
> Standard gates (lint, ts:check, build, test) must pass; validation bar
> is unit + integration coverage of the Card path PLUS a harness-parity
> regression proof (NOT a closing report).
>
> Canonical anchors:
> - [`mental-model.md` §12](../../spec/mental-model.md#12-player-facing-meta--the-card-the-matchmaking-facade-seasons) — the binding why-layer (the card is the unit, not the account; presets are forkable on-ramps; closed harness and open pool are two consumers of one engine)
> - [`mental-model.md` §5](../../spec/mental-model.md#5-core-emotional-loop) — prize split / emotional anchor
> - [`mental-model.md` §10](../../spec/mental-model.md#10-iteration-discipline-load-bearing-intent) — POC posture, proof-artifact discipline
> - [`mental-model.md` §6 pillars 6 & 7](../../spec/mental-model.md#6-design-pillars) — substrate-not-band-aid; state is the contract
> - [`concept-spec.md` §5](../../spec/concept-spec.md#5-win-condition-and-scoring) — win condition & scoring (unchanged)
> - North Star (planning brief, this thread) — the explicit scope cap the user locked

---

## 1. Purpose

Today a character is a throwaway persona instance locked to 8 hardcoded
archetypes. Nothing persists across matches; there is no way to run a
match from chosen competitors. The product's real persistent unit is the
**Card**: an agent name, a prompt, and a progression placeholder, that
*may or may not* carry an owner — and the Card is the **ranked unit**
(mental-model §12).

This phase introduces the Card as the first-class, account-optional
persistent unit and lets a match be triggered from an explicit array of
exactly 8 Card ids — decoupling player identity from the locked
8-persona substrate **without touching the substrate-proof harness**.

This is the deliberately thin foundation the later matchmaking facade,
accounts, seasons, and unlockable prompt segments will sit on. None of
those are built here.

> **North-star filter test** (mental-model §7): *does this make
> prompt-authored behaviour more interesting, legible, or exploitable?*
> Indirectly **yes** — the Card is the unit a player iterates a mind on
> across matches, and per-Card prize-per-match makes prompt quality
> legible and accumulable. The pillars directly served are §12 (the card
> is the unit) and §6.7 (state is the contract — the persistent unit
> becomes a first-class row, not a per-match throwaway).

---

## 2. Overview — what is being built

Five additive moves, one parallel path, **zero changes to the harness
path**:

### 2.1 `cards` table — the persistent first-class unit

A new table holding agent name + prompt (by content hash) + a thin
progression placeholder + the persistent accumulators. **No owner/user
ref field exists** — the Card substrate is coherent with no account
attached; accounts are a later era (north-star OUT OF SCOPE). A
`lineagePersonaId` (within the locked union) is a telemetry/seed tag,
NOT the prompt-load key (see §3 for the design tension resolution).

### 2.2 Preset pool seed + unbounded pool

A one-time seed inserts the 8 current presets as Cards (`isPreset:
true`, `agentName = titleCase(personaId)`, prompt = the inline persona
body). A `cards.create` mutation appends arbitrary additional Cards —
the pool size is unbounded. Preset *forkability* is noted for later but
**NOT built** (north-star).

### 2.3 `matches.startFromCards` — the explicit-8 trigger (parallel)

A NEW mutation, parallel to the untouched `matches.start`. Validates
`cardIds.length === 8` exactly — **no auto-draw, no backfill, no lobby
facade** (that is the deferred facade era, mental-model §12). It mirrors
`matches.start`'s map/world/spawn structure but binds each character to
a Card and **snapshots the Card's prompt hash at match time** (trace
integrity — §3.3).

### 2.4 Per-Card persistent accumulation

On terminal completion of a Card-triggered match, a parallel
accumulation step accrues to each drawn Card: `prizeUnitsWon`,
`matchesPlayed` (denominator = every match drawn into, incl. early
death), `kills`, `deaths`, `wallFaceSlams`. Idempotent against scheduler
replay via a sentinel table (§3.4). Prize-per-match (`prizeUnitsWon /
matchesPlayed`) and K/D are *derivable*, not stored. **No leaderboard
UI, no seasons tooling, no accounts** (north-star).

### 2.5 Harness-parity guarantee

`matches.start`, `characters.personaId` semantics, `runs`/`reports`
schema and aggregation, the per-turn loop's harness branch, and the
harness's trigger/read contract all remain behaviourally identical. A
regression test proves a `matches.start` run is unchanged.

---

## 3. Architecture Design

### 3.0 Current-state trace (the substrate this carve is parallel to)

- **`matches.start`** (`convex/matches.ts:193`) — the *only* current
  trigger. Inserts `matches`, expands the reference map →
  `worldStatic`/`worldState`, computes
  `assignPersonasToSpawnsInline(rngSeed, PERSONA_IDS)` (deterministic
  Fisher–Yates over the **locked 8**), inserts 8 `characters`
  (`personaId` from the locked union, `displayName =
  titleCase(personaId)`), schedules `runMatch.advanceTurn`.
- **Per-turn loop** (`convex/runMatch.ts:762`) — `loadPersonas()`
  returns `Record<PersonaId,string>`; `personas[actor.personaId]` →
  persona text → LLM. `personaPromptHash = hashHex(text)`. Prompt text
  is hash-deduped into the `prompts` table (`kind:"persona"`) by
  `persistTurn` (Phase 11).
- **`characters.personaId`** (`convex/schema.ts:1006`,
  `personaIdValidator`) is doing **double duty**: (a) prompt-load key
  (`loadPersonas()[personaId]`) and (b) telemetry/aggregation key
  (`runs.perPersona[]` keyed by it; `reports` per-persona; the
  substrate-proof differentiation metric).
- **Prize model** (`convex/runMatch.ts:1018-1047`) — `PRIZE_POOL=100`;
  sole survivor → 100; else `floor(100/extractors)` each; written to
  `matches.outcome.pointsByCharacter[] = {id, points}`. Already
  per-character.
- **Harness** (`harness/run.ts`) triggers `matches:start` with only
  `{ reasoningEffort }` and reads `runs`/`reports`.

### 3.1 The core design tension and its resolution

`characters.personaId` is overloaded (prompt-load AND telemetry). A Card
carries its *own* prompt (not a preset's) and is NOT a member of the
locked union. Naively widening `personaId` would break the harness's
closed union and `runs`/`reports`.

**Resolution — separate the two duties; keep the substrate uniform
(pillar 6, mental-model §10 "player-perspective substrate"):**

| Duty | Harness path (untouched) | Card path (new, parallel) |
|---|---|---|
| Prompt-load key | `loadPersonas()[personaId]` (hot-loadable, per WP9) | pinned `characters.cardPromptHash` → `prompts` table join |
| Telemetry/aggregation key | `characters.personaId` (locked union) | `characters.personaId` = `card.lineagePersonaId` (still within the locked union) |
| Product identity / ranked unit | n/a (throwaway) | the `cards` row |

`characters.personaId` **keeps its locked-union type and its
telemetry/aggregation meaning unchanged**. For a Card-backed character
it is filled from the Card's `lineagePersonaId` (a tag, always one of
the 8) so `runs`/`reports`/the differentiation metric continue to work
**without a single line of change**. The prompt-load duty is the only
one that branches, keyed on the presence of `characters.cardId`.

This is the "Card carries a persona lineage tag for prompt-load +
telemetry continuity while the harness keeps running the closed fixture"
that the assignment names — made concrete.

### 3.2 Schema changes (POC: forward-only, dev-state wipe)

**New table `cards`:**

```
cards: {
  agentName: v.string(),                 // free-form; NOT the locked union
  promptHash: v.string(),                // current prompt; text lives in `prompts` (kind:"persona"), hash-deduped
  lineagePersonaId: personaIdValidator,  // telemetry/seed tag — within the locked union (NOT prompt-load)
  progression: v.object({ level: v.number(), xp: v.number() }),  // thin placeholder ONLY
  // ── persistent accumulators (the ranked + vanity unit) ──
  prizeUnitsWon: v.number(),
  matchesPlayed: v.number(),             // denominator = every match drawn into, incl. early death
  kills: v.number(),
  deaths: v.number(),
  wallFaceSlams: v.number(),
  isPreset: v.boolean(),                 // true for the 8 seeded presets
  createdAt: v.number(),
  // NO userId / owner ref — accounts are a later era (north-star OUT OF SCOPE).
}.index("by_lineage", ["lineagePersonaId"])
```

Prize-per-match (`prizeUnitsWon / matchesPlayed`) and K/D are
*derivable* — deliberately not stored (no leaderboard surface here).

**New sentinel table `cardAccruals`** (idempotency anchor — §3.4):

```
cardAccruals: { matchId: v.id("matches") }.index("by_match", ["matchId"])
```

**`characters` additive fields** (absent on the harness path):

```
cardId: v.optional(v.id("cards")),       // present IFF Card-triggered
cardPromptHash: v.optional(v.string()),  // SNAPSHOT of the Card's prompt hash at match time
```

`characters.personaId` / `displayName` **unchanged in type**. For Card
characters: `personaId = card.lineagePersonaId`; `displayName =
card.agentName` (the agent name is the product identity — consistent
with the substrate already naming agents "Duelist" rather than
`Player_N`; see Ambiguity A2 for the `Player_N` integration check).

`prompts`, `matches`, `turns`, `worldStatic`, `worldState`, `runs`,
`reports` schemas: **untouched**.

### 3.3 Trace integrity — snapshot, not live pointer

Research-confirmed canonical pattern: persist the **content-hash
reference per match-record**, dedup the text content-addressably; the
card→current-prompt pointer is for live gameplay only, never replay.

The codebase already has the content-addressed store (`prompts` table,
hash-deduped) and the per-record hash plumbing
(`agentRecord.input.personaPromptHash`). This phase makes it
Card-trace-integral:

1. `matches.startFromCards` resolves each Card's current `promptHash`,
   ensures the text row exists in `prompts` (`kind:"persona"`,
   idempotent get-or-create — same path Phase 11 uses), and **pins
   `characters.cardPromptHash` at character-insert time**.
2. The per-turn loop, for a Card character, loads persona text from the
   **pinned `cardPromptHash`** (via the `prompts` table), NOT from
   `card.promptHash` (which may have since evolved) and NOT from
   `loadPersonas()`.
3. A later `cards.promptHash` edit creates a new `prompts` row and
   repoints only the Card. Every already-created character keeps its
   pinned hash → **past replays are never rewritten** (north-star
   acceptance; mental-model §12).

`agentRecord.input.personaPromptHash` will therefore equal the pinned
`cardPromptHash` for Card characters — trace self-containment holds with
zero agentRecord schema change.

### 3.4 Per-Card accumulation — pure aggregator + sentinel idempotency

Research-confirmed: one match event fans out to 8 Card aggregates →
pattern (a), a sentinel/marker table keyed by `sourceId` (matchId),
written in the same mutation as the increments. This mirrors the
existing `runs.aggregate` idempotency-by-row-existence exactly.

- **Pure aggregator** in the engine layer
  (`convex/engine/cardStats.ts`, zero Convex deps, unit-tested —
  mirrors `runStats.ts`): given the turns ledger + characters +
  `matches.outcome.pointsByCharacter`, returns per-Card deltas:
  - `prizeUnitsWon` += this match's `pointsByCharacter` for the Card's
    character (concept-spec §5 model — unchanged).
  - `matchesPlayed` += 1 for **every** drawn Card (incl. characters
    that died turn 2 — the denominator that can't be out-grinded,
    mental-model §12).
  - `kills` += per-character kill credit (reuse the `runStats` kill-
    attribution logic / extract a shared helper — see D3).
  - `deaths` += 1 if the character died (`diedAtTurn` set).
  - `wallFaceSlams` += count of `resolution.moves[].bodyCollision.kind
    === "wall"` for the character — the charge body-collision-into-wall
    (the product "wall face-slam"). Explicitly **distinct from**
    `resolution.moves[].blockedBy === "wall"` (a merely blocked step,
    NOT counted).
- **Writer** `cards.accrueFromMatch({ matchId })` (default runtime,
  mirrors `runs.aggregate`): bail if `cardAccruals` row exists
  (idempotent); bail if match not `completed` or has no Card-backed
  characters; else compute deltas via the pure aggregator, patch each
  Card row, insert the `cardAccruals` sentinel — all in one mutation.
- **Schedule**: `runMatch.advanceTurn`'s terminal branch
  (`convex/runMatch.ts:1116`) currently schedules `runs.aggregate`.
  Add a second `scheduler.runAfter(0, api.cards.accrueFromMatch, {
  matchId })`. `runs.aggregate` is unconditional (harness needs it);
  `cards.accrueFromMatch` self-guards on Card presence so the harness
  path schedules a cheap no-op. (Decision D5: schedule unconditionally +
  self-guard, vs. branch on Card presence at schedule site — see §7.)

### 3.5 Per-turn loop — the single branch point

`convex/runMatch.ts` ~L786. Current:

```
const personaText = personas[actor.personaId as PersonaId] ?? "";
```

Becomes (additive branch; harness path byte-identical):

```
const personaText = actor.cardPromptHash
  ? <prompts-table text for actor.cardPromptHash, kind:"persona">
  : personas[actor.personaId as PersonaId] ?? "";
```

The pinned-hash text is fetched once during match-state build
(`buildMatchState`) and threaded onto the in-memory actor, so the
per-turn hot loop stays a map lookup (no extra per-turn DB read; bounded
by ≤8 distinct hashes per match). When `cardPromptHash` is absent (every
harness character) the expression is exactly today's — the harness path
is provably unchanged.

### 3.6 Data flow

```
Card pool (cards table, ≥8, unbounded)
        │  caller picks EXACTLY 8 ids (no auto-draw / backfill / lobby)
        ▼
matches.startFromCards({ cardIds[8] })
        │  validate length===8 ; resolve each card.promptHash
        │  get-or-create prompts row (kind:persona) per distinct hash
        │  insert matches/worldStatic/worldState (mirrors matches.start)
        │  seeded shuffle of the 8 cards over spawn indices
        │  insert 8 characters {cardId, cardPromptHash(PINNED),
        │     personaId=card.lineagePersonaId, displayName=card.agentName}
        │  schedule runMatch.advanceTurn
        ▼
runMatch.advanceTurn (SHARED loop; single branch on cardPromptHash)
        │  Card char → pinned-hash prompt ; harness char → loadPersonas()
        │  ... unchanged resolution / persistTurn / prompts dedup ...
        ▼  terminal
   schedule runs.aggregate (unchanged)  +  schedule cards.accrueFromMatch
                                                   │  sentinel-guarded
                                                   ▼
                                   patch 8 cards: prizeUnitsWon,
                                   matchesPlayed, kills, deaths,
                                   wallFaceSlams ; insert cardAccruals
```

Harness path (`matches.start`) flows down the **same shared loop** with
`cardPromptHash` absent → identical behaviour; `cards.accrueFromMatch`
self-guards to a no-op.

---

## 4. Dependency Map (parallelisation)

```
WP1 (schema + cards CRUD + preset seed)        ── foundational, blocks all
   │
   ├──▶ WP2 (matches.startFromCards + pinning)  ─┐
   │                                             ├─ WP2 ∥ WP3 (independent
   ├──▶ WP3 (cardStats aggregator + accrual)    ─┘  modules; both depend
   │        (pure engine module can START in        only on WP1's schema)
   │         parallel with WP1 finalising —
   │         define shapes first)
   │
WP2 + WP3 ──▶ WP4 (per-turn loop branch + wiring + harness-parity proof)
   │                                  (needs the pinned field from WP2
   │                                   and the accrual writer from WP3)
   │
WP4 ──▶ WP5 (integration vertical slice + closure)
```

- **WP2 ∥ WP3** is the real parallelism: once WP1 locks the `cards`
  schema and the pure-aggregator input/output type, the trigger
  mutation and the accrual aggregator are independent surfaces with no
  shared code (WP3's engine module has zero Convex deps, mirroring the
  `runStats.ts` boundary). Two engineers can take WP2 and WP3
  concurrently.
- WP3's **pure aggregator** (`convex/engine/cardStats.ts`) can be
  TDD-started against the type contract before WP1's Convex schema is
  even pushed — it's a pure function over plain row shapes.
- WP4 is the only place the shared per-turn loop is touched and is the
  serialisation point + the harness-parity gate.

---

## 5. Work Package Breakdown (UAT vertical-slice)

Each WP is TDD: tests first (red), minimal implementation (green),
refactor. Testing trophy: unit = pure aggregator / validators;
integration = the trigger + accrual mutations and the shared-loop
branch; the vertical slice (WP5) is the user-journey proof.

### WP1 — `cards` schema, CRUD, preset seed

**Scope:** `cards` + `cardAccruals` tables; `characters.cardId` /
`cardPromptHash` optional fields; `cards.create` mutation;
`cards.seedPresets` one-time mutation; `cards.get` / `cards.list`
queries.

**Success criteria:**
- Schema compiles; `npx convex dev` pushes against a wiped dev DB
  (POC — no migration shim).
- `cards.seedPresets` inserts exactly 8 rows: `isPreset:true`,
  `agentName === titleCase(personaId)`, `promptHash ===
  hashHex(PERSONAS_INLINE[personaId])`, `lineagePersonaId === personaId`,
  all accumulators `0`, `progression {level:1,xp:0}` (placeholder).
  Re-running `seedPresets` is idempotent (no duplicate preset rows).
- `cards.create` appends an arbitrary Card (pool unbounded); a created
  Card is a valid first-class row with NO owner ref and is queryable.
- `cards.create` writes/get-or-creates the prompt text into `prompts`
  (`kind:"persona"`) and stores its hash on the Card.
- Unit tests: a Card with no account ref is valid & rankable-shaped;
  pool may exceed 8.

### WP2 — `matches.startFromCards` + prompt-hash pinning

**Scope:** the parallel trigger mutation; per-character Card binding +
prompt-hash snapshot. Reuses (does not fork) the map/world/spawn helpers
already inline in `convex/matches.ts`.

**Success criteria:**
- `matches.startFromCards({ cardIds })` **rejects** any `cardIds.length
  !== 8` (explicit error — no auto-draw/backfill). Rejects unknown card
  ids.
- Creates the same `matches`/`worldStatic`/`worldState` shape as
  `matches.start`; the 8 cards are seed-shuffled over spawn indices
  deterministically (same `rngSeed` → same mapping).
- Each character row: `cardId` set, `cardPromptHash` pinned to the
  Card's prompt hash **at trigger time**, `personaId =
  card.lineagePersonaId`, `displayName = card.agentName`. The prompt
  text row exists in `prompts` before `advanceTurn` is scheduled.
- Trace-integrity test: start a Card match; edit the Card's prompt
  (new hash); assert the in-flight/created character's `cardPromptHash`
  is unchanged and resolves to the *original* text.
- Schedules the same `runMatch.advanceTurn`.

### WP3 — `cardStats` pure aggregator + `cards.accrueFromMatch`

**Scope:** `convex/engine/cardStats.ts` (pure, zero Convex deps, unit-
tested — `runStats.ts` sibling) + `cards.accrueFromMatch` writer +
`cardAccruals` sentinel.

**Success criteria:**
- Pure aggregator unit tests cover: prize from
  `outcome.pointsByCharacter` (sole-survivor 100 and even-split per
  concept-spec §5 — model unchanged); `matchesPlayed` +1 for **all 8**
  incl. a turn-2 death; `kills` per attribution; `deaths` on
  `diedAtTurn`; `wallFaceSlams` counts `bodyCollision.kind==="wall"`
  and **excludes** `blockedBy==="wall"` (explicit both-cases test).
- `cards.accrueFromMatch` is idempotent: second invocation on the same
  matchId is a no-op (sentinel guard); concurrent/replayed schedule
  cannot double-count.
- No-ops (returns null, writes nothing) when the match is not
  `completed` or has no Card-backed characters.
- After accrual, each Card's accumulators reflect the match;
  prize-per-match and K/D compute correctly from stored values.

### WP4 — per-turn loop branch + scheduling wiring + harness-parity proof

**Scope:** the single `cardPromptHash` branch in the shared loop;
fetch-pinned-text in `buildMatchState`; schedule
`cards.accrueFromMatch` on terminal; the harness-parity regression.

**Success criteria:**
- Card characters drive the LLM with their **pinned** prompt text;
  `agentRecord.input.personaPromptHash` equals the pinned
  `cardPromptHash`.
- **Harness-parity proof (the gate):** a `matches.start` run produces
  agentRecords / `prompts` rows / `runs` row / `reports` aggregation
  byte-for-byte equivalent to pre-change for the same `rngSeed`; no
  `cardId`/`cardPromptHash` present on any harness character;
  `cards.accrueFromMatch` is a no-op for the harness match. Encoded as
  an automated regression test.
- `harness/run.ts` and `matches.start` are untouched (diff proof).
- `runs.aggregate` scheduling/behaviour unchanged.

### WP5 — integration vertical slice + closure

**Scope:** end-to-end: seed pool → add a 9th+ Card → trigger from an
explicit 8 → run → assert per-Card accumulation & trace integrity →
closure doc.

**Success criteria (UAT vertical slice — the north-star cucumber):**
- Pool seeded with 8 presets; ≥1 extra Card added → pool > 8.
- A match triggered with an explicit array of exactly 8 card ids runs
  those 8 as its characters; each character snapshots its Card's prompt
  hash.
- Prize/ladder accrues to the Card per concept-spec §5; `matchesPlayed`
  counts every match drawn into incl. early death; vanity totals
  (kills, deaths, wallFaceSlams) accumulate; prize-per-match & K/D
  derivable.
- Substrate-proof harness still runs on the locked persona union,
  unchanged (re-assert WP4 gate at integration scope).
- Closure doc records evidence + any residual decisions.
- All standard gates green (lint, ts:check, build, test).

---

## 6. Assignment-Level Success Criteria

1. A `cards` concept exists, decoupled from `personaIdValidator`,
   coherent with **no** account ref; the ranked unit is the Card.
2. The 8 presets seed the pool; pool size unbounded; preset
   forkability noted but NOT built.
3. A match triggers from an explicit array of **exactly 8** Card ids;
   no auto-draw, no backfill, no lobby/facade.
4. Each match character snapshots the Card's prompt hash/version (no
   live pointer); later Card evolution never rewrites past replays;
   reuses the existing hash-dedup `prompts` table.
5. Prize model unchanged from concept-spec §5.
6. Per-Card persistent accumulation: `prizeUnitsWon`, `matchesPlayed`
   (every match drawn into, incl. death), `kills`, `deaths`,
   `wallFaceSlams` (the `bodyCollision.kind==="wall"` charge,
   distinguished from `blockedBy==="wall"`). Prize-per-match & K/D
   derivable. No leaderboard UI, no seasons tooling, no accounts.
7. The substrate-proof harness and its 8-persona closed union remain
   UNTOUCHED; the Card path is parallel (proven by the WP4 gate).
8. POC posture honoured: schema break + dev-state reset; no migration
   shims; single forward shape.

OUT OF SCOPE (mental-modelled for later, NOT built, must not leak in):
user/account entity, matchmaking lobby UX + searching/countdown facade,
async auto-draw/backfill, unlockable prompt segments, seasons reset
tooling, leaderboard/replay UI changes.

---

## 7. Ambiguities & Decisions Needed

- **A1 — `matchesPlayed` for failed matches.** North-star says "every
  match the Card was drawn into, including early death". `runs.aggregate`
  refuses non-`completed` matches; `cards.accrueFromMatch` mirrors that.
  **Proposed default:** accrue (incl. `matchesPlayed`) only on
  `status==="completed"`; a *failed* match (engine crash, not an
  in-match death) does NOT increment `matchesPlayed` — it is a substrate
  failure, not a play. Early *death* in a completed match DOES count.
  **Decision needed:** confirm failed-match exclusion.
- **A2 — `displayName = card.agentName` reaching LLM context.**
  `displayName` feeds `<Player Name>` substitution
  (`convex/llm/azure.ts:146`) and interacts with
  `PERSONA_DISPLAY_NAMES`, the `playerNLiteralCount` diagnostic, and
  `Corpse_Player_N` id-normalisation (`convex/llm/idNormalisation.ts`).
  Using a free agent name is consistent with the substrate (agents are
  named, not `Player_N`). **Decision needed / WP2 must verify:** does
  id-normalisation derive `Player_N` from `spawnIndex` (safe) or from
  `displayName` (would break with free names)? If the latter, keep
  `displayName` engine-derived and surface `agentName` only at the
  product layer. **Proposed:** WP2 spikes this first; default to
  agentName→displayName if id-norm is spawnIndex-derived.
- **A3 — Accrual scheduling site (D5).** Schedule
  `cards.accrueFromMatch` unconditionally (self-guards on Card
  presence) vs. branch at the schedule site on Card presence.
  **Proposed:** unconditional + self-guard — keeps the terminal branch
  uniform and the harness path's no-op is one cheap indexed read
  (consistent with `runs.aggregate`'s own self-guard pattern).
- **A4 — `kills` attribution reuse (D3).** `runStats.ts` already
  computes per-persona kill credit. **Proposed:** extract a shared
  per-character kill-attribution helper into the engine layer so
  `runStats` and `cardStats` agree by construction (DRY; avoids a
  second, divergent attribution rule). WP3 owns the extraction;
  `runStats` behaviour must stay identical (covered by its existing
  tests).
- **A5 — `deaths` and environmental death.** North-star lists `deaths`
  as a vanity stat without qualifying combat vs. environmental.
  **Proposed:** `deaths` = character has `diedAtTurn` set (any death,
  incl. telefrag/environmental) — simplest, matches "deaths" plainly;
  K/D stays a play-style signal, not the ranked metric. **Decision
  needed:** confirm environmental deaths count toward `deaths`.

---

## 8. Recommended Job Sequence

1. **Plan review FIRST** (this spec) — the harness-parity claim and the
   `personaId` double-duty resolution are load-bearing; cheap to
   correct on paper, expensive after WP4. Resolve A1/A2/A5 (one-line
   user confirmations) before WP2/WP3 dispatch.
2. **WP1** (foundational, single owner) — unblocks everything.
3. **WP2 ∥ WP3** (two owners, concurrent) — independent surfaces once
   WP1's schema + aggregator type contract are locked. WP3's pure
   aggregator can begin TDD against the type contract immediately.
4. **WP4** (single owner; serialisation point) — the only shared-loop
   touch; the harness-parity regression is the **hard gate** here, not
   deferred to closure.
5. **UAT at WP5** — the vertical slice IS the north-star cucumber;
   place UAT at the end of WP5, with the WP4 harness-parity gate
   re-asserted at integration scope. No closing-report run is required
   (this is a substrate-structure carve, not a behaviour-tuning phase —
   validation bar is unit+integration+parity, per the status banner).

---

*Spec doc path: `docs/project/phases/13-card-layer-carve/README.md`*
