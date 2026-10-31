# G0 — Backup Restore Runbook (increment B4)

The written form of spec §8, matching the procedure the B4 drill
actually ran end to end against a scratch Fly app. A backup is proven
only when this procedure has been run from the off-volume copy with
the Fly volume treated as gone.

**Code:** `packages/server/src/backup/restore.ts` (the procedure),
`packages/server/src/backup/restore-cli.ts` (the runnable form),
`packages/server/src/backup/reconcile.ts` (tier-3 identity + ledger
reconciliation). Tests: `packages/server/src/__tests__/g0BackupRestore.test.ts`.

## When to use this

- **Drill** (proving the backup works): target a scratch app, never
  production. Run at least once per G0 exit gate, and again after any
  material schema, storage, or hosting change (G0-AC-15).
- **Real loss** (the production volume is gone or the database is
  corrupt): target the production app — the same steps, plus the
  write-freeze in step 1.

## What you need before starting

Access to: `flyctl` signed in to the owner's Fly account; the
Cloudflare account that holds the R2 bucket `soumaya-backups`.

### Secrets — by NAME only (G0-AC-14)

No secret value ever appears in this runbook, the manifest, the
backup index, logs, or chat. Each value lives in exactly its
authoritative store and is re-supplied from there during a restore.

| Name | What it is | Authoritative copy | Re-supply during restore |
|---|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | 32-byte AES-256-GCM key for the off-volume copies | (1) Fly secret on `brain-soumaya-v1`; (2) **the owner's offline copy** (password vault) | The owner sets it on the target app from the offline copy: `flyctl secrets set BACKUP_ENCRYPTION_KEY -a <target-app>` (value pasted by the owner, never through an assistant or a log). The drill tests THIS path — a backup whose key is lost is a failed backup, discovered in the drill, not during a real loss (spec §6). |
| `BACKUP_R2_ENDPOINT` | R2 S3 endpoint URL | Fly secret on `brain-soumaya-v1`; also derivable from the Cloudflare account id on the R2 dashboard | `flyctl secrets set` on the target app. |
| `BACKUP_R2_BUCKET` | Bucket name (`soumaya-backups`) | Fly secret on `brain-soumaya-v1`; R2 dashboard | Same. |
| `BACKUP_R2_ACCESS_KEY_ID` | S3 access key id of the bucket-scoped R2 API token | Fly secret on `brain-soumaya-v1`; the token's id on the Cloudflare R2 dashboard | Same. For a **drill**, create a SEPARATE bucket-scoped **read-only** token instead (least privilege) and use its id/secret on the scratch app only. |
| `BACKUP_R2_SECRET_ACCESS_KEY` | S3 secret for that token | Shown **once** when the token is created; afterwards only as the Fly secret | Set it on the target app in the same sitting as its creation — it cannot be read back from Fly or Cloudflare later. |

The restored app also needs its ordinary runtime configuration to
boot (compare `flyctl secrets list -a brain-soumaya-v1` — names only —
against the target app and re-supply anything missing from its own
authoritative store; e.g. `OWNER_SPACE_IDS` names the owner's space).
Non-secret env for a scratch target: `DB_PATH=/data/brain.db`,
`AUTONOMY=off`, and `BACKUP_SCHEDULER=off` — a restored brain on a
scratch app must not run autonomy loops or take backups of itself
into the production bucket (its store credentials are read-only in a
drill anyway, so an attempted promotion fails loudly and locally).

## Procedure (spec §8, in order)

All CLI commands run **from `/app` on the target machine, with the
app process stopped** — the restore swaps the database file, and a
running server would keep the old file open. On Fly the drill ran
them as a one-shot machine command against the app volume (see the
drill record in the B4 PR body for the exact invocations used).

1. **Freeze writes / pick the target.** Real loss: stop the
   production machines. Drill: create the scratch app
   (`brain-soumaya-restore-drill`) with its OWN empty volume.
2. **Preflight — recover the index from the store alone.**
   `npx tsx packages/server/src/backup/restore-cli.ts --preflight`
   prints the latest-good backup id, its manifest (creation time,
   app commit, schema version, snapshot + ciphertext SHA-256,
   per-table count total) and whether `BACKUP_ENCRYPTION_KEY` is
   present and well-formed — never its value. If this fails, stop:
   the index or the store is the problem, and nothing else in this
   runbook can help until it reads cleanly.
3. **Re-supply secrets** on the target app per the table above. For
   the drill this is the key-custody test: `BACKUP_ENCRYPTION_KEY`
   comes from the **owner's offline copy**, not from production.
4. **Run the restore.**
   `npx tsx packages/server/src/backup/restore-cli.ts --target /data/brain.db --operator <your name>`
   (add `--backup <id>` to restore a specific promoted backup
   instead of latest-good). The CLI, in order: reads the index,
   selects the backup, downloads the ciphertext and verifies its
   SHA-256 against the manifest, decrypts, verifies the snapshot
   standalone (integrity + foreign keys + manifest counts +
   MUST-BE-NONEMPTY enforcement), computes the tier-3 staged
   digests, moves any existing target database aside as
   `brain.db.pre-restore-<timestamp>`, swaps the verified snapshot
   in atomically, re-verifies the installed file (SHA-256 + tier-3
   digests + ledger reconciliation), and writes the restore record
   (to the index when the store credentials allow writes, always to
   `/data/restore-records/<restoreId>.json`). Exit code 0 = restored.
5. **Read the report.** The JSON report's reconciliation section
   shows the three tiers SEPARATELY: tier 1 manifest counts, tier 2
   structural integrity, tier 3 critical-record identity + ledgers
   (travel derivation, fuel balances, finance totals). All three
   must be ok. Tier 3 also reports any pre-existing travel
   event-chain violations found in the source data — those describe
   the source, not the restore, and are named, never hidden.
6. **Start the app; run the restore-correctness checks (spec §4).**
   - `GET /api/health` returns ok with the database alive.
   - A known space loads (any per-space route with that space's
     `x-space-id`).
   - The memory (nodes) count equals the manifest's `nodes` count.
   - The galaxy data for the space returns its nodes (what the web
     galaxy renders from); open the app URL and confirm the galaxy
     renders.
   - One chat round-trip returns an answer carrying a citation.
   - `GET /api/backup/status` (owner space) shows the restored
     attempt history — the backup that was restored is in it.
7. **Record.** The restore record from step 4 (backup id, operator,
   times, verification outcome) is the drill's evidence. Keep the
   local record file with the drill report. A restore with no record
   counts as unproven.
8. **Clean up (drill only).** Destroy the scratch app
   (`flyctl apps destroy brain-soumaya-restore-drill`) once the
   evidence is captured. The `.pre-restore-*` safety copy on a real
   target is the operator's to remove, after the restored app has
   run clean — the procedure never deletes it.

## Failure stages — what they mean

| Stage | Meaning | First move |
|---|---|---|
| `index` | The off-volume backup index is unreadable or corrupt. | Stop. Do not write anything to the bucket. The index is the recovery map; a corrupt index is itself the incident. |
| `select` | No latest-good, or the named backup is missing / not promoted. | Re-run `--preflight`; pick a promoted backup id explicitly. |
| `download` | The snapshot object is missing, or its bytes do not hash to the manifest (corruption in the store or in transit). | Do not retry blindly — check the bucket object's size/hash in Cloudflare. The target was not touched. |
| `decrypt` | The key is missing/malformed, or GCM authentication failed (wrong key, or tampered ciphertext that still hashed — impossible by construction, so: wrong key). | Re-supply `BACKUP_ENCRYPTION_KEY` from the owner's offline copy (step 3). |
| `verify` | The decrypted snapshot failed integrity, foreign-key, count, or MUST-BE-NONEMPTY checks. | The backup itself is bad. Restore an earlier promoted backup (`--backup <id>`); investigate the bad one as a backup-pipeline incident. |
| `reconcile` | Tier-3 digests could not be computed on the staged snapshot (e.g. a critical table is missing — schema drift). | Stop; the inventory/code and the snapshot disagree about the schema. This re-opens the drill requirement (G0-AC-15). |
| `install` | Staging, the swap, or the post-install proof failed. | The target was rolled back to its pre-restore state (or its safety copy is named in the report). Check disk space and volume health before retrying. |

Every failure above leaves the target database byte-for-byte what it
was before the run, and the failed attempt is still recorded.

## Revalidation (G0-AC-15)

Any material change to schema, storage, or hosting re-opens the
drill requirement: re-run this procedure end to end and record the
result before treating backups as proven again.
