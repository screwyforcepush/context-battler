# Phase 13 — Card Layer Carve · Plan Review

> Reviewer: Review Architect. Paper review of
> `docs/project/phases/13-card-layer-carve/README.md` against North Star +
> mental-model §12/§5/§10/pillars 6,7. No code changed. Claims traced to
> live substrate.

## Verdict: **CHANGES-REQUIRED**

The architecture is sound and the two load-bearing claims (personaId
duty-split; harness-parity) substantially hold against the code. The
required changes are precision/spec-correctness fixes that are
paper-cheap now and expensive after WP4 — exactly the class the
plan-review-first sequence exists to catch. This is **not** a rejection;
WP1 can be dispatched in parallel with the spec edits below (WP1 does not
depend on any of them). WP2/WP3 dispatch is gated on the edits.

---

## What was verified true (claims that hold)

- **personaId duty-split is correct.** `runs.aggregate`
  (`convex/runs.ts:124-130`) buckets `characters` by `personaId` and the
  substrate-proof report (`convex/reports/phase12.ts:559,593-597`) takes
  an **explicit `matchIds` array** as input and fetches `runs` `by_match`
  per supplied id — it does **not** scan all `runs` rows. Filling
  `personaId = card.lineagePersonaId` (locked union) keeps
  runs/reports/differentiation working with zero change. Confirmed.
- **Harness-parity on the aggregation/report side holds.** Because report
  input is an explicit harness-supplied matchId list, Card-triggered
  matches cannot pollute the substrate-proof metric. The shared-loop
  branch at `runMatch.ts:787` is genuinely additive and keyed on an
  optional field (`cardPromptHash`) that is absent on every harness
  character → harness expression is byte-identical. Confirmed.
- **Trace-integrity mechanic is code-grounded.** `bodyCollision` union
  (`convex/_internal_runMatch.ts:213-223`) is exactly
  `{kind:"wall",wallRectId}` vs the separate
  `blockedBy:v.optional(v.literal("wall"))` — the spec's
  wallFaceSlam-vs-blocked-step distinction maps 1:1 to the schema.
  Pinned `cardPromptHash` + the existing content-addressed `prompts`
  store (persisted by `persistTurn`, `runMatch.ts:1053`) is the right
  substrate.
- **Scope-leak guard: clean.** No account ref, no lobby/facade, no
  auto-draw/backfill, no leaderboard/seasons/unlockable-segments leaked
  into the spec or WPs.
- **A1 ratified** against mental-model §12 line 196 ("the denominator
  counts *every* match the card was drawn into, win or turn-2 death") —
  early death counts toward `matchesPlayed`. Confirmed by the why-layer.
- **A3 ratified** — unconditional schedule + self-guard mirrors the
  existing `runs.aggregate` row-existence self-guard
  (`convex/runs.ts:63-67`). Consistent, sound.

---

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| **High** | A2 / id-resolution | A2 is **mis-framed**. There is no "Player_N derived from spawnIndex vs displayName" question in the functional path — character-target resolution is **purely displayName-based** via `normaliseCharacterTargetId` (characterId fallback first, then `displayName`). `PERSONA_DISPLAY_NAMES` is **dead in production dispatch** (defined `engine/types.ts:54`, no functional importer). `Player_N` exists only as a *report diagnostic counter*. The real correctness holes a free `agentName→displayName` opens, which the spike-as-framed will NOT catch: **(a)** intra-match `agentName` uniqueness — `normaliseCharacterTargetId` / `visibleTargetIds` do `.find()` by displayName → first-match-wins → ambiguous targeting & corpse resolution if any two of the 8 cards share an `agentName`; **(b)** reserved-id collision — `resolveTypedEntity` dispatches `Corpse_`/`Crate_`/`Cover_`/`Wall_`/`Evac_` prefixes (and the `^Crate_-?\d+_-?\d+$` regex) **before** character normalisation, so a card named e.g. `Wall_1_1`, `Corpse_Camper`, or `Crate_3_4` is hijacked. | `idNormalisation.ts:38-48,256-304`; `validation.ts:48,129`; `resolution.ts:456`; `engine/types.ts:54-56` (no functional importer) | Reframe A2. `matches.startFromCards` MUST validate **agentName uniqueness within the 8** and **reject reserved-prefix / unsafe-charset agentNames**. Make these two validations explicit WP2 success criteria, not a spike. agentName→displayName is otherwise mechanically safe (it is already the production resolution path for "Duelist" etc.). |
| **Med** | WP4 / architecture | §3.5 says the pinned prompt text is "fetched once during match-state build (`buildMatchState`)". `buildMatchState` (`runMatch.ts:202`) is a **pure function — no `ctx`, no DB** — it cannot join the `prompts` table. The load-bearing WP4 mechanism is hand-waved. | `runMatch.ts:202-276` (pure; takes `Doc<>` arrays only) | Specify the threading precisely: resolve a `Map<hash,text>` via a DB read in `advanceTurn` (bounded ≤8 distinct hashes) and either pass it into `buildMatchState` or resolve onto the actor in the `perAgent.map` at `runMatch.ts:786`. Name the exact insertion point so WP4 cannot drift. |
| **Med** | A4/A5 / aggregator | `runStats` semantics (verified): environmental deaths are **not** in `resolution.deaths` and are **not** kills; `perPersona` buckets by `personaId`. A5's `deaths = diedAtTurn-set (any death)` + A4's reuse of `resolution.deaths`-based kill attribution yields a **deliberate K/D asymmetry** (env/wall death increments victim `deaths`, no killer `kills`). Acceptable per §12 (K/D is vanity/play-style, not the ranked metric) but unstated — an implementer may "reconcile" it. Separately, the shared kill-attribution helper (A4) must attribute **per-characterId**, whereas `runStats` currently buckets **per-personaId**; multiple Card characters can share `lineagePersonaId`. | `engine/runStats.ts:18-26,49-52`; mental-model §12:202-205 | Spec must (1) state the K/D asymmetry as intentional and forbid reconciliation; (2) make the A4 extraction contract explicit: per-characterId granularity, while preserving `runStats`' existing per-persona output byte-identical (guarded by its existing tests). |
| **Med** | DRY / "untouched" definition | WP2 "reuses (does not fork)" the inline helpers in `matches.ts`, but `expandMapInline`, `getReferenceMapDescriptor`, `defaultRngSeed`, and `assignPersonasToSpawnsInline` are **module-private**, and `assignPersonasToSpawnsInline(rngSeed, personas: readonly PersonaId[])` is **persona-typed** — reuse requires exporting + generalising it over an id type, which diffs the `matches.ts` file even though `matches.start` behaviour is unchanged. The spec's "matches.start untouched (diff proof)" (WP4) collides with this. | `matches.ts:150-168` (private, `PersonaId[]`-typed); README §2.5, WP4 success criteria | Define "untouched" precisely = **behavioural identity of `matches.start` + `harness/run.ts`**, not zero-diff on `matches.ts`. State that helper extraction is additive/behaviour-preserving and that `assignPersonasToSpawnsInline` is generalised to `<T>` (or co-locate `startFromCards` in `matches.ts`). Otherwise WP2 forks the helpers (DRY violation) or the parity diff-proof spuriously fails. |
| **Low** | runs hygiene | §3.4 schedules `runs.aggregate` unconditionally for Card matches → orphan `runs` rows with collapsed `perPersona` buckets when `lineagePersonaId` collides among the 8. Harmless (report input is explicit matchId-scoped — verified) but unstated. | `runs.ts:58-147`; `reports/phase12.ts:559,593` | Add one sentence: Card-match `runs` rows are expected, ignored by the substrate-proof report (explicit-matchId-scoped), and never read by an unscoped scan. Confirm no report path does an unscoped `runs` collect. |
| **Low** | prompts get-or-create | §3.3 / WP1 / WP2 say "idempotent get-or-create — same path Phase 11 uses". Phase 11's dedup lives **inside `persistTurn`**, not as a standalone API. There is no existing reusable get-or-create-prompts-by-hash mutation. | `runMatch.ts:1053` (`promptTexts` written via `persistTurn`) | Name it as a **new small shared helper** (idempotent-by-hash prompts writer) owned by WP1, not an existing API, so WP1/WP2 scope is honest. |

---

## Spec / Guide Deviations

- **A2 framing vs. code (High).** The spec's A2 ("is `Player_N` derived
  from `spawnIndex` (safe) or `displayName` (unsafe)?") describes a
  mechanism that does not exist in the functional path. Deviation from
  the actual substrate; correct the framing and convert the two real
  guards into WP2 acceptance criteria.
- **§3.5 vs. `buildMatchState` purity (Med).** Spec attributes a DB join
  to a pure function. Architecture boundary (ADR §1, pure engine layer)
  is otherwise respected — the fix is to state the resolution site
  correctly, not to violate the boundary.
- No deviation from North Star scope caps, concept-spec §5 prize model,
  or POC posture. mental-model §12 why-layer is correctly load-bearing
  throughout.

---

## A1–A5 Ratification (binding for the implement job, conditional on edits)

- **A1 — RATIFIED.** Early death counts toward `matchesPlayed`
  (mental-model §12:196). Failed/non-completed exclusion is a **sound PM
  judgment call** mirroring `runs.aggregate`'s completed-only guard; §12
  is silent on substrate crashes (it speaks to *plays*, not engine
  failures). Recommend PM explicitly sign the failed-match exclusion —
  it is defensible, not derivable.
- **A2 — NOT RATIFIED as written.** Reframe per the High issue;
  agentName→displayName is approved **conditional on** the two added
  guards (intra-match uniqueness + reserved-prefix/charset rejection).
- **A3 — RATIFIED.** Unconditional schedule + self-guard; mirrors
  `runs.aggregate` row-existence guard.
- **A4 — RATIFIED with contract.** Shared kill-attribution extraction
  approved; extraction contract must be per-characterId while preserving
  `runStats` per-persona output byte-identical (its existing tests are
  the guard).
- **A5 — RATIFIED with note.** Environmental deaths count toward
  `deaths`; the resulting K/D asymmetry is intentional (§12: K/D is
  vanity/play-style, not the ranked metric) and must be stated in the
  spec as deliberate.

---

## Decision Notes for the PM

1. **Sign the A1 failed-match exclusion** (substrate crash ⇒ no
   `matchesPlayed` increment). Defensible, not §12-derivable — needs an
   explicit owner decision.
2. **Apply the High + 3 Med spec edits before WP2/WP3 dispatch.** WP1 is
   independent of all of them and may dispatch immediately in parallel
   with the edits.
3. On re-spin of the spec with the edits applied, this review's
   ratifications (A1, A3, A4, A5 + conditionally-A2) become binding for
   the implement job. No second plan-review cycle is required for these
   specific, enumerated corrections — they are precision fixes, not
   architectural rework.
4. WP dependency map (WP1 → WP2∥WP3 → WP4 gate → WP5) and the
   WP2∥WP3 parallelism are **realistic and endorsed**; WP4 as the single
   serialisation point + hard parity gate is correctly placed.

---

*Artifact path: `docs/project/phases/13-card-layer-carve/PLAN-REVIEW.md`*
