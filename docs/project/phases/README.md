# Phases

Phase folders hold live work packages and notes for a specific delivery slice.

## Naming

`docs/project/phases/<NN>-<short-name>/`

Examples:
- `01-skeleton/` — repo scaffolding, tooling, hello-world arena loop.
- `02-mvp-arena/` — 8 agents, 50 turns, evac, scratchpad.
- `03-prompt-injection/` — cursed items, speech as attack surface.

## What goes inside a phase folder

- `README.md` — phase goal, scope, exit criteria.
- Work packages (WPs) — discrete units of delivery.
- Notes, decisions, and context generated *during* the phase.

Phase folders are working surfaces. When a phase closes, distill any durable insight back into `spec/` or `guides/`.

## Completed phases

- [`07-context-payload-iter-3/`](07-context-payload-iter-3/) — slim Vision, masked equipment, diagnostics CLI + dashboard, 16 MB unblock. [Closure](07-context-payload-iter-3/PHASE-7-CLOSURE.md).
- [`08-vision-affordance-filter/`](08-vision-affordance-filter/) — spent-entity (empty chest, drained corpse) filter. Lightweight substrate follow-up; no closing report.
- [`09-walls-vision-rect-grained/`](09-walls-vision-rect-grained/) — uniform wall LOS, wall-slide, rect-grained Vision. [Closure](09-walls-vision-rect-grained/PHASE-9-CLOSURE.md).
- [`10-body-collision-overseer/`](10-body-collision-overseer/) — body-collision substrate (charge + wall-bump) + overseer v0 refinement (start-of-N grid, widened TurnFeed, Status card). [Closure](10-body-collision-overseer/PHASE-10-CLOSURE.md).
