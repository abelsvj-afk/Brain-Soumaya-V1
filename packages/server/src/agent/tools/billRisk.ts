import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { getBudgetSummary } from "../../finance/summary.js";
import { FinBillRepo } from "../../repositories/finBill.repo.js";
import { parseDay } from "../../finance/bills.js";
import { buildCommunicationContext, recentActionCount } from "../../communication/context.js";
import { NotificationsRepo } from "../../repositories/notifications.repo.js";

/**
 * Bill-risk nudge (Financial OS, docs/financial-os/architecture.md §5) — Soumaya's proactive
 * money moment. When your cushion is thin against an upcoming NON-autopay bill, she warns you
 * BEFORE an overspend makes it short, in her own voice. Deterministic + offline: the numbers
 * come from the pure Budget Engine (LLM-free); at most one nudge per space per day.
 *
 * Phase S pilot (docs/specs/soumaya-shared-communication.md): this is the one proactive
 * surface Phase R named as the clearest instance of "intelligent detection, static
 * communication" — detect() correctly finds a real financial risk, but run() used to emit one
 * of exactly two hardcoded sentences forever, regardless of anything else already known about
 * the user. The DETECTION LOGIC BELOW IS COMPLETELY UNCHANGED — same thresholds, same Budget
 * Engine, same autopay/tight-cushion math. Only the MESSAGE now consults the shared
 * CommunicationContext (soul/behavior/preferences/emotional-pattern context, all already
 * built and already used by Chat) plus one new, generic, communication-only signal
 * (`recentActionCount` — has this nudge already fired lately) to select among a still fully
 * deterministic set of phrasings, instead of a fixed pair. No LLM call was added: see
 * `docs/specs/soumaya-shared-communication.md` §Performance for why a template remains the
 * right choice for this pilot.
 */

const DAY_MS = 86_400_000;
const dollars = (cents: number): string => `$${Math.round(cents / 100)}`;

/**
 * Deterministic message selection informed by CommunicationContext. Kept OUTSIDE the shared
 * context module on purpose — a different proactive surface (a future Journey-update nudge,
 * say) would derive different branching from the SAME context shape, so this domain-specific
 * decision belongs with the tool that owns the message, not baked into the reusable boundary.
 *
 * Priority, most to least specific (never a combinatorial cross-product of every flag —
 * Phase S's own explicit warning against "configuration hell"):
 *  1. `preferConcise` wins outright — the shortest possible form, no elaboration, regardless
 *     of anything else (an explicit, evidence-gated learned preference is the strongest signal
 *     this function has).
 *  2. Otherwise, the OPENING clause is chosen by (in order) repetition-awareness, then
 *     emotional-context gentleness, then the original default opener — softening tone, never
 *     inventing or naming an emotion (Phase S §12: never turn a detected pattern into a claim
 *     about how the user feels).
 *  3. `preferDirect` drops the softening closer clause in favor of a plain, shorter ask.
 */
function buildBillRiskMessage(input: {
  billName: string;
  billAmountCents: number;
  mode: "short" | "pace";
  threshold: number;
  leadGently: boolean;
  preferConcise: boolean;
  preferDirect: boolean;
  alreadyNudgedRecently: boolean;
}): string {
  const { billName, billAmountCents, mode, threshold, leadGently, preferConcise, preferDirect, alreadyNudgedRecently } = input;
  const amount = dollars(billAmountCents);
  const amt = dollars(threshold);

  if (preferConcise) {
    // Shortest defensible form: the fact and the number, nothing else. Still preserves the
    // mode distinction (already-short vs on-pace-but-tight) — never collapses a real
    // certainty difference for the sake of brevity (Phase S §12).
    return mode === "short"
      ? `💸 ${billName}: short ${amt}.`
      : `💸 ${billName} (${amount}): hold spending under ${amt} today.`;
  }

  const opener = alreadyNudgedRecently
    ? "💸 Still tight —"
    : leadGently
      ? "💸 No pressure, but"
      : "💸 Heads up —";

  if (mode === "short") {
    const closer = preferDirect
      ? `Bring in ${amt} more before it's due, or move money to cover it.`
      : `A little more income this week, or one extra shift, covers it.`;
    return `${opener} you're ${amt} short for ${billName} (${amount}). ${closer}`;
  }

  const closer = preferDirect
    ? `Keep today's spending under ${amt}.`
    : `If you spend more than ${amt} today, it'll be short — worth holding back.`;
  return `${opener} ${billName} (${amount}) is coming up. ${closer}`;
}

export const billRiskTool: Tool = {
  name: "bill_risk",
  description:
    "When today's spending pace could make an upcoming (non-autopay) bill short, warn the user before it happens. At most one nudge per day.",
  parameters: {
    type: "object",
    properties: { billId: { type: "number" }, mode: { type: "string" }, threshold: { type: "number" } },
    required: ["billId"],
  },

  detect(tc: ToolContext): ToolInvocation[] {
    const today = new Date(tc.now).toISOString().slice(0, 10);
    const didToday = tc.ctx.handle.sqlite
      .prepare(`SELECT 1 FROM agent_logs WHERE space_id = ? AND action = 'tool:bill_risk' AND substr(created_at,1,10) = ?`)
      .get(tc.spaceId, today);
    if (didToday) return [];

    const budget = getBudgetSummary(tc.ctx.handle, tc.spaceId, new Date(tc.now));
    if (budget.reserved.length === 0) return []; // nothing reserved → nothing at risk

    // Only NON-autopay bills need a heads-up (autopay is assumed to clear).
    const autopay = new Map(new FinBillRepo(tc.ctx.handle, tc.spaceId).list().map((b) => [b.id, b.autopay]));
    const atRisk = budget.reserved.filter((r) => !autopay.get(r.billId))[0]; // earliest (reserved is due-sorted)
    if (!atRisk) return [];

    // Fire only when the cushion is genuinely thin: already short, OR safe-to-spend is smaller
    // than the bill itself (so a bit of overspending would break it).
    const tight = budget.shortfallCents > 0 || budget.safeToSpendCents <= atRisk.amountCents;
    if (!tight) return [];

    const days = Math.max(1, Math.round((parseDay(atRisk.dueDate).getTime() - parseDay(today).getTime()) / DAY_MS));
    if (budget.shortfallCents > 0) {
      return [{ tool: "bill_risk", args: { billId: atRisk.billId, mode: "short", threshold: budget.shortfallCents },
        reason: `short ${dollars(budget.shortfallCents)} for "${atRisk.name}" due ${atRisk.dueDate}` }];
    }
    const perDay = Math.floor(budget.safeToSpendCents / days);
    return [{ tool: "bill_risk", args: { billId: atRisk.billId, mode: "pace", threshold: perDay },
      reason: `tight cushion before "${atRisk.name}" due ${atRisk.dueDate}` }];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const billId = Number(args.billId);
    const bill = new FinBillRepo(tc.ctx.handle, tc.spaceId).get(billId);
    if (!bill) return { ok: false, summary: `bill ${billId} gone` };
    const mode = args.mode === "short" ? "short" : "pace";
    const threshold = Number(args.threshold ?? 0);

    // Phase S: the shared, read-only communication boundary — the SAME soul/behavior/
    // preference machinery Chat already consults on every turn. This is a background/
    // proactive call (not the chat hot path), so it explicitly opts into the full-space
    // emotional read (same precedent already established for the Digest panel's own
    // buildEmotionalTrajectory call) rather than the chat-only bounded variant.
    const comm = buildCommunicationContext(tc.ctx.handle, tc.spaceId, { includeFullSpaceEmotionalTrajectory: true });
    // A communication-only signal (not a detection signal — detect()'s own once-a-day guard
    // above is untouched): has this exact nudge already fired recently, so a repeat firing
    // can acknowledge that instead of re-explaining from scratch every time.
    const alreadyNudgedRecently = recentActionCount(tc.ctx.handle, tc.spaceId, "tool:bill_risk", 7, new Date(tc.now)) >= 1;

    // These never NAME the detected emotional pattern or claim a fact about the user (Phase S
    // §12) — they only soften HOW the same financial fact is delivered. A pattern already
    // requires real repeated evidence to exist at all (analysis/emotional.ts's own bar).
    const leadGently = comm.emotionalPatterns?.some((p) => p.type === "Stress cycle" || p.type === "Burnout risk" || p.type === "Downswing") ?? false;
    const preferConcise = comm.preferences.some((p) => p.signal === "verbosity" && /concise|brief|short/i.test(p.value));
    const preferDirect = comm.preferences.some((p) => p.signal === "directness" && /direct|blunt/i.test(p.value));

    const msg = buildBillRiskMessage({
      billName: bill.name,
      billAmountCents: bill.amountCents,
      mode,
      threshold,
      leadGently,
      preferConcise,
      preferDirect,
      alreadyNudgedRecently,
    });

    let delivered = false;
    try {
      await tc.notify(msg, {
        tool: "billRisk",
        billId,
        // Best-effort due date for urgency classification; policy treats
        // missing as non-urgent (safe default).
        billDueAt: (bill as { dueDate?: string }).dueDate,
      });
      delivered = true;
    } catch { /* router logs it regardless */ }
    if (delivered) {
      // IM-74 producer: the warning was issued — mirror it into the server
      // Inbox so it survives even when the Telegram send was the only copy.
      // Deduped per bill per UTC day, matching detect()'s once-a-day guard.
      // Best-effort: the nudge itself already happened.
      try {
        new NotificationsRepo(tc.ctx.handle, tc.spaceId).record({
          source: "bill-risk",
          text: msg,
          icon: "💸",
          priority: "high",
          dedupeKey: `bill-risk:${billId}:${new Date(tc.now).toISOString().slice(0, 10)}`,
        });
      } catch { /* inbox is a mirror, never a gate */ }
    }
    // Phase Z: the same `agent_logs.targets` convention Phase X established for goal_trend —
    // lets the Proactive → Chat handoff (analysis/proactiveContext.ts) resolve exactly which
    // bill this nudge concerned. Purely additive: detect()'s own once-a-day dedup gate is
    // untouched and unaffected by this field.
    return { ok: true, summary: `bill-risk nudge for "${bill.name}" (${mode})`, delivered, message: msg, targets: [billId] };
  },
};
