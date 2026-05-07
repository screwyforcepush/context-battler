// WP12 — pure run-aggregator (engine layer; no Convex imports).
//
// Walks a completed match's `turns` ledger + `characters` rows and produces
// the payload for one `runs` row per ADR §6:
//
//   { matchId, kills, extractions, equips, speechEvents, perPersona[8] }
//
// Boundary contract (ADR §1, WP12):
//   - Pure function over plain objects; no Convex API access.
//   - WP12-owned: the Convex mutation `runs.aggregate` is a thin wrapper
//     that reads the rows and calls this function.
//   - WP10's completion branch SCHEDULES `runs.aggregate(matchId)` but does
//     NOT compute the row inline — that boundary is what keeps Gate-1
//     (engine smoke) decoupled from Gate-2 (per-match aggregation).
//
// Counter semantics (locked here):
//
//   kills: total deaths across the match (`sum(turns[*].resolution.deaths.length)`).
//          Also surfaces in `perPersona.kills` for every attacker who landed
//          a same-turn `attack` against a target whose id appears in the
//          turn's `deaths`. Multi-attacker credit per concept-spec §12 —
//          the sum of `perPersona.kills` may exceed top-level `kills` when
//          multiple attackers contributed to one death.
//
//   extractions: count of characters with `extractedAtTurn` populated in
//          their final state. Per-persona bucket is 0/1 per character.
//
//   equips: count of trace actions where the equip side-effect succeeded —
//          `(kind="interact", result="opened")` (the resolver emits
//          `result="opened"` only when the chest had non-null contents and
//          the equip side-effect ran — see resolution.ts:455-461) plus
//          `(kind="loot", result="looted")` (corpse-loot equipped one
//          slot). Failed interacts (`already_opened` / `out_of_range` /
//          `no_chest`) and failed loots are NOT counted.
//
//   speechEvents: total `trace.speech.length` across all turns. Per-persona
//          bucket attributes each utterance to its speaker's persona.
//
//   perPersona.survivedTurns: the latest turn the character was active —
//          `extractedAtTurn` if extracted, `diedAtTurn` if dead, else
//          `FINAL_TURN` (50). Computed from the character row only; trace
//          ledger is not consulted.
//
// Cross-references:
//   - ADR §6 — locks the `runs` row schema (field names + types).
//   - work-packages.md WP12 — acceptance ("Synthetic match with 2 kills,
//     3 chest opens with equip, 1 chest open without equip, 1 extraction
//     → kills=2, equips=3, extractions=1") covered by runStats.test.ts.
//   - mental-model.md §10 — Gate-3 done-bar consumes the per-persona
//     extraction-rate spread that builds on top of these per-persona counts.

import { PERSONA_IDS, type PersonaId } from "./types.js";

// ─── Types (mirror Convex row shapes; plain-object) ──────────────────────

/** A single trace action entry — schema-shaped (kind + target + result). */
export type AggregatorAction = {
  characterId: string;
  kind: string;
  target: string;
  result: string;
};

/** A single trace speech entry — only `characterId` (speaker) + `text` are
 *  needed by the aggregator; `heardBy` is ignored at this layer. */
export type AggregatorSpeech = {
  characterId: string;
  text: string;
  heardBy: string[];
};

/** A per-turn resolution payload (subset relevant to aggregation). */
export type AggregatorResolution = {
  consumed: Array<{ characterId: string; item: { category: "consumable"; name: string } }>;
  speech: AggregatorSpeech[];
  moves: Array<{ characterId: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
  actions: AggregatorAction[];
  deaths: string[];
  visibilityUpdates: Array<{ characterId: string; hidden: boolean; revealedBy?: string }>;
};

/** One `turns` row, narrowed to the fields the aggregator reads. */
export type AggregatorTurnRow = {
  turn: number;
  agentRecords: Array<{ characterId: string; personaId: PersonaId }>;
  resolution: AggregatorResolution;
};

/** One `characters` row, narrowed to the fields the aggregator reads. */
export type AggregatorCharacterRow = {
  _id: string;
  personaId: PersonaId;
  alive: boolean;
  diedAtTurn?: number;
  extractedAtTurn?: number;
};

/** Per-persona stats — mirrors the schema's `perPersonaStatsValidator`. */
export type PerPersonaStats = {
  personaId: PersonaId;
  survivedTurns: number;
  kills: number;
  extracted: number;
  equips: number;
  speechEvents: number;
};

/** Aggregated payload — mirrors the `runs` row's non-pk fields. */
export type RunSummary = {
  kills: number;
  extractions: number;
  equips: number;
  speechEvents: number;
  perPersona: PerPersonaStats[];
};

// ─── Constants ────────────────────────────────────────────────────────────

/** Final turn for v0 phase 1 (concept-spec §15). When neither
 *  `diedAtTurn` nor `extractedAtTurn` is set, the character is treated as
 *  having survived all 50 turns. */
const FINAL_TURN = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Initialise an empty per-persona stats record for all 8 locked ids. */
function emptyPerPersona(): Map<PersonaId, PerPersonaStats> {
  const map = new Map<PersonaId, PerPersonaStats>();
  for (const id of PERSONA_IDS) {
    map.set(id, {
      personaId: id,
      survivedTurns: 0,
      kills: 0,
      extracted: 0,
      equips: 0,
      speechEvents: 0,
    });
  }
  return map;
}

/** Build a characterId → personaId lookup from the character roster. */
function buildPersonaIndex(
  characters: AggregatorCharacterRow[],
): Map<string, PersonaId> {
  const idx = new Map<string, PersonaId>();
  for (const c of characters) idx.set(c._id, c.personaId);
  return idx;
}

// ─── Public aggregator ────────────────────────────────────────────────────

/**
 * Walk the trace ledger + character rows for one match and produce the
 * `runs` row payload. Pure / no I/O — testable without Convex.
 *
 * Inputs:
 *   - `turns`: the full `turns` ledger for the match (any order; not
 *     required to be sorted, though phase-1 emits them ascending).
 *   - `characters`: the final-state `characters` rows (8 in a complete
 *     phase-1 match; the function tolerates 0..N for tests).
 *
 * Returns: the `RunSummary` payload. Always exactly 8 entries in
 * `perPersona`, one per locked PersonaId (zero-filled for personas
 * absent from the roster — keeps Gate-3 report shape stable).
 */
export function aggregateRunStats(
  turns: AggregatorTurnRow[],
  characters: AggregatorCharacterRow[],
): RunSummary {
  const personaIndex = buildPersonaIndex(characters);
  const perPersona = emptyPerPersona();

  let kills = 0;
  let equips = 0;
  let speechEvents = 0;

  for (const t of turns) {
    // ── deaths → kills + per-attacker credit ───────────────────────────
    const deathSet = new Set(t.resolution.deaths);
    kills += t.resolution.deaths.length;

    if (deathSet.size > 0) {
      // For each landed attack against a dead character this turn, credit
      // the attacker's persona with one kill. Multi-attacker scenarios
      // share credit (concept-spec §12). Filter to attacks with `result`
      // starting "dmg " — that's the resolver's marker for a landed hit
      // (see convex/engine/resolution.ts:419-422).
      for (const a of t.resolution.actions) {
        if (a.kind !== "attack") continue;
        if (!a.result.startsWith("dmg ")) continue;
        if (!deathSet.has(a.target)) continue;
        const attackerPersona = personaIndex.get(a.characterId);
        if (!attackerPersona) continue;
        const bucket = perPersona.get(attackerPersona);
        if (bucket) bucket.kills += 1;
      }
    }

    // ── equips: chest-equip + corpse-loot-equip ────────────────────────
    for (const a of t.resolution.actions) {
      const isChestEquip =
        a.kind === "interact" && a.result === "opened";
      const isCorpseLootEquip =
        a.kind === "loot" && a.result === "looted";
      if (!isChestEquip && !isCorpseLootEquip) continue;
      equips += 1;
      const persona = personaIndex.get(a.characterId);
      if (!persona) continue;
      const bucket = perPersona.get(persona);
      if (bucket) bucket.equips += 1;
    }

    // ── speech events ──────────────────────────────────────────────────
    speechEvents += t.resolution.speech.length;
    for (const s of t.resolution.speech) {
      const persona = personaIndex.get(s.characterId);
      if (!persona) continue;
      const bucket = perPersona.get(persona);
      if (bucket) bucket.speechEvents += 1;
    }
  }

  // ── extractions + per-persona finalisation from character roster ─────
  let extractions = 0;
  for (const c of characters) {
    const bucket = perPersona.get(c.personaId);
    if (!bucket) continue;
    if (c.extractedAtTurn !== undefined) {
      extractions += 1;
      bucket.extracted += 1;
    }
    // survivedTurns: extractedAtTurn (if set) wins — "survived to
    // extraction"; else diedAtTurn — "survived through the kill turn";
    // else FINAL_TURN.
    if (c.extractedAtTurn !== undefined) {
      bucket.survivedTurns = c.extractedAtTurn;
    } else if (c.diedAtTurn !== undefined) {
      bucket.survivedTurns = c.diedAtTurn;
    } else {
      bucket.survivedTurns = FINAL_TURN;
    }
  }

  // ── Materialise the perPersona array in PERSONA_IDS order ────────────
  const perPersonaArr: PerPersonaStats[] = PERSONA_IDS.map((id) => {
    const stats = perPersona.get(id);
    if (!stats) {
      // Defensive — emptyPerPersona seeded all 8 ids; this branch is
      // unreachable in practice but keeps the type strictly non-undefined.
      return {
        personaId: id,
        survivedTurns: 0,
        kills: 0,
        extracted: 0,
        equips: 0,
        speechEvents: 0,
      };
    }
    return stats;
  });

  return {
    kills,
    extractions,
    equips,
    speechEvents,
    perPersona: perPersonaArr,
  };
}
