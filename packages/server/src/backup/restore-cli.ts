/**
 * G0 backup — restore operator CLI (increment B4; spec §8, runbook:
 * docs/G0_BACKUP_RESTORE_RUNBOOK.md).
 *
 * The runnable form of the §8 procedure. Run it with the target app
 * STOPPED (it swaps the database file; a running server would keep
 * the old file open). On a Fly machine, from /app:
 *
 *   npx tsx packages/server/src/backup/restore-cli.ts --preflight
 *   npx tsx packages/server/src/backup/restore-cli.ts [--backup <id>] \
 *       [--target /data/brain.db] [--operator <name>]
 *
 * Configuration is by environment, NAMES only (values are secrets
 * and are never printed): BACKUP_R2_ENDPOINT, BACKUP_R2_BUCKET,
 * BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY configure the
 * object store; BACKUP_ENCRYPTION_KEY is the decryption key;
 * RESTORE_OPERATOR names the operator for the restore record when
 * --operator is not passed.
 *
 * --preflight prints the store-alone facts (latest-good, its
 * manifest, key presence) and changes nothing. A restore prints the
 * full JSON report (record + the three reconciliation tiers) and
 * always writes the restore record to
 * `<target dir>/restore-records/<restoreId>.json` — the durable
 * record when the index append is unavailable (read-only store
 * credentials). Exit codes: 0 restored (or preflight ok), 1 restore
 * failed (target untouched), 2 usage/configuration error.
 */
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { loadS3StoreConfig, S3BackupStore } from "./store.js";
import { buildRestorePreflight, runRestore } from "./restore.js";

interface CliArgs {
  preflight: boolean;
  backupId?: string;
  target?: string;
  operator: string;
}

const USAGE =
  "usage: restore-cli [--preflight] [--backup <backup-id>] [--target <db-path>] [--operator <name>]";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    preflight: false,
    operator: process.env.RESTORE_OPERATOR ?? "unknown-operator",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--preflight") {
      args.preflight = true;
    } else if (a === "--backup" && argv[i + 1]) {
      args.backupId = argv[++i];
    } else if (a === "--target" && argv[i + 1]) {
      args.target = argv[++i];
    } else if (a === "--operator" && argv[i + 1]) {
      args.operator = argv[++i]!;
    } else {
      throw new Error(`unrecognized or incomplete argument: ${a ?? ""}\n${USAGE}`);
    }
  }
  return args;
}

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const config = loadS3StoreConfig();
  if (!config) {
    console.error(
      "The off-volume store is not configured. Set BACKUP_R2_ENDPOINT, BACKUP_R2_BUCKET, " +
        "BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY (names only — the values live " +
        "in the secret store, never in this command's output).",
    );
    return 2;
  }
  const store = new S3BackupStore(config);

  if (args.preflight) {
    const report = await buildRestorePreflight(store);
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  const targetDbPath = args.target ?? process.env.DB_PATH ?? "./brain.db";
  const result = await runRestore({
    store,
    targetDbPath,
    operator: args.operator,
    backupId: args.backupId,
  });

  // The local record file: written for EVERY run, restored or failed,
  // so a restore performed under read-only store credentials still
  // leaves its G0-AC-13 record on durable storage.
  const recordsDir = nodePath.join(nodePath.dirname(nodePath.resolve(targetDbPath)), "restore-records");
  fs.mkdirSync(recordsDir, { recursive: true });
  const recordFile = nodePath.join(recordsDir, `${result.record.restoreId}.json`);
  fs.writeFileSync(recordFile, `${JSON.stringify(result.record, null, 2)}\n`, "utf8");

  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          outcome: "restored",
          record: result.record,
          reconciliation: result.reconciliation,
          safetyCopyPath: result.safetyCopyPath,
          indexRecordWritten: result.indexRecordWritten,
          recordFile,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(
    JSON.stringify(
      {
        outcome: "failed",
        failureStage: result.failureStage,
        failureDetail: result.failureDetail,
        record: result.record,
        indexRecordWritten: result.indexRecordWritten,
        recordFile,
      },
      null,
      2,
    ),
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(nodePath.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    },
  );
}
