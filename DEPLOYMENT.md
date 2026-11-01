# Deployment

## Deploy checklist (current — read this first)

**Update 2026-10-31 (G0 increment B5):** how this app ships changed on
2026-10-28 — Fly's native GitHub auto-deploy is ON and the deploy
branch is `main` (see CLAUDE.md's Deployment section, "Update
2026-10-28"). Merging to `main` IS the deploy: Fly builds the
Dockerfile and ships it with no further step. The June account below
(push does not deploy; manual `fly deploy` by hand) is kept as
history and as the fallback path, not as the current flow.

Because the merge itself ships, the checks below run **before** the
merge. Nothing in the repo can intercept Fly's auto-deploy after a
merge lands — this checklist is where a deploy can honestly be
refused.

1. **Run the G0 deploy gate — a REFUSED verdict stops the deploy.**
   The gate (spec §10: *deploy refuses without a current
   latest-good*) verifies, against the live production app, that a
   current latest-good off-volume backup exists — the off-volume
   index reads cleanly, names the same latest-good as the app's
   record, and is no older than 24h — and then takes a **fresh
   pre-deploy backup** (trigger `pre_deploy`) and verifies it
   promoted and became the index's latest-good. Any failed condition
   is named, and the deploy does not proceed:

   ```bash
   DEPLOY_GATE_SPACE_ID=<owner space id> \
     npx tsx packages/server/src/backup/deploy-gate-cli.ts
   # exit 0 = PASS (deploy may proceed) · 1 = REFUSED (named conditions) · 2 = config error
   ```

   The space id is the operator's own credential (the backup routes
   are owner-gated); it comes from the environment only and is never
   committed or printed.
2. **The preserved manual safeguard (§10) still applies** — the
   automatic system supplements it, never replaces it. Its home is
   the V1 §18.4 deploy checklist (`docs/specs/v1-implementation-ask-2026-10-23.md`,
   `docs/specs/v1-implementation-gates-checklist.md`): a fresh
   export taken, a brain.db backup copy in hand, and the owner's
   downgrade acknowledgment made explicitly (downgrading past a
   release makes newer-format data invisible — not lost — until a
   current build returns; proceeding means accepting that).
3. **Merge to `main`** (or, on the fallback path, `fly deploy
   --remote-only` after pushing). Then verify the machine actually
   came up on the new release: Fly release complete, machine
   `started`, health checks passing — a deploy that leaves the
   machine stopped is not done (this has bitten before, 2026-10-30).
4. **G0-AC-15 revalidation:** any material change to schema,
   storage, or hosting re-opens the backup drill requirement — the
   restore drill (per the G0 Backup Restore Runbook,
   `docs/G0_BACKUP_RESTORE_RUNBOOK.md` — added by the B4 restore
   increment, PR #158) must be re-run end to end and recorded before
   backups are treated as proven again, and this checklist re-read
   against the change.

## How this app ships (the important part)

**STATUS (verified 2026-06-20, still current — see CLAUDE.md's Deployment
section for the authoritative, actively-maintained account): pushing to the
deploy branch alone does NOT deploy.** GitHub Actions is blocked on this
account (`startup_failure`, 0 jobs — an account/runner-availability issue, not
a code problem), so `.github/workflows/fly-deploy.yml` never ships anything
even if it exists. The working path right now is a **manual `fly deploy
--remote-only`**, run by `agy` (Antigravity CLI) from Termux — that sandbox has
the `FLY_API_TOKEN` and flyctl/Fly network access this sandbox doesn't.

The flow:

1. You commit + push to `claude/soumaya-second-brain-v1-m4z4hc`.
2. Someone with flyctl access (currently `agy`) runs
   `fly deploy --remote-only`, which builds the image (web build + server)
   and deploys it to app `brain-soumaya-v1` (region `iad`), using the `/data`
   volume for the SQLite DB.
3. The new machine must pass the health check (`GET /api/health`) before it
   serves traffic. If the new build is broken, the previous machine keeps
   running.

The durable fix is to **reconnect Fly's native GitHub auto-deploy** (Fly
dashboard → app → GitHub) — that builds the `Dockerfile` on push without going
through GitHub Actions at all. Until that's reconnected, treat every push as
needing a manual `fly deploy` afterward if you want it live.

If the app ever shows **"Suspended"** after a string of crashes, open the Fly
app, find the machine, and tap **Start/Resume** once — a healthy deploy normally
clears this on its own.

## Why `.github/workflows/fly-deploy.yml` doesn't ship anything

The workflow file is still present, but GitHub Actions cannot run on this
account — every run fails as `startup_failure` with 0 jobs within seconds
because no runner is ever assigned (an account/runner-availability setting,
not a code problem). A workflow that can never run only produces red "failed"
marks on every push and protects nothing. It's left in place as a marker for
whenever Actions is unblocked (see below), rather than actively relied on.

## Restoring CI later (recommended once Actions works)

When GitHub Actions can run again (e.g. account verified / billing enabled, or
the repo lives under an account with working Actions), a proper CI **check** is
worth having — it runs the test suite on every push so regressions are caught
before they reach Fly. Recreate `.github/workflows/ci.yml` with:

```yaml
name: CI
on:
  push:
    branches: [claude/soumaya-second-brain-v1-m4z4hc]
  pull_request:
  workflow_dispatch:

jobs:
  checks:
    name: Typecheck, test, build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build # web static build
```

This version intentionally **does not deploy** — right now nothing auto-deploys
on push (see above), so CI's only job would be a green/red signal on code
health. Once Fly's native GitHub auto-deploy is reconnected (the durable fix
described above), that alone handles deploys and this CI stays a pure check.
(If you'd rather have CI own the deploy instead, add a second job that runs
`flyctl deploy --remote-only` with a `FLY_API_TOKEN` repo secret — but don't
run that alongside a reconnected Fly GitHub integration, or the two will race.)

## Verifying a deploy locally (optional, for a developer)

You can prove the server boots against a database shaped like the production
volume:

```bash
DB_PATH=/path/to/old.db EMBED_PROVIDER=hash PORT=8099 \
  npx tsx packages/server/src/index.ts
curl localhost:8099/api/health   # -> {"ok":true,...}
```

`npm test` also includes `migration.test.ts`, which opens a pre-existing
(space_id-less) database and asserts it upgrades in place without crashing.
