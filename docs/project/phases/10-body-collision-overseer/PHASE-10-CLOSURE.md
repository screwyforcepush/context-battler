# Phase 10 — Closure Record

> Single-file handoff for Phase 11 planning. Records what the
> body-collision substrate + overseer v0 refinement slice produced, what
> proves it, and which North Star thresholds are met.
> Closure date: 2026-05-14. Source commit at close: `51b470d`.
>
> This is a closure RECORD, not a retrospective and not a phase-11 plan.

---

## 1. What we set out to build

Phase 10 shipped two intertwined threads in one slice:

- **Body-collision substrate (charge + wall-bump):** A discoverable,
  undocumented mechanic — no tool-schema surface, no system-prompt
  teaching, no new `action.kind`. Agents walking into other living agents
  (charge) or into walls (wall-bump) take 1 dmg. Charge damage routes
  through the existing `attacks[]` pipeline, so counter-stance defenders
  organically retaliate against chargers via the existing counter pass.
  Bilateral A<>B chargers each take 1 dmg but neither's counter fires
  (mutual exclusion with `position.kind=move`). Wall-bump self-damage
  fires on cardinal dead-stops and cornered-diagonal dead-stops. The
  partial-distance trace gap is closed: any wall-bonk emits both the
  partial movement trace and the bump signal.
- **Overseer v0 refinement:** Start-of-N grid semantics (grid renders
  what agents SAW when deciding, not what happened after), widened
  TurnFeed column (no hard 40% cap), and per-agent Status card in the
  feed row. The diagnostic loop (Status + Vision + reasoning + map)
  is visible in one widescreen viewport.

The proof target was a persisted 20-match `phase-10-closing-20` report
plus manual replay UAT at 1920x1080 confirming both substrate events
and UI refinements.

---

## 2. Canonical Source

- `reportId` = `jd7axe93jq0svjwgqkm21swcyd86q7ge`
- `reportType` = `phase-10-closing-20`
- `runCount` = 20
- `metBar` = `true`
- `failedMatches` = 0

The canonical report is queryable with:

```bash
npx convex run reports:byId '{"id":"jd7axe93jq0svjwgqkm21swcyd86q7ge"}'
```

The canonical metric payload is `phase10Payload`. The report follows the
sibling-payload pattern established by phases 7/9.

Report driver:

```bash
npx tsx harness/closing/phase10.ts --matchIds <closing-20 ids> --overwrite
```

### 2.1 OCC Substitution Policy

**Policy:** No OCC substitutions were required. All 20 matches completed
successfully with zero Convex optimistic-concurrency storage-layer
failures. `failedMatches: 0`.

---

## 3. Threshold Verdict

### 3.1 Preserved Phase-7 Thresholds

| Gate | Threshold | Measured | Verdict |
|---|---:|---:|---|
| Runs with extraction | >= 30% | 90% | PASS |
| Runs with kill | >= 80% | 100% | PASS |
| Runs with equip | >= 80% | 100% | PASS |
| Runs with speech | >= 50% | 100% | PASS |
| Persona extraction spread | >= 15 pp | (met) | PASS |
| Failed matches in canonical set | 0 | 0 | PASS |
| `null_only` raw `use:"consumable"` emissions | 0 | 0 | PASS |
| `Player_N` surfaced literals | 0 | 0 | PASS |
| Whole-turn validator zeroes | 0 | 0 | PASS |
| Per-field rejection rate | <= 10% | 0.248% | PASS |

**10 / 10 preserved threshold checks pass.** All phase-7 gates
preserved without regression.

### 3.2 Phase-10 Slice-Specific Evidence

| Counter | Threshold | Measured | Verdict |
|---|---:|---:|---|
| `chargeEventCount` | >= 10 | 155 | PASS |
| `chargeCounterFireCount` | >= 3 | 86 | PASS |
| `wallBumpSelfDamageCount` | >= 5 | 153 | PASS |
| `partialDistanceWallBumpCount` | >= 1 | 132 | PASS |
| `chargeDamageFeedMissing` | 0 | 0 (145/145 delivered) | PASS |

**5 / 5 slice-specific checks pass.** Evidence bar exceeded with
significant margin across all counters.

Additional data-only counters:
- `lethalChargeCount`: recorded in payload (frequency TBD)
- `chargeEventPerPersona`: distribution recorded in payload

---

## 4. Schema Wipe and Report Pipeline

The schema break (`moves[].bodyCollision` on `resolutionValidator`,
`phase10Payload` on `reports`) was exercised under POC posture
(`project_poc_schema_wipe_acceptable`). Dev DB wiped before phase-10
schema push.

Schema pushed with `npx convex dev --once`.

The report pipeline used the same Path-2 pattern as phases 7/9:

1. Harness completed 20 live matches at `--reasoning low`.
2. `harness/closing/phase10.ts` fanned out one `turns.byMatchSlim` read
   per match id.
3. The CLI computed metrics locally via `computePhase10Metrics`.
4. The CLI persisted only the small computed payload through
   `reports/phase10:persistComputedPhase10Report`.

---

## 5. Implementation Summary

Landed as commit `51b470d` (25 files, 3,242 insertions, 104 deletions).

### 5.1 Engine Substrate (WP-A)

- **`convex/engine/movement.ts`** — `bumpByMover` map drives both
  `blockedBy:"wall"` and `bodyCollision.wall` emission (D11). Charge
  events attach to `moves[]` trace as `bodyCollision.character` with
  `chargerId`/`defenderId`/`dmgToCharger`/`dmgToDefender`. Wall-bump
  self-dmg emits as `bodyCollision.wall` with `wallRectId`/`dmg`.
  Partial-distance wall-bump trace gap closed. Desire-recompute branch
  retired (single source of truth).
- **`convex/engine/resolution.ts`** — Body-collision `AttackEvent`
  variants inserted into `attacks[]` at `resolution.ts:320` before
  overwatch loop (D24). `source:"bodyCollision"` +
  `revealsAttacker:false` flags (D12). Counter pending dedupe by
  `(overwatcherId, attackerId)` (D15). Bilateral charge dedupe by
  sorted-pair key (D2).

### 5.2 LLM Projection (WP-B)

- **`convex/llm/inputBuilder.ts`** — `renderMoveFragment` gains
  charge/wall-bump outcome phrasing. `renderDamageEventLines` extends
  to surface "X charged into you (dmg 1)" defender feed lines.
- **`apps/replay/src/lib/decisionEnglish.ts`** — `bodyCollision.character`
  and `bodyCollision.wall` fragments render in TurnFeed + HoverCard
  outcome summaries (D14).

### 5.3 Overseer UI (WP-C)

- **`apps/replay/src/routes/Replay.tsx`** — Start-of-N grid via
  `reconstruct(bundle, currentTurn - 1)` call-site flip (D4).
  `mainStyle.maxWidth` cap removed for widescreen (D18).
- **`apps/replay/src/components/TurnFeed.tsx`** — Column widened (no
  hard 40% cap). Per-agent Status card parses `composedUserMessage`
  and renders position, HP, weapon, armour, consumable, scratchpad,
  Inside/Outside Evac flag (D19). Default expanded (D22).

### 5.4 Closing Infrastructure (WP-D)

- **`convex/reports/phase10.ts`** — `computePhase10Metrics`,
  `phase10PayloadValidator`, `persistComputedPhase10Report` mutation.
  15 threshold gates + `meetsAllThresholds` rollup.
- **`harness/closing/phase10.ts`** — CLI driver (mirrors phase-7/9
  drivers).

---

## 6. ADR Rollup

All decisions D1–D29 from the spec, review rounds, and implementation
were honoured. Key decisions:

- **D11:** Single `bumpByMover` map — single source of truth for wall
  trace + body-collision emission.
- **D12:** Body-collision events carry `revealsAttacker:false`; reveal
  pass skips them. Counter retaliations reveal normally.
- **D13:** `resolutionValidator` added to persistence chain; schema-mirror
  parity test enforces structural alignment.
- **D14:** `decisionEnglish.ts` moved into WP-B scope for body-collision
  fragment rendering.
- **D15:** Counter pending dedupe by `(overwatcherId, attackerId)`.
- **D17:** Kill-feed ordering: `actions[]` first (weapon kills), then
  `moves[].bodyCollision` (1-dmg charge never out-ranks weapon kill).
- **D18:** `maxWidth` cap removed from `Replay.tsx` for widescreen.
- **D19:** Status parser regex matches `renderStatusBlock` verbatim.
- **D24:** Body-collision `attacks[]` insertion between declaration and
  overwatch loop.

---

## 7. Validation Gates

- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS (41 files; 708 tests passed, 2 skipped)
- `npm run build` — PASS
- `npm run build:replay` — PASS
- `git diff --check` — PASS
- `npx convex dev --once` — PASS

Working tree clean at close.

---

## 8. Test Coverage

| File | Phase-10 tests | Coverage |
|---|---:|---|
| `tests/engine/movement.test.ts` | ~12 | Charge event emission (cardinal + diagonal), wall-bump self-dmg (cardinal dead-stop, cornered diagonal), partial-distance wall-bump, bilateral charge dedupe, charge budget-zeroing, slide + bump coexistence |
| `tests/engine/resolution.test.ts` | ~8 | Body-collision attacks[] insertion, counter-on-charge fire, bilateral counter suppression, reveal suppression for body-collision, counter dedupe, lethal charge |
| `tests/llm/inputBuilder.test.ts` | ~10 | Charge outcome line phrasing, wall-bump outcome line, defender damage-feed line, partial-distance + bump combined rendering |
| `tests/llm/schemaMirror.test.ts` | 1 | bodyCollision schema-mirror parity |
| `tests/reports/phase10.test.ts` | ~15 | Metric computation, threshold gates, bilateral counting, damage-feed audit, per-persona distribution |
| `tests/turns.test.ts` | ~5 | bodyCollision persistence roundtrip through slim projection |

All tests are unit-level (pure-function engine + projection logic).
Integration exercised by the closing-20 end-to-end.

---

## 9. Replay / UI Verification

Manual replay UAT at `1920x1080`:

- Start-of-N grid semantics confirmed: grid positions align with
  the agent's Vision at the displayed turn.
- TurnFeed column width measured at 963px (exceeds 700px target).
- Per-agent Status card renders position, HP, weapon with stats,
  armour with stats, consumable with stats, scratchpad, Inside/Outside
  Evac flag — matching the per-turn input's `## Status` block.
- Body-collision events visible in TurnFeed outcome summaries.
- `?turn=N` deep-link semantics consistent with start-of-N grid.
- HoverCard labels consistent with new semantics.
- Diagnostic loop (Status + Vision + reasoning + map) visible in one
  viewport without scrolling.

---

## 10. Deferred Items

1. **Persona behaviour-tuning to exploit charges** — Out of scope.
   Substrate slice; behaviour tuning is a later loop. Diagnostics
   expose `chargeEventPerPersona` for a future tuning pass.
2. **Charge frequency calibration** — D29 notes that 155 charges and
   153 wall-bumps across 20 runs far exceed the minimum thresholds
   (>= 10 / >= 5). Whether 1-dmg scratch frequency is at the right
   level is a future calibration question, not a phase-10 blocker.
3. **`convex/runStats.ts` per-persona kill attribution** — Known issue
   from phase-7 diagnostic addendum (mental-model §16); top-level kills
   works via `deaths.length`. Separately backlogged.
4. **Post-match aftermath grid view** — Start-of-N flip intentionally
   hides final-turn aftermath (D23). Accepted as diagnostic-grade
   tradeoff.
5. **Status card on dead/extracted agent rows** — Dead rows render
   existing terminal marker; Status card only on live agentRecord rows.
6. **Consumer-renderer parity** — Overseer remains diagnostic-grade
   per mental-model §11.

---

## 11. Cross-references

- Canonical intent: [`mental-model.md` §18](../../spec/mental-model.md#18-next-slice-intent--jam-captured-2026-05-14-not-yet-dispatched)
- Predecessor: [Phase 9 — Walls + Vision Rect-Grained](../09-walls-vision-rect-grained/PHASE-9-CLOSURE.md)
- Phase spec: [Phase 10 README](./README.md) (spec v2 + §10 closure record)
- Phase 7 closure: [PHASE-7-CLOSURE.md](../07-context-payload-iter-3/PHASE-7-CLOSURE.md) (threshold baseline)
- Phase 9 closure: [PHASE-9-CLOSURE.md](../09-walls-vision-rect-grained/PHASE-9-CLOSURE.md) (wall-slide + rect-Vision predecessor)
