# Phase 12 — Crate substrate + handcrafted equipment variance + world-event airdrop

> Spec doc + WP breakdown. Planning artifact for the crate-rename +
> deterministic equipment-variance catalog + world-event airdrop-crate
> slice (telegraph → land → spent, with telefrag), plus the runStats
> per-persona kill-attribution rider.
>
> Status: PLANNED — not yet dispatched. Source-of-truth intent is the
> North Star in the assignment brief and `docs/project/spec/mental-model.md`
> pillars 1/5/6/8. This doc is the "how"; the mental model is the "why".

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
- **runStats per-persona kill-attribution fix.** Structurally zero since
  phase 6 (mental-model §16 known issue, the "fourth occurrence" of the
  contract-drift family). Picked up now because telefrag introduces a
  killer-less death that *must not* corrupt attribution, and a closing
  gate this slice asserts non-zero correctly-attributed perPersona kills.

Determinism is mandatory and load-bearing: keeping one variable at a time
has paid off every phase, and RNG (loot, spawns, walls/cover/evac) is a
deliberately separate later slice *after* mechanics, *before* render.

---

## 2. Overview — what is being built

| # | Deliverable | Shape |
|---|---|---|
| A | **chest→crate rename** | Single forward shape across engine, vision, idNormalisation, inputBuilder, schema, runMatch, diagnostics, reports, tests, 8 personas, both spec docs. `Chest_<x>_<y>` → `Crate_<x>_<y>`. Dev DB wipe; no migration shims. |
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

Blast-radius inventory (grep-anchored — every `chest`/`Chest`/`chest_`
literal in an agent-facing surface, engine path, persona prompt, replay
UI, diagnostics, or report aggregator must be retired):

| Layer | Files | Nature |
|---|---|---|
| Engine types | `convex/engine/types.ts` | `ChestState`→`CrateState`; `VisibleEntity` `kind:"chest"`→`"crate"`; `MapDescriptor.chests`→`.crates` |
| Engine map | `convex/engine/map.ts` | `Chest_${x}_${y}`→`Crate_${x}_${y}`; descriptor field rename; **WP-B retires `rollLoot`** here |
| Engine loot tables | `convex/engine/loot.ts` | head-note + `LOOT_TABLES` semantics (WP-B reworks; see §3.2) |
| Engine resolution | `convex/engine/resolution.ts` | `isChestId`→`isCrateId`; `interacts`/chest-open branch comments + trace; **WP-D adds airdrop phase** |
| Engine runStats | `convex/engine/runStats.ts` | `isChestId`→`isCrateId`; **WP-F reworks attribution** |
| LLM id-normalisation | `convex/llm/idNormalisation.ts` | `isChestId`, `findChestByTargetId`, `ResolvedEntity.kind`, Crate namespace branch (WP-C/E) |
| LLM input builder | `convex/llm/inputBuilder.ts` | `renderChestId`, `chestSpentById`→`crateSpentById`; kill-feed (WP-D); Vision (WP-C) |
| LLM vision | `convex/engine/vision.ts` | `kind:"chest"` emission; airdrop emission (WP-C) |
| Schema | `convex/schema.ts` | `chestValidator`→`crateValidator`; `resolutionValidator` (WP-D env-deaths); `worldState`/`worldStatic` (WP-C airdrop); `phase12Payload` (WP-G) |
| Run-match plumbing | `convex/runMatch.ts`, `convex/_internal_runMatch.ts` | `worldRow.chests` adapter both directions; airdrop persist (WP-C); env-death plumb (WP-D) |
| Reference map | `maps/reference.json` | `"chests"`→`"crates"`; entries gain `contents` (WP-B); airdrop wave table (WP-C) — terrain/cover/spawns/evac **byte-identical** |
| Personas | `personas/{duelist,camper,vulture,opportunist}.md` **and** `convex/_data/personas.ts` inlined copies | mechanical `chest`→`crate` scrub only; tests cross-check both copies |
| Diagnostics | `harness/diagnostics/mechanics.ts`, `harness/diagnostics/types.ts`, `apps/replay/src/routes/Diagnostics.tsx`, `apps/replay/src/lib/decisionEnglish.ts` | chest funnel labels/keys |
| Reports | `convex/reports/*.ts` | chest-funnel metric keys (new phase12 aggregator; historical phaseN payloads are frozen and not back-renamed — they are not agent-facing) |
| Spec docs | `docs/project/spec/concept-spec.md` §6/§7/§8/§13/§14, `docs/project/spec/mental-model.md` | prose chest→crate; add phase-12 §20 to mental-model |
| Tests | `tests/**` (engine, llm, reports, integration, runMatch, turns) | fixtures + assertions |

Decision: historical persisted `reports.phase{3,6,7,9,10}Payload` rows and
their aggregator source are **not** retro-renamed — they are not
agent-facing, the DB is wiped anyway, and freezing closed-phase
aggregators is the established precedent (closed phases are contracts, not
live surfaces). The grep-clean acceptance gate scopes to *agent-facing
surface, engine dispatch path, persona prompt, replay UI, diagnostics, and
the **phase-12** report aggregator* — verbatim from the North Star AC.

### 3.2 Deterministic equipment catalog (WP-B)

Today `expandMap` rolls each chest's contents via
`rollLoot(c.lootTable, rng)` seeded by `rngSeed:chest:<id>` — the **only**
content RNG in the slice (the other RNG, `assignPersonasToSpawns`, is the
explicitly-deferred player-spawn-permutation slice and is **left
untouched**; "no RNG introduced" forbids *adding* RNG, it does not
mandate retiring the pre-existing, separately-scoped spawn permutation).

Move to fully hand-authored, seed-independent contents:

- `MapDescriptor.crates` entries change from `{x,y,lootTable}` to
  `{x,y,contents:ItemRef}`. `expandMap` copies `contents` verbatim — no
  `rollLoot`, no per-crate rng stream. `LOOT_TABLES`/`rollLoot` are
  retired from the crate path (kept only if still referenced by tests
  being rewritten; prefer deletion — single forward shape).
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

Lifecycle, derived from `state.turn` vs `landsAtTurn` (no stored state
machine — turn-derived, like evac reveal):

| State | Condition | Vision treatment | stopAtRange |
|---|---|---|---|
| `PRE` | `turn < landsAtTurn - 3` | absent | — |
| `TELEGRAPHED` | `landsAtTurn - 3 ≤ turn < landsAtTurn` | emitted to **every** agent, non-LOS, non-Chebyshev, with `countdown: landsAtTurn - turn` | 0 (race onto tile) |
| `LANDED` | `turn ≥ landsAtTurn` AND `!looted` | normal LOS+Chebyshev-gated lootable crate | 2 (loot) |
| `SPENT` | `looted` | absent (absence, not a flag — pillar 8) | — |

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
4. Push the victim's id to a **new trace channel
   `trace.environmentalDeaths: string[]`** — *separate from*
   `trace.deaths`. Critically: `runStats` computes
   `kills += t.resolution.deaths.length`, so keeping telefrags out of
   `deaths` is what excludes them from the kill-rate threshold by
   construction (no formula change needed).
5. The airdrop becomes a normal `LANDED` crate at the spawn tile from
   this turn forward (its `landsAtTurn` has been reached).

Death/alive accounting: Phase 6 only flips weapon/charge deaths; the
telefrag victim is already `alive=false` from the sub-phase, so the
alive count (`characters.filter(c=>c.alive).length`) decrements
naturally and the prize split (computed from survivors at scoring) and
match-termination check (`aliveCount<=1`) recompute with zero new
branching.

Kill-feed: `buildKillFeedLines` (`inputBuilder.ts`) gains a telefrag
branch reading `prev.resolution.environmentalDeaths` →
`"<Persona> got telefragged by crate spawn"` (no killer token — it is
credited to no agent). Ordering: weapon kills, then charge kills, then
telefrag (a turn-40 incineration-clock telefrag never out-ranks a weapon
kill line — mirrors phase-10 D17 kill-feed ordering). The line is a
discoverable substrate signal — **no schema surface, no system-prompt
teaching** (pillar 5/6, exactly like body-collision in phase 10).

Schema: `resolutionValidator` gains
`environmentalDeaths: v.array(v.id("characters"))`; persistence chain
(`runMatch.ts` resolution adapter, prior-turn row, slim projection,
`harness/diagnostics/types.ts`) plumbs it end-to-end like phase-9 `slide`
/ phase-10 `bodyCollision`.

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

Bug (mental-model §16, structurally zero since phase 6): in
`runStats.ts`, `deathSet = new Set(t.resolution.deaths)` holds engine
`characterId`s, but `a.target` on attack/overwatch actions is the persona
**displayName** (post-iter-2 surface). `deathSet.has(a.target)` never
matches → `perPersona[*].kills` silently always 0. Top-level
`kills = deaths.length` is unaffected, which is why closing kill-rate
gates kept passing while per-persona was dead.

Fix — mirror `buildTargetIdLookup` from `turnsDerived.ts:auditDamageFeed`:

- Build a `Map<string,string>` from match participants
  (`turns[].agentRecords` `{characterId, personaId}` + `characters`
  `{_id, personaId}`), mapping `characterId`, `personaId`, and
  `titleCase(personaId)` (= displayName) all → engine `characterId`
  (mirror `personaToDisplayName`). `runStats` already has `PERSONA_IDS`
  / `titleCase` available from `./types.js`.
- `const tid = lookup.get(a.target) ?? a.target;` then
  `deathSet.has(tid)`.
- Credit lethal `kind:"counter"` (currently only `attack`/`overwatch` are
  credited — counter-fire that lands lethally goes unattributed; the §16
  footnote calls this out explicitly).
- Telefrag/env-deaths: not in `trace.deaths`, no attacker action →
  naturally excluded from per-persona credit AND from top-level `kills`.
  Add a regression test asserting an env-death turn does not corrupt
  attribution and is not counted as a kill.
- `runStats.test.ts` contract updated (the §16 note flags this is "beyond
  a one-line tweak" — the test fixtures currently pass *because* the
  shape is broken; they must be rebuilt to assert correct attribution).

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
WP-F (runStats rider) ──────┤  INDEPENDENT of A–E except: env-death regression
                            │  test depends on D's trace channel
                            │
WP-G (diagnostics+report) ──┴─ depends on C+D (airdrop funnel, env-death); LAST
```

Parallelization opportunities:

- **WP-F (runStats rider) starts immediately, in parallel with WP-A.** It
  touches only `runStats.ts` + `runStats.test.ts` + the
  `buildTargetIdLookup` mirror; the only cross-dependency is the
  env-death regression test, which can stub the new channel until D
  lands or be added in a D↔F sync commit.
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

**Scope:** §3.1 blast-radius. Single forward shape; dev DB wipe; no
shims. Persona scrub is mechanical only (no behaviour tuning).

**Success criteria:**
- `grep -rn 'chest\|Chest\|chest_'` over agent-facing surfaces, engine
  dispatch path, persona prompts, replay UI, diagnostics, and the
  phase-12 aggregator returns **zero** hits (historical phaseN payloads
  excluded per §3.1 decision).
- `Crate_<x>_<y>` is the agent-facing id; loot dispatch still routes
  crates vs corpses by id namespace; all existing engine/llm tests pass
  after rename.
- `personas/{duelist,camper,vulture,opportunist}.md` and the
  `convex/_data/personas.ts` inlined copies say "crate"; the
  markdown↔inline cross-check test passes; no other persona word changes.
- concept-spec §6/§7/§8/§13/§14 and mental-model say "crate"; a
  mental-model §20 phase-12 section is added.

### WP-B — Deterministic equipment catalog

**Scope:** §3.2. Expand weapon/armour tiers (plain names); descriptor
crate entries carry `contents: ItemRef`; retire `rollLoot` from the crate
path; flip the determinism contract.

**Success criteria:**
- New tiers present in `WeaponName`/`ArmourName` unions, `WEAPONS`/
  `ARMOUR` stat tables, `itemRefValidator`, all consistent.
- `expandMap(d, "x")` deep-equals `expandMap(d, "y")` for **all** crate
  contents (new test; the old "differs by seed" assertion is deleted).
- No `rollLoot`/`makeRng` call remains on the crate-contents path.
- Closing report shows visible equipment variance across agents/runs
  (equip ≥ 80% preserved; variance observable in diagnostics
  equipment cross-cut).

### WP-C — Airdrop entity state machine

**Scope:** §3.3. `AirdropState`, turn-derived lifecycle, non-LOS
telegraph with `countdown`, `Crate_<x>_<y>` navigation, Vision section,
SPENT-absence, schema + persistence plumbing, hand-authored wave table.

**Success criteria:**
- Telegraphed airdrop appears in **every** living agent's Vision for
  exactly the 3 turns before each of turns 10/20/30/40, non-LOS,
  with a correct per-entity `countdown` (3→2→1).
- On the landing turn the entity is LOS+Chebyshev-gated and lootable at
  range 2 with its hand-authored contents.
- Once looted/empty it is absent from Vision (not a flag).
- `toward Crate_<x>_<y>` validates and navigates in both telegraphed
  and landed states (engine test + replay observation).
- Determinism: identical airdrop positions/contents/countdowns across
  two runs with different seeds.

### WP-D — Telefrag

**Scope:** §3.4. New sub-phase after Phase 5 / before Phase 6;
`environmentalDeaths` trace channel; total vanish; kill-feed line;
alive/prize recompute; schema + persistence.

**Success criteria:**
- An agent on the spawn tile on the landing turn (camped OR moved-onto-it
  that turn) is removed entirely: no corpse entity, no lootable gear,
  nothing transferred to the crate.
- Kill-feed emits exactly `"<Persona> got telefragged by crate spawn"`,
  no killer token, ordered after weapon/charge kills.
- Recorded in `environmentalDeaths`, **excluded** from `trace.deaths`
  and therefore from kill-rate; alive count decrements; match
  termination + prize split recompute among survivors.
- At most one telefrag victim per spawn (tile-exclusivity invariant —
  asserted by test).
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

**Scope:** §3.6. Mirror `buildTargetIdLookup`; credit lethal counter;
env-death-safe; rebuild `runStats.test.ts` contract.

**Success criteria:**
- `perPersona[*].kills` is non-zero and correctly attributed on a
  synthetic match with named-persona attack targets (new/rebuilt test).
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
- Rename grep-clean across all scoped surfaces (§5 WP-A).
- Airdrop lifecycle observable in replay: telegraph (with per-entity
  countdown) for the 3 turns before each of 10/20/30/40 → LOS-gated
  lootable → spent-absent.
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

## 7. Ambiguities / Open Questions (decisions needed)

**Q1 — Equipment catalog tiers + airdrop wave table (USER AUTHORING
DECISION, blocks WP-B/WP-C).** The North Star says "author the
wave→coords→contents table" and "PLAIN names" but does not pin tier
names/stats or coordinates. Engineers must not invent stats. Proposed
deterministic catalog for confirmation (mid-game value curve: turn-10
weakest → 20/30 strongest → 40 strong-under-clock):

- *New weapon tiers (plain):* e.g. `dagger` (dmg 8, rng 2), keep
  `rusty_blade`/`sword`/`axe`/`greatsword`, add `warhammer` (dmg 30,
  rng 2). *New armour tiers:* keep `cloth`/`leather`/`chain`/`plate`,
  add `riot_plate` (reduction 14). Static-crate `contents` hand-placed
  across the existing 12 crate coords. *Airdrop waves:*
  T10 @ (one accessible coord) = `leather`; T20 @ (central-ish) = `axe`;
  T30 @ (near evac) = `plate`; T40 @ **evac bullseye `(48,48)`** =
  `greatsword` (juicy late-loot-vs-incineration tension + the canonical
  camp-the-bullseye telefrag).
  → **Confirm or replace this table before WP-B/C implementation.**

**Q2 — Static-crate count/placement.** Reference map has 12 chests.
North Star: terrain/evac/spawns byte-identical, but crates are the
variance vehicle and lose their `lootTable`. Keep all 12 coords and only
swap `lootTable`→`contents`, or re-author count/coords for better
variance? (Recommend: keep 12 coords, hand-assign contents — minimal
diff, satisfies "positions hand-authored and deterministic".) Confirm.

**Q3 — Telefrag on a turn-40 airdrop landing at the evac bullseye after
the turn-30 evac reveal.** This is the intended "juicy" case, but
confirm the turn-40 airdrop coordinate is *inside* the 3×3 evac zone (the
North Star explicitly wants the late-loot-vs-incineration tension). The
proposed (48,48) is the evac centre — confirm that is desired vs an
adjacent tile.

**Q4 — `rollLoot`/`LOOT_TABLES` deletion vs retention.** Recommend full
deletion (single forward shape, POC). Confirm nothing out-of-scope still
needs the RNG loot path (the deferred RNG slice will re-introduce its own
mechanism; preserving dead code now violates "no back-into-a-corner").

**Q5 — Mental-model authorship.** The North Star references mental-model
"updated this slice with the crate/airdrop/telefrag vision" but
`mental-model.md` currently ends at §19 (phase 11). WP-A adds a §20
phase-12 section. Confirm the PM/intent owner wants the planning
architect's §20 draft, or whether the user authors it (mirrors how prior
phase intents were user-captured in mental-model).

---

## 8. Recommended Job Sequence

1. **Resolve Q1–Q5 first** (esp. Q1/Q2 — they block WP-B/WP-C
   implementation; do not start catalog/airdrop coding against invented
   stats).
2. **Plan review** of this spec (mirror the phase-11 REVIEW-v1 → plan-v2
   discipline) — the rename blast-radius and the telefrag phase
   placement are the highest-risk decisions; get them reviewed before
   dispatch.
3. **Dispatch WP-A and WP-F in parallel** (A = mechanical rename merge
   gate; F = isolated runStats rider). Land A first / fast.
4. **WP-B and the WP-A persona+doc scrub concurrently** post-A.
5. **WP-C → WP-D**, then **WP-E ∥ WP-G start**.
6. **WP-G last**, gating the 20-run closing.
7. **UAT before closure:** step the closing-20 through the replay UI
   (airdrop telegraph countdown, landed loot, spent-absence, ≥1 telefrag
   feed line) + the Diagnostics tab (env-death + airdrop funnel) — the
   phase-9/10 backend-slice UAT precedent.
8. **Closure record** `PHASE-12-CLOSURE.md` mirroring the phase-9/10
   single-file-handoff format (canonical reportId, threshold verdict,
   ADR rollup, deferred items).

**Implement-first, not review-first** for the WPs themselves (TDD per
AOP.IMPLEMENT — tests red→green inside each WP), but **review-first for
this plan** given the cross-cutting rename + the discoverable-mechanic
correctness sensitivity (telefrag must not corrupt kill attribution — the
exact failure family that has recurred four times per mental-model §16).

---

## 9. Cross-references

- North Star: assignment brief (this dispatch).
- Why-layer: `docs/project/spec/mental-model.md` pillars 1/5/6/8, §16
  (runStats known issue), §17–§19 (rect-Vision / body-collision /
  DB-bandwidth precedents).
- Mechanics: `docs/project/spec/concept-spec.md` §6/§7/§8/§13/§14.
- Mirror precedents: `docs/project/phases/10-body-collision-overseer/PHASE-10-CLOSURE.md`
  (discoverable mechanic + closing mirror),
  `docs/project/phases/09-walls-vision-rect-grained/PHASE-9-CLOSURE.md`
  (Path-2 report pattern),
  `docs/project/phases/11-db-bandwidth-substrate/PHASE-11-CLOSURE.md`
  (forward-shape schema break / dev wipe).
- runStats fix pattern: `convex/turnsDerived.ts:auditDamageFeed`
  (`buildTargetIdLookup`, `personaToDisplayName`).
