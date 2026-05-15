## Review Summary
- **Overall assessment**: Concern / **REQUEST-REVISION** before implementation starts.
- **What is solid**: The north-star shape is right: remove duplicate prompt text from `turns.agentRecords[].input`, keep runtime LLM calls unchanged, preserve diagnostic/replay full-input surfaces by joining at read time, and split mutable world data from immutable terrain. This aligns with mental-model pillar 7: state is the contract, runtime is swappable.
- **What is risky or unclear**: The plan has two incorrect assumptions that affect acceptance math: `buildSystemPrompt(turn)` is turn-bound, so there is not one system prompt per match; and WP-B still reads static terrain once per scheduled turn, not once per chain. The hash collision path is not guarded. The read-side recomposition contract is underspecified for `turn`, missing-prompt fatality, and all derived slim-query fields.

## Issues
| Severity | Area | Description | Evidence | Recommendation |
|----------|------|-------------|----------|----------------|
| High | Data / Prompt Dedup | The plan's prompt cardinality is wrong: current system prompt text is not identical across all 50 turns. It changes with the evac/extraction countdown. This invalidates "exactly 1 system row + <=8 persona rows" and overstates write-dedup math. | `convex/llm/systemPrompt.ts:5-20` renders `Evac location spawns in N turns` / `Extraction in N turns`; tests assert turn-bound text and hashes at `tests/llm/systemPrompt.test.ts:53-68`; Phase 7 closure records "prompt hashes remain turn-bound" at `PHASE-7-CLOSURE.md:209`. Plan claims 1 system row at `README.md:403-405`. | Revise WP-A acceptance to expect one row per distinct `(kind, hash, text)`: likely up to 50 system prompt rows plus 8 persona rows for a full match, cross-match deduped. Do not make the system prompt stable just to improve dedup; that would be prompt-behaviour scope creep. Fetch replay prompt text by unique hashes referenced by turns, not by hard-coded "system + 8 persona" assumptions. |
| High | Data Integrity | DJB2-32 collisions would silently corrupt historical prompt replay if `getOrCreatePrompt` treats any existing `(hash, kind)` row as valid. Cross-match scope raises the blast radius: one collision can poison later matches. | Plan locks DJB2-32 at `README.md:67-70` and describes idempotent read-then-insert at `README.md:191-196`, but does not specify `existing.text === text` verification. Current hash is 8 hex chars at `convex/runMatch.ts:101-123`. | Add a required guard: query `(hash, kind)` with a uniqueness check; if no row, insert; if row exists and `row.text === text`, reuse; if row exists and `row.text !== text`, throw a fatal data-integrity error or switch to SHA-256. Add a unit test with a forced collision. |
| High | Correctness / Recomposition | `recomposeUserMessage` as specified cannot byte-equal the current user role because it lacks the parent turn number. | `buildAgentInput` renders `Turn ${state.turn}, ${aliveCount}/8 players alive` at `convex/llm/inputBuilder.ts:632-644`; the proposed helper signature at `README.md:227-235` only takes `input`, `displayName`, and `prompts`. | Change the helper contract to include `turn` from the parent turn row, e.g. `recomposeUserMessage({ input, turn, displayName, prompts })`. Add a byte-equality unit that compares the whole user role, including blank lines and section order. |
| High | Diagnostics Contract | The read-side slim projection does more than delivery-line scanning. It currently parses status and visible keys out of `composedUserMessage`; replacing only delivery audits with `narrativeLines` will break Phase 7/9/10 diagnostics. | `turnsDerived.ts` checks delivery lines at `:572`, `:589`, `:628-649`, `:672-674`, but also derives `visibleRectKeys`, `insideBearingHere`, `observerPos`, `selfEquipment`, and `selfHp` at `:777-798`. Diagnostics mechanics consume those fields at `harness/diagnostics/mechanics.ts:156-163`. | Specify the exact forward sources: delivery audits from `narrativeLines.some(...)`; visible rect keys and inside-bearing from `visibleStateDigest`; `selfHp`, equipment, position, and evac status from `input.status`. Add focused tests for `projectSlimTurnRows` preserving all current derived fields. |
| Med | Scope / Schema Growth | Persisting `narrativeLines` may be acceptable, but the current rationale overstates the cost of recompute. `turns.byMatchSlim` already walks adjacent rows in memory; replay bundles already include all turns. The trade-off is exact rendered text vs ~500-800B per agentRecord, not "avoid a DB history walk". | Plan rationale at `README.md:90-95` and `:569-581`; current adjacent-row projection is `projectSlimTurnRows(rows).map((row,index) => buildDeliverySignals(previousRow,row))` at `convex/turnsDerived.ts:807-813`; `buildAgentInput` already creates one string per event line at `convex/llm/inputBuilder.ts:624-630`. | Revise the decision note. Either keep `narrativeLines` as an intentional exact-text snapshot with a measured byte budget, or flip to recompute from previous row. If kept, require every element to be a complete rendered line and test delivery scans against array entries, not joined blobs. |
| Med | World Read ROI | WP-B does not meet the North Star's "read once per chain" phrasing. It removes static terrain from `worldByMatch`, but then adds `worldStaticByMatch` on every scheduled `advanceTurn` invocation. | Plan explicitly says both reads occur per turn at `README.md:120-131` and success criteria require one static read per turn at `README.md:457-459`. The action chain reschedules at `convex/runMatch.ts:1028-1030`. | Keep the scoped deferral if desired, but change the claim and benchmark. Measure combined per-turn world payload (`worldByMatch` + `worldStaticByMatch`), not just slim `worldByMatch`. If the user wants true read-bandwidth removal, the plan must scope a single-action turn loop or equivalent cacheable chain refactor. |
| Med | Read-Side Enumeration | The plan's enumeration is mostly right but incomplete. In particular, `harness/closing/phase9.ts` directly reads `worldState:byMatchId` and adapts `row.walls` / `row.coverClusters`; `convex/reports/phase6.ts` directly reads `composedUserMessage` and `personaPromptText`. | `harness/closing/phase9.ts:126-130`, `:355-400`; `convex/reports/phase6.ts:118-124`, `:204-207`, `:397-407`, `:800-809`. Plan only names `convex/reports/phase9.ts`/`phase3.ts` in WP-B and generic `phase*.ts` in WP-A. | Add these files explicitly to WP-A/WP-B. Treat tests as first-class update scope: `tests/turns.test.ts`, `tests/runMatch.test.ts`, `tests/llm/*`, `tests/reports/phase6.test.ts`, replay raw-pane/TurnFeed tests, and phase9 closing tests. |
| Med | API / Failure Semantics | The helper comment allows a null/sentinel on missing prompt lookup, but forward-only POC posture says missing prompt text is data corruption, not a graceful legacy case. | Plan says "Returns null/sentinel on missing hash" at `README.md:231-235`; same plan says no migration shims / single forward shape at `README.md:896-901`. | Make missing prompt rows fatal in server-side recomposition and visibly fatal in the UI, not silently unavailable. Because `persistTurn` upserts prompts in the same mutation, any missing row indicates a bug or data corruption. |
| Med | Parallelism | WP-A and WP-B are not fully independent. Both touch `convex/schema.ts` and the same `advanceTurn` block in `convex/runMatch.ts`; the conflict is not just schema rebase. | WP-A changes `buildAgentInputRecord`, `perAgent`, `resolved`, and `persistTurn` args around `runMatch.ts:734-850` and `:897-1025`; WP-B changes world reads and `buildMatchState` around `runMatch.ts:676-696`. Plan claims disjoint call-site files at `README.md:619-625`. | Reword as "parallelisable with an integration owner". Assign one engineer or final integrator to `convex/runMatch.ts` and add an integration test that builds state, calls LLM wrapper input, and persists the new shape. |
| Low | Smoke Bar | The 10-run smoke can miss meaningful behaviour regressions. It only gates `>0` for extraction/kill/equip/speech, so a half-rate regression versus Phase 9 would pass. | Mental model §19 sets directionally intact smoke at `mental-model.md:903-914`; plan repeats it at `README.md:485-494` / WP-C. | Keep the light gate per North Star, but record Phase 7/9 comparable metrics as data-only beside the pass/fail smoke bars so the user can see a large drift and override before closure. |
| Low | Documentation Hygiene | The plan references "confirmed in §5 perplexity research", but §5 is the work-package breakdown and no research note exists in the file. | `README.md:193-195`. | Remove or replace the stale reference; the plan should not cite unavailable evidence. |

## Spec / Guide Deviations
- **System prompt dedup claim deviates from current spec/code**: mental-model §16 records the two-phase system prompt countdown; `buildSystemPrompt(turn)` and its tests enforce turn-bound hashes. Phase 11 must dedup per distinct system prompt, not collapse to one system row.
- **World static "once per chain" deviates from North Star wording**: mental-model §19 says static terrain is read once per chain or split via sibling query; the plan chooses per-turn static reads. That can be an intentional deferral, but the read-bandwidth claim must be stated as a partial win.
- **Forward-only POC posture conflicts with missing-hash sentinel behavior**: no migration shims means the new read path should fail loudly on unresolved prompt hashes rather than preserve a legacy-style unavailable fallback.
- **Phase 7 diagnostics precedent requires evidence-backed delivery checks**: the current plan should preserve cross-turn evidence semantics from `turnsDerived.ts`, not replace them with same-turn counters or untested narrative scans.

## Conditions Required Before Implementation
1. Update WP-A cardinality and tests for turn-bound system prompts: expected prompt rows are distinct hashes, not `1 + 8`.
2. Add hash-collision and duplicate-row guards in `getOrCreatePrompt`, with tests.
3. Change recomposition helper inputs to include `turn`; add byte-equality tests for user role and replay full LLM input.
4. Make missing prompt lookup fatal for forward rows.
5. Decide `narrativeLines` explicitly: persist exact lines with measured byte budget, or recompute from adjacent rows. If persisted, test complete-line delivery scans.
6. Expand read-side worklist to include `convex/reports/phase6.ts`, `harness/closing/phase9.ts`, and the affected tests.
7. Reframe WP-B as a slim `worldByMatch` response plus per-turn static sibling read, unless the user explicitly scopes a real once-per-chain action refactor.
8. Measure combined world-read payload in closure (`worldByMatch` + `worldStaticByMatch`) and `persistTurn` mutation payload separately from persisted DB row bytes.
9. Assign final integration ownership for `convex/runMatch.ts`.
10. Keep the smoke gate light, but publish comparable Phase 7/9 metrics as data-only drift context.

## Read-Side Touchpoint Completeness
Grep target: `systemPromptText|personaPromptText|composedUserMessage`.

- `convex/schema.ts:225-235` and `convex/_internal_runMatch.ts:130-140` define the mirrored persisted input validator.
- `convex/runMatch.ts:392-409`, `:734-850`, `:897-1025` builds and persists the current input shape.
- `convex/llm/inputBuilder.ts:601-649` constructs runtime system/user prompt material. This remains the source for the LLM call and the round-trip oracle.
- `convex/llm/azure.ts:113-120`, `:499-503` consumes `composedUserMessage` for the live Azure request. This is runtime input, not persisted read-side, and should remain.
- `convex/turnsDerived.ts:40-49`, `:543-737`, `:777-798` derives slim diagnostics from full input before projection.
- `convex/reports/phase6.ts:118-124`, `:204-207`, `:397-407`, `:800-809` directly reads legacy prompt/user-message fields.
- `apps/replay/src/lib/rawPane.ts:64-89` renders system role and user role from persisted fields.
- `apps/replay/src/components/TurnFeed.tsx:240-242`, `:396-417` parses the Status card from `composedUserMessage`.
- Test/update scope includes `tests/integration/persistAdaptParity.test.ts`, `tests/turns.test.ts`, `tests/llm/inputBuilder.test.ts`, `tests/llm/systemPrompt.test.ts`, `tests/llm/azure.test.ts`, `tests/llm/useVariantContract.test.ts`, `tests/runMatch.test.ts`, `tests/reports/phase6.test.ts`, `apps/replay/src/lib/__tests__/rawPane.test.ts`, `apps/replay/src/components/__tests__/TurnFeed.test.tsx`, and `apps/replay/src/lib/__tests__/vintageReplay.test.tsx`.
- Comment-only stale reference: `convex/llm/personas.ts` mentions per-turn `personaPromptText`.

Grep target: `worldRow.walls|worldRow.coverClusters|worldRow.coverTiles|worldState?.walls|worldState?.coverTiles|row.walls|row.coverClusters|world.walls|world.coverClusters|world.coverTiles`.

- `convex/matches.ts:225-229` writes static terrain into `worldState` today.
- `convex/_internal_runMatch.ts:323-330` returns the full `worldState` row through `worldByMatch`; `:462-473` patches only dynamic fields.
- `convex/runMatch.ts:198-234`, `:676-696` reads `worldByMatch` and builds complete `MatchState.world`.
- `convex/replay.ts:72-90` bundles `worldState` for replay.
- `convex/worldState.ts:4-12` exposes `worldState:byMatchId`; used by closing scripts.
- `harness/closing/phase9.ts:126-130`, `:355-400` reads world state and adapts static terrain for Phase 9 metrics. This is omitted from the plan.
- `convex/reports/phase9.ts:236-296` consumes `world.walls` and `world.coverClusters` for rect/LOS evidence.
- `apps/replay/src/components/Grid.tsx:49-105` renders walls and cover tiles.
- `apps/replay/src/lib/reconstruct.ts:46-49`, `:130`, `:168-175` consumes `worldState` for dynamic replay state; keep type changes coordinated if the bundle shape changes.
- Engine consumers (`convex/engine/movement.ts`, `hiding.ts`, `vision.ts`, `convex/llm/idNormalisation.ts`) should continue to receive complete `MatchState.world` after the merge; they are not DB readers but are regression-sensitive.

## Diagnostics Trace Check
Damage-feed continuity is viable if `narrativeLines` stores the same complete event lines currently appended by `buildAgentInput`. Current flow:

- `buildAgentInput` creates event lines as independent strings at `convex/llm/inputBuilder.ts:624-630`, then appends them under `# Current Game State` at `:632-644`.
- `turnsDerived.ts:543-737` maps previous-turn speech/loot/damage/body-collision events to the next turn's agent record and checks `input.composedUserMessage.includes(expectedLine)`.
- `harness/diagnostics/mechanics.ts:156-163` consumes the resulting `inboundSpeechCount` and `damageFeedAudit` counters.

Forward flow should be `record.input.narrativeLines.some((line) => line.includes(expectedLine))`. Do not split a single rendered event across array elements; do not replace this with same-turn resolution counters.

## Decision Notes
- **D1 / §7.1 Hash function DJB2-32**: **AGREE with condition**. POC scale is acceptable only with a collision guard. Override signal: if guard is not accepted, use SHA-256 now.
- **D2 / §7.2 Persist status snapshot**: **AGREE**. This is small, replaces brittle regex status parsing, and is needed for byte-equal user-role recomposition without a state walk. Keep `maxHp` as the shared constant unless max HP becomes per-agent.
- **D3 / §7.3 Persist `narrativeLines`**: **AGREE only after revision**. The exact-text argument is valid; the "avoid server-side history walk" argument is not. Reviewer preference: keep if the byte budget is measured and tests prove line-complete delivery scans.
- **D4 / §7.4 Cross-match prompts table**: **AGREE with collision guard**. Cross-match dedup is the right high-ROI move, especially because system prompts are turn-bound but stable across matches.
- **D5 / §7.5 Two-table `worldStatic` split**: **AGREE**. It enforces mutability boundaries in schema and keeps the engine-facing `MatchState.world` contract clean.
- **D6 / §7.6 Per-turn double-read**: **DISAGREE with the bandwidth framing; accept only as scoped deferral**. It does not satisfy "once per chain". The plan must benchmark combined world reads and document the remaining static-read cost.
- **D7 WP-A + WP-B parallelism**: **DISAGREE as written**. Parallel implementation is possible, but `convex/runMatch.ts` is a shared integration hotspot.
- **D8 Light validation bar**: **AGREE**. Keep smoke light per North Star, but record data-only drift against Phase 7/9 so a severe behaviour regression is visible even if not gated.

## PM Decisions Needed
- Confirm whether to revise the plan in place before dispatch, or let the engineer treat this review as binding conditions.
- Decide whether `narrativeLines` is an exact-text snapshot worth ~500-800B per agentRecord, or whether read-time recomposition from adjacent turn rows is preferred.
- Decide whether the partial WP-B win is enough for this slice, knowing static terrain still moves once per scheduled turn unless the action chain is refactored.

---

# Reviewer 2 — supplemental notes (independent pass)

> Below is an independent second review run in parallel with the one above.
> Reviewer 2 reached most of the same findings — turn-bound system prompt,
> hash-collision guard, recompose-needs-`turn`, WP-B per-turn-static read,
> phase6 + harness/closing/phase9 + Grid.tsx omissions, runMatch.ts shared
> integration surface, light-smoke gap. Recording here only the *additional*
> items that the primary review didn't surface, and a separate verdict.

## ⚖️ Reviewer 2 verdict
**APPROVE-WITH-CONDITIONS** — same conditions as the primary review's
*Conditions Required Before Implementation* list; treat that list as
binding. The plan's architecture is sound. The gaps are guard-rails on
locked decisions whose failure mode is silent corruption, post-merge
break, or honesty in the bandwidth claim. None invalidate the slice.

## Additional issues

| Severity | Area | Description | Evidence | Recommendation |
|----------|------|-------------|----------|----------------|
| **Low** | Plan factual | §3.4 / §7.2 attribute `extractSelfHp` / `extractSelfEquipment` / `extractObserverPos` to `rawPane.ts`. They live in `convex/turnsDerived.ts:227-289`. `apps/replay/src/components/TurnFeed.tsx:396-418` has its own `parseStatusBlockForReplay` (separate parser, same teardown target). | Grep `extractSelfHp` returns `convex/turnsDerived.ts` only. | Fix file references in §3.4 + §7.2. Both call sites must switch to `input.status`. |
| **Med** | Replay bundle shape | §3.5 leaves "merge `worldStatic` into `worldState` OR return as sibling" as "engineer's call". `apps/replay/src/components/Grid.tsx:77,94` reads `worldState?.walls` / `?.coverTiles` directly off the bundle. If the engineer picks sibling, Grid silently renders an empty map until somebody fixes it. | `apps/replay/src/components/Grid.tsx:77,94`; `convex/replay.ts:72-92` `getReplayBundle`. | **Add Lock-D10 to §7**: `getReplayBundle` returns ONE `worldState` field with merged static+dynamic so Grid's existing field access stays unchanged. Sibling-field has no benefit and pays a Grid update cost. Lock-it. |
| **Low** | Plan factual | §3.2 step 1 says concurrency idempotency is "confirmed in §5 perplexity research". §5 is the work-package breakdown; no research artifact in the doc. | `README.md:193-195` vs §5. | Drop the stale reference; rely on the Convex serialisability behaviour (which is correct) as the rationale. |

## Round-trip sufficiency — per-line trace

Verified that the persisted fields after WP-A are sufficient to byte-equal
reconstruct `composedUserMessage` from `convex/llm/inputBuilder.ts:632-644`
**provided `turn` is added to the recompose helper** (primary review's
HIGH-severity Correctness/Recomposition issue). Trace:

| Builder line | Source post-WP-A | Verified |
|--------------|------------------|----------|
| `` `# ${observer.displayName}` `` | helper arg `displayName` | ✅ |
| `` `You adopt ${observer.displayName} persona:` `` | helper arg `displayName` | ✅ |
| `personaPromptText` | JOIN `input.personaPromptHash` → `prompts` table | ✅ |
| `""` (separator) | constant | ✅ |
| `renderStatusBlock(state, observer)` 7 lines | `input.status` (`hp`,`pos`,`equipped`,`insideEvac`) + `input.scratchpadBefore`; `maxHp` = `CHARACTER_MAX_HP` constant | ✅ |
| `""` | constant | ✅ |
| `"# Current Game State"` | constant | ✅ |
| `` `Turn ${state.turn}, ${aliveCount}/8 players alive` `` | helper arg `turn` + `input.aliveCount` | ✅ once signature fixed |
| `...events` (post-filter) | `input.narrativeLines` (post-filter array) | ✅ |
| `""` | constant | ✅ |
| `visibleStateDigest` | `input.visibleStateDigest` (already persisted) | ✅ |

Note: `observer.scratchpad` in the Status block IS
`agentRecord.input.scratchpadBefore` — verified at `convex/runMatch.ts:763`
(`scratchpadBefore: actor.scratchpad`). The post-filter contract for
`narrativeLines` (must store the filtered array, not raw event outputs with
potential `null`s) is the load-bearing implementation detail; engineer
should pin it with the WP-A round-trip test.

## Note on the prompts-table cardinality correction

The primary review's "turn-bound system prompt" finding is correct and
load-bearing. The arithmetic correction:

- **Per-match prompt rows (with cross-match dedup):** up to 50 distinct
  system-prompt rows (one per turn, countdown changes every turn for
  turns 1-50) + ≤ 8 persona rows.
- **Cross-match steady state:** still ≤ 50 + 8 = 58 rows total across
  all matches, since turn-N system prompt is identical across matches
  using the same map and timing.
- **Per-match write savings:** old shape persisted system prompt 8
  agents × 50 turns = 400 copies of (50 distinct) system prompts ≈ 400
  × ~600 B = ~240 KB. New shape: ≤ 50 rows × ~600 B = ~30 KB on first
  match, ~0 KB on subsequent matches (cross-match dedup).
- **Multi-match cohort savings (10-run smoke):** old shape 10 × 240 KB
  = ~2.4 MB system-prompt write; new shape ~30 KB on first match, ~0 KB
  on others = ~30 KB total. **Savings ≈ 98% of system-prompt write
  bandwidth across the cohort.** Per-match savings drops to ~88% (240
  KB → 30 KB), still substantial.

The plan's headline "~80% of write-bandwidth redundancy retires" claim
holds directionally — it just needs to be re-stated in terms of distinct
hashes, not "1 system + 8 persona" rows, and the cohort math should
appear in the WP-C bench.

---

*Reviewer 2 trusted, but verified: file paths and line numbers cited above
were grep-confirmed against the working tree at HEAD (`03c0ce8`).*
