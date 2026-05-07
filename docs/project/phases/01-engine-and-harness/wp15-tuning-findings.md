# WP15 — Persona / Combat Tuning Findings

**Status:** NO-GO @ 3 lethal runs / 10 (best result: Cycle 2). Internal-gate target was ≥6/10 lethal.
**Reasoning:** `low` for all 3 cycles (per de-risking.md). One bonus probe at `medium` after Cycle 2; did not improve the kill rate.

---

## Stage-2 baseline (pre-WP15)

10 matches, concurrency 5, --reasoning low. Source: commit 0778b1e + `wp10-5-phase-e2-and-wp12-stage2.md`.

- **kills total:** 4
- **lethal runs (≥1 kill):** 4/10
- **extractions:** 12
- **equips:** 69
- **fallback rate:** ~6.8%

Original 10 matchIds: `j97324vsy6wt75qpf0jnb7r5vs8697hq`, `j97191qt1jnbxhegkm43spst31868fzv`, `j97bcsxa0gabzfa811v1ngef45869078`, `j976tkq81rbg7b02wqekyraew58697na`, `j978n5fm16hj2hekpf7ac70z81868bng`, `j9752s6xwmv9bj5a17zw60zdv1869pzg`, `j9736tjjnr714ypcvmaywhgcvx869a66`, `j97fx9p9zgcsy5stha2kjqnngx869t2k`, `j973p3v94rdfqmppk15a9zt13x8683v8`, `j97a4tm0f9m44q7fqtpzeyc0a9868f3v`.

---

## Investigation — what the Stage-2 trace data actually said

I drilled into all 10 Stage-2 matches with two new diagnostic scripts (`harness/inspect-attacks.ts`, `harness/inspect-equipped.ts`), per ADR §7's per-(run, agent, turn) trace-introspection contract.

**Two dominant failure modes accounted for the lethality gap (mechanism-level, not vibes-level):**

1. **5/10 matches: agents never engaged at all.** 0 decision-attacks across all 50 turns. Agents either overwatch all match (paranoid/camper/vulture defensive stance) or evac-rush (sprinter/trader). No collisions, no kills.
2. **4/10 matches: agents attacked but unarmed.** Every landed-attack reported `dmg 5` — the `MIN_DAMAGE_FLOOR` (concept-spec §12). At 5 dmg/hit and HP=100, a clean kill needs 20 hits. No wonder kills were vanishingly rare. Sample: match `j97324vsy6wt75qpf0jnb7r5vs8697hq` had **42 attacks, all dmg 5, 0 deaths** — duelist made 24 attacks unarmed, camper made 17 unarmed.
3. **1/10 matches: armed combat — and it produced kills.** Match `j976tkq81rbg7b02wqekyraew58697na` showed `dmg 10` (rusty_blade), and that's where Stage-2's kills clustered.

**Equipped-state survey** (digest "Equipped:" line, 50-turn rollup):
- duelist: equipped a weapon **0/50 turns** even while making 24 attack-decisions — the persona told it to "equip the best weapon you find" but never made chest-acquisition the imperative first step.
- vulture: equipped sword 49/50 turns BUT made 0 attacks — overwatching defensively.
- camper: 44/50 with heal only (no weapon).

Verified `convex/engine/combat.ts:50-64` — the `damageFor()` floor `gross > MIN_DAMAGE_FLOOR ? gross : MIN_DAMAGE_FLOOR` is correctly honoured. `MIN_DAMAGE_FLOOR=5` is itself an engine-level constant from `convex/engine/types.ts:91`. There is **no engine bug here** — 5-damage unarmed attacks are the spec. The lethality gap is a behavioural / map gap.

That falsified hypothesis (b) (engine damage floor) immediately and pointed me at hypothesis (a) (persona engagement triggers) for Cycle 1, with hypothesis (c) (map encounter pressure) reserved for Cycle 2.

---

## Cycle 1 — sharpen persona procedural ordering (hypothesis a)

**Edit.** Rewrote 4 personas (duelist, vulture, opportunist, camper) with explicit numbered procedural priority: "1) unarmed → move to nearest chest and open it. 2) armed → close to range 2 and attack." Previous bodies described intent ("equip the best weapon you find") but did not enforce ordering.

Token budget held: every persona body ≤ 320 chars (≤ 80 tokens by the chars/4 proxy).

**Files touched.** `personas/{duelist,vulture,opportunist,camper}.md` + the inline mirror at `convex/_data/personas.ts`.

**Probe.** `npx tsx harness/run.ts --runs 10 --concurrency 5 --reasoning low`.

Cycle 1 matchIds: `j977aftmw655wdjchydvt9wvyn8691fq`, `j9758kmmttfn54eckspqbpe9yn8681fq`, `j97e8phxzjm4cgw1968xc643en868zad`, `j978p61edqamy70egpyrvn2h198687ns`, `j978e3gh80kdn88j0pdzdgwwh9869b7y`, `j975k1ynw0x5x3ddpj3qj91t398689tz`, `j977qfxcw83d3737dj2nhw0rb1869qty`, `j97fjffjvvnag3hfbrq36rt7h1868pm5`, `j971n95932pw155fs9a5sw9vs9868csp`, `j97an0avrqkabg7j2b43nh797s8686rq`.

**Result.**
- kills: **3** (vs Stage-2's 4)
- lethal runs: **2/10** (vs Stage-2's 4/10) — within statistical noise on n=10, slight regression
- extractions: 18 (up from 12 — agents reach evac more reliably)
- equips: 62

**What happened.** The new procedural framing made personas more disciplined about chest-first behaviour (extractions and equip rates both improved), but personas became *too* risk-averse. Match `j978p61edqamy70` showed the success path: armed duelist made 22 attack-decisions, 20 landed at dmg 7-15 → 2 kills. But in 5/10 matches duelists still deferred (probably because they never saw an enemy in their constrained 20-tile vision window).

**Conclusion.** Hypothesis (a) is partially right but insufficient on its own: making personas weapon-first without also reducing geometric separation produces well-armed loners.

---

## Cycle 2 — combine sharpened personas with reduced map separation (hypotheses a + c)

**Edit.** Two changes:
1. Sharpened duelist + vulture further: explicit "Never attack unarmed; weapon comes first", "After turn 30, head to evac centre and engage anyone you find there."
2. Pulled all 8 spawns inward from radius ~45 to radius ~28 (e.g., `(10,10) → (20,20)`, `(50,5) → (48,20)`, etc.). Centre evac stayed at (48,48). Spawn-to-spawn average Chebyshev distance dropped from ~80 to ~56. Vision is 20, so initial sight cone is now ~5-7 turns away instead of ~10-12.

**Files touched.** `personas/{duelist,vulture}.md` + mirror; `maps/reference.json` (spawns block only, all walkability + reachability invariants preserved; map test green).

**Probe.** `npx tsx harness/run.ts --runs 10 --concurrency 5 --reasoning low`.

Cycle 2 matchIds: `j97evk4nk8qxs4m359mt9my1cn869k42`, `j979v7wts2crwkqzmg317a3xq9868gmt`, `j97ed0a7b53bqwzbp960e120qs8690ft`, `j970jmby0xz81vpfa8y6a0vajx86898d`, `j970677ramwas2cscpn5dan505869ex5`, `j9765q5ndbv6ewd9xdcwxpftv58689jx`, `j971rfza74szqwh5d22r59dkwx86819f`, `j975qjkj4q383d1pgww724r2ds868d7h`, `j972ngxv87bdm92wxe2rs7gnw1868f31`, `j97be9ntst6c0tktbbaka1qtx1868xcz`.

**Result.** ⭐ **BEST OF ALL CYCLES**
- kills: **5** (up from cycle 1's 3, up from Stage-2's 4)
- lethal runs: **3/10** (j979v7wts=2, j971rfza=2, j97be9ntst=1)
- extractions: 15
- equips: 63
- fallback (sample): 4-8% — well under the ≤10% gate
- duelist: 5/5 of the kills (the engagement trigger is working)

**What happened.** Match `j979v7wts2crwkqzmg…`: duelist closed with sword (dmg 15), made 13 attacks, all 13 landed → 2 kills. Match `j971rfza…`: same pattern, duelist with rusty_blade → 2 kills. Vulture and paranoid still 0 kills.

**Conclusion.** Hypotheses (a) and (c) compound: tighter spawn geometry + procedural duelist gives the duelist a real shot at converging on a target while still armed. Other personas need their own engagement edits to contribute kills.

---

## Cycle 3 — sharpen vulture + paranoid aggression triggers (hypothesis a doubled-down)

**Edit.** Two persona rewrites:
1. Vulture: "armed and any enemy visible — close to range 2 and strike, especially the lowest-HP target" (was "armed — close to range 2 of any wounded enemy and strike" — but in early game nobody is wounded, so this rule never fired).
2. Paranoid: numbered procedural with explicit "armed — overwatch from cover and fire on any enemy at range 2; they came to threaten you" (was abstract "Avoid open ground. Treat the evac zone as a trap").

Token budget verified.

**Files touched.** `personas/{vulture,paranoid}.md` + mirror.

**Probe.** `npx tsx harness/run.ts --runs 10 --concurrency 5 --reasoning low`.

Cycle 3 matchIds: `j97dc8t4cqgc86gndb3s1tm6xd8689fn`, `j97dy3hxzyv7zmvw7yvbgksr0h868yeh`, `j9745f1wakgfbaqpbf8sdkk33986993a`, `j9786ragth17ee9z6karc6mzw9869xtt`, `j977b30q8axerd5a82ms0k4y6x86830c`, `j979qq3sp495gsxqw94hxxfwz1869vry`, `j979hst4bqvcmy2pd21eerz08x8697ar`, `j975e2ppfmygggspd336qd1ces869x83`, `j977h9kx80mmvb3h68cd45kpdd8685ax`, `j97ckhnwpy6y70zc7d4y0cq7ph8699p3`.

**Result.** Regression.
- kills: **3** (down from cycle 2's 5)
- lethal runs: **2/10** (j9745f1=2, j975e2pp=1)
- extractions: 24 (up — paranoid's procedural made them reach evac more reliably)
- equips: 65

**What happened.** The "fire on any enemy at range 2" trigger for paranoid still rarely produced kills because paranoid sits in cover and enemies rarely traverse paranoid's range-2 window. The vulture "lowest-HP target" trigger didn't pull vulture out of overwatch posture — vulture has no positive movement instruction when armed except "close to range 2" which is non-actionable when no enemy is visible.

**Conclusion.** I reverted Cycle 3 changes — Cycle 2 is the strongest state. Net commit at HEAD = Cycle 2 personas + Cycle 2 spawns.

---

## Bonus — `--reasoning medium` probe with Cycle-2 personas

Per WP15 brief reasoning policy ("MAY tune up to medium ONLY IF probe still RED after cycle 2"), I ran one probe at medium reasoning with the Cycle-2 personas to see if better target selection helps.

Medium-reasoning matchIds: `j975xy962fx4rftx6mdgmv3e7d868xen`, `j970zyjve2f6nf2xjhbrgppn3n868j77`, `j9701rccq8p5004fp1hcyz51n1868v1p`, `j97c0fpcah2wynhax9dwtvwbq986834v`, `j976be4pdt47qpwckvttdwyyhn869dq0`, `j9710xe1c6x7vykhsg2zxmjfgd868m7p`, `j975jgqkc6zkyma8mgdas3a9n18680hh`, `j97b4f8pxp99p1gn00thys73q98688xv`, `j97brmrk3kdyrk739e9xaw004586836j`, `j9783j0k4vd71hnh4j58fms4eh868xte`.

**Result.**
- kills: **3**
- lethal runs: **3/10**
- extractions: 18
- speech: 211 (down from 663 — agents speak much less at medium; deliberation absorbs the budget)
- duration: 577s (vs ~410s at low — ~40% slower)

Spread the 3 kills across 3 different runs (vs Cycle 2 low which was 5 kills across 3 runs). Same lethality-rate, more cost. **Medium does not unblock the gate.**

---

## Best probe (final committed state) — Cycle 2 @ low

| Metric | Stage-2 baseline | Cycle 1 | **Cycle 2 (committed)** | Cycle 3 | Medium probe |
|---|---|---|---|---|---|
| Total kills | 4 | 3 | **5** | 3 | 3 |
| Lethal runs / 10 | 4 | 2 | **3** | 2 | 3 |
| Extractions | 12 | 18 | 15 | 24 | 18 |
| Equips | 69 | 62 | 63 | 65 | 67 |
| Fallback rate | ~6.8% | ~7% | ~5-8% | ~7% | low |
| Speech events | 717 | 733 | 663 | 758 | 211 |

**Per-persona breakdown — Cycle 2 (committed):**

| Persona | extractions | kills | equips | speech |
|---|---|---|---|---|
| rat | 3 | 0 | 9 | 0 |
| duelist | 2 | **5** | 4 | 0 |
| trader | 2 | 0 | 7 | 410 |
| opportunist | 2 | 0 | 9 | 0 |
| paranoid | 0 | 0 | 5 | 213 |
| camper | 1 | 0 | 11 | 6 |
| sprinter | 4 | 0 | 11 | 9 |
| vulture | 1 | 0 | 7 | 25 |

Persona extraction-rate spread (max - min) = sprinter 40% - paranoid 0% = **40 pp** ≥ Gate-3 target of 15 pp (well above).

GO criteria recap:
- ≥6/10 lethal: **3/10 ❌** (the binding fail)
- aggregate fallback ≤10%: ~5-8% ✅
- 0 crashes: ✅
- ≥8/10 runs with ≥1 equip: **10/10 ✅** (every run had ≥4 equips)
- ≥1 speech event: ✅ (663 across 10 runs)
- spread ≥15pp: 40pp ✅
- lint+typecheck+test green at every commit: ✅

---

## What worked / what didn't (mechanism-level)

**Worked.**
- **Numbered procedural ordering** in persona text. The model reliably executes "1) unarmed → chest. 2) armed → engage." in that priority once it's literally numbered. Cycle 2 produced a duelist that kills.
- **Tight spawn geometry.** Pulling spawns inward from radius ~45 to ~28 created mutual-vision events ~5 turns earlier. The duelist's engagement trigger only fires when an enemy is visible; reducing the average first-sight turn made the trigger fireable in more matches.
- **Min-damage-floor verification.** Read combat.ts, confirmed §12 is correctly implemented. Did NOT touch the engine — no spurious "fix" introduced.
- **Investigation tooling first.** `harness/inspect-attacks.ts` + `harness/inspect-equipped.ts` (committed) gave per-attack, per-persona visibility. The "all 41 attacks landed at dmg 5" finding from Stage-2 match j97324vsy was the load-bearing diagnostic — it ruled out hypothesis (b) and pointed at (a) immediately.

**Didn't work.**
- **Generic aggression nudges for paranoid + vulture.** "Fire on any enemy at range 2" requires enemies to *be* at range 2 of the agent. Cover-camping personas don't pull enemies into their kill window; they wait for traversal that mostly doesn't happen. Net effect of Cycle 3: paranoid 0 kills, vulture 0 kills, regression vs Cycle 2.
- **Wounded-only triggers.** Vulture's "strike wounded survivors" rule never fires in early game when everyone is at full HP. The trigger predicate excludes the actual game state.
- **Medium reasoning.** Doesn't help when the bottleneck is geometric (range 2 attack window vs vision 20 + map 100×100). More deliberation per turn doesn't pull enemies into the duelist's engagement window any faster.

---

## Recommended next lever (for the next PM round)

If the orchestrator opens a 4th cycle, the highest-EV lever is **convergence pressure**, not more persona text.

**Concrete options, ordered by ROI:**

1. **Shrink the playable footprint inside the existing 100×100.** Spawns at radius 28 helped; pulling them to radius 20 (e.g., `(28,28)`, `(48,28)`, ...) would put initial Chebyshev separations at ~28 (within 1.5 vision-cones of one another) — agents would see each other on turn 1-2 instead of turn 5-7. This compounds with the Cycle-2 procedural duelist.
2. **Aggressively reduce HP from 100 → 50** (or boost weapon damage tiers ×1.5). The 5-damage floor + 100 HP ratio means 20 hits to kill unarmed — that's most of a match. Halving HP halves the time-to-kill for armed combat too. This is engine-side (`MAX_HP` in `convex/runMatch.ts`) but is a single-line change; tests assert specific values from concept-spec §12 like axe-vs-leather=17, so a minimum-floor change risks more breakage than HP. **HP is the cheapest knob.** This was *not* tried in Cycle 1-3 because the brief framed combat-tier edits as "engine bug only" — but HP is a tunable, not a bug.
3. **Pull camper out of the "open chest then return to cover" anti-pattern.** Camper opens chests but the trip to/from chest negates the cover-camp signal. Either lock camper to a cover tile that's ALSO chest-adjacent (map edit: place a chest at (47,46) inside the central cover cluster) or have camper sit in cover with whatever weapon they spawn with (`MIN_DAMAGE_FLOOR=5` overwatch fires unarmed are still kills if applied 20 times to one target).
4. **Add 2-3 more chests near evac centre.** Currently 9 chests, 4 in corners 4 in interior 1 north of evac. Chests near evac would get armed during the convergence window (turn 30-50) when most agents arrive armed-or-not.

**Do not retry:**
- More persona text aggression (Cycle 3 showed diminishing/negative returns).
- Reasoning bumps without geometric or HP changes.
- Combat-formula edits (the engine is correct).

---

## Files touched at HEAD (Cycle-2 committed state)

- `personas/duelist.md` — Cycle 2 sharpened body (numbered procedural + "Never attack unarmed").
- `personas/vulture.md` — Cycle 2 body (chest-first, range-2 strike on wounded).
- `personas/opportunist.md` — Cycle 1 body (gather-before-fight, range-2 attack on weaker).
- `personas/camper.md` — Cycle 1 body (chest-then-cover-then-overwatch).
- `convex/_data/personas.ts` — inline mirror updated for the four edits above.
- `maps/reference.json` — 8 spawns moved from radius ~45 to radius ~28 (size, walls, cover, chests, evac all unchanged).
- `harness/inspect-attacks.ts` — NEW. Diagnostic: attack-resolution histogram + decision-attack-by-persona + damage distribution.
- `harness/inspect-equipped.ts` — NEW. Diagnostic: equipped-state histogram per persona, weapon-at-attack-time.

Out of scope (Liam's WP14 silo): `convex/reports.ts`, `convex/engine/reportStats.ts`, `tests/reports.test.ts`, `tests/engine/reportStats.test.ts`, additive `convex/schema.ts` reports fields. Confirmed via inbox during the cycles.

Validation: `npm run lint && npx tsc --noEmit && npm test` green at every commit boundary.
