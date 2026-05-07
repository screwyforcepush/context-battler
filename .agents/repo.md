
# Repository Guidelines

VALIDATE by Running required commands — all must pass without warnings or errors:
   - lint:       <!-- TODO: wire up linter command -->
   - typecheck:  <!-- TODO: wire up typecheck command -->
   - tests:      <!-- TODO: wire up test command -->
   - build:      <!-- TODO: wire up build command -->


## Dev server
<!-- TODO: document the dev server start command, port, and log path once the app exists. -->

When you do start a long-running process (dev server, watcher, simulation host) that must survive past your final response, **nohup it** so it isn't killed when the headless agent exits. Pattern:

```bash
nohup <start-command> > /tmp/<name>.log 2>&1 &
```

Before launching a new instance, check whether one is already running (e.g. `ps`, log file presence) — restarting bumps the port and orphans state.


## Documentation Protocol
Guard the doc hierarchy: specs in `docs/project/spec/` remain the source of truth (mental model, business logic, data dictionary, data flows, tech guide, industry references); guides in `docs/project/guides/` capture evolving process; phase folders (`docs/project/phases/XX-Name/`) store live work packages and notes. Update whichever doc you rely on as soon as the code diverges.


## PRE Deployment
<!-- TODO: document the pre-deployment / CI build command once a deploy target is chosen. -->
