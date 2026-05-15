# Phase 12 — Crate substrate + handcrafted equipment variance + world-event airdrop

> Spec doc + WP breakdown. Planning artifact for the crate-rename +
> deterministic equipment-variance catalog + world-event airdrop-crate
> slice (telegraph → land → spent, with telefrag), plus the runStats
> per-persona kill-attribution rider.
>
> Status: PLANNED (plan-v2) — not yet dispatched. Source-of-truth intent
> is the North Star in the assignment brief and
> `docs/project/spec/mental-model.md` pillars 1/5/6/8 + §11 (current
> vision). This doc is the "how"; the mental model is the "why".

---

## v2 changelog — binding conditions folded

Plan-v1 verdict: **APPROVE-WITH-BINDING-CONDITIONS** (unanimous,
3 architects — REVIEW-v1.md / REVIEW.md / PLAN-REVIEW.md). Core
architecture (telefrag sub-phase, `environmentalDeaths`-separate
kill-rate exclusion, runStats `buildTargetIdLookup` fix, catalog,
dependency map) is **ratified and code-verified — not re-architected**.
Q1–Q5 are **resolved** (Decisions D2–D6); §7 now records them, not
re-opens them. v2 folds:

- **BC-1 (High)** — §3.1 rename inventory re-derived from a fresh
  full-repo `[Cc]hest` grep (1555 hits / 149 files; live surfaces
  isolated from frozen docs). Added: `convex/matches.ts`,
  `convex/llm/decisionTool.ts`, `convex/engine/validation.ts`,
  `convex/worldState.ts`, `convex/engine/reportStats.ts`,
  `convex/engine/lastKnown.ts`, the full replay-UI set, the harness
  diagnostics consumers. §3.2 reconciled: `rollLoot`/`Chest_`
  construction lives in **both** `map.ts` *and* `matches.ts`. Added a
  post-WP-A re-grep gate as a WP-A exit criterion.
- **BC-2 (High)** — §3.3/§3.4 now specify the landed-airdrop **loot
  application** path (shared crate-lookup/apply helper; SPENT-flip;
  `result:"opened"`+`lootedItem` trace contract).
- **BC-3 (High)** — §3.3 lifecycle table re-pinned against the
  input-built-before-`resolveTurn` order (`runMatch.ts:773` vs `:927`);
  explicit input-projection vs resolution-spawn lifecycle; first-lootable
  turn pinned to landing+1.
- **BC-4 (Med)** — all stale `mental-model §16/§17/§18/§19/§20`
  citations re-pointed to §11 + real source-of-truth; WP-A "add
  mental-model §20" task **struck**; unsourced "fourth occurrence"
  framing removed.
- **BC-7 (Low-Med)** — §4 assigns explicit `runStats.ts` rename
  ownership; the "WP-F is INDEPENDENT / touches only runStats.ts" claim
  corrected.
- Low notes folded: WP-D scratchpad no-op-patch confirmation;
  WP-F `titleCase` import; kill-feed early-return guard for
  telefrag-only turns; persona "all 8 checked, only-hit files edited"
  wording.

---

## 1. Purpose

The user is iterating the mechanics substrate and wants to *see*, in
replay, two things the current substrate cannot produce:

1. **Equipment variance** — agents ending matches with visibly different
   gear, deterministically (no RNG noise), so persona behaviour around
   loot is legible and diff-friendly across runs.
2. **A contested public objective** — a BR-genre airdrop that telegraphs
   ahead, lands as loot, and *telefrags* anyone camping the bullseye.
   This forces a prompt-authored risk/reward decision (rush / hold /
   punish the cluster) and produces a textbook shareable "best failure":
   *"my agent camped the airdrop bullseye and got vaporised."*

Two enabling moves ride along:

- **Vocabulary closure (agent ergonomics).** Agents natively say "crate",
  not "chest" — they refer to it that way unprompted. Closing the
  substrate-vocabulary gap is the same precedent as `Player_N`→persona
  names and `chest_NNN`→`Chest_53_54`. Pure ergonomics, no behaviour
  change.
- **runStats per-persona kill-attribution fix.** `perPersona[*].kills`
  has been structurally zero since phase 6 — code-verified, not a
  documented-issue claim: `runStats.ts:209` compares engine
  `characterId`s (`deathSet`) against `a.target` which is the persona
  displayName (`resolution.ts:483-489`). The mirror remedy already
  exists at `turnsDerived.ts:auditDamageFeed`. Phase-9/10 closure docs
  record the known issue (`PHASE-9-CLOSURE.md`, `PHASE-10-CLOSURE.md`).
  Picked up now because telefrag introduces a killer-less death that
  *must not* corrupt attribution, and a closing gate this slice asserts
  non-zero correctly-attributed perPersona kills.

Determinism is mandatory and load-bearing: keeping one variable at a time
has paid off every phase, and RNG (loot, spawns, walls/cover/evac) is a
deliberately separate later slice *after* mechanics, *before* render.

---

## 2. Overview — what is being built

| # | Deliverable | Shape |
|---|---|---|
| A | **chest→crate rename** | Single forward shape across engine, vision, idNormalisation, inputBuilder, **the agent-facing tool grammar (`decisionTool.ts`) and validator rejection text (`validation.ts`)**, **the live match-start mirror (`matches.ts`)**, schema, runMatch, the full replay UI, diagnostics, phase-12 reports, tests, 8 personas, live spec docs. `Chest_<x>_<y>` → `Crate_<x>_<y>`. Dev DB wipe; no migration shims. |
| B | **Deterministic equipment catalog** | Expand `WeaponName`/`ArmourName` unions + `WEAPONS`/`ARMOUR` stat tables + `itemRefValidator` with new PLAIN-named tiers. Map crate entries carry hand-authored `contents: ItemRef` directly — `rollLoot` RNG path retired from `expandMap`. |
| C | **Airdrop entity state machine** | `TELEGRAPHED` (non-LOS, every agent's Vision, per-entity `countdown`) → `LANDED` (normal LOS-gated lootable crate, range 2) → `SPENT` (absent from Vision). Hand-authored wave→coords→contents table for landing turns 10/20/30/40. |
| D | **Telefrag** | New resolution sub-phase after movement: agent whose resolved tile == spawn tile on the landing turn vanishes entirely (no corpse, no gear transfer). Kill-feed line, environmental-death stat, excluded from kill-rate, alive-count/prize recompute. |
| E | **state-aware stopAtRange + experiment** | Extract per-namespace `stopAtRange` lookup; Crate row is state-aware (telegraphed 0, landed 2). Harness experiment: 10 runs @ telegraphed stopAtRange 0 vs 10 @ 2, reports telefrag counts. In-loop, NOT a closing gate. |
| F | **runStats kill-attribution fix (rider)** | Mirror `buildTargetIdLookup` from `turnsDerived.ts:auditDamageFeed` into `runStats.ts`; credit lethal `kind:"counter"`; env-deaths excluded gracefully; `runStats.test.ts` contract updated. |
| G | **Diagnostics + closing report** | `mechanics.ts` + replay diagnostics tab surface environmental-death stat + airdrop funnel. `convex/reports/phase12.ts` + `harness/closing/phase12.ts` mirror the phase-9/10 Path-2 pattern. `reportType: "phase-12-closing-20"`. |

**Explicitly out of scope (carry as labels, do not implement):** any RNG
(loot/crate-spawn/player-spawn/walls/cover/evac — its own later slice);
multi-item crates / agent-chooses-loot tool-schema work; prompt-injection
/ cursed item names (catalog stays plain this slice).

---

## 3. Architecture Design

### 3.1 The crate vocabulary rename (WP-A)

The agent-facing id is the only user-visible surface (`Chest_<x>_<y>` →
`Crate_<x>_<y>`); everything else is engine-internal consistency. This is
the same single-forward-shape, dev-DB-wipe, no-shim move as the phase-7
`chest_NNN`→`Chest_53_54` rename and the phase-11 schema break. POC
posture is confirmed (`project_poc_schema_wipe_acceptable`).

**Blast-radius inventory (BC-1: re-derived from a fresh full-repo
`[Cc]hest` grep — 1555 hits across 149 files; live surfaces below,
frozen docs/closed-phase aggregators excluded per the decision after the
table).** Every `chest`/`Chest`/`chest_` literal in an agent-facing
surface, engine path, persona prompt, replay UI, diagnostics, or the
phase-12 report aggregator must be retired:

| Layer | Files (live hit count) | Nature |
|---|---|---|
| Engine types | `convex/engine/types.ts` (6) | `ChestState`→`CrateState`; `VisibleEntity` `kind:"chest"`→`"crate"`; `MapDescriptor.chests`→`.crates` |
| Engine map | `convex/engine/map.ts` (16) | `Chest_${x}_${y}`→`Crate_${x}_${y}`; descriptor field rename; **WP-B retires `rollLoot`** here (see §3.2 — *one of two* expand seams) |
| **Live match-start mirror** | **`convex/matches.ts` (11)** | **BC-1 KEY MISS.** `expandMapInline` (`:100`) is a full mirror of `map.ts:expandMap`: `ChestState` import, `descriptor.chests.map`, `` `Chest_${c.x}_${c.y}` `` (`:110`), `makeRng(`${rngSeed}:chest:${chestId}`)` (`:111`), `rollLoot(c.lootTable,rng)` (`:112`), world-`chests` schema adapter (~`:97-235`). WP-A renames; **WP-B's determinism flip must cover this seam too** (see §3.2). |
| **Agent-facing tool grammar** | **`convex/llm/decisionTool.ts` (1, `:147`)** | **BC-1 highest-priority miss.** Tool-description string `"… loot a visible chest/corpse …"` — the per-turn LLM contract. Squarely in grep-clean scope. |
| **Engine dispatch + rejection text** | **`convex/engine/validation.ts` (7, `:154-169`)** | `entity.kind !== "chest"`; agent-facing rejection strings `"… is not a visible chest or corpse"` / `"known chest"`. Preserve namespace dispatch — gate becomes `kind === "crate" \|\| "corpse"`. |
| Engine resolution | `convex/engine/resolution.ts` (32) | `isChestId`→`isCrateId`; `interacts`/chest-open branch comments + trace (`result:"no_chest"`→`"no_crate"` etc.); **WP-D adds airdrop sub-phase**; **WP-C/D add shared loot helper (BC-2)** |
| Engine runStats | `convex/engine/runStats.ts` (13) | `isChestId`→`isCrateId` (`:61`,`:225`). **BC-7: ownership assigned in §4** — not a free-for-all with WP-F. |
| Engine reportStats | `convex/engine/reportStats.ts` (1, `:80`) | Live engine aggregator string `"≥ 80% of runs contain at least one chest equip"` (not a frozen payload). |
| Engine lastKnown | `convex/engine/lastKnown.ts` (1, `:33`) | comment; grep-clean still flags it. Low sev, catalogued. |
| Engine worldState | `convex/worldState.ts` (1, `:7`) | `chests: unknown[]` projection type. |
| LLM id-normalisation | `convex/llm/idNormalisation.ts` (13) | `isChestId`, `findChestByTargetId`, `ResolvedEntity.kind`, Crate namespace branch (WP-C/E) |
| LLM input builder | `convex/llm/inputBuilder.ts` (8) | `renderChestId`, `chestSpentById`→`crateSpentById`; kill-feed guard (WP-D, see §3.4); Vision (WP-C) |
| Engine vision | `convex/engine/vision.ts` (9) | `kind:"chest"` emission; airdrop emission (WP-C) |
| Engine turnsDerived | `convex/turnsDerived.ts` (9) | chest references in the damage-audit derive (the WP-F mirror-source file itself also carries `chest` literals — rename in WP-A, leave the `buildTargetIdLookup` *logic* untouched as WP-F's pattern source) |
| Schema | `convex/schema.ts` (8) | `chestValidator`→`crateValidator`; `resolutionValidator` (WP-D env-deaths); `worldState`/`worldStatic` + airdrops (WP-C); `phase12Payload` (WP-G) |
| Run-match plumbing | `convex/runMatch.ts` (3), `convex/_internal_runMatch.ts` (4) | `worldRow.chests` adapter both directions; airdrop persist (WP-C); env-death plumb + `adaptPriorTurnRowForBuilder` carries `environmentalDeaths` (WP-D, see §3.4) |
| Reference map | `maps/reference.json` (2) | `"chests"`→`"crates"`; entries swap `lootTable`→`contents` (WP-B); airdrop wave table (WP-C) — terrain/cover/spawns/evac **byte-identical** |
| Personas | `personas/{duelist,vulture,opportunist,camper}.md` (1 each) **and** `convex/_data/personas.ts` (4) inlined copies | mechanical `chest`→`crate` scrub only. **All 8 persona prompts are checked; only the files with hits are edited.** Tests cross-check markdown↔inline. |
| Replay UI | `apps/replay/src/components/HoverCard.tsx` (27), `apps/replay/src/lib/reconstruct.ts` (21), `apps/replay/src/routes/Replay.tsx` (12), `apps/replay/src/components/Grid.tsx` (10), `apps/replay/src/lib/hoverTypes.ts` (2), `apps/replay/src/components/ExpandModal.tsx` (1) | **BC-1: was uncatalogued.** `case "chest"`, `ChestHover`, `chestId`, `data-chest-id`, `SnapshotChest`, `data-token-kind="chest"`, "Chest (opened/closed)". North Star AC names "replay UI" unconditionally. WP-C also defines how landed/spent/telegraphed airdrops enter the snapshot for human replay (without re-entering LLM Vision once spent). |
| Diagnostics CLI + tab | `harness/diagnostics/mechanics.ts` (22), `harness/diagnostics/types.ts` (1), `harness/diagnostics/helpers.ts` (2), `harness/diagnostics.ts` (1), `harness/analyze-match.ts` (13), `harness/run.ts` (4), `harness/client.ts` (1), `harness/probe-reasoning.ts` (1), `apps/replay/src/routes/Diagnostics.tsx` (22), `apps/replay/src/lib/decisionEnglish.ts` (5) | chest funnel labels/keys; the diagnostics-consumer surface (BC-1 added `analyze-match.ts` + the rest). |
| Phase-12 reports | new `convex/reports/phase12.ts` (WP-G) | chest-funnel metric keys in the *new* aggregator only. |
| Live spec docs | `docs/project/spec/concept-spec.md` §6/§7/§8/§13/§14 (33), `docs/project/spec/mental-model.md` (1), `docs/project/spec/architecture.md` (3), `docs/project/spec/decision-tool-schema-draft.md` (5), `docs/project/spec/behavioural-diagnostics-intent.md` (2) | prose chest→crate. **No phase-12 section is added to `mental-model.md`** — §11 already carries intent; adding a §20 log violates the why-layer's own no-assignment-logs header rule (BC-4 / D4). |
| Tests | `tests/**` engine/llm/reports/integration/runMatch/turns + `apps/replay/src/**/__tests__/**` (per-file counts in grep; the high-churn ones: `resolution.test.ts` 54, `validation.test.ts` 51, `runStats.test.ts` 42, `reconstruct.test.ts` 38, `inputBuilder.test.ts` 28, `vision.test.ts` 10, `idNormalisation.test.ts` 10, `map.test.ts` 17, `movement.test.ts` 14, `turns.test.ts` 13) | fixtures + assertions follow each WP |

**Frozen / out-of-scope (NOT renamed — grep-clean gate excludes these):**
historical persisted `reports.phase{3,6,7,9,10}Payload` rows + their
aggregator source (`convex/reports/phase{3,7}.ts`, `convex/reports.ts`)
and the closed-phase report tests (`tests/reports/phase{3,6,7,9,10}.test.ts`);
all `docs/project/phases/01..11/**` and closed iter-intent specs
(`context-payload-iter-3-intent.md`); `.agents/**`, `.claude/**`
tooling; generated artifacts (`harness/probe-reasoning-output.json`).
Rationale: closed phases are contracts, not agent-facing live surfaces;
the DB is wiped anyway; freezing closed-phase aggregators is the
established phase-9/10/11 precedent. **The grep-clean acceptance gate is
scoped to the live-surface list above — it is NOT a naive full-repo
`rg chest`** (which would intentionally hit frozen docs and phase-7
legacy schema fields).

**Post-WP-A re-grep gate (BC-1, WP-A exit criterion):** after WP-A
lands, re-run `[Cc]hest` over exactly the live-surface file set above
(scripted exclusion of the frozen list) and assert **zero** hits. This
is a hard WP-A exit gate, re-stated in §5 WP-A success criteria.

### 3.2 Deterministic equipment catalog (WP-B)

**BC-1 reconciliation — `rollLoot`/`Chest_` construction lives in TWO
seams, not one:**

1. `convex/engine/map.ts:expandMap` — the engine-path expander.
2. `convex/matches.ts:expandMapInline` (`:100-120`) — a **full mirror**
   used on the live match-start path, with the *same*
   `Chest_${c.x}_${c.y}` id construction, the *same*
   `makeRng(`${rngSeed}:chest:${chestId}`)` seed, and the *same*
   `rollLoot(c.lootTable, rng)` call.

Plan-v1 §3.2 wrongly attributed `rollLoot` retirement solely to
`map.ts`. **WP-B must retire `rollLoot` and flip the determinism
contract in BOTH `map.ts` AND `matches.ts`**, and WP-A renames
`Chest_`→`Crate_` in both. A **parity test is required**: `expandMap` and
`expandMapInline` must produce byte-identical crate ids + hand-authored
`contents` for the reference descriptor (the persistence path and the
engine path must not diverge — Review B's High finding).

Both seeds (`rngSeed:chest:<id>`) are the **only** content RNG in the
slice. The other RNG, `assignPersonasToSpawns`, is the
explicitly-deferred player-spawn-permutation slice and is **left
untouched** ("no RNG introduced" forbids *adding* RNG; it does not
mandate retiring the pre-existing, separately-scoped spawn permutation).

Move to fully hand-authored, seed-independent contents:

- `MapDescriptor.crates` entries change from `{x,y,lootTable}` to
  `{x,y,contents:ItemRef}`. Both `expandMap` and `expandMapInline` copy
  `contents` verbatim — no `rollLoot`, no per-crate rng stream.
  `LOOT_TABLES`/`rollLoot` are **fully deleted** from the crate path
  (single forward shape, POC — D3; the deferred-RNG slice brings its own
  mechanism; preserving dead code violates "no back-into-a-corner").
  Closed-phase report tests that still reference `loot.ts` semantics are
  frozen (§3.1) and out of scope.
- **Catalog expansion.** `WeaponName`/`ArmourName` string-literal unions,
  the `WEAPONS`/`ARMOUR` stat tables (`convex/engine/types.ts`), and
  `itemRefValidator` (`convex/schema.ts`) gain new PLAIN-named tiers.
  Consumables unchanged (`heal`/`speed`). The catalog is the future
  pillar-5 prompt-injection seam — **plain names only this slice**.
- Determinism contract flips: `expandMap(d, "x")` deep-equals
  `expandMap(d, "y")` for **all** crate contents (the old map.test.ts
  contract asserted the *opposite* — that different seeds differ; that
  test inverts this slice).

> **AMBIGUITY — see §6 Q1.** Exact new tier names + stats are a user
> authoring decision. A proposed deterministic catalog + wave table is in
> §6 for confirmation; engineers must not invent stats unilaterally.

### 3.3 Airdrop entity state machine (WP-C)

The non-LOS, match-meta emission pattern already exists: `vision.ts`
emits `evac_rect` "regardless of Chebyshev range or LOS" once
`evac.revealedAtTurn !== null`. The telegraphed airdrop mirrors this —
the *only* other intentionally non-LOS-gated Vision entry, by deliberate
design (pillar 8: "the only non-LOS-gated entry is Evac post-reveal,
which is intentionally match-meta"; airdrop telegraph is the second
sanctioned match-meta channel, same minimap-style rationale).

**State model.** A new `WorldState.airdrops: AirdropState[]`, distinct
from `chests`/`crates` (an airdrop is a scheduled world event with a
landing turn and a lifecycle; a static crate is not). Shape:

```
AirdropState = {
  id: string;            // "Crate_<x>_<y>" — same id namespace as static crates
  pos: Tile;
  landsAtTurn: number;   // 10 | 20 | 30 | 40 (hand-authored)
  contents: ItemRef;     // hand-authored, deterministic
  looted: boolean;       // SPENT flag (engine-internal; never surfaced as a Vision field — pillar 8)
}
```

**BC-3 — lifecycle pinned against the input/resolve turn boundary.**
`runMatch.ts` builds every agent's input from start-of-turn `state` at
`:773` (`buildAgentInput(state, …)`) and only calls
`resolveTurn(state, decisions)` later at `:927`. So there are **two
distinct lifecycle clocks**, both turn-derived (no stored state machine,
like evac reveal), and they must not be conflated:

*Input/projection clock* — what an agent's Vision shows when its input
is built at the **top** of `state.turn`:

| Projected state | Condition (input built at start of `state.turn`) | Vision treatment | stopAtRange |
|---|---|---|---|
| `PRE` | `state.turn < landsAtTurn - 3` | absent | — |
| `TELEGRAPHED` | `landsAtTurn - 3 ≤ state.turn ≤ landsAtTurn` (incl. the landing turn's own input — it has not spawned yet) | emitted to **every** agent, non-LOS, non-Chebyshev, with `countdown: landsAtTurn - state.turn` (3→2→1→0) | 0 (race onto tile) |
| `LANDED` | `state.turn > landsAtTurn` AND `!looted` | normal LOS+Chebyshev-gated lootable crate | 2 (loot) |
| `SPENT` | `looted` | absent (absence, not a flag — pillar 8) | — |

*Resolution-spawn clock* — what `resolveTurn` does (§3.4): the crate
physically spawns in the airdrop sub-phase **after Phase 5** of the turn
where `state.turn === landsAtTurn`. Telefrag is evaluated at that
instant against post-Phase-4 positions.

**Pinned semantics (the BC-3 contract, tests must assert):**
- A drop with `landsAtTurn = 10` is `TELEGRAPHED` (navigable, with
  countdown) in the inputs for turns **7, 8, 9, and 10** (countdown
  3, 2, 1, 0 — at turn-10 input it is still telegraphed because
  `resolveTurn(turn 10)` has not run yet).
- It **spawns** during `resolveTurn` of turn 10, after Phase 5
  (telefrag evaluated here).
- It is first **`LANDED` / lootable** in the inputs for turn **11**
  onward (and first appears as a landed crate in the replay snapshot at
  start-of-turn-11). There is **no same-turn loot** of an airdrop on its
  landing turn — by construction, not by special-case.
- `countdown: 0` at the landing-turn input is the deliberate "it lands
  *this* turn — decide now" signal (pillar 8: the affordance is in
  Vision, the model reasons about it from the countdown).

`countdown` is a per-entity Vision field — it does **not** go in the
system prompt. The system-prompt countdown slot is uniquely earned by
evac (one match-meta clock the model must always weigh; the airdrop
clock is per-entity and conditional, so it belongs in Vision next to the
entity it describes — pillar 8: Vision carries the affordance, the
prompt does not re-teach it).

Navigation: `resolveTypedEntity` gains a `Crate_` namespace branch.
Telegraphed airdrops resolve as a movement target (non-LOS — mirror the
evac branch which skips the LOS gate); landed airdrops resolve like a
chest/crate with LOS gating. `visibleTargetIds` emits the `Crate_<x>_<y>`
key in both states so `toward Crate_<x>_<y>` validates.

Vision JSON: a new tier/section for airdrops. Telegraphed entries carry
`{dist, bearing, countdown}`; landed entries carry `{dist, bearing}`
(identical to a static crate — once landed it *is* a crate). `crateSpentById`
(renamed from `chestSpentById`) plus an airdrop-spent check drop SPENT
entities from the projected Vision.

**BC-2 — landed-airdrop loot APPLICATION path (the gap §3.3/§3.4 must
close).** The loot resolver consults `working.world.chests` (post-rename
`world.crates`) **only**, at queue-time (`resolution.ts:560-595`) and at
apply-time (`:758-810`). Airdrops live in a separate
`WorldState.airdrops[]`, so a landed `Crate_<x>_<y>` airdrop currently
resolves `isCrateId` → `world.crates.find` returns `undefined` →
`result:"no_crate"` → **the landed airdrop is unlootable**, breaking
land→lootable→spent, the equip≥80% contribution, and the funnel
looted→spent arm.

Fix — introduce a **shared crate lookup/apply helper** consulting both
sources (preferred over duplicating the open-loop):

- `findCrateById(world, id)` → resolves an id to either a
  `{source:"static", crate}` row from `world.crates` *or* a
  `{source:"airdrop", airdrop}` entry from `world.airdrops` that is
  `LANDED && !looted` (a `TELEGRAPHED` airdrop is **not** lootable —
  range/no-LOS already block it; the helper also returns "not lootable
  yet" for `state.turn ≤ landsAtTurn`, consistent with the BC-3
  resolution-spawn clock — the crate only exists from the spawn
  sub-phase onward).
- The queue-time and apply-time loot branches both call the helper. On
  success: run the existing `equipIntoSlot` side-effect; for a static
  crate flip `opened=true, contents=null`; for an airdrop set
  `looted=true` (= SPENT). Emit the **identical trace contract**
  `{kind:"loot", target:"Crate_<x>_<y>", result:"opened", lootedItem}`
  so `runStats` equip-credit and the airdrop funnel's looted→spent
  transition both read the same shape. Non-success outcomes
  (`already_opened`/`out_of_range`/`empty`) map the same for both
  sources.
- New tests: static crate loot, landed-airdrop loot, telegraphed-airdrop
  not lootable, spent-airdrop already-spent, and static/airdrop id
  collision (an airdrop coord that equals a static crate coord is
  disallowed by authoring — assert the wave table avoids the 12 static
  coords; see §7).

### 3.4 Telefrag + resolution order (WP-D)

The 8-phase resolver (`resolution.ts`) order is locked. Movement is
Phase 4; positions change *only* in Phase 4 (Phase 5 action never moves
anyone). So an agent's *resolved tile* is its post-Phase-4 position,
regardless of whether it camped the bullseye or moved onto it this turn.

**New sub-phase: "World events — airdrop spawn"**, inserted **after
Phase 5 (action) and before Phase 6 (death + corpse formation)**, gated on
`state.turn === landsAtTurn` for each airdrop (turn-derived, mirrors the
Phase-8 evac-reveal/extraction `state.turn === EVAC_*` checks):

1. For each airdrop landing this turn, compute its spawn tile.
2. Find any living character whose post-Phase-4 `pos` equals the spawn
   tile. The two-agents-can-never-share-a-tile movement invariant
   guarantees **at most one** victim per spawn.
3. Telefrag the victim: set `alive=false`, `diedAtTurn = state.turn`,
   **no corpse pushed**, **no gear transferred** to the crate (the crate
   keeps its hand-authored contents). Total vanish.
   **Telefrag-vs-attack precedence (BC-3 cluster, Review B Med):** the
   sub-phase runs **before** Phase 6, so it telefrags **any still-`alive`
   character on the tile regardless of same-turn `hp`** — a victim who
   also took lethal damage this turn vanishes as an environmental death
   and forms **no** corpse and **no** `trace.deaths` entry (telefrag
   wins; the attacker is *not* credited a kill). This is the intended
   contract (total vanish dominates); WP-D adds an explicit precedence
   test. Tile-exclusivity already guarantees ≤1 candidate.
4. Push the victim's id to a **new trace channel
   `trace.environmentalDeaths: string[]`** — *separate from*
   `trace.deaths`. Critically: `runStats` computes
   `kills += t.resolution.deaths.length`, so keeping telefrags out of
   `deaths` is what excludes them from the kill-rate threshold by
   construction (no formula change needed).
5. The airdrop becomes a `LANDED` crate from the **next** turn's inputs
   forward (BC-3: it does not become lootable on the landing turn —
   spawned post-Phase-5, first lootable turn `landsAtTurn + 1`). It is
   looted via the BC-2 shared helper, not the legacy chest-only loop.

Death/alive accounting: Phase 6 only flips weapon/charge deaths; the
telefrag victim is already `alive=false` from the sub-phase, so the
alive count (`characters.filter(c=>c.alive).length`) decrements
naturally and the prize split (computed from survivors at scoring) and
match-termination check (`aliveCount<=1`) recompute with zero new
branching.

**Low note (Review-v1, WP-D must confirm):** `liveActorIds` is
snapshotted at Phase 1 (`resolution.ts:209`); the end-of-turn
scratchpad-update loop (`:1000-1005`) patches by that snapshot, so a
telefragged victim can still receive a **no-op** scratchpad write
(`patchCharacter` finds the now-`alive=false` row, writes a dead row
nobody reads). Harmless, but WP-D must add an assertion that **no
telefragged id is ever re-surfaced** in Vision, kill-feed (as a killer),
prize split, or the next input — only as an `environmentalDeaths` entry.

Kill-feed: `buildKillFeedLines` (`inputBuilder.ts:375`) gains a telefrag
branch reading `prev.resolution.environmentalDeaths` →
`"<Persona> got telefragged by crate spawn"` (no killer token — it is
credited to no agent). **Guard fix (Review B Med — confirmed at
`inputBuilder.ts:379`):** the function early-returns `[]` when
`prev.resolution.deaths.length === 0`; a **pure-telefrag turn** (zero
weapon/charge deaths, non-empty `environmentalDeaths`) would otherwise
emit **no** discoverability line. WP-D changes the guard to
`if (!prev || (prev.resolution.deaths.length === 0 &&
prev.resolution.environmentalDeaths.length === 0)) return [];`. Ordering:
weapon kills, then charge kills, then telefrag (a turn-40
incineration-clock telefrag never out-ranks a weapon kill line — mirrors
phase-10 D17 kill-feed ordering). Tests: "telefrag-only turn emits the
line" + "mixed weapon/charge/telefrag ordering". The line is a
discoverable substrate signal — **no schema surface, no system-prompt
teaching** (pillar 5/6, exactly like body-collision in phase 10).

Schema + plumbing: `resolutionValidator` gains
`environmentalDeaths: v.array(v.id("characters"))`; the persistence
chain plumbs it end-to-end like phase-9 `slide` / phase-10
`bodyCollision`: `runMatch.ts` resolution adapter, prior-turn row, **and
explicitly `adaptPriorTurnRowForBuilder` (`runMatch.ts:~604-646`) must
carry `environmentalDeaths`** so `buildKillFeedLines` actually receives
it (Review B Med — without this the kill-feed branch never fires), plus
the slim projection and `harness/diagnostics/types.ts`.

### 3.5 state-aware stopAtRange + experiment (WP-E)

`resolveTypedEntity` currently hardcodes `stopAtRange` inline per branch
(character 2, chest 2, corpse 2, cover 0, wall 1, evac 0). The North Star
frames it as "per-entity-type by id namespace". Extract a single lookup
(`STOP_AT_RANGE` keyed by `ResolvedEntity.kind`), then make the Crate
entry **state-aware**: a function of airdrop lifecycle state, not a flat
constant —

| Namespace | stopAtRange |
|---|---|
| character / chest|crate (static) / corpse | 2 |
| cover / evac | 0 |
| wall | 1 |
| **Crate — TELEGRAPHED** | **0** (race onto the tile) |
| **Crate — LANDED** | **2** (normal loot) |

The telegraphed value is the experiment knob. A harness-level override
(env var / CLI flag threaded into the resolver via `MatchState` or a
resolver option, **not** persisted, **not** schema) lets the experiment
force telegraphed-crate stopAtRange to 0 or 2. Default ships 0.

Experiment (`harness/` script, mirrors `probe-*.ts` style): run 10
matches with telegraphed stopAtRange 0 and 10 with 2; report
environmental-death (telefrag) counts per cohort so the user can judge
"rare funny" vs "annoying noise". **In-loop measurement, explicitly NOT a
closing gate.**

### 3.6 runStats kill-attribution fix (WP-F, rider)

Bug (code-verified at `runStats.ts:209`; structurally zero since
phase 6; known-issue record in `PHASE-9-CLOSURE.md` /
`PHASE-10-CLOSURE.md` — **not** a mental-model § per BC-4): in
`runStats.ts`, `deathSet = new Set(t.resolution.deaths)` holds engine
`characterId`s, but `a.target` on attack/overwatch actions is the persona
**displayName** (`resolution.ts:483-489`). `deathSet.has(a.target)` never
matches → `perPersona[*].kills` silently always 0. Top-level
`kills = deaths.length` is unaffected, which is why closing kill-rate
gates kept passing while per-persona was dead.

Fix — mirror `buildTargetIdLookup` from `turnsDerived.ts:auditDamageFeed`:

- Build a `Map<string,string>` from match participants
  (`turns[].agentRecords` `{characterId, personaId}` + `characters`
  `{_id, personaId}`), mapping `characterId`, `personaId`, and
  `titleCase(personaId)` (= displayName) all → engine `characterId`
  (mirror `personaToDisplayName`). **`runStats.ts:59` currently imports
  only `{ PERSONA_IDS, type PersonaId }` from `./types.js` — WP-F must
  add `titleCase` to that import** (`titleCase` exists at `types.ts:50`;
  the plan-v1 "already available" wording was wrong).
- `const tid = lookup.get(a.target) ?? a.target;` then
  `deathSet.has(tid)`.
- Credit lethal `kind:"counter"` (currently only `attack`/`overwatch`
  are credited at `runStats.ts:207` — counter-fire that lands lethally
  (`resolution.ts:733-741`, target also displayName) goes unattributed;
  `turnsDerived.ts:auditDamageFeed`'s `isDamageAction` already includes
  `counter`, so the mirror covers it).
- Telefrag/env-deaths: not in `trace.deaths`, no attacker action →
  naturally excluded from per-persona credit AND from top-level `kills`.
  Add a regression test asserting an env-death turn does not corrupt
  attribution and is not counted as a kill.
- `runStats.test.ts` contract **rebuilt, not tweaked** — the current
  fixtures pass *because* the shape is broken (they target character
  ids, hiding the displayName mismatch); asserting correct attribution
  requires new participant-bearing fixtures with displayName targets,
  lethal `counter`, and env-death-only turns.

### 3.7 Diagnostics + closing report (WP-G)

Mirror the phase-9/10 Path-2 sibling-payload pattern verbatim:

- `convex/reports/phase12.ts` — `computePhase12Metrics`,
  `phase12PayloadValidator`, `persistComputedPhase12Report`. Preserved
  phase-9/7 threshold gates + slice-specific gates (see §5).
- `harness/closing/phase12.ts` — CLI driver cloned from
  `harness/closing/phase10.ts` (slim fan-out + local compute + small
  persist). `reportType: "phase-12-closing-20"`.
- `convex/schema.ts` — `phase12Payload: v.optional(phase12PayloadValidator)`
  added as a sibling field on `reports` (additive, exact-match-object
  precedent from phases 3/6/7/9/10).
- `harness/diagnostics/mechanics.ts` + `apps/replay/src/routes/Diagnostics.tsx`
  — add the **environmental-death** stat and the **airdrop funnel**
  (telegraphed-seen → landed → looted/spent, + telefrag count), keyed off
  `environmentalDeaths` and the airdrop Vision entries. Diagnostics CLI
  is the canonical machine-introspection surface
  (`feedback_observability_targets_agents`); the dashboard is the human
  one. Rows deep-link to the existing turn modal (no new modal).

### 3.8 Decision matrix (architecture options weighed)

| Decision | Options | Chosen | Why |
|---|---|---|---|
| Airdrop storage | (a) extra state on `crates[]`; (b) new `airdrops[]` array | **(b)** | An airdrop has a landing-turn lifecycle + telefrag semantics a static crate lacks; conflating them forces `if (isAirdrop)` branches everywhere. Separation = single forward shape, mirrors `chests`/`corpses`/`evac` decomposition. |
| Lifecycle state | (a) stored `state` enum; (b) turn-derived | **(b)** | Evac reveal/extraction is turn-derived (`state.turn === EVAC_*`); mirroring it keeps determinism trivially provable and avoids a mutable state machine to persist/migrate. |
| Telefrag death channel | (a) reuse `trace.deaths`; (b) new `environmentalDeaths` | **(b)** | `runStats` derives `kills` from `deaths.length`; reusing it would inflate kill-rate (North Star forbids). Separate channel = exclusion by construction, no formula edits, clean diagnostics key. |
| Telefrag phase placement | (a) fold into Phase 8; (b) new sub-phase after Phase 5 | **(b)** | Must run after movement (resolved tile) but feed alive/termination accounting; placing it before Phase 6 lets death/alive/prize fall out with zero new branching. Phase 8 is post-increment and after corpse formation — wrong ordering. |
| Countdown location | (a) system prompt; (b) per-entity Vision | **(b)** | Pillar 8 — Vision carries the affordance; the prompt does not re-teach it. Evac uniquely earns the prompt slot (always-on match clock); airdrop clock is conditional + per-entity. |
| Catalog determinism | (a) keep `rollLoot`, seed-fixed; (b) hand-authored `contents` | **(b)** | "No RNG" + "identical every run regardless of seed". Seed-fixed rolls are still RNG-shaped and break the diff-friendly authoring the North Star wants. |
| Landed-airdrop loot (BC-2) | (a) duplicate the open-loop for `airdrops[]`; (b) shared `findCrateById` helper over `crates[]`+`airdrops[]` | **(b)** | Single forward shape; one trace contract (`result:"opened"`/`lootedItem`) keeps `runStats` equip-credit + funnel reading one shape; avoids `if(isAirdrop)` drift across queue-time and apply-time loops. |
| External research | perplexity vs codebase precedent | **codebase precedent** | No library/framework choice exists; the architecture is fully determined by pillars + the phase-9/10 mirror precedent. External research would add noise, not signal (per CLAUDE.md / mental-model: internal pillars are the authority). |

---

## 4. Dependency Map & Parallelization

```
WP-A (rename)  ─────────────┬─ touches every layer; the substrate other WPs build on
                            │
WP-B (catalog) ─────────────┤  depends on A's CrateState/descriptor rename
                            │
WP-C (airdrop SM) ──────────┤  depends on A (Crate id), B (ItemRef contents)
                            │
WP-D (telefrag) ────────────┤  depends on C (airdrop state + landsAtTurn)
                            │
WP-E (stopAtRange+exp) ─────┤  depends on C (lifecycle state for state-aware row)
                            │
WP-F (runStats rider) ──────┤  attribution-logic independent of A–E, BUT
                            │  shares the runStats.ts FILE with WP-A's
                            │  isChestId→isCrateId rename (BC-7 owns it);
                            │  env-death regression test depends on D
                            │
WP-G (diagnostics+report) ──┴─ depends on C+D (airdrop funnel, env-death); LAST
```

Parallelization opportunities:

- **WP-F (runStats rider) starts immediately, in parallel with WP-A —
  with the BC-7 ownership rule below.** The attribution logic
  (`buildTargetIdLookup` mirror, counter-credit, env-death-safety) is
  independent of A–E; the only behavioural cross-dependency is the
  env-death regression test, which stubs the new `environmentalDeaths`
  channel until D lands (or is added in a D↔F sync commit).
- **BC-7 — `convex/engine/runStats.ts` ownership (was inaccurately
  "WP-F touches only runStats.ts / is INDEPENDENT").** §3.1 lists the
  `isChestId`→`isCrateId` rename of `runStats.ts:61,225` under **WP-A**,
  and WP-F rewrites attribution in the *same file* → guaranteed merge
  touchpoint. **Decision: WP-F OWNS `convex/engine/runStats.ts`
  end-to-end** — it absorbs the `isChestId`→`isCrateId` rename *and*
  adds the `titleCase` import *and* the `buildTargetIdLookup` mirror in
  one coherent edit. **WP-A explicitly EXCLUDES `runStats.ts`** from its
  rename sweep (the only such carve-out; §3.1's runStats row is owned by
  WP-F, noted there). The post-WP-A re-grep gate therefore does **not**
  assert `runStats.ts` clean until WP-F also lands; the closing
  grep-clean gate (§6) covers it. WP-A and WP-F otherwise dispatch in
  parallel with no file overlap.
- **WP-A must land first** for B–E (it renames the substrate they edit).
  Treat A as a fast, mechanical, test-green merge gate.
- **WP-B and the WP-A persona/doc scrub can run concurrently** (disjoint
  files: catalog types vs `personas/*.md`).
- **WP-C → WP-D → (WP-E ∥ start of WP-G)**: D needs C's airdrop model;
  E needs C's lifecycle; G needs C+D's observable signals. E's resolver
  lookup extraction is independent enough to start once C's state model
  is typed.
- **WP-G is last** and gates the closing run.

Critical path: **A → C → D → G** (rename → airdrop → telefrag →
report). B, E, F hang off it with slack.

---

## 5. Work Package Breakdown (UAT vertical slices)

Each WP is a vertical slice with its own tests (TDD: red → green) and a
manual/observable success check. All WPs preserve the standard gates
(lint, ts:check, build, full test suite).

### WP-A — Crate vocabulary rename

**Scope:** §3.1 blast-radius (full re-derived inventory), **excluding
`convex/engine/runStats.ts` which WP-F owns (BC-7)**. Includes the
BC-1-added surfaces: `matches.ts` (rename only; WP-B does its
determinism flip), `decisionTool.ts`, `validation.ts`, `worldState.ts`,
`reportStats.ts`, `lastKnown.ts`, `turnsDerived.ts` (literals only —
not the `buildTargetIdLookup` logic), the full replay-UI set, the
harness diagnostics consumers. Single forward shape; dev DB wipe; no
shims. Persona scrub is mechanical only (no behaviour tuning).

**Success criteria:**
- **Post-WP-A re-grep gate (BC-1, hard exit):** the scripted
  live-surface `[Cc]hest` scan (the §3.1 file set, frozen list excluded,
  `runStats.ts` excluded pending WP-F per BC-7) returns **zero** hits.
  This is a scoped scan, **not** a naive full-repo `rg chest`.
- `Crate_<x>_<y>` is the agent-facing id; loot dispatch still routes
  crates vs corpses by id namespace; `validation.ts` gate is
  `kind === "crate" || "corpse"` and its rejection text says "crate";
  `decisionTool.ts` tool grammar says "crate"; all existing engine/llm
  tests pass after rename.
- **`matches.ts:expandMapInline` and `map.ts:expandMap` produce
  byte-identical crate ids** (parity test — the determinism-flip of
  *contents* is WP-B; WP-A only proves the id/field rename keeps the two
  seams in lockstep).
- **All 8 persona prompts are checked; only files containing hits**
  (`personas/{duelist,vulture,opportunist,camper}.md` + the
  `convex/_data/personas.ts` inlined copies) are edited; the
  markdown↔inline cross-check test passes; no other persona word
  changes (no behaviour tuning).
- Live spec docs (concept-spec §6/§7/§8/§13/§14, architecture.md,
  decision-tool-schema-draft.md, behavioural-diagnostics-intent.md, the
  single `mental-model.md` literal) say "crate". **No phase-12 section
  is added to `mental-model.md`** — STRUCK per BC-4/D4 (§11 already
  carries intent; a §20 log would violate the why-layer's own
  no-assignment-logs header rule).

### WP-B — Deterministic equipment catalog

**Scope:** §3.2. Expand weapon/armour tiers (plain names); descriptor
crate entries carry `contents: ItemRef`; retire `rollLoot` from the crate
path; flip the determinism contract.

**Success criteria:**
- New tiers present in `WeaponName`/`ArmourName` unions, `WEAPONS`/
  `ARMOUR` stat tables, `itemRefValidator`, all consistent.
- `expandMap(d,"x")` deep-equals `expandMap(d,"y")` **and**
  `expandMapInline(d,"x")` deep-equals `expandMapInline(d,"y")` for
  **all** crate contents, **and** `expandMap` deep-equals
  `expandMapInline` (BC-1: both seams flipped + parity; the old
  "differs by seed" assertion is deleted).
- No `rollLoot`/`makeRng`/`LOOT_TABLES` reference remains on the
  crate-contents path in **either** `map.ts` or `matches.ts`
  (`loot.ts` crate path fully deleted per D3).
- Closing report shows visible equipment variance across agents/runs
  (equip ≥ 80% preserved; variance observable in diagnostics
  equipment cross-cut).

### WP-C — Airdrop entity state machine

**Scope:** §3.3. `AirdropState`, the BC-3 two-clock turn-derived
lifecycle, non-LOS telegraph with `countdown`, `Crate_<x>_<y>`
navigation, Vision section, SPENT-absence, **the BC-2 shared
`findCrateById` loot helper**, schema + persistence plumbing,
hand-authored wave table (§7), replay-snapshot representation of
telegraphed/landed/spent airdrops.

**Success criteria:**
- **BC-3 turn boundary:** for `landsAtTurn ∈ {10,20,30,40}` the
  telegraphed airdrop appears in **every** living agent's Vision in the
  inputs for turns `landsAtTurn-3 .. landsAtTurn` (four inputs) with
  `countdown` 3→2→1→**0**, non-LOS; it is **not lootable on
  `landsAtTurn`**; it is first `LANDED`/lootable in the inputs for
  `landsAtTurn+1`. Tests pin countdown values and the first-lootable
  turn explicitly.
- **BC-2 loot path:** a landed airdrop is lootable at range 2 via the
  shared `findCrateById` helper, emits
  `{kind:"loot",result:"opened",lootedItem}` identical to a static
  crate, and flips to SPENT (`looted=true`); a telegraphed airdrop and a
  spent airdrop are **not** lootable (correct non-success traces). Tests:
  static crate, landed airdrop, telegraphed-not-lootable,
  spent-already-spent, static/airdrop coord-collision rejected.
- Once looted/empty (SPENT) it is absent from Vision (not a flag —
  pillar 8).
- `toward Crate_<x>_<y>` validates and navigates in both telegraphed
  and landed states (engine test + replay observation).
- Replay snapshot represents telegraphed (with countdown), landed, and
  spent airdrops for the human UI without re-entering LLM Vision once
  spent.
- Determinism: identical airdrop positions/contents/countdowns across
  two runs with different seeds; wave coords avoid the 12 static crate
  coords.

### WP-D — Telefrag

**Scope:** §3.4. New sub-phase after Phase 5 / before Phase 6;
`environmentalDeaths` trace channel; total vanish; kill-feed line;
alive/prize recompute; schema + persistence.

**Success criteria:**
- An agent on the spawn tile on the landing turn (camped OR moved-onto-it
  that turn) is removed entirely: no corpse entity, no lootable gear,
  nothing transferred to the crate.
- Kill-feed emits exactly `"<Persona> got telefragged by crate spawn"`,
  no killer token, ordered after weapon/charge kills. **A pure-telefrag
  turn (zero weapon/charge deaths) still emits the line** — the
  `inputBuilder.ts:379` early-return guard is widened to also check
  `environmentalDeaths.length`, and `adaptPriorTurnRowForBuilder` carries
  `environmentalDeaths` (tests: telefrag-only-turn + mixed-ordering).
- **Telefrag-vs-attack precedence:** an agent on the tile that also took
  lethal same-turn damage is telefragged (env-death only, no corpse, no
  `trace.deaths`, attacker NOT credited) — explicit precedence test.
- Recorded in `environmentalDeaths`, **excluded** from `trace.deaths`
  and therefore from kill-rate; alive count decrements; match
  termination + prize split recompute among survivors.
- At most one telefrag victim per spawn (tile-exclusivity invariant —
  asserted by test).
- **No telefragged id is re-surfaced** in Vision, kill-feed (as killer),
  prize split, or the next input — only as an `environmentalDeaths`
  entry (confirms the `liveActorIds` snapshot no-op-patch is harmless;
  Review-v1 Low note).
- No schema field or system-prompt text teaches telefrag (discoverable).

### WP-E — state-aware stopAtRange + telefrag-frequency experiment

**Scope:** §3.5. Extract `STOP_AT_RANGE` lookup; state-aware Crate row
(telegraphed 0 / landed 2); non-persisted override knob; harness
experiment.

**Success criteria:**
- `resolveTypedEntity` reads `stopAtRange` from a single namespace lookup;
  Crate is state-aware (telegraphed 0, landed 2) by default.
- Override knob forces telegraphed Crate stopAtRange to 0 or 2 without
  schema/persist changes.
- Harness experiment runs 10 matches @ 0 and 10 @ 2 and prints telefrag
  environmental-death counts per cohort. Documented as in-loop
  measurement, **not** a closing gate.

### WP-F — runStats per-persona kill-attribution fix (rider)

**Scope:** §3.6 + **BC-7: WP-F OWNS `convex/engine/runStats.ts`
end-to-end** — in one coherent edit it (a) renames
`isChestId`→`isCrateId` (`:61`,`:225`) [carved out of WP-A], (b) adds
`titleCase` to the `./types.js` import (`:59`), (c) mirrors
`buildTargetIdLookup`, (d) credits lethal `kind:"counter"`, (e) is
env-death-safe, (f) rebuilds the `runStats.test.ts` contract. Dispatches
in parallel with WP-A (no file overlap given the carve-out).

**Success criteria:**
- `runStats.ts` is `isCrateId`-clean (the BC-7 carve-out closes here;
  the §6 closing grep-clean covers it since the §3.1/WP-A re-grep
  excludes it pending WP-F).
- `titleCase` imported from `./types.js`.
- `perPersona[*].kills` is non-zero and correctly attributed on a
  synthetic match with named-persona (displayName) attack targets
  (new/rebuilt test — current fixtures pass *because* the shape is
  broken; this is a contract rebuild, not an assertion tweak).
- Lethal `kind:"counter"` fire is credited.
- An env-death (telefrag) turn neither credits any persona nor counts
  toward top-level `kills`.
- `runStats.test.ts` asserts the correct (not the broken-shape) contract.

### WP-G — Diagnostics + phase-12 closing report

**Scope:** §3.7. `phase12.ts` report + `closing/phase12.ts` driver +
`phase12Payload` schema; env-death stat + airdrop funnel in
`mechanics.ts` + replay Diagnostics tab.

**Success criteria:**
- `convex run reports:byId` on the persisted `phase-12-closing-20`
  report exposes preserved + slice-specific gates (§5 assignment-level).
- Diagnostics CLI emits the environmental-death stat and the airdrop
  funnel over the last ≤20 matches; replay Diagnostics tab renders the
  same with drill-down to the existing turn modal.
- 20-run closing report persisted; `metBar` verdict recorded with any
  documented why-not (phase-9/10 closure-record discipline).

---

## 6. Assignment-Level Success Criteria

Closing bar — a persisted 20-run `phase-12-closing-20` report
(`convex/reports/phase12.ts`, Path-2 sibling-payload) that:

**Preserved phase-9/7 thresholds (all PASS, no regression):**
extraction ≥ 30%, kill ≥ 80%, equip ≥ 80%, speech ≥ 50%, persona
extraction spread ≥ 15 pp, zero crashes / failed matches, per-field
rejection ≤ 10%, zero illegal `use:"consumable"`, zero `Player_N`
literals, zero whole-turn validator zeroes.

**Slice-specific evidence:**
- Rename grep-clean across all scoped live surfaces (the §3.1 scoped
  scan, **including `runStats.ts` once WP-F lands** — the closing gate
  covers the BC-7 carve-out; frozen docs/closed-phase aggregators
  excluded, NOT a naive full-repo `rg`).
- Airdrop lifecycle observable in replay: telegraph (with per-entity
  countdown 3→2→1→0 across the four inputs `landsAtTurn-3..landsAtTurn`)
  → first LOS-gated lootable at `landsAtTurn+1` → spent-absent (BC-3
  semantics).
- ≥ 1 telefrag environmental-death across the closing-20 with the exact
  kill-feed line, recorded under the environmental-death stat, excluded
  from kill-rate.
- `runStats perPersona[*].kills` non-zero and correctly attributed;
  lethal counter-fire credited; telefrag does not corrupt attribution.
- Telefrag-frequency experiment delivered (10 @ stopAtRange 0 vs 10 @ 2,
  telefrag counts reported) — in-loop, not a gate.
- Determinism: two runs produce identical crate positions + contents +
  airdrop schedule; `maps/reference.json` terrain/cover/spawns/evac
  byte-identical to pre-slice.
- Diagnostics CLI + replay Diagnostics tab surface env-death stat +
  airdrop funnel.

**Standard gates:** lint, ts:check, build, full test suite green.

---

## 7. Resolved Decisions (Q1–Q5 — RECORDED, not open)

All five plan-v1 questions are **resolved** by PM Decisions D2–D6; this
section records the ratified POC defaults so WP-B/WP-C are
dispatch-ready (no placeholders, no user escalation). Per **D5** these
tables are a **reversible POC working default** — the user retunes via
the watch→revise loop in UAT, not a pre-impl block.

**Q1/Q2 — RESOLVED (D5).** Catalog + static-crate + airdrop-wave tables
pinned below. **Q2: keep all 12 reference-map crate coords; swap
`lootTable`→`contents` (minimal diff).**

*New catalog tiers (plain names, pure `damage`/`reduction` — no richer
stats; the multi-stat seam is deferred per §12/North-Star OOS):*

| Kind | Existing (unchanged) | Added (plain) |
|---|---|---|
| Weapon | `rusty_blade`, `sword`, `axe`, `greatsword` | `dagger` (damage 8, range 2), `warhammer` (damage 30, range 2) |
| Armour | `cloth`, `leather`, `chain`, `plate` | `riot_plate` (reduction 14) |
| Consumable | `heal`, `speed` | — (unchanged) |

Extend `WeaponName`/`ArmourName` unions, `WEAPONS`/`ARMOUR` stat tables
(`types.ts`), `itemRefValidator` (`schema.ts`) — all consistent.

*Static-crate contents (12 reference coords, `lootTable`→`contents`;
variance vehicle — spread, no value-curve constraint):*

| Coord | was lootTable | contents (POC default) |
|---|---|---|
| (14,14) | starter | armour `cloth` |
| (85,14) | starter | weapon `dagger` |
| (14,85) | starter | weapon `rusty_blade` |
| (85,85) | starter | armour `leather` |
| (33,33) | weapons-light | weapon `sword` |
| (66,33) | weapons-light | weapon `axe` |
| (47,46) | weapons-light | armour `chain` |
| (49,52) | weapons-light | weapon `sword` |
| (33,66) | weapons-heavy | weapon `greatsword` |
| (66,66) | weapons-heavy | armour `plate` |
| (53,54) | weapons-heavy | weapon `warhammer` |
| (50,25) | consumables | consumable `heal` |

*Airdrop wave table (value curve T10 weakest → T20/T30 strong → T40
strong-under-incineration-clock; coords avoid all 12 static coords; T40
@ evac bullseye per D2):*

| Lands | Coord | Contents | Rationale |
|---|---|---|---|
| Turn 10 | (50,50) | armour `leather` | weakest; centre-ish, accessible |
| Turn 20 | (25,75) | weapon `axe` | strong; contested off-centre |
| Turn 30 | (75,25) | armour `plate` | strong; opposite quadrant |
| Turn 40 | **(48,48)** | weapon `greatsword` | strong, under the turn-30-revealed evac clock; **evac bullseye** — the canonical camp-the-bullseye telefrag (D2) |

> WP-C must verify each airdrop coord is a non-wall, navigable tile
> against `maps/reference.json` walls; if a literal collides with a
> wall, nudge to the nearest open tile and note it — coords are a
> reversible POC default (D5), not a frozen contract. No static/airdrop
> coord collision exists by construction (asserted by test).

**Q3 — RESOLVED (D2).** T40 @ (48,48) is the evac centre
(`reference.json:74`, `EVAC_HALF_SIZE=1` → 3×3 zone 47–49). Dead-centre
is **intended** — the North Star explicitly wants the
late-loot-vs-incineration tension and the canonical bullseye telefrag.
No adjacent-tile substitution.

**Q4 — RESOLVED (D3).** Full deletion of `rollLoot`/`LOOT_TABLES` from
the crate path (single forward shape, POC). The deferred-RNG slice
brings its own mechanism; preserving dead code violates
"no back-into-a-corner". Closed-phase report tests referencing
`loot.ts` semantics are frozen (§3.1) and out of scope.

**Q5 — MOOT (D4).** `mental-model.md` §11 already carries the
phase-12 crate/airdrop/telefrag/equipment-variance intent. **No §20 is
authored** — adding a phase-12 section to the just-slimmed why-layer
violates its own no-assignment-logs header rule. The WP-A "add
mental-model §20" task is **STRUCK** (BC-4). The runStats bug is
engine current-state (this doc / closure / `runStats.ts` /
`turnsDerived.ts`), not why-layer material.

---

## 8. Recommended Job Sequence

1. **Q1–Q5 resolved (§7, D2–D6) and plan-v1 reviewed → this plan-v2
   folds all binding conditions.** No further pre-dispatch decisions;
   PM gates dispatch after this revision.
2. **Dispatch WP-A and WP-F in parallel** (A = mechanical rename merge
   gate excluding `runStats.ts`; F = runStats rider owning `runStats.ts`
   per BC-7 — no file overlap). Land A first / fast.
3. **WP-B and the WP-A persona+doc scrub concurrently** post-A.
4. **WP-C → WP-D**, then **WP-E ∥ WP-G start**.
5. **WP-G last**, gating the 20-run closing.
6. **UAT before closure:** step the closing-20 through the replay UI
   (airdrop telegraph countdown, landed loot, spent-absence, ≥1 telefrag
   feed line) + the Diagnostics tab (env-death + airdrop funnel) — the
   phase-9/10 backend-slice UAT precedent.
7. **Closure record** `PHASE-12-CLOSURE.md` mirroring the phase-9/10
   single-file-handoff format (canonical reportId, threshold verdict,
   ADR rollup, deferred items).

**Implement-first, not review-first** for the WPs themselves (TDD per
AOP.IMPLEMENT — tests red→green inside each WP); the plan itself was
review-first (plan-v1 → unanimous APPROVE-WITH-BINDING-CONDITIONS →
this plan-v2), given the cross-cutting rename + the discoverable-mechanic
correctness sensitivity (telefrag must not corrupt kill attribution —
the runStats `characterId`-vs-`displayName` bug is code-verified at
`runStats.ts:209` / `resolution.ts:483-489`, with the mirror remedy at
`turnsDerived.ts:buildTargetIdLookup`).

---

## 9. Cross-references

- North Star: assignment brief (this dispatch).
- Why-layer: `docs/project/spec/mental-model.md` pillars 1/5/6/8 and
  **§11** (current vision — crate/airdrop/telefrag/equipment-variance
  intent). *(All plan-v1 `§16/§17/§18/§19/§20` citations were stale —
  the slimmed file has 12 §§; re-pointed here per BC-4.)*
- runStats bug source-of-truth: `convex/engine/runStats.ts:209`
  (`deathSet` characterId vs `a.target` displayName),
  `convex/engine/resolution.ts:483-489`; known-issue record in
  `PHASE-9-CLOSURE.md` / `PHASE-10-CLOSURE.md` (not a mental-model §).
- Mechanics: `docs/project/spec/concept-spec.md` §6/§7/§8/§13/§14.
- Mirror precedents: `docs/project/phases/10-body-collision-overseer/PHASE-10-CLOSURE.md`
  (discoverable mechanic + closing mirror),
  `docs/project/phases/09-walls-vision-rect-grained/PHASE-9-CLOSURE.md`
  (Path-2 report pattern),
  `docs/project/phases/11-db-bandwidth-substrate/PHASE-11-CLOSURE.md`
  (forward-shape schema break / dev wipe).
- runStats fix pattern: `convex/turnsDerived.ts:auditDamageFeed`
  (`buildTargetIdLookup`, `personaToDisplayName`).
