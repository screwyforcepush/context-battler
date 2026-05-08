# Phase 03 - Plan Review Round 3

**Verdict: Concern.** Plan v2 closes almost all Round-1/Round-2 punch-list items and is aligned with the North Star, but it is not yet clean enough for WP-A dispatch. The blocking miss is narrow: the expanded `concept-spec.md` edit surface lands in `README.md` and ADR §8, but `work-packages.md` still scopes WP-A.4 and its acceptance to only §11/§13/§21, and ADR §8's consequences still repeat the old three-section surface. That makes punch-list item 12 / PM lock D12 only partially landed. I also found one low-severity stale wording leak (`chest-interact counts`) in WP-B acceptance.

---

## 1. Verdict

Overall assessment: **Concern**.

What is solid: the schema mirror, overwatch trace shape, wall-blocked move engine emit, reporting data flow, Branch-B rationale path, reasoning nullability, consumer fan-out, affordances sequencing, test coverage additions, and offensive-overwatch scenario all have concrete landings in v2 text. The phase remains aligned with `mental-model.md` §11's substrate-refinement intent: outcome attribution, wall visibility, drained-corpse traceability, structured overwatch, reasoning/raw replay introspection, and no migration shims.

What is risky or unclear: one source-of-truth edit surface is internally inconsistent across v2 docs. `README.md` §9.8 and ADR §8 correctly list `concept-spec.md` §7, §8, §11, §13, §21, §22, §23, but `work-packages.md` WP-A.4 and acceptance still instruct only §11/§13/§21. An implementer following WP-A literally could leave stale `Heard`, `Evac`, local-affordances, and overwatch-priority prose in the source spec.

Recommended gate: **plan delta-fix**, then WP-A dispatch.

---

## 2. Punch-list Landing Audit

| Item | Status | Landing audit |
|---|---|---|
| 1. Add `convex/_internal_runMatch.ts` to WP-A.2 file list | PASS | Present in ADR §1 mirror note (`architecture-decisions.md` §1, lines 27-40), WP-A.2 explicit file entry (`work-packages.md` WP-A.2, lines 67-77), WP-A.5 mirror parity test (lines 107-114), and WP-A acceptance mirror lockstep check (lines 136-141). |
| 2. Decide persisted overwatch trace shape | PASS | ADR §3 locks engine-emitted optional `fromOverwatch` + `stance` on `resolution.actions[]` (`architecture-decisions.md` §3, lines 293-320), with schema/mirror/type consequences (lines 340-345). README metric sources consume those fields (`README.md` §5, lines 229-230). |
| 3. Decide closing-10 reporting data flow | PASS | WP-E.3 defines new `convex/reports/phase3.ts` reading `turns` / `worldState` / `characters` directly and no `runs` aggregate columns (`work-packages.md` WP-E.3, lines 665-681). README §12.5 repeats the data flow and location (lines 582-590). |
| 4. Decide wall-blocked move rate computation | PASS | New ADR §9 defines `MoveTraceEntry.blockedBy: "wall"` and push-gate relaxation (`architecture-decisions.md` §9, lines 706-744); WP-B.7 scopes the engine emit (`work-packages.md`, lines 245-251); README §5 sources the metric from that engine emit (line 226). |
| 5. Wire Branch-B rationale ask into ADR §7 and WP-C.2 | PASS | ADR §7 adds conditional Section 5b rationale ask (`architecture-decisions.md`, lines 598-606); WP-C.2 explicitly includes the Branch-B conditional (`work-packages.md`, lines 399-408); D-P3-1 cross-links the same ask and tests (`de-risking.md`, lines 68-87). |
| 6. Reconcile reasoning nullability | PASS | ADR §2 requires `reasoning: v.union(v.string(), v.null())` and null on every non-captured path (`architecture-decisions.md`, lines 207-225). WP-A.2 mirrors this in schema and Azure wrapper scope (`work-packages.md`, lines 59-62, 84-87). README §5 metric source names the same nullable field (line 232). |
| 7. Move `affordances.ts` deletion from WP-B to WP-C | PASS | Foundation sequencing calls out the fix (`work-packages.md`, lines 21-27); WP-B.6 defers deletion (lines 236-244); WP-C.1 drops the import first (lines 372-375); WP-C.4 deletes the module and test (lines 413-419). README §7 dependency map repeats the sequencing (lines 288-294). |
| 8. Update `convex/engine/runStats.ts` chest-equip filter | PASS | WP-B.8 explicitly updates `runStats.ts` to `loot/opened/chest_*` (`work-packages.md`, lines 252-257), and WP-B acceptance requires `runStats.test.ts` coverage (lines 303-306). README §3 deliverables also list the filter update (lines 156-158). |
| 9. Update `apps/replay/src/lib/reconstruct.ts` filter | PASS | WP-D.4 scopes `reconstruct.ts:215-232` to the new `loot/opened/chest_*` filter (`work-packages.md`, lines 562-571), with a dedicated reconstruct test in WP-D.5 (lines 582-584). README §3 and §7 both include the consumer (lines 177-180, 310-311). |
| 10. Update `apps/replay/src/components/HoverCard.tsx` filter | PASS | WP-D.4 scopes `HoverCard.tsx:318` to the same chest-open filter (`work-packages.md`, lines 572-573), and WP-D.5 adds hover-card test coverage if a test file exists (lines 593-596). README §3 includes the deliverable (line 182). |
| 11. Update `harness/analyze-match.ts` filter | PASS | WP-B.9 scopes `harness/analyze-match.ts:52` from `kind === "interact"` to `loot/opened/chest_*` (`work-packages.md`, lines 262-268), and README §12 includes it in the WP-B gate (lines 546-555). Low wording issue noted below: acceptance still says "chest-interact counts" (line 309). |
| 12. Expand ADR §8 concept-spec edit targets to §7, §8, §22, §23 | PARTIAL | The expansion is present in README §9.8 (`README.md`, lines 466-485) and ADR §8 decision (`architecture-decisions.md`, lines 651-680). It is not cleanly propagated: WP-A.4 still says only §11/§13/§21 (`work-packages.md`, lines 97-99), WP-A acceptance repeats only §11/§13/§21 (lines 129-130), and ADR §8 consequences still say v0.2 ships §11/§13/§21 edits only (`architecture-decisions.md`, lines 695-700). |
| 13. Add mirror parity test or hoist validators | PASS | WP-A.5 adds a mirror parity test for `_internal_runMatch.ts` validators against `schema.ts` (`work-packages.md`, lines 107-114). ADR §1 consequences also allow the non-blocking shared-module follow-up (lines 126-132). |
| 14. Add 12-wall safety ceiling test | PASS | WP-B.10 adds a vision-side wall emission / 12-wall safety-ceiling case (`work-packages.md`, lines 270-274), and WP-C.6 adds inputBuilder cap coverage (lines 438-441). |
| 15. Add no-deleted-headers assertion | PASS | WP-C.6 explicitly asserts no `Affordances:`, `Heard (last turn):`, `Last-known:`, or `Evac:` section headers (`work-packages.md`, lines 442-446). README §11 repeats the hygiene gate (lines 517-520). |
| 16. Add `tests/llm/systemPrompt.test.ts` | PASS | WP-C.6 adds `tests/llm/systemPrompt.test.ts` with typed-id glossary, action grammar, overwatch stance, urgency framing, and Branch-B rationale assertions (`work-packages.md`, lines 457-470). README §11 lists the same test obligation (lines 514-517). |
| 17. Add offensive-overwatch Cucumber scenario | PASS | README §3 includes a separate "Offensive overwatch picks deterministically" scenario with stance and trace attribution (`README.md`, lines 93-99). |
| 18. Cross-check `chars/4` proxy against real tiktoken on smoke run | PASS | WP-C.6 adds optional non-blocking tiktoken calibration for one composed input per persona and requires recording >5% gaps in smoke notes (`work-packages.md`, lines 451-456). This matches the "nice-to-have / nit" severity from Round 2. |

### PM-Locked Decisions D7-D13

| Decision | Status | Landing audit |
|---|---|---|
| D7. Chest-open trace kind/result = `loot` / `opened` | PASS | ADR §1 consequences lock `resolution.actions[].kind = "loot"`, `result = "opened"` and name all consumers (`architecture-decisions.md`, lines 138-145). WP-B.8, WP-B.9, and WP-D.4 carry the filter updates (`work-packages.md`, lines 252-268, 562-573). |
| D8. Overwatch trace shape engine-emits `fromOverwatch` + `stance` | PASS | ADR §3 persisted trace shape block defines both optional fields and when set (`architecture-decisions.md`, lines 293-320). WP-A.2 extends validators (`work-packages.md`, lines 62-65, 81-83). README §5 metrics read them directly (lines 229-230). |
| D9. Wall-blocked move rate via engine-emitted `blockedBy: "wall"` | PASS | ADR §9 decision and consequences define the trace field and report-reader source (`architecture-decisions.md`, lines 706-744, 770-788). WP-B.7 and README §5 reflect the lock (`work-packages.md`, lines 245-251; `README.md`, line 226). |
| D10. Phase-3 report writer reads raw tables; no `runs` columns | PASS | WP-E.3 defines `convex/reports/phase3.ts`, direct reads from `turns` / `worldState` / `characters`, and no `runs` aggregate columns (`work-packages.md`, lines 665-681). Acceptance repeats no `runs` schema diff (lines 720-725). README §12.5 aligns (lines 582-588). |
| D11. Branch-B rationale ask in ADR §7 Section 5b | PASS | ADR §7 Section 5b contains the conditional rationale ask (`architecture-decisions.md`, lines 598-606); WP-C.2 links it to the Branch-B implementation (`work-packages.md`, lines 399-408); D-P3-1 lists the same Branch-B path (`de-risking.md`, lines 76-87). |
| D12. Concept-spec edit surface = §7, §8, §11, §13, §21, §22, §23 | PARTIAL | Correct in README §9.8 and ADR §8 decision (`README.md`, lines 466-485; `architecture-decisions.md`, lines 651-680), but stale in WP-A.4 / WP-A acceptance and ADR §8 consequences (`work-packages.md`, lines 97-99, 129-130; `architecture-decisions.md`, lines 695-700). |
| D13. Reasoning field uses required nullable `v.union(v.string(), v.null())` | PASS | ADR §2 locks required nullable and null-on-noncaptured paths (`architecture-decisions.md`, lines 207-225). WP-A.2 and D-P3-1 Branch A/B both specify the same shape (`work-packages.md`, lines 59-62, 84-87; `de-risking.md`, lines 51-75). |

---

## 3. Cross-Doc Consistency

- **North Star / mental-model alignment:** aligned. `mental-model.md` §11 says the substrate-refinement slice exists because the agent input lacks outcome attribution, walls, drained-corpse traceability, structured overwatch, reasoning capture, and raw replay introspection; README §1 carries the same why-layer into the phase plan (`README.md`, lines 17-38).
- **Phase-1 ADR supersession:** mostly clean. Phase-3 ADR top matter explicitly supersedes phase-1 ADR §4 decision schema and extends phase-1 ADR §7 trace shape via ADR §2, §3, and §9 (`architecture-decisions.md`, lines 8-21). The assignment references `docs/project/spec/architecture-decisions.md`, but the repo has phase-scoped ADR files; the actual historical source is `docs/project/phases/01-engine-and-harness/architecture-decisions.md`.
- **Concept-spec surface:** inconsistent. ADR §8 and README §9.8 name the correct surface; WP-A.4/acceptance and ADR §8 consequences retain the old narrower surface. This is the only blocking cross-doc failure.
- **Old vocabulary leak check:** no live schema design leaks were found for `overwatch_priority`, `targetCorpseId`, `kind === "interact"`, or `v.optional(v.string())`; those terms appear in removal / rename / update-from contexts. The only orphan wording is WP-B acceptance's "chest-interact counts" (`work-packages.md`, line 309), which should become "chest-open counts" or "chest loot/opened counts".
- **WP file-list sufficiency:** sufficient except for the WP-A.4 concept-spec surface. The required mirror file, `reconstruct.ts`, `HoverCard.tsx`, `runStats.ts`, `analyze-match.ts`, `convex/reports/phase3.ts`, and WP-C affordances deletion are all present in the relevant WP scopes.

---

## 4. New Issues Found In V2

| Severity | Area | Description | Evidence | Recommendation |
|---|---|---|---|---|
| High | Source-of-truth / WP scope | The D12 concept-spec surface is only partially landed. README and ADR §8 tell reviewers the surface is expanded, but the actual implementation WP and its acceptance still point implementers at only §11/§13/§21. | `README.md` §9.8 lines 466-485 and `architecture-decisions.md` §8 lines 651-680 are correct; `work-packages.md` WP-A.4 lines 97-99 and acceptance lines 129-130 are stale; `architecture-decisions.md` §8 consequences lines 695-700 are stale. | Delta-fix WP-A.4 scope and WP-A acceptance to list §7, §8, §11, §13, §21, §22, §23. Also fix ADR §8 consequences to match its decision block. |
| Low | Terminology hygiene | WP-B acceptance still uses the old "interact" noun in "chest-interact counts" after the schema unifies chest open under `loot/opened/chest_*`. This is not a schema literal leak, but it is orphan wording in a live acceptance check. | `work-packages.md` WP-B acceptance line 309. | Rename to "chest-open counts" or "chest loot/opened counts". |

No other new High issues were found. The plan design itself remains North-Star aligned.

---

## 5. Recommended Next Step

**Plan delta-fix.** Make the narrow doc fixes above before WP-A dispatch:

1. Update `work-packages.md` WP-A.4 scope to say `concept-spec.md` §7, §8, §11, §13, §21, §22, §23 per ADR §8.
2. Update `work-packages.md` WP-A acceptance to require all seven concept-spec sections, not only §11/§13/§21.
3. Update `architecture-decisions.md` ADR §8 consequences to match the expanded surface.
4. Rename the WP-B smoke wording from "chest-interact counts" to the unified chest-open/loot terminology.

After those edits, the review posture should move to **Approve / WP-A dispatch** without another full design re-review; a focused delta check against item 12 / D12 and the low wording cleanup is enough.
