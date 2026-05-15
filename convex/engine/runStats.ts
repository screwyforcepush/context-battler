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
//   kills: total weapon/counter deaths across the match
//          (`sum(turns[*].resolution.deaths.length)`). Environmental deaths
//          live outside `deaths`, so they are not counted as kills. Also
//          surfaces in `perPersona.kills` for every attacker who landed
//          same-turn damage against a target whose resolved engine
//          characterId appears in the turn's `deaths`. Multi-attacker
//          credit per concept-spec §12 — the sum of `perPersona.kills` may
//          exceed top-level `kills` when multiple attackers contributed to
//          one death.
//
//   extractions: count of characters with `extractedAtTurn` populated in
//          their final state. Per-persona bucket is 0/1 per character.
//
//   equips: count of trace actions where the equip side-effect succeeded —
//          `(kind="interact", result="opened")` plus `(kind="loot",
//          result="looted")`. Ground-truth contract (Gate-2 fix #1): the
//          resolver pushes the success result ONLY from inside the phase-5
//          equip / loot APPLICATION loops, AFTER each short-circuit
//          (crates: `crate.opened || crate.contents === null`; corpses:
//          no remaining slot to pick) — so `result="opened"` /
//          `result="looted"` is one-to-one with the equip side-effect
//          actually running. Same-turn collisions (multiple actors target
//          the same crate/corpse) only credit the one actor whose
//          side-effect runs; dud crates with null contents and drained
//          corpses produce zero equip events. Failed action-build attempts
//          (`already_opened` / `out_of_range` / `no_crate` / `no_corpse`)
//          are emitted as those non-success results and are NOT counted.
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
//     3 crate opens with equip, 1 crate open without equip, 1 extraction
//     → kills=2, equips=3, extractions=1") covered by runStats.test.ts.
//   - mental-model.md §10 — Gate-3 done-bar consumes the per-persona
//     extraction-rate spread that builds on top of these per-persona counts.

import { PERSONA_IDS, titleCase, type PersonaId } from "./types.js";

function isCrateId(id: string): boolean {
  return /^Crate_-?\d+_-?\d+$/.test(id);
}

// ─── Types (mirror Convex row shapes; plain-object) ──────────────────────

/** A single trace action entry — schema-shaped (kind + target + result). */
export type AggregatorAction = {
  characterId: string;
  kind: string;
  target: string;
  result: string;
  /** Present when the item was NOT equipped because actor held an equal-or-better
   *  item (strictly-better equip rule). equips counter must NOT increment. */
  discardedWeaker?: boolean;
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
  environmentalDeaths?: string[];
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
  displayName?: string;
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

function addTargetAliases(
  lookup: Map<string, string>,
  participant: { characterId: string; personaId: PersonaId; displayName?: string },
): void {
  lookup.set(participant.characterId, participant.characterId);
  lookup.set(participant.personaId, participant.characterId);
  lookup.set(titleCase(participant.personaId), participant.characterId);
  if (participant.displayName && participant.displayName.trim().length > 0) {
    lookup.set(participant.displayName, participant.characterId);
  }
}

function buildTargetIdLookup(
  turns: readonly AggregatorTurnRow[],
  characters: readonly AggregatorCharacterRow[],
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const c of characters) {
    addTargetAliases(lookup, {
      characterId: c._id,
      personaId: c.personaId,
      ...(c.displayName !== undefined ? { displayName: c.displayName } : {}),
    });
  }
  for (const t of turns) {
    for (const record of t.agentRecords) {
      addTargetAliases(lookup, {
        characterId: record.characterId,
        personaId: record.personaId,
      });
    }
  }
  return lookup;
}

function isDamageAction(action: AggregatorAction): boolean {
  return (
    (action.kind === "attack" ||
      action.kind === "overwatch" ||
      action.kind === "counter") &&
    /^dmg\s+\d+/i.test(action.result)
  );
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
  const targetIdLookup = buildTargetIdLookup(turns, characters);
  const perPersona = emptyPerPersona();

  let kills = 0;
  let equips = 0;
  let speechEvents = 0;

  for (const t of turns) {
    // ── deaths → kills + per-attacker credit ───────────────────────────
    const deathSet = new Set(t.resolution.deaths);
    kills += t.resolution.deaths.length;

    if (deathSet.size > 0) {
      // For each landed damage action against a dead character this turn, credit
      // the attacker's persona with one kill. Multi-attacker scenarios
      // share credit (concept-spec §12: "if three agents attack one
      // target, all valid attacks land"). Stationary attacks, overwatch,
      // and counter-fire qualify; resolver traces may target display names
      // or persona ids, so normalise to engine characterId before checking
      // `trace.deaths`.
      for (const a of t.resolution.actions) {
        if (!isDamageAction(a)) continue;
        const targetId = targetIdLookup.get(a.target) ?? a.target;
        if (!deathSet.has(targetId)) continue;
        const attackerPersona = personaIndex.get(a.characterId);
        if (!attackerPersona) continue;
        const bucket = perPersona.get(attackerPersona);
        if (bucket) bucket.kills += 1;
      }
    }

    // ── equips: crate-equip + corpse-loot-equip ────────────────────────
    // Crates and corpses share `kind="loot"` but are disambiguated by
    // target namespace. Corpse loot success must come from Corpse_<PersonaName>
    // so malformed crate rows cannot inflate equip counts.
    //
    // Strictly-better rule: `discardedWeaker=true` means the source was opened
    // but the item was NOT equipped (actor held an equal-or-better item). Do NOT
    // count discarded-weaker actions as equips.
    for (const a of t.resolution.actions) {
      if (a.discardedWeaker === true) continue;
      const isCrateEquip =
        a.kind === "loot" &&
        a.result === "opened" &&
        isCrateId(a.target);
      const isCorpseLootEquip =
        a.kind === "loot" &&
        a.result === "looted" &&
        a.target.startsWith("Corpse_");
      if (!isCrateEquip && !isCorpseLootEquip) continue;
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
