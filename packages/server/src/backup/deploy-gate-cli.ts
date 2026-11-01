/**
 * G0 backup — deploy gate operator CLI (increment B5; spec §10).
 *
 * The runnable form of the deploy gate (deployGate.ts). Run it
 * BEFORE merging to `main` (or before a manual `fly deploy`): the
 * merge is what ships — Fly's native auto-deploy picks `main` up on
 * its own — so this check is the last point where a deploy can
 * honestly be refused. DEPLOYMENT.md's deploy checklist makes it
 * step zero; a REFUSED verdict means the deploy does not proceed.
 *
 *   DEPLOY_GATE_SPACE_ID=<owner space id> \
 *     npx tsx packages/server/src/backup/deploy-gate-cli.ts [--base-url <url>] [--json]
 *
 * Configuration is by environment, NAMES only: DEPLOY_GATE_SPACE_ID
 * is the operator's owner space id — the backup routes are
 * owner-gated and the space id is the credential (see the runbook);
 * it is read from the environment, never passed on the command line,
 * and never printed. DEPLOY_GATE_BASE_URL overrides the target app
 * origin (default https://brain-soumaya-v1.fly.dev).
 *
 * Exit codes: 0 = PASS (the deploy may proceed), 1 = REFUSED (a
 * named condition failed — including an unreadable status endpoint:
 * the gate fails closed), 2 = usage/configuration error (e.g. the
 * space-id environment variable is unset).
 */
import * as nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { HttpDeployGateClient, formatDeployGateVerdict, runDeployGate } from "./deployGate.js";

const DEFAULT_BASE_URL = "https://brain-soumaya-v1.fly.dev";
const USAGE =
  "usage: deploy-gate-cli [--base-url <app-origin>] [--json]  (env: DEPLOY_GATE_SPACE_ID required, DEPLOY_GATE_BASE_URL optional)";

interface CliArgs {
  baseUrl: string;
  json: boolean;
}

export function parseDeployGateArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const args: CliArgs = {
    baseUrl: env.DEPLOY_GATE_BASE_URL?.trim() || DEFAULT_BASE_URL,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      args.json = true;
    } else if (a === "--base-url" && argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
      args.baseUrl = argv[++i]!;
    } else {
      throw new Error(`unrecognized or incomplete argument: ${a ?? ""}\n${USAGE}`);
    }
  }
  return args;
}

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseDeployGateArgs(argv, process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const spaceId = process.env.DEPLOY_GATE_SPACE_ID?.trim();
  if (!spaceId) {
    console.error(
      "DEPLOY_GATE_SPACE_ID is not set. The backup routes are owner-gated: set it to the owner's " +
        "space id (the operator's own credential — from its authoritative store, never committed, " +
        "never printed) and re-run.",
    );
    return 2;
  }
  const client = new HttpDeployGateClient({ baseUrl: args.baseUrl, spaceId });
  const verdict = await runDeployGate(client);
  if (args.json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(formatDeployGateVerdict(verdict));
  }
  return verdict.outcome === "pass" ? 0 : 1;
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
