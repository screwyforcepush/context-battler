# Phase 6 — Completion UAT (Fresh Iter-2 Data)

> Status: **PASS**
> Date: 2026-05-12
> Inspector: UAT Inspector (runtime-behavior only, no source modifications)
> Build under test: working tree post-D32 closeout; `apps/replay` against Convex deployment `calculating-meerkat-923`
> Canonical report: `jd78f616beq7dvs84gcs1n2f9586kbqt` (reportType `phase-6-closing-20`, 20 matches)
> Previous UAT round: CRITICAL-FAIL on legacy phase-3 data (ISSUE-001 vintage crash, ISSUE-002 error-boundary copy). Fresh iter-2 data plus the D29 vintage detector + error-boundary differentiation resolve those failures — see §5.

---

## 1. Summary

All 12 user stories execute without crashes against the fresh iter-2 dataset. Iter-2 surfaces — five-field tool schema, per-turn `use` variant, persona-name agent ids, Status block, Current Game State event log with personal damage feed and global kill feed, field-scoped validator rendering, action+position combos, compass + target-relative move arms, movement-triggered overwatch annotation — are all visible and well-formed in the replay UI. Zero `Player_N` leaks observed in any rendered surface across the matches exercised. Only finding is a cosmetic favicon 404 with no functional impact.

## 2. Results table

| US | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| US-1 | Picker baseline | 20 fresh phase-6 matches (single-run replacement included in canonical 20), persona-named entries, no error boundary | Picker shows exactly 20 matches; "No more matches" button confirms total. All 20 canonical match ids from PHASE-6-CLOSURE.md §2.1 present (j97e6dvm, j97fje15, j977vn9d, j975axez, j972wq4n, j9781970, j9710xv3, j971jy8y, j97bx6d1, j9731tem, j973pnze, j974d6ma, j979gemc, j976skvx, j974f6fp, j9774p9b, j97eyhdz, j9785jjg, j97aatr5, j974w0qy). The OCC-replacement single-run match (j974w0qy) is the newest (21m ago) and is one of the 20, per closure §2. No error boundary. | PASS |
| US-2 | Cold-load match | 8 agent decisions per turn with persona names, no `Player_N`, no error boundary | Match j974w0qy at turn 5 renders 8 decisions: Camper / Duelist / Opportunist / Paranoid / Rat / Sprinter / Trader / Vulture. Decision English renders new arms (`Held overwatch`, `Held counter`, `Moved toward Opportunist up to 2`, `Moved SE up to 5`, `Held counter. Opened Chest_010`). Zero `Player_N` strings observed. | PASS |
| US-3 | Expand modal full surface | Status block, Current Game State, system prompt with persona display name, per-turn schema variant (not static), rawArguments vs decision side-by-side with matched/diverged, usage, validatorFieldErrors, decision English covering new arms | All surfaces rendered. Expand on Vulture turn 5: system role reads `You are Vulture, …` (D13 substitution); user role contains `# Vulture`, `## Status` block with 📍❤️⚔️🛡️🧪🗒️ fields and stats inline (e.g. `weapon: rusty_blade [dmg 10]`, `consumable: speed [+4 move range max dist]`); `# Current Game State` with `Turn N, M/8 players alive`, own-outcome line (`You moved 8 W`), Visible JSON keyed by persona names; tool schema variant emitted **per this (run, agent, turn)** (turn 5 null-only `"use":{"type":["null"],"enum":[null]}`, turn 2 consumable-or-null `"use":{"type":["string","null"],"enum":["consumable",null]}` — confirms it is not a static reference); reasoning summary captured; usage block (`input_tokens`, `output_tokens`, `reasoning_tokens`); tool-call pane shows "rawArguments vs decision: **matched**" indicator (also see US-9 for diverged variant). | PASS |
| US-4 | Action+overwatch combo | Combo trace with overwatch arming + action; decision English renders both arms | Camper turn 36 of j974w0qy: feed line `Held overwatch. Attacked Paranoid — hit (dealt 10 damage) — killed Paranoid.` Tool call confirms decision `{position:{kind:"overwatch"}, action:{kind:"attack", targetId:"Paranoid"}}`. Closure §3 reports 43 such combos; query across 5 matches surfaced 11 quickly. | PASS |
| US-5 | Counter retaliation | Counter direction text + counter-fire trace | Duelist turn 36 of j974w0qy: `Held counter. Attacked Paranoid — hit (dealt 10 damage) — killed Paranoid. Counter: counter-fired Paranoid, dealt 10 damage.` Paranoid same turn shows `Held counter. Attacked Duelist — hit (dealt 5 damage). Counter: counter-fired Duelist, dealt 5 damage. Counter: counter-fired Camper, dealt 5 damage.` Persona names used throughout. | PASS |
| US-6 | Movement-triggered overwatch | `triggeredByMovement:true` visible in trace; persona names | Paranoid turn 34 of j974w0qy: `Held overwatch. Overwatch: overwatch fired on Duelist, dealt 5 damage (movement trigger).` The explicit `(movement trigger)` parenthetical is the rendered surface for `triggeredByMovement:true`. Target carries persona display name (Duelist). | PASS |
| US-7 | Personal damage feed | Next turn user-role includes `<Attacker> attacked you with <weapon> (dmg N)`; persona name; appears even without LOS | Camper turn 36 of j974w0qy: Current Game State includes `Opportunist attacked you with sword (dmg 15)`. Multi-line examples: Duelist turn 35 shows `Paranoid attacked you with bare hands (dmg 5)` + `Opportunist attacked you with sword (dmg 9)`. Opportunist turn 35 shows `Duelist attacked you with rusty_blade (dmg 10)` + `Camper attacked you with rusty_blade (dmg 10)`. Format matches Scenario 5 verbatim. | PASS |
| US-8 | Compass + target-relative moves | All 8 compass bearings (N/NE/E/SE/S/SW/W/NW) and both toward/away render correctly with "up to <dist>" suffix on target-relative arms | Observed across j974w0qy: `Moved N up to 1` (Rat t34), `Moved NE up to 8` (Duelist t9), `Moved E up to 5` (Paranoid t1), `Moved SE up to 5` (Opportunist t5), `Moved S up to 6` (Trader t6), `Moved SW up to 8` (Trader t5), `Moved W up to 8` (Opportunist t9), `Moved NW up to 2` (Sprinter t5). Target-relative: `Moved toward Opportunist up to 2` (Duelist t5), `Moved away from Duelist up to 1` (Rat t7 in j97fje15). D19 "up to <dist>" preserved on both target-relative arms. | PASS |
| US-9 | Validator zero rendering | Field name + reason text per field-zeroed; rest of decision survives | Vulture turn 19 of j97e6dvm: feed entry shows `Diagnostic warning` badge + `Moved toward Chest_010 up to 4. validatorFieldErrors: action: loot target 'Chest_010' is already opened`. Modal: `rawArguments vs decision: diverged`, side-by-side rawArguments (`action.kind:"loot"`) vs decision (`action.kind:"none"`, position.move arm preserved). Validator field errors block lists `action: loot target 'Chest_010' is already opened`. Whole-turn fallback was NOT triggered — move arm survives validation, exactly per ADR-6 / Scenario 7. | PASS |
| US-10 | No-op visualisation (qualitative) | Note whether 43% no-op reads as genuine behaviour or measurement artifact | No-ops observed in feed are `Held overwatch` / `Held counter` stance commitments with no action/say/use. They are persona-consistent: Camper ("Hold ground in cover"), Rat ("avoid fights at all costs"), Paranoid ("Avoid open ground"), and Trader/Sprinter diplomatic/escape postures. The UI renders these decisions faithfully; the rate is a behaviour-policy outcome, not a render bug. Supports closure §3.1's "behaviour-policy gap" framing. | PASS |
| US-11 | Replacement single-run match | Replacement match renders cleanly | The OCC-replacement match is j974w0qy (newest at 21m ago); this is the same match used for US-2/US-3/US-4/US-5/US-6/US-7/US-8 and renders cleanly across the full turn range exercised. Closure §2 frames it as included in the canonical 20 rather than a 21st match — picker total = 20, no separate "extra" entry to exercise. | PASS |
| US-12 | No regressions in navigation/hash/hover/copy/raw-pane | All previous interactions work | Hash-route updates correctly on URL nav (`?turn=N`), on slider/Next-turn click, on picker → match drill-in, on back link. Modal opens via per-row "Open expand modal for X" button and closes via Close button or Escape key. `copy` buttons toggle to `copied!` (LLM input pane copy verified). Raw pane content is selectable as `<pre>` text. Final conslist run shows zero errors and zero warnings — only the favicon.ico 404 captured during initial picker load, cosmetic only. | PASS |

## 3. Iter-2 surfaces audit

The following iter-2-specific surfaces were independently observed during the runs:

- **Persona-name agent ids** — every feed entry, modal heading, system role substitution, Visible-object key, attack/loot `targetId`, kill-feed and damage-feed line, corpse id (`Corpse_Opportunist`, `Corpse_Trader`, `Corpse_Vulture` seen on Camper turn 36), and tool-call body uses persona display names. Zero `Player_N` literals observed across all turns visited.
- **Five-field tool schema** — every tool-call rendered has exactly `{use, position, action, say, scratchpad}`. No `primary`, `move`, `overwatch_stance`, `consume`, or `scratchpad_update` residue.
- **Position discriminated union** — `{kind:"overwatch"}`, `{kind:"counter"}`, and `{kind:"move", direction:{...}, dist:N}` all observed in tool-call bodies. Direction shapes: target-relative `{kind:"toward"|"away", targetId}` and compass `{kind:"N"|...|"NW"}` both observed.
- **Per-turn `use` variant** — turn 2 of j974w0qy (Vulture with speed equipped) emits the consumable-or-null variant (`type:["string","null"], enum:["consumable",null]`); turn 5 of j974w0qy (Vulture with consumable=none) emits the null-only variant (`type:["null"], enum:[null]`). Confirms per-turn build, not a static reference.
- **System prompt iter-2 text** — verbatim §1 system prompt rendered; no "Output discipline"/"safe-default" tail; cover-reveal list says `revealed by enemy within 2, attacking, speaking, looting, consumable` — `leaving cover` is absent from the teaching surface (D7/ADR-10 preserved).
- **`<Player Name>` substitution** — system role is rendered as `You are Vulture, …` (or Camper, Duelist, etc.) at display time; per closure §6 D13 this substitution lives in `convex/llm/azure.ts` and persisted `systemPromptText` keeps the template + stable hash.
- **Stats inline** — equipment carries stats inside the Status block: `rusty_blade [dmg 10]`, `axe`, `speed [+4 move range max dist]`. The agent does not need to remember effects.
- **📍 position-only** — position line carries `(x,y)` only; last-turn outcome (`You moved 8 W`, `You attacked Opportunist (dmg 10)`) lives in the event log under `# Current Game State`, not on 📍.
- **Personal + global event scopes** — both observed simultaneously on Camper turn 36: personal `Opportunist attacked you with sword (dmg 15)` (LOS-independent attribution) and global `Duelist killed Opportunist with rusty_blade`.
- **rawArguments vs decision indicator** — both `matched` (Vulture turn 5) and `diverged` (Vulture turn 19 of j97e6dvm) observed. Diverged case renders both sides + the validator-field-errors block.
- **Diagnostic surfaces** — `Diagnostic warning` badge appears on rows with either a `validatorFieldErrors` (Vulture turn 19 of j97e6dvm) or a `failureReason` (Vulture turn 9 of j974w0qy showing `failureReason: content_filter_blocked` — an Azure content-filter rejection with a 0/1200 token usage and `Moved N up to 0` safe-default movement). No-crash handling of LLM-side failures in the UI.

## 4. Console / network

- **Console errors**: One (1) 404 on `/favicon.ico` captured during initial picker navigation. Cosmetic, no functional impact, not a defect against any phase-6 acceptance criterion.
- **Console errors during deep navigation**: Final `conslist` after navigating picker → match → multiple turns → multiple modal opens/closes → back-to-picker reported zero errors and zero warnings.
- **Network**: All replay/dev-server fetches returned 200 except the favicon.ico noted above.
- **Convex backend log**: One pre-UAT OCC error from the original concurrent run was visible in `/tmp/convex-dev.log` (`worldState ... changed while this mutation was being run`) and one pre-UAT 16MB read-limit error from the in-Convex aggregator — both are documented in PHASE-6-CLOSURE.md §2 and §4 and are not user-visible in the UI. No new backend errors triggered by this UAT pass.

## 5. Status of prior UAT findings (vintage data)

The previous UAT round (D28) critical-failed on legacy phase-3 data:

- **ISSUE-001** — `decisionEnglish.ts` unguarded `position.kind` access crashed every phase-3 match render. D29 dispatched a vintage detector at the replay read boundary plus a render fallback so legacy rows are gated by a vintage notice rather than crashing. The fresh iter-2 dataset does not trigger the vintage path; no error boundary observed across any of the matches exercised. Verified resolved against the goal (fresh data renders cleanly); independent verification against legacy data is out of scope for this UAT pass since the DB was wiped per WP-H.
- **ISSUE-002** — error boundary surfaced async-404 copy on a synchronous render crash. D29 differentiated the message surfaces. The fresh dataset did not exercise the error boundary at all (no crashes), so the differentiation was not visually re-confirmed in this UAT pass. Out of scope to re-trigger.
- **ISSUE-003** — picker baseline. This pass confirms all 20 canonical iter-2 matches list correctly with completed status and persona-id heritage cleared.

## 6. Evidence

Screenshots captured during this pass:

- `/tmp/uat-us1-picker.png` — picker baseline with 20 fresh iter-2 matches
- `/tmp/uat-us3-expand-modal.png` — expand modal full surface (Vulture turn 5)
- `/tmp/uat-us4-overwatch-combo.png` — action+overwatch combo (Camper turn 36 attacks Paranoid)
- `/tmp/uat-us9-validator-zero.png` — diverged tool-call modal with per-field validator error (Vulture turn 19 of j97e6dvm)

Reproducible Convex traces (for cross-checking from the source-code side if anyone wants to re-verify):

- Action+overwatch combo: match `j974w0qyq10d8j8jm6ynymq2gs86k1be` turn 36 persona `camper`
- Action+counter combo: same match turn 36 persona `duelist`
- Movement-triggered overwatch: same match turn 34 persona `paranoid` firing on `Duelist`
- Personal damage feed (multi-line): same match turn 35 persona `duelist`, turn 35 persona `opportunist`
- Consumable variant: same match turn 2 persona `vulture` (speed equipped)
- Null-only variant: same match turn 5 persona `vulture`
- Validator field error: match `j97e6dvmegsemdvazv52g66jxd86j7ad` turn 19 persona `vulture`
- Away target-relative: match `j97fje15x6kwta3dxjym5dpn9186k7r7` turn 7 persona `rat` away from `Duelist`
- Content-filter failure: match `j974w0qyq10d8j8jm6ynymq2gs86k1be` turn 9 persona `vulture`

## 7. Issues found

None blocking. None of severity High or above. Only finding:

### NIT-001: favicon.ico 404

- **Severity**: Cosmetic / Low (not a defect against phase-6 acceptance criteria)
- **Repro**: Open `http://localhost:5173/` cold; check the console.
- **Expected**: Either a favicon served or no request (no missing asset reference).
- **Actual**: One `Failed to load resource: 404` for `/favicon.ico`. Verified via `performance.getEntriesByType('resource')` filter.
- **Impact**: None functional. Replay UI works in every flow exercised.
- **Recommendation**: Add a favicon to `apps/replay/public/` or remove the implicit reference in `index.html`. Defer to next UI polish slice; do not gate phase-6 closeout on this.

## 8. Recommendation

**PASS** — the iter-2 replay UI surfaces are runtime-correct on fresh iter-2 data. All 12 user-story flows execute end-to-end; iter-2 mechanics (action+overwatch / counter retaliation / movement-triggered overwatch / personal-and-global damage/kill feeds / per-turn schema variant / field-scoped validator / persona-name agent ids / compass + target-relative moves / `<Player Name>` substitution / vintage-data path absent on fresh data) are demonstrably working in the replay UI.

Phase 6 north-star UAT condition (the replay UI is the user-facing proof target for the iter-2 mechanics) is satisfied against the canonical 20-run dataset.
