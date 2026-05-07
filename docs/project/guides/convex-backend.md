# Convex Backend — Deployment, Auth, Smoke Test

Operational reference for talking to the project's Convex deployment. **Verified working 2026-05-07.**

> Convex is the backend-as-a-service for state, queries, mutations, and scheduled functions. Auth is via a deploy key in `.env`; the CLI picks it up automatically.

---

## 1. Credentials (in `.env`)

```
CONVEX_URL=https://calculating-meerkat-923.convex.cloud
CONVEX_DEPLOY_KEY=dev:calculating-meerkat-923|<token>
```

- The URL host (`calculating-meerkat-923`) and the deploy key's deployment slug must match.
- `dev:` prefix = **dev deployment key**. Allows deploy + invoke + read. For prod, the prefix is `prod:` and you'd typically use it only in CI.
- `.env` is gitignored. Never commit these.

## 2. Deployment state (as of 2026-05-07)

- Project: **fresh** — no `convex/` folder, no functions, no schema, no tables.
- `package.json` includes `convex` as a devDependency.
- Build version returned by `/version`: `20260504T231427Z-f1774a00487d`.

## 3. Smoke tests (no functions required)

All three should pass on a fresh deployment with valid credentials:

```bash
set -a; source .env; set +a

# 1. Deployment is reachable
curl -sS "$CONVEX_URL/version"
# → e.g. "20260504T231427Z-f1774a00487d"

# 2. Deploy key authenticates (lists tables — empty on fresh deployment)
npx convex data
# → "There are no tables in the calculating-meerkat-923 deployment's database."

# 3. Function metadata reachable
npx convex function-spec
# → { "url": "...", "functions": [] }
```

If any of these fail, suspect: stale/rotated deploy key, deployment paused, or URL/key slug mismatch.

## 4. Going from fresh → first function

```bash
npx convex dev --once   # codegens convex/_generated/, creates convex/ if missing
# author convex/<file>.ts with `query` / `mutation` / `action` exports
npx convex dev          # watches & redeploys on change (long-running)
npx convex run <fn>     # invoke a deployed function from the CLI
```

`npx convex dev` (long-running) is the standard developer loop — it watches `convex/`, redeploys on change, and streams logs. **Not yet exercised** for this project — first function will validate the write path.

## 5. Useful commands

| Command | Purpose |
|---|---|
| `npx convex data [table]` | List tables / print rows. Read-only. |
| `npx convex function-spec` | List deployed functions and their arg/return shapes. |
| `npx convex run <fn> [json-args]` | Invoke a function from the CLI. |
| `npx convex logs` | Stream deployment logs. |
| `npx convex env list` | List server-side env vars (separate from `.env`). |
| `npx convex dashboard` | Open the web dashboard. |
| `npx convex deployment` | Show which deployment the CLI is pointing at. |

## 6. Server-side env vars (`npx convex env`)

Anything a Convex function needs at runtime (e.g. `AZURE_API_KEY` for an action that calls the LLM) lives in the **deployment's** env, not `.env`. Set with:

```bash
npx convex env set AZURE_API_KEY "$AZURE_API_KEY"
```

`.env` is for the **local CLI/dev machine**. Convex functions executing in the cloud don't see it.

## 7. When this guide goes stale

- Deployment renamed or rotated: update both `CONVEX_URL` and `CONVEX_DEPLOY_KEY` in `.env`, re-run §3.
- Schema/functions exist: §2 ("fresh project") will be wrong — update or delete that section.
- After first successful `npx convex dev --once`, replace §4's "Not yet exercised" note with the verified write-path command.
