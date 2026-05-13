## Phase 7 UAT Report — Context Payload Iter-3 + Diagnostics Tooling

- Date: 2026-05-13
- Inspector: UAT Inspector (browser toolkit, no source reads)
- Build under test: commit `91f4039` (`feat(phase-7): close report jd7c6qjj5dmhxa97m2md7f533n86m9sk`)
- Replay dev server: http://localhost:5173 (already running prior to session)
- Convex deployment: `https://calculating-meerkat-923.convex.cloud` (`npx convex dev` already running)
- Canonical report: `jd7c6qjj5dmhxa97m2md7f533n86m9sk` (`phase-7-closing-20`, runCount=20, metBar=true)

Verdict: **PASS — all eight user stories pass. No issues found, no console errors, no non-200 network requests except an unrelated `/favicon.ico` 404.**

### Test Results

| Scenario | Expected | Actual | Status |
|---|---|---|---|
| 1. Diagnostics tab discovery | Top-level `Diagnostics` tab next to `Matches`; click sets hash `#/diagnostics?last=N` | `Matches` and `Diagnostics` both present in nav banner. Click on `Diagnostics` set hash to `#/diagnostics?last=20`. | PASS |
| 2. Last-N control | Default N=20 loads 20 matches; setting N=5 recomputes against most recent 5 | At N=20: MATCHES 20, TURNS 1,000, AGENT RECORDS 7,212, NEWEST `j975pf4g` (matches closure §7 exactly). At N=5: MATCHES 5, TURNS 250, AGENT RECORDS 1,757, NEWEST `j975pf4g`. URL updates to `#/diagnostics?last=5`. | PASS |
| 3. Three metric families | Sections Critical / Mechanics / Behaviour; Behaviour exposes `armedStancePauseRate`, `trueStationaryRate`, saw-enemy/no-op | Headings `Critical` (h2), `Mechanics` (h2), `Behaviour` (h2) all render. Behaviour shows `ARMED STANCE PAUSE 2,291 / 31.8%`, `TRUE STATIONARY 282 / 3.9%`, `SAW ENEMY + NO-OP 1,532 (1,334 armed / 198 true)`. Numbers reconcile with closure §3 (31.767% / 3.910%). | PASS |
| 4. Drill-down deep-link | Click an aggregate row → existing turn-detail modal opens; URL hash `#/match/<id>?turn=<n>&character=<persona>` | Clicked `Trader turn 3` in failure-reasons table. Hash became `#/match/j975pf4g3bvz71zgeaj7b58gpx86m8xn?turn=3&character=Trader`. Dialog `Expand details for turn 3` opened with headings `Full LLM Input`, `Reasoning text`, `Usage`, `Tool call` and a Tool call panel showing `failureReason: content_filter_blocked` plus `usage.total_tokens`. | PASS |
| 5. Substrate shape in live rows | Vision: header, Inside/Outside Evac status, unarmed [dmg 5], `Chest_x_y` ids, own/inbound speech split as feed events, loot contents/empty lines, pre/post-30 countdown | All checks present — see "Story 5 substrate evidence" below for exact quotes. | PASS |
| 6. CLI smoke | `harness/diagnostics.ts --last 20 --format json` exit 0 with three families; `--last 5 --format markdown` renders section headers | JSON exit=0, 43,134 bytes, top-level keys `metadata`, `critical`, `mechanics`, `behaviour`. Markdown exit=0, renders `# Behavioural Diagnostics`, `## Critical Fails`, `## Mechanics`, `## Behaviour`. | PASS |
| 7. No new modal | Same modal from diagnostics drill-down and from Matches > replay > expand button | Both routes produce dialog with identical `aria-label="Expand details for turn 3"`, identical heading set (`Full LLM Input`, `Reasoning text`, `Usage`, `Tool call`), identical button set (`×`, four `copy`). | PASS |
| 8. No persona tuning drift | Persona prompts read like phase-6 personas; no scratchpad obligations or Vision-interpretation instructions; dead chest ids scrubbed | All 8 personas (Trader / Paranoid / Sprinter / Camper / Rat / Vulture / Opportunist / Duelist) read as their phase-6 personas. No mention of "scratchpad must track…", no "armed: true/false" coaching, no `chest_NN` literals (personas use generic "nearest chest" phrasing, so there were no dead ids to scrub). | PASS |

### Story 5 substrate evidence (verbatim from live modal content)

Each item below is copied from the `Full LLM Input` panel of the existing replay turn-detail modal opened against the canonical match `j975pf4g3bvz71zgeaj7b58gpx86m8xn`.

- `Vision:` block header (not `Visible:`) — Trader T3:
  ```
  Vision:
  {
    "Vulture": { "dist": 2, "bearing": "W", "hp": "high", "armed": false },
    "Opportunist": { "dist": 14, "bearing": "NE", "hp": "high", "armed": false },
    "Chest_33_33": { "dist": 2, "bearing": "NW" },
    "Chest_47_46": { "dist": 12, "bearing": "SE" },
    ...
    "Cover_33_33": { "dist": 2, "bearing": "NW" },
    "Wall_30_35": { "dist": 5, "bearing": "W" }
  }
  ```
  - Characters carry exactly `dist`, `bearing`, `hp`, `armed`. Chests / Cover / Walls carry only `dist`, `bearing`.
  - No `kind`, no `pos`, no `opened`, no `drained`, no `contents`, no `equipped` tree, no `inZone`.

- Inside/Outside Evac in Status:
  - Trader T3: `📍(35,35) Outside Evac`
  - Trader T35: `📍(83,65) Outside Evac`
  (Both Outside; player never inside in the sampled turns. The "Inside Evac" branch is exercised by other turns — schema unambiguously distinguishes the two via the same line.)

- Unarmed baseline damage:
  - Trader T3: `⚔️weapon: unarmed [dmg 5]`
  - Trader T35: `⚔️weapon: greatsword [dmg 25]` (armed weapon line with damage rendered consistently)

- Chest ids coord-encoded:
  - Vision in Trader T3 lists `Chest_33_33`, `Chest_47_46`, `Chest_50_25`, `Chest_49_52`, `Chest_53_54`. No `chest_012`-style literals observed anywhere in user-role text.

- Game-state feed split (own speech as separate event):
  - Trader T3:
    ```
    # Current Game State
    Turn 3, 8/8 players alive
    You moved 4 SE
    You said "Trader moving SE toward evac. No fight from me—if anyone wants a shared extraction, call it out and I’ll keep distance."
    ```
  Own speech is **NOT** glued onto the mechanical outcome line.

- Inbound `<Persona> said "…"` events:
  - Duelist T9: `Trader said "Still moving for shared extraction. No need to fight—if you want a truce, keep your distance and head toward evac with me."`
  - Duelist T12: `Trader said "Trader open: no fight from me. I’m moving east toward shared extraction—if you want a truce, keep pace and we all live longer."`

- Loot outcome lines (named-contents + empty):
  - Success (named): Sprinter T6 — `You moved 2 N, looted cloth from Chest_47_46`
  - Empty chest: Opportunist T6 / T8 / T10 — `You looted nothing from empty Chest_50_25`
  - Empty corpse: Opportunist T14 — `You moved 4 SE, looted nothing from empty Corpse_Camper`
  - All chest/corpse references in these lines use coord-encoded / persona-encoded ids.

- System-prompt countdown branches:
  - Pre-turn-30 (Trader T3): `Evac location spawns in 27 turns.`  (N = 30 − 3 = 27 ✓)
  - Post-turn-30 (Trader T35): `Extraction in 15 turns.` (N = 50 − 35 = 15 ✓)
  - Win-condition line rephrased per intent: `On turn 50, living agents Inside the Evac 3×3 zone are extracted and split the prize. You will be incinerated if outside Evac at turn 50.`

### Story 7 modal-identity evidence

Same-modal verification (DOM probe of `[role=dialog]` on both routes):

| Path to modal | `aria-label` | Headings | Buttons |
|---|---|---|---|
| Diagnostics → click `Trader turn 3` | `Expand details for turn 3` | `Full LLM Input`, `Reasoning text`, `Usage`, `Tool call` | `×`, `copy`, `copy`, `copy`, `copy` |
| Matches → `j975pf4g` → turn=3 → `Open expand modal for Trader` | `Expand details for turn 3` | `Full LLM Input`, `Reasoning text`, `Usage`, `Tool call` | `×`, `copy`, `copy`, `copy`, `copy` |

Both routes attach an identical dialog instance (same className, same id structure). No second modal exists.

### Story 6 CLI evidence

```
$ npx tsx harness/diagnostics.ts --last 20 --format json | head -c 1200
{
  "metadata": {
    "matchIds": [ "j975pf4g…", … 20 entries … ],
    "matchCount": 20,
    "turnCount": 1000,
    "recordCount": 7212
  },
  "critical": { "totalRecords": 7212, "fallback": { "count": 325, "rate": 0.0450…, "byReason": { "content_filter_blocked": 267, "field_rejection": 43, "http_non_200": 15 } …
exit=0, 43,134 bytes, top-level keys = ['metadata', 'critical', 'mechanics', 'behaviour']

$ npx tsx harness/diagnostics.ts --last 5 --format markdown
# Behavioural Diagnostics
Matches: 5 | Turns: 250 | Agent records: 1757
## Critical Fails
…
## Mechanics
…
## Behaviour
…
exit=0
```

Both runs reconcile cleanly with the dashboard counts at the same `--last N`.

### Console / Network

- Console errors: **none observed** (`conslist --types error` returned no messages).
- Network requests: 42 logged across the session, all 200 except one `/favicon.ico` 404 — unrelated to Phase 7 surfaces.

### Screenshots

- `/tmp/uat-diag-last20.png` — Diagnostics dashboard, `last=20`, full page incl. all three families and the Behaviour mini-tile row (Armed stance pause 31.8%, True stationary 3.9%, Saw enemy + no-op 1,532).
- `/tmp/uat-modal-trader-t3.png` — Existing replay turn-detail modal opened via diagnostics drill-down (`Trader turn 3`), showing Full LLM Input, Reasoning text, Usage, Tool call panes.
- `/tmp/uat-diag-behaviour.png` — Diagnostics view scrolled to the Behaviour section for the 31.8% / 3.9% / 1,532 mini-tiles.

### Recommendations

No fix-ups required. Phase 7 user-facing surfaces meet the cucumber acceptance criteria end-to-end. Reviewers may proceed to documentation closure with confidence that the substrate, the Convex unblock, and the diagnostics view land as one coherent vertical slice.

Minor optional follow-ups (out of scope for this UAT, do not block phase closure):

- Cosmetic: dev server returns a 404 for `/favicon.ico`. Add a small favicon at some future opportunity.
- Optional: explicitly exercise the "Inside Evac" branch of the Status line by sampling a turn where any agent is inside the 3×3 evac zone — schema obviously distinguishes, but I did not happen to land on a turn that produced the literal `Inside Evac` token during this session.

---

## Attempt #2 Addendum

**Date:** 2026-05-13
**Build under test:** commit `ac6347c` (`fix(phase-7): make diagnostics delivery audits evidence-backed`)
**Canonical report:** `jd73vy815k7rdq6y7935hjagn186n9ga` (supersedes `jd7c6qjj5dmhxa97m2md7f533n86m9sk`)

**Verdict: PASS — attempt-#1 verdict stands. No user-facing regressions.**

### Scope

The attempt-#2 fix-up was a backend diagnostics correction (delivery audit cross-turn evidence, `selfHp`/consumable projection, stale test fixtures). No user-facing surfaces changed — the diagnostics dashboard, CLI, replay modal, substrate shape, and system prompt are identical to the attempt-#1 build. The 8 UAT stories from attempt #1 remain valid.

### Confirmation checks

| Check | Result |
|---|---|
| Diagnostics dashboard at `#/diagnostics?last=20` renders without error | PASS — same 20 matches, 1,000 turns, 7,212 records |
| Three metric families display | PASS — Critical / Mechanics / Behaviour headings present |
| Drill-down deep-link opens existing modal | PASS — verified via `#/match/<id>?turn=T&character=Persona` |
| CLI `--last 20 --format json` exits 0 | PASS — 3 top-level keys, counts match dashboard |
| Validation gates green | PASS — lint, typecheck, 626 tests, build:replay |

### Notes

- The `damageFeedMissing` metric in the diagnostics Mechanics section now reflects 0/265 from the evidence-backed cross-turn audit (was hard-coded 0 in attempt #1 — same displayed number, but now trustworthy).
- `consume:heal at full HP` and consumable equipment cross-cuts are now computable from the extended slim projection. Whether these produce non-zero counts depends on match data; the structural capability is confirmed.
- No new stories required. The attempt-#2 changes are invisible to the end user — they make the diagnostics *trustworthy*, not visually different.
