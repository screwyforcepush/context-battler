# Phase 13 — Card Layer Carve

> **Status:** Spec re-spun 2026-05-16 (3-reviewer convergent fix-set
> applied; PM ratifications baked in). Planning architect artifact.
> Deliberately thin foundation: **Cards, NOT accounts**. The substrate-
> proof harness and its locked 8-persona union stay UNTOUCHED — the Card
> path is strictly parallel. POC posture applies (schema break + Convex
> dev-state reset authorised; no migration shims; single forward shape).
> Standard gates (lint, ts:check, build, test) must pass; validation bar
> is unit + integration coverage of the Card path PLUS a harness-parity
> regression proof (NOT a closing report).
>
> **No second plan-review is required.** The architecture (personaId
> duty-split, harness-parity, trace-integrity via `cardPromptHash`,
> idempotent accrual sentinel) is RATIFIED; all three plan reviewers
> explicitly waived a second plan-review cycle for the enumerated
> precision fixes now folded into this spec (Decision D7). The edits
> below are spec-correctness/precision, **not** architectural rework, and
> must NOT be re-litigated. **WP1 is independently dispatchable now**, in
> parallel with everything else (it depends on none of the corrections).
>
> Canonical anchors:
> - [`mental-model.md` §12](../../spec/mental-model.md#12-player-facing-meta--the-card-the-matchmaking-facade-seasons) — the binding why-layer (the card is the unit, not the account; presets are forkable on-ramps; closed harness and open pool are two consumers of one engine; §12:196 = the prize-per-match denominator counts every match drawn into incl. turn-2 death; §12:202-205 = K/D is vanity/play-style and wall face-slams are comedy stats, never progression)
> - [`mental-model.md` §5](../../spec/mental-model.md#5-core-emotional-loop) — prize split / emotional anchor
> - [`mental-model.md` §10](../../spec/mental-model.md#10-iteration-discipline-load-bearing-intent) — POC posture, proof-artifact discipline
> - [`mental-model.md` §6 pillars 6 & 7](../../spec/mental-model.md#6-design-pillars) — substrate-not-band-aid; state is the contract
> - [`concept-spec.md` §5](../../spec/concept-spec.md#5-win-condition-and-scoring) — win condition & scoring (unchanged)
> - [`PLAN-REVIEW.md`](./PLAN-REVIEW.md) — the 3-reviewer verdict this re-spin discharges
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

A NEW mutation, parallel to the behaviourally-untouched `matches.start`.
Validates `cardIds.length === 8` exactly AND `new Set(cardIds).size ===
8` (no duplicate Card ids) — **no auto-draw, no backfill, no lobby
facade** (that is the deferred facade era, mental-model §12). It mirrors
`matches.start`'s map/world/spawn structure but binds each character to
a Card and **snapshots the Card's prompt hash at match time** (trace
integrity — §3.3). It enforces the §3.2.1 agentName validation contract.

### 2.4 Per-Card persistent accumulation

On terminal completion of a Card-triggered match, a parallel
accumulation step accrues to each drawn Card: `prizeUnitsWon`,
`matchesPlayed` (denominator = every match drawn into in a *completed*
match, incl. early death — see A1), `kills`, `deaths`, `wallFaceSlams`.
Idempotent against scheduler replay via a sentinel table (§3.4).
Prize-per-match (`prizeUnitsWon / matchesPlayed`) and K/D are
*derivable*, not stored. **No leaderboard UI, no seasons tooling, no
accounts** (north-star).

### 2.5 Harness-parity guarantee

`matches.start` + `harness/run.ts` are **behaviourally identical** (see
§3.8 for the precise definition — this is NOT a zero-diff claim on the
`matches.ts` *file*). `characters.personaId` semantics, `runs`/`reports`
schema and aggregation for the harness path, the per-turn loop's harness
branch, and the harness's trigger/read contract all remain behaviourally
identical. A regression test proves a `matches.start` run is byte-for-
byte unchanged for the same `rngSeed` and asserts ZERO Card writes.

---

## 3. Architecture Design

### 3.0 Current-state trace (the substrate this carve is parallel to)

- **`matches.start`** (`convex/matches.ts:193`) — the *only* current
  trigger. Inserts `matches`, expands the reference map →
  `worldStatic`/`worldState`, computes
  `assignPersonasToSpawnsInline(rngSeed, PERSONA_IDS)` (deterministic
  Fisher–Yates over the **locked 8**, `matches.ts:150-168` — currently
  module-private and typed `readonly PersonaId[]`), inserts 8
  `characters` (`personaId` from the locked union, `displayName =
  titleCase(personaId)`), schedules `runMatch.advanceTurn`.
- **Per-turn loop** (`convex/runMatch.ts:786`) — `loadPersonas()`
  returns `Record<PersonaId,string>`; the personaText resolution is the
  single line `runMatch.ts:787`:
  `personas[actor.personaId as PersonaId] ?? ""` inside
  `perAgent = livingActors.map(...)`. `personaPromptHash = hashHex(text)`
  (`hashHex` at `runMatch.ts:119`). Prompt text is hash-deduped into the
  `prompts` table (`kind:"persona"`) **inside `persistTurn`**
  (`runMatch.ts:1053`, Phase 11) — there is **no** standalone get-or-
  create-by-hash API today (see §3.3).
- **`characters.personaId`** (`convex/schema.ts:1006`,
  `personaIdValidator`) is doing **double duty**: (a) prompt-load key
  (`loadPersonas()[personaId]`) and (b) telemetry/aggregation key
  (`runs.perPersona[]` keyed by it via `runs.ts:124-130`; `reports`
  per-persona; the substrate-proof differentiation metric).
- **Prize model** (`convex/runMatch.ts:1018-1047`) — `PRIZE_POOL=100`;
  sole survivor → 100; else `floor(100/extractors)` each; written to
  `matches.outcome.pointsByCharacter[] = {id, points}`. Already
  per-character.
- **Substrate-proof report** (`convex/reports/phase12.ts:559,593`)
  consumes an **explicit harness-supplied `matchIds` array** and fetches
  `runs` `by_match` per supplied id — it does **not** scan all `runs`
  rows (PLAN-REVIEW verified; confirm no report path does an unscoped
  `runs` collect).
- **Harness** (`harness/run.ts`) triggers `matches:start` with only
  `{ reasoningEffort }` and reads `runs`/`reports`.

### 3.1 The core design tension and its resolution (RATIFIED — do not rework)

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
the 8) so the harness's runs/reports/differentiation continue to work
**without a single line of change**. The prompt-load duty is the only
one that branches, keyed on the presence of `characters.cardPromptHash`.

This split is RATIFIED (Decision D2; PLAN-REVIEW verified
`runs.aggregate` buckets by `personaId` and the substrate-proof report
is explicit-matchId-scoped). It must NOT be re-architected.

### 3.2 Schema changes (POC: forward-only, dev-state wipe)

**New table `cards`:**

```
cards: {
  agentName: v.string(),                 // free-form; NOT the locked union — see §3.2.1 validation contract
  promptHash: v.string(),                // current prompt; text lives in `prompts` (kind:"persona"), hash-deduped
  lineagePersonaId: personaIdValidator,  // telemetry/seed tag — within the locked union (NOT prompt-load)
  progression: v.object({ level: v.number(), xp: v.number() }),  // thin placeholder ONLY
  // ── persistent accumulators (the ranked + vanity unit) ──
  prizeUnitsWon: v.number(),
  matchesPlayed: v.number(),             // denominator = every match drawn into in a COMPLETED match, incl. early death (A1)
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
card.agentName` (validated per §3.2.1).

`prompts`, `matches`, `turns`, `worldStatic`, `worldState`, `runs`,
`reports` schemas: **untouched**.

#### 3.2.1 `agentName → displayName` is engine-load-bearing — the validation contract

> **A2 reframed (Decision D6 — the spawnIndex-vs-displayName framing and
> the "spike-first" plan are DELETED).** There is no "is `Player_N`
> derived from `spawnIndex` or `displayName`" question in the functional
> path. Character-target resolution is **purely displayName-keyed**:
> `normaliseCharacterTargetId` (`convex/llm/idNormalisation.ts:38-48`)
> tries `characterId` then falls back to a `displayName` `.find()`
> (first-match-wins). `PERSONA_DISPLAY_NAMES` is dead in production
> dispatch. `agentName → displayName` is *already* the production
> resolution path (the substrate names agents "Duelist", not
> `Player_N`), so it is mechanically safe **only** with the two
> validations below.

`displayName` is the LLM-facing target id, the visible-vision JSON key
(`convex/llm/inputBuilder.ts:519`, corpse key `Corpse_<name>`;
`resolution.ts:270,286` add `displayName` and `Corpse_<displayName>` to
visible/target id sets), the corpse id component, and the
`<Player Name>` system-prompt substitution
(`buildPlayerSystemMessage`, `convex/llm/azure.ts` — a **raw**
`String.replace`, so an unescaped agentName can inject newlines /
instructions into the system prompt). A free `agentName` therefore opens
two real correctness holes that `matches.startFromCards` MUST close
(WP2 success criteria, **not** a spike):

1. **Intra-8 `agentName` uniqueness.** If any two of the selected 8
   Cards share an `agentName`, `normaliseCharacterTargetId` /
   `visibleTargetIds` resolve by displayName via `.find()` →
   first-match-wins → ambiguous targeting, corpse resolution, and a
   collided vision JSON key (`inputBuilder.ts:519`,
   `idNormalisation.ts:44-46`). `matches.startFromCards` MUST validate
   `agentName` uniqueness within the 8 (after normalisation, see
   below).
2. **Reserved-prefix / unsafe-charset rejection.** `resolveTypedEntity`
   (`convex/engine/resolution.ts:314`) is invoked by `validation.ts:118`
   and `validation.ts:154` **before** character normalisation and
   dispatches the prefixes `Corpse_` / `Cover_` / `Wall_` / `Evac_` and
   the crate regex `^Crate_-?\d+_-?\d+$` (`resolution.ts:143`,
   `isCrateId`). A Card named e.g. `Wall_1_1`, `Corpse_Camper`,
   `Crate_3_4`, `Cover_2_2`, `Evac_0_0`, or `Player_7` is hijacked
   before it can resolve as a character. `matches.startFromCards` MUST
   reject any `agentName` matching the reserved namespaces
   `^(Crate|Corpse|Cover|Wall|Evac)_` or `^Player_\d+$` or the
   `^Crate_-?\d+_-?\d+$` regex, AND must reject unsafe charsets:
   non-single-line (no `\n`/`\r`), untrimmed, empty, or over a max
   length (to prevent raw system-prompt injection at
   `buildPlayerSystemMessage`).
3. **Collision disambiguation fallback.** As a defence-in-depth
   fallback (NOT a substitute for criterion 1's hard reject), if a
   post-validation `displayName` collision is still possible, append a
   deterministic disambiguation suffix (e.g. `Slayer (2)`) so the engine
   never sees two identical `displayName`s in one match. Criterion 1 is
   the primary guard; the suffix is the safety net.

These three are explicit WP2 success criteria. A2 is **conditionally
ratified** on all three being implemented (Decision D6).

### 3.3 Trace integrity — snapshot, not live pointer (RATIFIED)

Canonical pattern: persist the **content-hash reference per
match-record**, dedup the text content-addressably; the
card→current-prompt pointer is for live gameplay only, never replay.

The codebase already has the content-addressed store (`prompts` table,
hash-deduped) and the per-record hash plumbing
(`agentRecord.input.personaPromptHash`). This phase makes it
Card-trace-integral:

1. `matches.startFromCards` resolves each Card's current `promptHash`
   and **ensures the text row exists in `prompts`** (`kind:"persona"`)
   via a **NEW small shared idempotent-by-hash get-or-create helper
   owned by WP1** (Decision: this is NOT an existing Phase 11 API —
   Phase 11's dedup lives *inside* `persistTurn` at `runMatch.ts:1053`
   and is not reusable). It then **pins `characters.cardPromptHash` at
   character-insert time**.
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
zero agentRecord schema change. This equality is an explicit WP4 test
(see §3.7 — both sides must use the same extracted hash function).

### 3.4 Per-Card accumulation — pure aggregator + sentinel idempotency (RATIFIED)

One match event fans out to 8 Card aggregates; a sentinel/marker table
keyed by `matchId`, written in the same mutation as the increments. This
mirrors the existing `runs.aggregate` idempotency-by-row-existence
exactly (`convex/runs.ts:62-67`).

- **Pure aggregator** in the engine layer
  (`convex/engine/cardStats.ts`, zero Convex deps, unit-tested —
  mirrors `runStats.ts`): given the turns ledger + characters +
  `matches.outcome.pointsByCharacter`, returns per-Card deltas:
  - `prizeUnitsWon` += this match's `pointsByCharacter` for the Card's
    character (concept-spec §5 model — unchanged).
  - `matchesPlayed` += 1 for **every** drawn Card in a *completed*
    match (incl. characters that died turn 2 — the denominator that
    can't be out-grinded, mental-model §12:196). See A1 for the
    failed-match exclusion.
  - `kills` += per-characterId kill credit via the **shared kill-
    attribution helper** (A4 — see §3.6 for the extraction contract).
  - `deaths` += 1 if the character has `diedAtTurn` set (any death,
    including environmental/telefrag/wall — A5).
  - `wallFaceSlams` += `count(resolution.moves[].bodyCollision.kind ===
    "wall")` for the character — the charge body-collision-into-wall
    (the product "wall face-slam", mental-model §12:204 comedy stat).
    **Definition (Decision, MED fix):** `wallFaceSlams =
    count(bodyCollision.kind === "wall")`. `blockedBy === "wall"` is an
    **independent legacy/diagnostic marker** and is **ignored** — do
    NOT use it to *exclude* entries. A direct wall hit may carry BOTH
    `bodyCollision.kind:"wall"` and `blockedBy:"wall"`; such an entry
    still counts (it is a face-slam). Only entries with `blockedBy`
    *without* `bodyCollision.wall` are non-slams (and they are not
    counted because they lack the `bodyCollision.wall`, not because of
    `blockedBy`).
- **Writer** `cards.accrueFromMatch({ matchId })` (default runtime,
  mirrors `runs.aggregate`): bail if `cardAccruals` row exists
  (idempotent); bail if match not `status==="completed"` (A1) or has no
  Card-backed characters; else compute deltas via the pure aggregator,
  patch each Card row, insert the `cardAccruals` sentinel — all in one
  mutation.
- **Schedule (A3 ratified, unconditional + self-guard):**
  `runMatch.advanceTurn`'s terminal branch (`convex/runMatch.ts:1116`)
  currently schedules `runs.aggregate`. Add a second
  `scheduler.runAfter(0, api.cards.accrueFromMatch, { matchId })`
  **unconditionally**. `runs.aggregate` is unconditional (harness needs
  it); `cards.accrueFromMatch` self-guards on Card presence so the
  harness path schedules a cheap no-op (one indexed read), mirroring
  `runs.aggregate`'s own row-existence self-guard. The WP4 parity test
  MUST assert ZERO Card writes for a harness match.

### 3.5 Per-turn loop — the single branch point + the prompts-table join site

`convex/runMatch.ts:787`, inside `perAgent = livingActors.map(...)`
(`runMatch.ts:786`). Current:

```
const personaText = personas[actor.personaId as PersonaId] ?? "";
```

Becomes (additive branch; harness path byte-identical):

```
const personaText = actor.cardPromptHash
  ? cardPromptTextByHash.get(actor.cardPromptHash) ?? ""
  : personas[actor.personaId as PersonaId] ?? "";
```

**The join site, named precisely so WP4 cannot drift (MED fix —
`buildMatchState` is PURE):** `buildMatchState` (`runMatch.ts:202-276`)
takes only `Doc<>` arrays + a `descriptorSize` and **has no `ctx` and no
DB access — it CANNOT join the `prompts` table.** The pinned text MUST
be resolved by a **bounded DB read in `advanceTurn`** (≤8 distinct
`cardPromptHash` values per match): after the characters are loaded and
before the `perAgent = livingActors.map(...)` at `runMatch.ts:786`,
collect the distinct non-null `cardPromptHash` values, fetch each
`prompts` row (`kind:"persona"`) once, and build a
`Map<hash,text>` (`cardPromptTextByHash`). That map is closed over by
the `perAgent.map` callback at `runMatch.ts:787` (it does NOT pass
through `buildMatchState`). The per-turn hot path stays a `Map` lookup
(no extra per-turn DB read; bounded by ≤8 reads once per turn). When
`cardPromptHash` is absent (every harness character) the expression is
exactly today's — the harness path is provably unchanged.

> **WP4 anchor (binding so it cannot drift):** the DB read + `Map`
> construction lives in `advanceTurn`, immediately before
> `runMatch.ts:786`; the consumption is the single edited line
> `runMatch.ts:787`. `buildMatchState` is NOT modified to take `ctx`.

### 3.6 Stat-attribution contracts — A4 helper + A5 K/D asymmetry (RATIFIED)

**A4 extraction contract (binding, MED fix).** `runStats.ts` already
computes kill credit but buckets **per-`personaId`**. The Card path
needs **per-`characterId`** granularity (multiple Cards in one match can
share `lineagePersonaId` — e.g. 8 Vulture-lineage cards). WP3 extracts a
shared kill-attribution helper into the engine layer with these exact
constraints:
- The shared helper attributes **per-`characterId`**.
- `runStats.ts` MUST keep its existing **per-persona output
  byte-identical** — its existing unit tests are the regression guard.
  (`runStats` may aggregate the per-characterId result up into its
  per-persona buckets internally; the externally observable `runStats`
  output must not change a single byte.)
- `cardStats.ts` consumes the same per-characterId helper so Card kills
  and substrate kills agree by construction (DRY; no second divergent
  attribution rule).

**A5 K/D asymmetry is INTENTIONAL — reconciliation is FORBIDDEN
(binding, MED fix).** `runStats` semantics (verified): environmental /
wall / telefrag deaths are **not** in `resolution.deaths` and are
**not** anyone's kill. Combined with A5 (`deaths` = `diedAtTurn` set,
any death), this yields a deliberate asymmetry: an environmental/wall
death increments the **victim's** `deaths` but **no killer's** `kills`.
This is correct and consistent with mental-model §12:202-205 (K/D is a
vanity/play-style signal, not the ranked metric; the ranked ladder is
prize-per-match). The spec **explicitly forbids** any implementer
"reconciling" Card `kills` and `deaths` totals — they are not expected
to balance. State this in the WP3 implementation notes and as a test
assertion (an env-death fixture: victim `deaths` +1, total `kills`
unchanged).

### 3.7 `hashHex` extraction — one hash function, both runtimes (MED fix)

`hashHex` (`convex/runMatch.ts:119`) is a pure function but currently
lives in a **node-action module**. The default-runtime `cards` mutations
(WP1 `cards.create`, WP2 pinning) must compute the **same** hash as
`agentRecord.input.personaPromptHash`, and must NOT import a node-action
module. **Decision:** extract `hashHex` into a pure / default-runtime-
safe module (e.g. `convex/engine/hash.ts` or co-located with the prompts
helper) imported by **both** `runMatch` and the `cards` mutations.
**Required test (WP4):** for a Card match, assert `cardPromptHash ===
agentRecord.input.personaPromptHash` (the extracted hash function
produces identical output on both sides). This is the trace-integrity
correctness proof; without it, a pinned hash that disagrees with the
runtime hash would silently break replay.

### 3.8 `runs`/`reports` for Card matches — harness-only diagnostics (HIGH fix)

The "zero change to `runs`/`reports`" claim holds **for the HARNESS path
only**. For Card matches:
- `runs.aggregate` is scheduled unconditionally (A3) → Card matches
  **do** produce `runs` rows. These rows are **harness-only
  diagnostics**, NOT Card product-truth. Card product-truth is
  `cardAccruals`/the `cards` accumulators — full stop.
- Because Card selection is open, multiple selected Cards can share
  `lineagePersonaId`. `runs.perPersona` buckets by `personaId`
  (`runs.ts:124-130`) → e.g. 8 same-lineage Cards collapse into 1
  non-zero bucket + 7 zero buckets. **This collapse is BY DESIGN for
  the substrate metric** (the substrate metric is an archetype view; it
  is not Card-product-truth and is never relied on for Card
  correctness).
- The substrate-proof report (`reports/phase12.ts:559,593`) takes an
  **explicit harness-supplied `matchIds` array** and reads `runs`
  `by_match` per id — Card-match `runs` rows are orphan/expected,
  ignored by the explicit-matchId-scoped substrate report, and **never
  read by an unscoped scan**. WP4 must confirm no report path does an
  unscoped `runs` collect.

### 3.9 Data flow

```
Card pool (cards table, ≥8, unbounded)
        │  caller picks EXACTLY 8 distinct ids (no auto-draw / backfill / lobby)
        ▼
matches.startFromCards({ cardIds[8] })
        │  validate length===8 ; new Set(cardIds).size===8 ; agentName contract (§3.2.1)
        │  resolve each card.promptHash ; get-or-create prompts row (kind:persona) per distinct hash (WP1 helper)
        │  insert matches/worldStatic/worldState (reuses generalised matches.ts helpers — D9, WP4)
        │  seeded shuffle of the 8 cards over spawn indices
        │  insert 8 characters {cardId, cardPromptHash(PINNED),
        │     personaId=card.lineagePersonaId, displayName=validated agentName}
        │  schedule runMatch.advanceTurn
        ▼
runMatch.advanceTurn (SHARED loop)
        │  advanceTurn: bounded ≤8 prompts read → Map<hash,text>  (NOT in buildMatchState — it is pure)
        │  runMatch.ts:787 single branch on actor.cardPromptHash
        │  Card char → pinned-hash prompt ; harness char → loadPersonas()
        │  ... unchanged resolution / persistTurn / prompts dedup ...
        ▼  terminal
   schedule runs.aggregate (unchanged)  +  schedule cards.accrueFromMatch (unconditional)
                                                   │  sentinel-guarded ; self-guards on Card presence
                                                   ▼
                                   patch 8 cards: prizeUnitsWon,
                                   matchesPlayed, kills, deaths,
                                   wallFaceSlams ; insert cardAccruals
```

Harness path (`matches.start`) flows down the **same shared loop** with
`cardPromptHash` absent → identical behaviour; `cards.accrueFromMatch`
self-guards to a no-op (zero Card writes — WP4 asserts this).

---

## 4. Dependency Map (parallelisation — retained & confirmed)

```
WP1 (schema + cards CRUD + preset seed + prompts get-or-create helper
     + hashHex extraction + wipe-union update)   ── foundational
   │   ↳ INDEPENDENTLY DISPATCHABLE NOW — depends on none of the
   │     spec corrections; may run in parallel with this re-spin's
   │     WP2/WP3-gating edits being consumed.
   │
   ├──▶ WP2 (matches.startFromCards + agentName contract + pinning)  ─┐
   │                                                                  ├─ WP2 ∥ WP3
   ├──▶ WP3 (cardStats aggregator + A4 helper extraction + accrual)  ─┘  (independent
   │        (pure engine module can START in parallel with WP1            modules; both
   │         finalising — define shapes first)                            depend only
   │                                                                      on WP1 schema)
   │
WP2 + WP3 ──▶ WP4 (per-turn loop branch + advanceTurn join + wiring
   │                + harness-parity HARD GATE)
   │
WP4 ──▶ WP5 (integration vertical slice + UAT + closure)
```

- **WP1 is independently dispatchable immediately** (PLAN-REVIEW + D7):
  it depends on none of the precision edits. WP2/WP3 consume the §3.2.1
  / §3.6 / §3.8 corrections.
- **WP2 ∥ WP3** is the real parallelism: once WP1 locks the `cards`
  schema, the prompts get-or-create helper, the extracted `hashHex`, and
  the pure-aggregator input/output type, the trigger mutation and the
  accrual aggregator are independent surfaces with no shared code (WP3's
  engine module has zero Convex deps, mirroring the `runStats.ts`
  boundary). Two engineers can take WP2 and WP3 concurrently.
- WP3's **pure aggregator + A4 helper extraction**
  (`convex/engine/cardStats.ts`) can be TDD-started against the type
  contract before WP1's Convex schema is pushed — pure functions over
  plain row shapes.
- WP4 is the only place the shared per-turn loop is touched and is the
  serialisation point + the harness-parity gate.

---

## 5. Work Package Breakdown (UAT vertical-slice)

Each WP is TDD: tests first (red), minimal implementation (green),
refactor. Testing trophy: unit = pure aggregator / validators;
integration = the trigger + accrual mutations and the shared-loop
branch; the vertical slice (WP5) is the user-journey proof.

### WP1 — `cards` schema, CRUD, preset seed, shared helpers (independently dispatchable now)

**Scope:** `cards` + `cardAccruals` tables; `characters.cardId` /
`cardPromptHash` optional fields; `cards.create` mutation;
`cards.seedPresets` one-time mutation; `cards.get` / `cards.list`
queries; the **new shared idempotent-by-hash prompts get-or-create
helper** (NOT an existing Phase 11 API — §3.3); **`hashHex` extraction**
into a pure/default-runtime-safe module (§3.7); add `cards` and
`cardAccruals` to the **dev-wipe table union** (`convex/spike.ts`
`WipeTable`, currently 8 tables — POC reset support); a minimal
**`cards.updatePrompt` mutation** (resolves the trace-test ambiguity —
see WP2; chosen over a DB-fixture patch so the trace test exercises a
real product path).

**Success criteria:**
- Schema compiles; `npx convex dev` pushes against a wiped dev DB
  (POC — no migration shim); `cards` + `cardAccruals` are in the
  `spike.ts` wipe union.
- `cards.seedPresets` inserts exactly 8 rows: `isPreset:true`,
  `agentName === titleCase(personaId)`, `promptHash ===
  hashHex(PERSONAS_INLINE[personaId])` (using the **extracted** hashHex),
  `lineagePersonaId === personaId`, all accumulators `0`, `progression
  {level:1,xp:0}`. Re-running `seedPresets` is idempotent.
- `cards.create` appends an arbitrary Card (pool unbounded); a created
  Card is a valid first-class row with NO owner ref and is queryable;
  it get-or-creates the prompt text into `prompts` (`kind:"persona"`)
  via the new shared helper and stores its hash.
- The shared get-or-create-by-hash prompts helper is idempotent:
  two calls with the same text produce one `prompts` row.
- `cards.updatePrompt` get-or-creates a new prompt row and repoints
  ONLY the Card's `promptHash` (does NOT touch any existing character).
- `hashHex` is importable from a default-runtime-safe module by both
  `runMatch` and the `cards` mutations (no node-action import).
- Unit tests: a Card with no account ref is valid & rankable-shaped;
  pool may exceed 8.

### WP2 — `matches.startFromCards` + agentName contract + prompt-hash pinning

**Scope:** the parallel trigger mutation; the §3.2.1 agentName
validation contract; per-character Card binding + prompt-hash snapshot.
Reuses (does not fork) the map/world/spawn helpers in `convex/matches.ts`
— this **requires** exporting + generalising `assignPersonasToSpawnsInline`
over an id type `<T>` (or co-locating `startFromCards` in `matches.ts`);
see §2.5 + the WP4 "Untouched = behavioural identity (D9)" criterion
for why this does NOT violate "harness untouched".

**Success criteria:**
- `matches.startFromCards({ cardIds })` **rejects** any `cardIds.length
  !== 8` AND any `new Set(cardIds).size !== 8` (no duplicate Card ids —
  explicit errors, no auto-draw/backfill). Rejects unknown card ids.
- **agentName contract (A2 — §3.2.1, all three required):**
  (1) rejects intra-8 `agentName` collisions (uniqueness within the
  selected 8); (2) rejects reserved-prefix agentNames
  (`^(Crate|Corpse|Cover|Wall|Evac)_`, `^Player_\d+$`, the
  `^Crate_-?\d+_-?\d+$` regex) and unsafe charsets (empty/untrimmed/
  multi-line/over-max-length); (3) applies a deterministic
  disambiguation suffix as the defence-in-depth fallback so the engine
  never sees two identical `displayName`s. Each has an explicit
  rejecting/passing test.
- Creates the same `matches`/`worldStatic`/`worldState` shape as
  `matches.start`; the 8 cards are seed-shuffled over spawn indices
  deterministically (same `rngSeed` → same mapping) via the generalised
  helper.
- Each character row: `cardId` set, `cardPromptHash` pinned to the
  Card's prompt hash **at trigger time**, `personaId =
  card.lineagePersonaId`, `displayName =` the validated agentName. The
  prompt text row exists in `prompts` (via WP1's helper) before
  `advanceTurn` is scheduled.
- Trace-integrity test: start a Card match; `cards.updatePrompt`
  (WP1) to change the Card's prompt (new hash); assert the created
  character's `cardPromptHash` is unchanged and resolves to the
  *original* text.
- Schedules the same `runMatch.advanceTurn`.

### WP3 — `cardStats` pure aggregator + A4 helper + `cards.accrueFromMatch`

**Scope:** `convex/engine/cardStats.ts` (pure, zero Convex deps,
unit-tested — `runStats.ts` sibling) + the **shared per-characterId
kill-attribution helper extraction** (A4 — §3.6) + `cards.accrueFromMatch`
writer + `cardAccruals` sentinel.

**Success criteria:**
- **A4 extraction:** the shared kill-attribution helper attributes
  per-`characterId`; `runStats`'s existing per-persona output is
  **byte-identical** (its existing tests pass unchanged — the
  regression guard). A test proves `cardStats` and `runStats` kill
  credit agree by construction.
- Pure aggregator unit tests cover: prize from
  `outcome.pointsByCharacter` (sole-survivor 100 and even-split per
  concept-spec §5 — model unchanged); `matchesPlayed` +1 for **all 8**
  incl. a turn-2 death (completed match); `kills` per the shared helper;
  `deaths` on `diedAtTurn` (incl. an env/wall-death fixture);
  `wallFaceSlams = count(bodyCollision.kind==="wall")` including an
  entry that ALSO has `blockedBy==="wall"` (it still counts), and
  excluding a `blockedBy`-only-without-`bodyCollision.wall` entry
  (explicit both-cases test).
- **A5 asymmetry test:** an environmental/wall-death fixture asserts
  victim `deaths` +1 and total `kills` unchanged; a comment/test name
  states the asymmetry is INTENTIONAL and must not be reconciled.
- `cards.accrueFromMatch` is idempotent: second invocation on the same
  matchId is a no-op (sentinel guard); concurrent/replayed schedule
  cannot double-count.
- No-ops (returns null, writes nothing) when match `status !==
  "completed"` (A1 failed-match exclusion) or it has no Card-backed
  characters.
- After accrual, each Card's accumulators reflect the match;
  prize-per-match and K/D compute correctly from stored values.

### WP4 — per-turn loop branch + advanceTurn join + wiring + harness-parity proof

**Scope:** the bounded `cardPromptHash` → text `Map` DB read in
`advanceTurn` (immediately before `runMatch.ts:786`); the single
branch edit at `runMatch.ts:787`; the unconditional
`cards.accrueFromMatch` schedule at `runMatch.ts:1116`; the
harness-parity regression. (`buildMatchState` is NOT given `ctx` — §3.5.)

**Success criteria:**
- Card characters drive the LLM with their **pinned** prompt text;
  `agentRecord.input.personaPromptHash` equals the pinned
  `cardPromptHash` (the §3.7 extracted-hash equality test).
- The prompts `Map` is built by a bounded ≤8-distinct-hash read in
  `advanceTurn`, NOT inside `buildMatchState`; the per-turn hot path is
  a `Map` lookup.
- **Harness-parity proof (the HARD GATE):** a `matches.start` run
  produces agentRecords / `prompts` rows / `runs` row / `reports`
  aggregation byte-for-byte equivalent to pre-change for the same
  `rngSeed`; no `cardId`/`cardPromptHash` on any harness character;
  `cards.accrueFromMatch` performs **ZERO Card writes** for the harness
  match. Encoded as an automated regression test.
- **"Untouched" = behavioural identity (D9):** `matches.start` +
  `harness/run.ts` are behaviourally identical (same outputs for same
  inputs). This is NOT a zero-diff claim on the `matches.ts` *file* —
  generalising `assignPersonasToSpawnsInline` over `<T>` / exporting
  helpers is additive and behaviour-preserving; the parity test asserts
  behaviour, not file diff. `harness/run.ts` itself is byte-unchanged.
- `runs.aggregate` scheduling/behaviour unchanged; no report path does
  an unscoped `runs` collect (confirmed — §3.8).

### WP5 — integration vertical slice + UAT + closure

**Scope:** end-to-end: seed pool → add a 9th+ Card → trigger from an
explicit 8 → run → assert per-Card accumulation & trace integrity →
closure doc.

**Success criteria (UAT vertical slice — the north-star cucumber):**
- Pool seeded with 8 presets; ≥1 extra Card added → pool > 8.
- A match triggered with an explicit array of exactly 8 distinct card
  ids runs those 8 as its characters; each character snapshots its
  Card's prompt hash.
- Prize/ladder accrues to the Card per concept-spec §5; `matchesPlayed`
  counts every match drawn into incl. early death (completed match);
  vanity totals (kills, deaths, wallFaceSlams) accumulate;
  prize-per-match & K/D derivable.
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
3. A match triggers from an explicit array of **exactly 8 distinct**
   Card ids (`length===8` AND `new Set().size===8`); no auto-draw, no
   backfill, no lobby/facade.
4. Each match character snapshots the Card's prompt hash/version (no
   live pointer); later Card evolution never rewrites past replays;
   reuses the existing hash-dedup `prompts` table; `cardPromptHash ===
   agentRecord.input.personaPromptHash` (one extracted hash function).
5. Prize model unchanged from concept-spec §5.
6. Per-Card persistent accumulation: `prizeUnitsWon`, `matchesPlayed`
   (every match drawn into in a *completed* match, incl. early death;
   failed/crashed matches excluded — A1), `kills`, `deaths` (incl.
   environmental — A5), `wallFaceSlams` (`bodyCollision.kind==="wall"`,
   not gated on `blockedBy`). Prize-per-match & K/D derivable; the K/D
   asymmetry (env death → victim deaths, no killer kills) is intentional
   and must not be reconciled. No leaderboard UI, no seasons tooling, no
   accounts.
7. The substrate-proof harness and its 8-persona closed union remain
   **behaviourally** UNTOUCHED; the Card path is parallel (proven by the
   WP4 hard gate, which asserts behavioural identity + zero Card writes,
   NOT a `matches.ts` file diff).
8. POC posture honoured: schema break + dev-state reset (`cards` /
   `cardAccruals` in the wipe union); no migration shims; single
   forward shape.

OUT OF SCOPE (mental-modelled for later, NOT built, must not leak in):
user/account entity, matchmaking lobby UX + searching/countdown facade,
async auto-draw/backfill, unlockable prompt segments, seasons reset
tooling, leaderboard/replay UI changes.

---

## 7. Ratified Decisions (binding — do NOT re-litigate)

All five are RATIFIED by the 3-reviewer plan-review + PM. They are
baked into §§3.2.1/3.4/3.6/3.7/3.8 above and are restated here as the
decision record for the implement job. No second plan-review is
required for these enumerated precision fixes (Decision D7).

- **A1 — Failed-match exclusion (PM-SIGNED, Decision D5).**
  `matchesPlayed` (and all accrual) increments **only when
  `match.status === "completed"`**. Early *death* in a completed match
  **DOES** count (north-star + mental-model §12:196). A **failed**
  match (engine crash / non-completed substrate failure) does **NOT**
  increment `matchesPlayed` — it is a substrate failure, not a play.
  **Owned rationale:** §12:196 addresses *death*-not-exclusion ("win or
  turn-2 death"), it is silent on engine crashes; counting a crashed
  match would pollute the prize-per-match ladder with non-playable
  events; this mirrors `runs.aggregate`'s existing completed-only guard
  exactly. This is a deliberate PM-signed owned decision, not a §12
  derivation.
- **A2 — `agentName → displayName`, conditionally ratified (Decision
  D6).** The spawnIndex-vs-displayName framing and the "spike-first"
  plan are **DELETED** — that mechanism does not exist in the
  functional path (resolution is purely displayName-keyed). Approved
  **only** with the three §3.2.1 WP2 success criteria implemented:
  (1) intra-8 agentName uniqueness; (2) reserved-prefix / unsafe-charset
  rejection; (3) disambiguation-suffix fallback.
- **A3 — Unconditional schedule + self-guard (RATIFIED).** Schedule
  `cards.accrueFromMatch` unconditionally at the terminal branch; it
  self-guards on Card presence (cheap indexed read), mirroring
  `runs.aggregate`'s row-existence self-guard. The WP4 parity test
  asserts ZERO Card writes for harness matches.
- **A4 — Shared kill-attribution helper (RATIFIED with contract).**
  WP3 extracts a shared kill-attribution helper at **per-`characterId`**
  granularity (multiple Cards may share `lineagePersonaId`).
  `runStats`'s per-persona output MUST remain **byte-identical** (its
  existing tests are the guard). `cardStats` and `runStats` agree by
  construction.
- **A5 — Environmental deaths count; asymmetry intentional (RATIFIED
  with note).** `deaths` = `diedAtTurn` set (any death, incl.
  environmental/telefrag/wall). The resulting K/D asymmetry (env death
  → victim `deaths`, no killer `kills`) is **INTENTIONAL** (mental-model
  §12:202-205 — K/D is vanity/play-style, not the ranked metric).
  **Reconciliation is explicitly FORBIDDEN**; an env-death test asserts
  the asymmetry.

No open ambiguities remain. No user round-trip is required.

---

## 8. Recommended Job Sequence

1. **Plan review is DONE.** This re-spin discharges the 3-reviewer
   convergent fix-set (PLAN-REVIEW.md, Decisions D5–D9). **No second
   plan-review cycle** — the reviewers explicitly waived it for these
   enumerated precision fixes. Re-spin goes **direct to implement**.
2. **WP1 — dispatch NOW** (foundational, single owner, independently
   dispatchable; depends on none of the corrections). Unblocks
   everything; also delivers the shared prompts get-or-create helper,
   the `hashHex` extraction, and the wipe-union update.
3. **WP2 ∥ WP3** (two owners, concurrent) — independent surfaces once
   WP1's schema + helper + extracted hashHex + aggregator type contract
   are locked. WP3's pure aggregator + A4 extraction can begin TDD
   against the type contract immediately.
4. **WP4** (single owner; serialisation point) — the only shared-loop
   touch; the harness-parity regression (behavioural identity + zero
   Card writes) is the **hard gate** here, not deferred to closure.
5. **UAT at WP5** — the vertical slice IS the north-star cucumber;
   place UAT at the end of WP5, with the WP4 harness-parity gate
   re-asserted at integration scope. No closing-report run is required
   (this is a substrate-structure carve, not a behaviour-tuning phase —
   validation bar is unit+integration+parity, per the status banner).

---

*Spec doc path: `docs/project/phases/13-card-layer-carve/README.md`*
