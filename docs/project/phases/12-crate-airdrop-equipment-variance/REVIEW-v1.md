# Phase 12 — Plan Review v1 (Review Architect)

> Binding review of `README.md` (plan spec) against the North Star,
> slimmed `mental-model.md` (pillars 1/5/6/8, §11 intent), concept-spec
> §13/§14, and phase-9/10/11 closure precedents. No code exists yet —
> plan/architecture review only; no lint/build/test gates run.

## VERDICT: APPROVE-WITH-BINDING-CONDITIONS

The core architecture is **sound and code-verified**: the telefrag
sub-phase placement, the `environmentalDeaths`-separate-from-`deaths`
kill-rate-exclusion-by-construction, the alive/prize/termination
fall-out, and the runStats bug diagnosis all check out against actual
source. Q1/Q2 are **ratified as dispatch-ready** (no user escalation).

However, the **§3.1 rename blast-radius inventory is materially
incomplete** (≥7 agent-facing/engine surfaces missing, one of which —
`convex/matches.ts` — contradicts §3.2's claimed rollLoot location), and
there is a **real architectural gap in the landed-airdrop loot path**.
These are correctable pre-dispatch and do not warrant a full REVISE, but
they are **binding conditions** that must be folded into the plan before
WP-A / WP-C / WP-D dispatch.

**Go/no-go:** WP-F may dispatch now (with the BC-7 coordination note).
**WP-A is NOT dispatch-ready** until BC-1 (inventory correction +
re-grep) lands. WP-C/WP-D not dispatch-ready until BC-2 (landed-airdrop
loot path) is specified.

---

## Focus-Area Findings (evidence-backed)

### 1. Rename blast-radius COMPLETENESS — **FAIL (BC-1, High)**

Independent `grep -n [Cc]hest` shows the §3.1 inventory **omits
agent-facing / engine-dispatch surfaces**:

| Missing surface | Evidence | Why it matters |
|---|---|---|
| `convex/matches.ts` (11 hits) | `matches.ts:97-132` — `ChestState` import, `descriptor.chests.map`, `` `Chest_${c.x}_${c.y}` ``, `makeRng(`${rngSeed}:chest:${chestId}`)`, schema adapter `world.chests.map` at :235 | **Not in §3.1 at all.** This is a second chest-construction + rng-seed + schema-adapter seam. §3.2 attributes `rollLoot` retirement solely to `convex/engine/map.ts` — but `matches.ts` also builds chests with the same `rngSeed:chest:` pattern. WP-B's determinism flip + `Chest_`→`Crate_` id construction is **under-scoped** until matches.ts is traced and listed. |
| `convex/llm/decisionTool.ts` (1 hit) | `:147` tool-description string `"… loot a visible chest/corpse …"` | **Agent-facing tool grammar** — the per-turn LLM contract (pillar 6: per-turn input is one rolled context). A `chest` literal here is squarely in the North Star grep-clean scope. Highest-priority miss. |
| `convex/engine/validation.ts` (7 hits) | `:154-169` — `entity.kind !== "chest"`, `` `loot target '${rawTargetId}' is not a visible chest or corpse` `` | Engine **dispatch path** + agent-facing **rejection text** returned to the model. Not listed. |
| `convex/worldState.ts` (1) | `:7` `chests: unknown[]` | Engine/persistence projection. Not listed. |
| `convex/engine/reportStats.ts` (1) | `:80` `≥ 80% of runs contain at least one chest equip` | Engine report aggregator (live, not a frozen payload). Not listed. |
| `convex/engine/lastKnown.ts` (1) | `:33` comment | Engine path; grep-clean would still flag. Low sev but uncatalogued. |
| Replay UI beyond `Diagnostics.tsx`/`decisionEnglish.ts` | `HoverCard.tsx` (27: `case "chest"`, `ChestHover`, `chestId`, `data-chest-id`), `Grid.tsx` (10), `Replay.tsx` (12), `reconstruct.ts` (21), `hoverTypes.ts` (2), `ExpandModal.tsx` (1) | North Star AC explicitly names **"replay UI"** in grep-clean scope. §3.1's "Diagnostics" row lists only `Diagnostics.tsx` + `decisionEnglish.ts` — the bulk of the replay chest surface is uncatalogued. (Pillar 8's "render modality is orthogonal" permits *looted crates staying as scenery*; it does **not** exempt the *vocabulary* — the AC is unconditional.) |
| `harness/analyze-match.ts` (13), `harness/diagnostics.ts` (1), `harness/diagnostics/helpers.ts` (2) | grep | Diagnostics CLI consumers; in the "diagnostics" grep-clean scope. |

**Loot-dispatch-by-id-namespace integrity:** the dispatch contract
itself is sound — `resolution.ts:560 isChestId(rawTargetId)` →
`world.chests.find(c.id===chestId)`, `:515` `Corpse_` branch,
`:139` `/^Chest_-?\d+_-?\d+$/`. Renaming the regex to
`/^Crate_-?\d+_-?\d+$/` + `world.crates` preserves namespace dispatch.
**Historical-payload freeze decision (§3.1) is sound** — closed-phase
`reports.phaseNPayload` rows are contracts, not agent-facing, DB is
wiped; matches the phase-11 precedent and the verbatim North Star AC
scope. No issue there.

> **BC-1 (binding):** Re-derive §3.1 from a full `grep -n [Cc]hest`,
> add the surfaces above (esp. `matches.ts`, `decisionTool.ts`,
> `validation.ts`, the replay-UI component set), reconcile §3.2's
> rollLoot location against `matches.ts` vs `map.ts:118-136`, and add a
> post-WP-A re-grep gate over the corrected surface list. WP-A is not
> dispatch-ready until this lands.

### 2. Telefrag correctness — **PASS (code-verified)**

- **Sub-phase placement is correct.** `resolution.ts`: Phase 5 action
  application ends ~`:884`; Phase 6 death is `:886-920`
  (`for ch of working.characters if (ch.alive && ch.hp<=0)`). A
  sub-phase inserted between them that sets the victim
  `alive=false` makes Phase 6 **skip** it (guard is `ch.alive && …`)
  → victim is **never pushed to `trace.deaths`**. ✔
- **Kill-rate exclusion is by construction.** `runStats.ts:192`
  `kills += t.resolution.deaths.length`. With telefrags in a separate
  `environmentalDeaths` channel and absent from `deaths`, **no formula
  edit is needed** — exactly as the plan claims. ✔
- **Alive/prize/termination fall out with zero new branching.**
  `runMatch.ts:986-992` — termination reads
  `nextState.characters.filter(c=>c.alive)` then `aliveAfterCount<=1`;
  prize split `:1011-1018` from extracted/survivors. The sub-phase's
  `alive=false` propagates into `nextState` → decrement + termination +
  split recompute automatically. **Plan claim verified.** ✔
- **≤1 victim per spawn.** Movement body-collision
  (`resolution.ts:327-358`) bounces colliding movers back, so
  post-Phase-4 positions are tile-unique → at most one resolved-tile
  match. ✔ (WP-D should still assert this invariantly per its own
  success criterion.)
- **Minor (Low, note for WP-D):** `liveActorIds` is snapshotted at
  Phase 1 (`:209`); the scratchpad-update loop `:1000-1005` patches by
  that list, so a telefragged victim can still receive a no-op
  scratchpad write (`patchCharacter` finds the now-`alive=false` row).
  Harmless (the agent is gone and never surfaced), but WP-D should note
  it and confirm nothing re-surfaces a telefragged id.

### 3. runStats rider — **PASS (bug real; citation unsubstantiated)**

- **Bug confirmed by source, not plan claim.** `runStats.ts:209`
  `if (!deathSet.has(a.target)) continue;` where `deathSet =
  new Set(t.resolution.deaths)` (`:191`, holds engine `characterId`s)
  but `a.target` is the persona **displayName** —
  `resolution.ts:483-489` pushes `target: target.displayName`. The two
  never match → `perPersona[*].kills` is **structurally always 0**.
  Top-level `kills` (`:192`) is unaffected, explaining why closing
  kill-rate gates kept passing. **Diagnosis correct.** ✔
- **Counter-fire gap confirmed.** `runStats.ts:207` filters to
  `attack`/`overwatch` only; `kind:"counter"` (`resolution.ts:733-741`,
  target also `traceTargetName`=displayName) is **uncredited**. ✔
- **Fix pattern verified.** `turnsDerived.ts:272-288`
  `buildTargetIdLookup` maps `characterId`/`displayName`/`personaId`/
  `personaToDisplayName(personaId)` → `characterId`; `auditDamageFeed`
  (`:358-386`) applies `targetIdLookup.get(action.target) ?? action.target`
  then `deathIds.has(targetId)`, and its `isDamageAction` (`:317-324`)
  **already includes `counter`**. Mirroring this into `runStats.ts` is
  exact and correct. ✔ `titleCase` exists (`types.ts:50`) but is **not
  currently imported** by `runStats.ts` (only `PERSONA_IDS`,
  `PersonaId`) — WP-F must add the import; the plan's "already
  available" wording is slightly loose but harmless.
- **`runStats.test.ts` must be REBUILT, not tweaked** — confirmed: the
  current fixtures pass *because* the shape is broken; asserting correct
  attribution requires new participant-bearing fixtures. Plan is right.
- **Citation defect (BC-4):** the plan repeatedly sources the bug to
  "mental-model §16 … the fourth occurrence of the contract-drift
  family." The slimmed `mental-model.md` has **only 12 sections**; no
  §16. `PHASE-7-CLOSURE.md` contains **no** runStats/attribution/
  known-issue text (grep: no match). The bug is **real and
  code-verified**, but its claimed provenance is unsubstantiated and the
  "fourth occurrence" framing has no cited source. Non-blocking for WP-F
  correctness, but the citations must be corrected (see BC-4).

### 4. Citation integrity — **FAIL (BC-4, Med)**

The plan cites `mental-model` §16 (runStats), §17–§19 (rect-Vision/
body-collision/DB-bandwidth), and §20 (phase-12). The slimmed
`mental-model.md` ends at **§12** ("Open questions / live tensions");
phase-12 intent is already captured in **§11 ("Current vision —
equipment variance & contested public objectives")** — covering crate
vocabulary, deterministic equipment variance, the airdrop, telefrag, and
honest attribution. Consequently:

- All `§16/§17/§18/§19/§20` citations (README lines ~35-38, 96, 270,
  290, 296-297, 398, 570-575, 605, 612-614, 622) are **stale** against
  the slimmed file.
- **Q5 is MOOT** — §11 already encodes the phase-12 why-layer; no
  user-authored §20 is needed (matches Decision D4/D5).
- **WP-A success criterion "a mental-model §20 phase-12 section is
  added" (README:398) is WRONG and must be struck.** Adding a phase-12
  §20 would re-bloat the just-slimmed why-layer with a phase log, in
  direct violation of `mental-model.md`'s own header rule ("No
  assignment logs … keep assignment logs, closure records, ADRs …
  out"). The runStats bug is engine current-state, not why-layer
  material — it belongs in this phase doc / closure, not mental-model.

> **BC-4 (binding):** Re-point all `mental-model §16-§20` citations to
> §11 (intent) + actual source-of-truth (`runStats.ts` / `turnsDerived.ts`
> for the bug; phase-9/10 closure docs for the mirror precedents).
> Delete the WP-A "add mental-model §20" task and its WP-A success
> bullet. Remove the unsourced "fourth occurrence" framing or cite a
> real artifact.

### 5. Q1/Q2 ratification — **RATIFIED, no user escalation**

Sanity-checked against source per D5:

- **Catalog tiers exist and extend cleanly.** `types.ts:60-61`
  `WeaponName = rusty_blade|sword|axe|greatsword`,
  `ArmourName = cloth|leather|chain|plate`; `WEAPONS`/`ARMOUR`
  (`:69/:77`) carry **only `{damage,range}` / `{reduction}`** — the
  proposed `dagger`(8/2), `warhammer`(30/2), `riot_plate`(red 14) are
  plain-named, pure dmg/reduction, **no richer stats** → respects the
  explicitly-deferred multi-stat scope (§12 / North Star OOS). ✔
- **Value curve qualitatively monotonic.** T10 `leather` (weakest) →
  T20 `axe` / T30 `plate` (strong) → T40 `greatsword` (strong, under
  the turn-30-revealed evac clock). Mixing weapon/armour means it is not
  a single scalar ramp, but the North Star asks only "T10 weakest, 20/30
  stronger, 40 strong-under-clock" — satisfied. ✔
- **T40 @ (48,48) is inside the evac zone.** `reference.json:74`
  `"evac": {"x":48,"y":48}`; `resolution.ts:135` `EVAC_HALF_SIZE=1` →
  3×3 zone (47-49, 47-49). (48,48) is dead-centre — the canonical
  camp-the-bullseye telefrag the North Star explicitly wants (D2). ✔
- **equip ≥ 80% feasible** — deterministic hand-authored contents do not
  reduce loot frequency; agents still loot crates → equip. Same
  mechanism that already clears the phase-9 gate. ✔

**Q1/Q2 are North-Star-compatible → ratified as the reversible POC
default (D5). WP-B/WP-C are unblocked on the catalog/wave table.** No PM
escalation required. (Q2: keep the 12 reference-map coords, swap
`lootTable`→`contents` — minimal-diff, satisfies "positions
hand-authored & deterministic"; ratified.)

### 6. Dependency map / parallelization — **MOSTLY SOUND (BC-7, Low-Med)**

A→C→D→G critical path is correct. **But the "WP-F is INDEPENDENT of
A–E … touches only runStats.ts" claim is inaccurate:** §3.1 itself lists
`convex/engine/runStats.ts` `isChestId→isCrateId` under **WP-A**, and
WP-F rewrites attribution in the *same file*. Parallel A∥F therefore
**both edit `runStats.ts`** (a guaranteed merge touchpoint, plus WP-F's
`isChestId` mirror of `buildTargetIdLookup` interacts with A's rename).

> **BC-7:** Either (a) WP-A owns the `runStats.ts` `isChestId→isCrateId`
> rename and WP-F rebases on A for that file, or (b) WP-F explicitly
> absorbs the rename in its own runStats.ts edit and A excludes
> runStats.ts. Make the ownership explicit in §4 before dispatching
> A∥F. WP-F may otherwise dispatch now.

---

## Additional Issue Found (not in focus list)

### Landed-airdrop loot path — **architectural gap (BC-2, High)**

§3.3 stores airdrops in `WorldState.airdrops[]` (separate from
`crates[]`), with a `looted` boolean as the SPENT signal. §3.4 step 5
says a landed airdrop "becomes a normal LANDED crate." But the **loot
*application* path is never specified to consult `airdrops[]`**:
`resolution.ts:560-595` resolves a crate loot via
`world.chests.find(c.id===chestId)` → after rename, `world.crates`.
A landed airdrop's id is `Crate_<x>_<y>` so `isCrateId` passes, but
`world.crates.find` returns `undefined` → trace `result:"no_crate"` →
**the landed airdrop is unlootable**, breaking the
land→lootable→spent lifecycle, the equip≥80% gate contribution, and the
"looted/spent" arm of the airdrop funnel.

§3.3 only addresses *navigation* (`resolveTypedEntity` `Crate_` branch)
and *Vision*; the resolver's `interacts` apply-loop
(`resolution.ts:762-810`, which flips `opened/contents` and emits
`result:"opened"` + `lootedItem`) has no airdrop equivalent.

> **BC-2 (binding):** WP-C/WP-D must specify, in §3.3/§3.4, the
> landed-airdrop loot dispatch: the `loot` branch must also match
> `world.airdrops[]` entries that are `LANDED && !looted`, run the
> `equipIntoSlot` side-effect, set `looted=true` (= SPENT), and emit a
> trace `result` that the equips counter and the airdrop funnel can
> read (mirror the `result:"opened"` / `lootedItem` contract so
> `runStats` equip credit and the funnel "looted→spent" transition both
> work).

---

## Issues Table

| Sev | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| High | Rename | §3.1 inventory omits ≥7 agent-facing/engine surfaces | `matches.ts:97-235`, `decisionTool.ts:147`, `validation.ts:154-169`, `worldState.ts:7`, `reportStats.ts:80`, `HoverCard.tsx`/`Grid.tsx`/`Replay.tsx`/`reconstruct.ts` | **BC-1**: re-derive inventory from full grep + post-WP-A re-grep gate; reconcile §3.2 rollLoot location vs matches.ts |
| High | Airdrop | Landed-airdrop loot application path unspecified → unlootable | `resolution.ts:560-595,762-810` vs `airdrops[]` design | **BC-2**: specify loot dispatch/SPENT-flip/trace for landed airdrops |
| Med | Citations | mental-model §16-§20 cited but file has 12 §§; WP-A "add §20" violates why-layer purity | `mental-model.md` (12 §§, §11 = intent); `PHASE-7-CLOSURE.md` no runStats match | **BC-4**: re-point citations to §11 + real source; delete WP-A §20 task; Q5 moot |
| Med | Parallelization | WP-F "independent / runStats.ts only" collides with WP-A runStats.ts rename | §3.1 WP-A row vs §3.6 WP-F | **BC-7**: assign runStats.ts rename ownership explicitly |
| Low | Telefrag | Telefragged id can receive a no-op scratchpad patch (start-of-turn `liveActorIds`) | `resolution.ts:209,1000-1005` | WP-D note: confirm no telefragged id is re-surfaced |
| Low | runStats | Plan says `titleCase` "already available" but not imported in runStats.ts | `runStats.ts:59` imports only `PERSONA_IDS,PersonaId`; `types.ts:50` | WP-F adds the import (trivial) |

## Spec / Guide Deviations

- **mental-model header rule violation (latent):** WP-A success bullet
  "a mental-model §20 phase-12 section is added" (README:398)
  contradicts `mental-model.md`'s own scope rule ("keep assignment logs,
  closure records, ADRs … out"). Must be struck (BC-4).
- **North Star grep-clean scope vs §3.1 coverage:** AC names "replay UI"
  unconditionally; §3.1 covers only the Diagnostics tab. Pillar 8's
  render-modality-orthogonal clause exempts *behaviour* (looted crates
  as scenery), **not vocabulary** — BC-1 closes this.
- Otherwise the plan is **well-aligned**: turn-derived lifecycle mirrors
  evac (pillar 8 match-meta sanction is correctly invoked), telefrag is
  discoverable (no schema/prompt surface — pillar 5/6), determinism
  inversion is correctly identified, Path-2 closing-report mirror is the
  established phase-9/10 pattern.

## Decision Notes (PM)

- **No new user/PM decisions required.** Q1/Q2 ratified here (D5
  satisfied); Q3 confirmed ((48,48) ∈ evac zone, intended per D2); Q4
  full `rollLoot`/`LOOT_TABLES` deletion endorsed (D3, single forward
  shape — confirm matches.ts path under BC-1); Q5 moot (D4, §11 already
  carries intent).
- **Dispatch gating:** WP-F → **GO now** (with BC-7 ownership note).
  WP-A → **HOLD** until BC-1 inventory correction + BC-4 citation/§20
  fix. WP-C/WP-D → **HOLD** until BC-2 landed-airdrop loot path is in
  the plan. WP-B unblocked once BC-1 reconciles the rollLoot location.
- Recommended: fold BC-1/2/4/7 into a plan-v2 (mirrors the phase-11
  REVIEW-v1 → plan-v2 discipline), then dispatch WP-A∥WP-F.
