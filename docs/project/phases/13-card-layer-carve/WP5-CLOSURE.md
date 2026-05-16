# WP5 Closure — Card Layer Vertical Slice

Date: 2026-05-16
Owner: EliaFractal
Scope: WP5 tests and closure evidence for Phase 13 Card Layer Carve.

## Summary

WP5 adds a fake-context vertical-slice regression for the ownerless Card
journey:

1. seed the 8 preset Cards,
2. add a 9th ownerless Card,
3. trigger a match from an explicit array of exactly 8 distinct Card ids,
4. assert character `cardPromptHash` snapshots,
5. update the Card prompt and prove the existing character stays pinned,
6. complete a Card-backed match fixture,
7. accrue prize, matches played, kills, deaths, wall face-slams, and the
   idempotency sentinel to Cards,
8. re-assert the harness/no-card path self-guards to a no-op.

No production implementation files were edited for WP5.

## New WP5 Evidence

- `tests/cardLayer.verticalSlice.test.ts`
  - `runs the north-star ownerless Card journey from seeded pool to completed-match accrual`
  - `reasserts the harness path remains closed-union and Card accrual self-guards to no-op`

The new test is fully in-process and fake-context compatible. It does not
call Azure and does not require a real Convex deployment.

## Assignment Criteria Evidence

1. **Card exists without account; ranked unit is the Card.**
   Evidence: `tests/cards.test.ts` checks the `cards` schema has no
   `ownerId` / `userId` / `accountId`; `tests/cardLayer.verticalSlice.test.ts`
   re-checks seeded and created Cards are ownerless while carrying rankable
   accumulator fields.

2. **8 presets seed the pool; pool can exceed 8; preset forkability deferred.**
   Evidence: `tests/cards.test.ts` covers exact preset seed shape and
   idempotency; `tests/cardLayer.verticalSlice.test.ts` seeds 8 presets,
   creates a 9th Card, and asserts the listed pool length is 9. No fork
   mutation was added.

3. **Match triggers from exactly 8 distinct Card ids; no auto-draw/backfill/lobby.**
   Evidence: `tests/matches.test.ts` rejects 7, 9, duplicate, and unknown
   Card selections; `tests/cardLayer.verticalSlice.test.ts` passes a caller
   selected explicit 8-id array and asserts exactly those 8 Cards become
   characters.

4. **Prompt hash snapshots and trace integrity.**
   Evidence: `tests/matches.test.ts` verifies `cardPromptHash` pinning after
   Card prompt changes; `tests/runMatch.advanceTurnCards.test.ts` verifies
   pinned Card prompt text is loaded and `agentRecord.input.personaPromptHash`
   equals the pinned hash; `tests/cardLayer.verticalSlice.test.ts` repeats the
   user-facing update flow and proves `cards.updatePrompt` does not rewrite
   existing characters.

5. **Prize model unchanged from concept-spec §5.**
   Evidence: `tests/engine/cardStats.test.ts` covers sole-survivor 100 and
   split prize outcomes from `outcome.pointsByCharacter`;
   `tests/cardLayer.verticalSlice.test.ts` completes a Card-backed match with a
   100-point survivor prize and accrues it to the winning Card.

6. **Per-Card persistent accumulation and derivable metrics.**
   Evidence: `tests/engine/cardStats.test.ts` covers per-character kill
   attribution, all drawn Cards counting `matchesPlayed`, environmental death
   K/D asymmetry, and `wallFaceSlams` from `bodyCollision.kind === "wall"`;
   `tests/cards.test.ts` covers writer guards, accumulator patching, turn
   ordering, and idempotency; `tests/cardLayer.verticalSlice.test.ts` covers
   all selected Cards receiving `matchesPlayed`, winner prize/kills/wall-slam,
   victim deaths including environmental death, absent stored
   `prizePerMatch`/`kd`, and second-call sentinel no-op.

7. **Harness closed union remains behaviorally untouched; Card path is parallel.**
   Evidence: `tests/matches.test.ts` pins `matches.start` seeded character
   shape with no `cardId`/`cardPromptHash`; `tests/runMatch.advanceTurnCards.test.ts`
   pins the harness fallback to `loadPersonas()` and terminal scheduling of
   both `runs:aggregate` and `cards:accrueFromMatch`;
   `tests/cardLayer.verticalSlice.test.ts` asserts `matches.start` still
   creates the locked 8-persona union with no Card fields and that
   `cards.accrueFromMatch` no-ops without Card-backed characters. On
   2026-05-16, `git diff -- harness/run.ts` produced no output, so
   `harness/run.ts` is byte-unchanged in this shared worktree.

8. **POC posture: forward schema shape; wipe union includes Cards.**
   Evidence: `convex/schema.ts` defines `cards`, `cardAccruals`, and optional
   character Card trace fields; `convex/spike.ts` includes `cards` and
   `cardAccruals` in `WipeTable` / `wipeOneTable`. `tests/cards.test.ts`
   covers the schema shape. No migration shim was added.

## WP4 Hard-Gate Evidence

- **Harness/no-card behavior:** covered by `tests/matches.test.ts`,
  `tests/runMatch.advanceTurnCards.test.ts`, and the new WP5 vertical-slice
  harness no-op test.
- **Card accrual self-guard:** `tests/cards.test.ts` and
  `tests/cardLayer.verticalSlice.test.ts` prove completed non-Card harness
  matches do not patch Cards or insert `cardAccruals`.
- **`harness/run.ts` unchanged:** `git diff -- harness/run.ts` returned no
  output on 2026-05-16.
- **Reports scoped by match ids:** `convex/reports.ts` and phase report
  writers read `runs` rows inside loops over caller-supplied `matchIds` using
  `runs.by_match`; `tests/reports.test.ts` covers `runReportCreate` reading
  only supplied match ids, missing-run reporting, and idempotency by
  `matchIdsHash`.

Parity note: the automated hard-gate evidence is decomposed across focused
tests and source checks rather than a maintained historical pre-Card golden
fixture. The covered invariants are the harness `matches.start` row shape,
absence of Card fields on harness characters, unchanged persona prompt
loading, terminal scheduling of the Card accrual self-guard, zero Card writes
for completed no-Card matches, and report reads scoped by explicit
`matchIds`. No WP5 production code changed the harness path.

## Decisions

- Used a single fake Convex-like DB/scheduler context for the vertical slice
  instead of a real deployment, matching the phase constraint that WP5 must not
  require Azure calls or deployed Convex state.
- Kept WP5 scoped to tests and docs. No edits were made to
  `convex/runMatch.ts`, `convex/matches.ts`, or `convex/cards.ts`.
- Treated prize-per-match and K/D as derivable assertions, not stored fields,
  aligned with mental-model §12 and README assignment criterion 6.

## Out Of Scope Verification

No accounts, lobby, auto-draw/backfill, seasons, leaderboard UI, replay UI, or
unlockable prompt segments were added by WP5.

## Validation Commands

- `npm test -- tests/cardLayer.verticalSlice.test.ts` — PASS, 2 tests.
- `npx eslint tests/cardLayer.verticalSlice.test.ts` — PASS.
- `npx tsc --noEmit --pretty false` — PASS.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm test` — PASS, 51 files passed, 1 skipped; 839 tests passed, 2 skipped.
- `npm run build` — PASS.
