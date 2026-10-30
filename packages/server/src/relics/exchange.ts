/**
 * Relics I-6 — THE EXCHANGE (implementation design §5.6; approved
 * design §5, R2-2/R2-3/R3-1; §9 rulings 1 + 5).
 *
 * A held Legacy may be exchanged, atomically, per ownership
 * instance: the holding ends, the copy returns to the world through
 * the I-2 return machinery (its placement history respected — never
 * an anchor that copy has occupied), an exchange receipt is
 * written, and the chosen consideration is delivered — all in ONE
 * transaction, all-or-nothing. A failure at any step leaves the
 * Legacy held and no consideration delivered.
 *
 * The consideration is real or the option refuses:
 *  - LORE unlocks an eligible L3 thread (§4.7, R2-3 — the thread's
 *    other relic is placed and its text is authored and approved).
 *    No eligible thread, no lore: the option reports itself
 *    unavailable and never fabricates an unlock.
 *  - CHART issues a chart stirring through the I-5 seam — exempt
 *    from the ambient cap, never from eligibility. Eligibility is
 *    re-validated at exchange time (the transaction calls issue()
 *    itself): a failed re-validation aborts the whole exchange.
 *  - CREDITS reads the posted-value seam (economy.ts) and reports
 *    "not offered": no posted value exists, and none is invented
 *    (ruling 1). No balance, no payment code.
 *
 * Keystones are never exchanged (R2-2), Seeds are never held to
 * exchange (R2-1), unclassed relics refuse by the same class rule.
 * The exchange is NOT a release: it never bypasses the Keystone
 * release refusal, and the gate-permanence recorder runs before the
 * holding delete, in this transaction (fix (a) discipline).
 *
 * Station rule (O-R7 / ruling 5): the exchange is accepted only
 * when the server-derived current world — passed in by the caller
 * from the travel ledger, never client-supplied — is the Great
 * Station. A replay of a committed exchange is not a change, so it
 * answers from anywhere; refusals write no receipt, so a refused
 * attempt never burns its key (the claim path's committed /
 * non-committed discipline).
 */
import { RELIC_BY_ID, eligibleExchangeThreads } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import {
  RelicHoldingsStore, STATION_REQUIRED_MESSAGE, UNKNOWN_RELIC_MESSAGE,
  type HoldingRow,
} from "./holdings.js";
import { RelicStirringService } from "./stirrings.js";
import { postedExchangeValue } from "../economy.js";

export type ExchangeOption = "lore" | "credits" | "chart";
export type ExchangeFailureKind =
  | "unknown" | "malformed" | "not-held" | "class" | "not-at-station"
  | "lore-unavailable" | "credits-not-offered" | "chart-ineligible";
export type ExchangeResult =
  | {
      ok: true; replayed: boolean; option: ExchangeOption; relicId: string; copyId: string;
      unlockedThreadIds: string[]; chartStirringId: number | null;
      returnAnchor: string | null; returnState: "placed" | "return-pool";
    }
  | { ok: false; reason: string; kind: ExchangeFailureKind };

export interface ExchangeArgs {
  relicId: string;
  option: ExchangeOption;
  chartTargetRelicId?: string | null;
  attemptKey: string;
}

const MALFORMED_MESSAGE = "That exchange didn't arrive whole — please try again.";
const KEY_CONFLICT_MESSAGE = "That exchange key already belongs to a different exchange — start a fresh exchange for this one.";
const NOT_HELD_MESSAGE = "You do not hold a copy of that relic to exchange.";
const CHART_TARGET_MISSING_MESSAGE = "Name the relic the chart should point to.";
const CHART_TARGET_UNKNOWN_MESSAGE = "That chart target is not in the Codex.";
const CHART_INELIGIBLE_MESSAGE = "That chart cannot be drawn — the relic it would point to cannot honestly be promised to you right now.";

/** The recorded half of a committed exchange (the receipt's outcome). */
interface StoredExchangeOutcome {
  option: ExchangeOption; relicId: string; copyId: string;
  unlockedThreadIds: string[]; chartStirringId: number | null;
  returnAnchor: string | null; returnState: "placed" | "return-pool";
}

/** Thrown inside the exchange transaction when the chart grant
 *  cannot be issued at exchange time: the whole exchange rolls back
 *  and the caller answers with the honest chart refusal. */
class ChartGrantAbort extends Error {}

export class RelicExchangeService {
  private store: RelicHoldingsStore;
  constructor(private h: DbHandle) { this.store = new RelicHoldingsStore(h); }

  private receiptRow(spaceId: string, attemptKey: string): { relicId: string; outcome: StoredExchangeOutcome } | null {
    try {
      const row = this.h.sqlite.prepare(
        `SELECT relic_id, outcome FROM relic_exchange_attempts WHERE space_id = ? AND attempt_key = ?`,
      ).get(spaceId, attemptKey) as { relic_id: string; outcome: string } | undefined;
      if (!row) return null;
      return { relicId: row.relic_id, outcome: JSON.parse(row.outcome) as StoredExchangeOutcome };
    } catch { return null; }
  }

  private replayedResult(outcome: StoredExchangeOutcome): ExchangeResult {
    return {
      ok: true, replayed: true, option: outcome.option, relicId: outcome.relicId, copyId: outcome.copyId,
      unlockedThreadIds: outcome.unlockedThreadIds ?? [], chartStirringId: outcome.chartStirringId ?? null,
      returnAnchor: outcome.returnAnchor ?? null, returnState: outcome.returnState ?? "return-pool",
    };
  }

  exchange(spaceId: string, args: ExchangeArgs, currentWorld: string): ExchangeResult {
    const def = RELIC_BY_ID.get(args.relicId);
    if (!def) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE, kind: "unknown" };
    if ((args.option !== "lore" && args.option !== "credits" && args.option !== "chart") || !args.attemptKey) {
      return { ok: false, reason: MALFORMED_MESSAGE, kind: "malformed" };
    }
    // Idempotency first (the claim path's step-2 discipline): a
    // committed exchange answers with its recorded outcome and
    // grants nothing twice. The replay performs no change, so the
    // Station rule below does not gate it.
    const prior = this.receiptRow(spaceId, args.attemptKey);
    if (prior) {
      if (prior.relicId !== args.relicId) return { ok: false, reason: KEY_CONFLICT_MESSAGE, kind: "malformed" };
      return this.replayedResult(prior.outcome);
    }
    // The Station rule (O-R7): changes happen at the Great Station.
    if (currentWorld !== "great-station") {
      return { ok: false, reason: STATION_REQUIRED_MESSAGE, kind: "not-at-station" };
    }
    try {
      const run = this.h.sqlite.transaction((): ExchangeResult => {
        this.store.backfillCopies();
        // The receipt is re-checked inside the transaction (the
        // claim path's discipline): a racing exchange that committed
        // this key is answered, never double-granted.
        const inner = this.receiptRow(spaceId, args.attemptKey);
        if (inner) {
          if (inner.relicId !== args.relicId) return { ok: false, reason: KEY_CONFLICT_MESSAGE, kind: "malformed" };
          return this.replayedResult(inner.outcome);
        }
        // Fix (a): gate permanence is recorded from the found set AS
        // IT STANDS, before the delete below can endanger it.
        this.store.recordGateCompletionIfComplete(spaceId);
        const row = this.h.sqlite.prepare(
          `SELECT * FROM relic_holdings WHERE space_id = ? AND relic_id = ?`,
        ).get(spaceId, args.relicId) as HoldingRow | undefined;
        if (!row || !row.copy_id) return { ok: false, reason: NOT_HELD_MESSAGE, kind: "not-held" };
        const copyId = row.copy_id;
        // The class rule (R2-2/R2-1): Legacies alone exchange.
        if (def.tierClass === "keystone") {
          return { ok: false, reason: `${def.name} is a keystone — keystones are never exchanged. The exchange belongs to legacies alone, and a keystone stays with the brain that holds it.`, kind: "class" };
        }
        if (def.tierClass === "seed") {
          return { ok: false, reason: `${def.name} is a seed — seeds are consumed the moment they are claimed and never held, so there is nothing here to exchange.`, kind: "class" };
        }
        if (def.tierClass !== "legacy") {
          return { ok: false, reason: `${def.name} cannot be exchanged — the exchange belongs to legacies alone.`, kind: "class" };
        }
        // Read-only option validation — everything provable is
        // proven BEFORE any write (§5.6 step 4).
        const threads = args.option === "lore" ? eligibleExchangeThreads(args.relicId) : [];
        if (args.option === "lore" && threads.length === 0) {
          return { ok: false, reason: `No thread tied to ${def.name} can be revealed by an exchange yet — a thread opens only when its other relic rests in the world and its words are written and approved.`, kind: "lore-unavailable" };
        }
        if (args.option === "credits" && !postedExchangeValue(args.relicId).offered) {
          return { ok: false, reason: `No posted value exists for ${def.name}, so the exchange cannot price it — and no price will be invented.`, kind: "credits-not-offered" };
        }
        if (args.option === "chart") {
          if (!args.chartTargetRelicId) return { ok: false, reason: CHART_TARGET_MISSING_MESSAGE, kind: "malformed" };
          if (!RELIC_BY_ID.has(args.chartTargetRelicId)) return { ok: false, reason: CHART_TARGET_UNKNOWN_MESSAGE, kind: "chart-ineligible" };
          if (!this.store.chartTargetEligible(spaceId, args.chartTargetRelicId)) {
            return { ok: false, reason: CHART_INELIGIBLE_MESSAGE, kind: "chart-ineligible" };
          }
        }
        // Consume: the holding ends; the copy's chain records the
        // exchange before it records the return (§5.6 step 5).
        this.store.recordEvent(copyId, "exchanged", {
          spaceId, world: def.world, anchorKey: row.anchor_key,
          detail: { option: args.option, attemptKey: args.attemptKey },
        });
        this.h.sqlite.prepare(`DELETE FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).run(spaceId, args.relicId);
        // Grant the consideration (§5.6 step 5).
        let unlockedThreadIds: string[] = [];
        let chartStirringId: number | null = null;
        if (args.option === "lore") {
          for (const thread of threads) {
            // The thread unlocks from BOTH members' Codex entries:
            // whichever side a reader opens, the words are there.
            for (const member of [thread.relicA, thread.relicB]) {
              this.h.sqlite.prepare(
                `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES (?, ?, 'L3', ?, 'exchange')`,
              ).run(spaceId, member, thread.threadId);
            }
          }
          unlockedThreadIds = threads.map((t) => t.threadId);
        } else if (args.option === "chart") {
          // Eligibility is re-validated HERE, by issuance itself —
          // the pre-check above only keeps the common refusal cheap.
          // A null from the seam aborts the whole exchange: the
          // Legacy is only spent when the chart is truly granted.
          const stirring = new RelicStirringService(this.h).issue(spaceId, args.chartTargetRelicId!, "chart", {});
          if (!stirring) throw new ChartGrantAbort();
          chartStirringId = stirring.id;
        } else {
          // Credits with a posted value: unreachable until a Credits
          // ledger exists to pay from — fail LOUD (the transaction
          // rolls back) rather than pretend a payment happened.
          throw new Error("exchange: a posted Credits value exists but no Credits ledger does — refusing to fake a payment");
        }
        // Place the copy again (§5.6 step 5): the I-2 return
        // machinery, against the copy's own placement history.
        const returnAnchor = this.store.returnPlacedCopy(copyId, spaceId, args.relicId, row.anchor_key, "exchange", { option: args.option, attemptKey: args.attemptKey });
        const returnState: "placed" | "return-pool" = returnAnchor ? "placed" : "return-pool";
        // Receipt last (§5.6 step 5): the committed record a replay
        // answers from.
        const outcome: StoredExchangeOutcome = {
          option: args.option, relicId: args.relicId, copyId,
          unlockedThreadIds, chartStirringId, returnAnchor, returnState,
        };
        const receipt = this.h.sqlite.prepare(
          `INSERT INTO relic_exchange_attempts (space_id, attempt_key, copy_id, relic_id, option, chart_target_relic_id, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(spaceId, args.attemptKey, copyId, args.relicId, args.option, args.option === "chart" ? args.chartTargetRelicId! : null, JSON.stringify(outcome));
        if (chartStirringId !== null) {
          // The chart's provenance points at this very exchange
          // (§4.6's chart_exchange_id column) — backfilled inside
          // the same transaction, so the link can never dangle.
          this.h.sqlite.prepare(`UPDATE relic_stirrings SET chart_exchange_id = ? WHERE id = ?`).run(Number(receipt.lastInsertRowid), chartStirringId);
        }
        return {
          ok: true, replayed: false, option: args.option, relicId: args.relicId, copyId,
          unlockedThreadIds, chartStirringId, returnAnchor, returnState,
        };
      });
      return run.immediate();
    } catch (err) {
      if (err instanceof ChartGrantAbort) {
        return { ok: false, reason: CHART_INELIGIBLE_MESSAGE, kind: "chart-ineligible" };
      }
      throw err;
    }
  }
}
