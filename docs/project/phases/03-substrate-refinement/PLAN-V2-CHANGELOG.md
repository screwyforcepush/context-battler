# Phase 03 — Plan v2 Changelog

> Plan-refinement pass folding the dual-reviewer must-fix bundle from
> `plan-review-round-1.md` and `plan-review-round-2.md`, plus the six
> PM-locked decisions (D7–D13) recorded in the assignment decision
> log. Doc-only edits across the four spec docs; no implementation.
>
> Outcome: plan v2 is ready for re-review and (post-clean-review) for
> WP-A dispatch. The reviewers' Concern → ready transition is driven
> by closing 18 contract-coverage / metric-measurability gaps; the
> design itself was already North-Star aligned and is unchanged.

---

## How to read this file

Each changelog entry below ties one or more punch-list items from
`plan-review-round-2.md` §pre-WP-A (consolidated list, items 1–18) to
the concrete spec edits that close them. PM decisions D7–D13 are
called out where they shape an edit. Reviewer-finding citations use
the round/numbering from the review reports.

---

## PM-locked decisions (D7–D13) — reflected as concrete spec text

| Decision | Lock | Spec landing |
|---|---|---|
| **D7** | Trace `kind` for chest opens = `"loot"` / `result="opened"` | ADR §1 consequences (chest-open trace shape); WP-D.4 reconstruct/HoverCard filters; WP-B.8 runStats filter; WP-B.9 analyze-match filter |
| **D8** | Overwatch trace extends `actions[]` validator with optional `fromOverwatch?: boolean` + `stance?: "offensive" \| "defensive"` (engine-emit, not derivation) | ADR §3 "Persisted trace shape" block + consequences; WP-A.2 file list (schema + mirror); WP-B counter-fire scope; README §5 metric source columns |
| **D9** | Wall-blocked move rate via engine-emit `MoveTraceEntry.blockedBy: "wall"` | NEW ADR §9; WP-A.2 validators; WP-B.7 `movement.ts` push-gate relaxation; README §5 metric source; phase-3 report writer |
| **D10** | Phase-3 report writer reads `turns`/`worldState`/`characters` directly via new `convex/reports/phase3.ts`; no per-run aggregate columns added to `runs` | WP-E.3 scope; README §12.5; WP-E.3 acceptance |
| **D11** | Branch B rationale ask placed in ADR §7 as conditional Section 5b | ADR §7 Section 5b; WP-C.2 conditional scope; D-P3-1 Branch B cross-link |
| **D12** | Concept-spec edit surface = §7, §8, §11, §13, §21, §22, §23 | ADR §8 expanded edit list; WP-A.4 acceptance; README §9.8 |
| **D13** | `agentRecord.llm.reasoning` field shape = `v.union(v.string(), v.null())` (required nullable; persisted as null on every non-captured path) | ADR §2 consequences; WP-A.2 file list; D-P3-1 Branch A/B branches; README §5 reasoning-capture metric source |

---

## Round-2 punch list — landing per item

### Blocking — must land before WP-A starts

| # | Item | Landing |
|---|---|---|
| 1 | Add `convex/_internal_runMatch.ts` to WP-A.2 file list | ADR §1 mirror note; WP-A.2 explicit file entry; WP-A.5 mirror parity test; WP-A acceptance (d) |
| 2 | Decide & document persisted overwatch trace shape | ADR §3 "Persisted trace shape" block; D8 lock |
| 3 | Decide & document closing-10 reporting data-flow shape | WP-E.3 scope rewrite; README §12.5; D10 lock |
| 4 | Decide & document wall-blocked move rate computation | NEW ADR §9; WP-B.7 + WP-A.2 validator extension; D9 lock |
| 5 | Wire Branch B rationale ask into ADR §7 (conditional) and WP-C.2 | ADR §7 Section 5b; WP-C.2 conditional Branch-B scope; D-P3-1 Branch B cross-link; D11 lock |
| 6 | Reconcile `reasoning` nullability (`v.union`, persisted null) | ADR §2 consequences rewrite; WP-A.2 file list; D-P3-1 Branch A/B; README §5 metric source; D13 lock |

### Blocking — must land before WP-B / WP-D close

| # | Item | Landing |
|---|---|---|
| 7 | Move `affordances.ts` deletion from WP-B to WP-C | WP-B.6 (deferred note); WP-C.1 (import drop) + WP-C.4 (deletion); README §3 deliverables; README §7 dep map; foundation-sequencing header |
| 8 | `convex/engine/runStats.ts` chest-equip filter update | WP-B.8 explicit sub-deliverable; README §3 deliverables |
| 9 | `apps/replay/src/lib/reconstruct.ts` filter update | WP-D.4 sub-deliverable; README §3 deliverables; WP-D.5 reconstruct.test.ts |
| 10 | `apps/replay/src/components/HoverCard.tsx` filter update | WP-D.4 sub-deliverable; README §3 deliverables |
| 11 | `harness/analyze-match.ts` filter update | WP-B.9 sub-deliverable; README §12.5 sequence |
| 12 | Expand ADR §8 concept-spec edit targets to §7, §8, §22, §23 | ADR §8 expanded list; README §9.8; WP-A.4 acceptance; D12 lock |

### Should-fix — strongly recommended

| # | Item | Landing |
|---|---|---|
| 13 | Mirror parity test (or hoist validators to shared module) | WP-A.5 mirror parity test entry; ADR §1 consequences (optional follow-up to share module) |
| 14 | 12-wall safety ceiling test | WP-B.10 vision tests entry; WP-C.6 inputBuilder cap test entry |
| 15 | Explicit no-deleted-headers assertion in inputBuilder tests | WP-C.6 test entry |

### Nice-to-have / nits

| # | Item | Landing |
|---|---|---|
| 16 | `tests/llm/systemPrompt.test.ts` for typed-id glossary, action grammar, stance, Branch B ask | NEW WP-C.6 test file; README §11 hygiene non-negotiables |
| 17 | Add offensive-overwatch Cucumber scenario to README §3 | README §3 fifth scenario added explicitly |
| 18 | Cross-check `chars/4` proxy against real tiktoken on smoke run | WP-C.6 token-budget test entry, marked optional non-blocking |

---

## Round-1 punch list — overlap traceability

The Round-2 list above incorporates all Round-1 high/medium issues
that still required action; the table below is the mapping for
audit-trail clarity.

| Round-1 issue | Resolved by Round-2 punch-list item(s) |
|---|---|
| R1 — Sequencing/Build (`affordances.ts` in WP-B) | #7 (move to WP-C) |
| R1 — `_internal_runMatch.ts` schema mirror | #1 (file list) + #13 (parity test) |
| R1 — Reporting / data flow | #3 (data-flow decision = phase-3 report writer) |
| R1 — Trace schema for `fromOverwatch` / stance | #2 (D8: validator extension) |
| R1 — Concept-spec edits too narrow | #12 (D12: expanded edit list) |
| R1 — Replay reconstruction (`reconstruct.ts`, `HoverCard.tsx`) | #9 + #10 |
| R1 — Reasoning Branch B under-specified | #5 (D11: ADR §7 Section 5b) |
| R1 — Reasoning nullability inconsistency | #6 (D13: `v.union(string,null)`) |
| R1 — System prompt test coverage | #16 (`tests/llm/systemPrompt.test.ts`) |
| R1 — Offensive overwatch scenario absent from README §3 | #17 (scenario added) |

---

## Spec docs touched

| File | Edit summary |
|---|---|
| `README.md` | §3 deliverables (engine fixes call out movement+runStats; deferred affordances deletion note); §3 added offensive-overwatch Cucumber scenario; §3 dependency-map ASCII reflects WP-B/C resequencing + WP-D consumer-fanout; §5 metrics rewritten with engine-emit sources (D8, D9, D13); §9.8 concept-spec edit list expanded (D12); §11 hygiene adds movement-test, systemPrompt-test, no-deleted-headers; §12 sequence references `convex/reports/phase3.ts` (D10) and the deferred affordances deletion |
| `architecture-decisions.md` | §1 mirror note + chest-open trace lock (D7); §2 nullability rewrite (D13); §3 added "Persisted trace shape" block + consequences (D8); §7 added conditional Section 5b (D11); §8 expanded edit surface (D12); NEW §9 `MoveTraceEntry.blockedBy: "wall"` (D9); top-of-file ADR list updated; v2.0 changelog entry |
| `work-packages.md` | WP-A.2 expanded with `_internal_runMatch.ts` mirror, ADR §3 + §9 validator extensions, nullability fix; WP-A.5 added mirror parity test; WP-A acceptance extended; WP-B.6 deferred-deletion note; WP-B.7 new movement.ts engine-emit scope; WP-B.8 engine consumer renames (runStats); WP-B.9 harness CLI consumer; WP-B.10 tests include 12-wall ceiling + movement; WP-C.1 import-drop + 12-wall cap consumer; WP-C.2 Branch B conditional; WP-C.4 affordances deletion; WP-C.6 tests rewritten with no-deleted-headers + new systemPrompt.test.ts; WP-D.4 reconstruct + HoverCard scope; WP-D.5 tests; WP-E.3 phase-3 report writer (D10); WP-E acceptance; closing-the-phase reviewer checklist expanded |
| `de-risking.md` | D-P3-1 Branch A/B updated for nullability (D13) + Section 5b cross-link (D11) |
| `PLAN-V2-CHANGELOG.md` | THIS FILE — new |

---

## What did NOT change

- Design pillars from `mental-model.md` are unchanged.
- North Star jam decisions are unchanged (loot unify, stance,
  reasoning capture, raw-pane, system-prompt rewrite — all locked
  pre-plan).
- WP sequencing (A → B → (C ∥ D) → E) is unchanged at the macro
  level. The intra-WP rebalancing of `affordances.ts` deletion is
  the only sequencing fix.
- The token-budget arithmetic in README §8 holds; D-P3-3 trim path
  is unchanged.
- Phase-1 ADRs §4 + §7 remain superseded; the supersession surface
  is now broader (also §3 + §9 trace shape extensions, on top of §1
  + §2 schema breaks).
- POC schema-wipe posture is unchanged.

---

## Status

- Plan v2 is ready for re-review.
- After clean re-review, WP-A dispatch.
- No implementation has started; this changelog ships alongside the
  doc edits.

---

## Post-closure follow-ups

- **WP-F.5 (2026-05-08)** — phase-3 completion review (Reviewer B Med)
  surfaced two stale phase-1/2 LLM-input lines outside the original D12
  edit set (§7/§8/§11/§13/§21/§22/§23): `concept-spec.md:130` (LLM-input
  enumeration in §2A.1) and `concept-spec.md:406` (§7 sub-section
  "Last-known and heard states"). Both brought into alignment with the
  locked phase-3 digest shape (per-Visible observation brackets, no
  separate `Affordances:` / `Heard:` / `Last-known:` blocks; evac on the
  `You:` line only after reveal). Additional surface beyond D12; spec is
  now internally consistent with phase-3 ADR §6.

---

*Drafted: 2026-05-08 (plan-v2 refinement). Prior plan-v1 changelog
preserved at the bottom of `architecture-decisions.md`.*
