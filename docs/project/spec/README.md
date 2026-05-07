# Spec — Source of Truth

This directory holds the **source of truth** specifications for context-battler.

## What lives here

- **`mental-model.md`** — the why layer. Purpose, core flows, user mental models, business logic. No implementation details.
- **Concept / mechanics specs** — the what layer. Game rules, turn economy, combat, gear, evac.
- **Data dictionary, data flows** — when the system grows enough to need them.
- **Tech guide / industry references** — when relevant.

## What does not live here

- Process and ways of working → `docs/project/guides/`
- Live work packages and phase notes → `docs/project/phases/<phase-id>/`
- Implementation code or comments → the codebase

## Editing rules

- The mental model is **stewarded**, not freeform. If new info conflicts with it, resolve the conflict explicitly before updating.
- Mechanics specs may update freely as design evolves; keep them aligned with the mental model's pillars and north star.
- Update specs as soon as the code or design diverges. Stale specs are worse than missing specs.
