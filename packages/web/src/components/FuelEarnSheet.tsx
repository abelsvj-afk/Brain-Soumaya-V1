import type { Fuel } from "@brain/shared";

/**
 * "Ways to earn Fuel" — a tappable cheat-sheet you reach from the fuel gauge or the
 * low-fuel banner. Every active row is a real button that takes you straight to the
 * thing that earns it, so Fuel never feels mysterious or out of reach. The numbers
 * mirror the server economy (economy.ts) — keep them in sync.
 */

export type EarnKind = "memory" | "mind" | "thought" | "action" | "recall" | "codex";

interface Row {
  kind?: EarnKind; // present = actionable button; absent = passive/info row
  /** REG-053 (PG-10): the sheet covers the whole economy — earns and the
   *  user-directed spends. Rows default to the earn section. */
  section?: "earn" | "spend";
  icon: string;
  label: string;
  amount: string;
  hint: string;
}

const ROWS: Row[] = [
  { kind: "memory", icon: "＋", label: "Log a memory", amount: "+15", hint: "Your main income — dump a thought and she grows the galaxy." },
  { icon: "🔗", label: "Links you forge", amount: "+2 each", hint: "Every associative link on a logged memory pays +2." },
  { kind: "mind", icon: "🧠", label: "Add to your Mind", amount: "+6", hint: "A goal, person, skill, identity or idea — building your mind pays." },
  { kind: "action", icon: "✅", label: "Clear an action item", amount: "+3", hint: "Tick off a day-to-day to-do in the Agenda (one you didn't just create — real follow-through pays)." },
  { kind: "thought", icon: "💭", label: "Capture a thought", amount: "+2", hint: "Drop a fleeting thought into the mind space." },
  { kind: "recall", icon: "🧠", label: "Recall a fading memory", amount: "+3", hint: "Do a recall in the 🧠 Recall session — it also keeps your streak alive, +2 more the first time you tend your brain each day." },
  { icon: "🔥", label: "Daily streak", amount: "+2", hint: "Automatic the first time you tend your brain each day." },
  { kind: "codex", icon: "🔦", label: "Codex discoveries", amount: "+4", hint: "Your own galaxy states, discovered as you tend it — claimed the moment they're found, one-time per entry." },
  { icon: "🛰️", label: "Slow auto-refuel", amount: "+3.5/hr", hint: "The tank trickles back up on its own while you're away." },
  { section: "spend", icon: "🛠️", label: "Deep jobs (her research)", amount: "−2 each", hint: "Soumaya's autonomous deep-dive research & sector charting." },
  { section: "spend", icon: "🌡️", label: "Commission a warming", amount: "−25", hint: "Ask Soumaya to warm your coldest memories right now." },
  { section: "spend", icon: "🌀", label: "Warp between worlds", amount: "−10", hint: "One jump between spaces — drifting is always free." },
  { section: "spend", icon: "🚀", label: "Fast-flight burn", amount: "up to −5", hint: "Flying faster than free cruise speed burns a little fuel per burst." },
];

interface Props {
  fuel: Fuel | null;
  onAction: (kind: EarnKind) => void;
  onClose: () => void;
}

export function FuelEarnSheet({ fuel, onAction, onClose }: Props) {
  const pct = fuel ? Math.round((fuel.fuel / fuel.capacity) * 100) : 0;
  return (
    <div className="fuel-ways-backdrop" onClick={onClose}>
      {/* IM-11: entrance animation consistent with the other overlays (toast-in / obs-rise family). */}
      <div className="fuel-ways fuel-ways-enter" onClick={(e) => e.stopPropagation()}>
        <button className="fw-x" onClick={onClose} aria-label="Close">×</button>
        <div className="fw-head">
          <span className="fw-glyph">⛽</span>
          <div>
            <div className="fw-title">Ways to earn Fuel</div>
            {fuel && (
              <div className="fw-now">
                {Math.round(fuel.fuel)}/{fuel.capacity} · {pct}% — Soumaya spends it on Research Mode research & sector charting.
                {/* IM-11: the spend side, as a number — each autonomous job costs this much. */}
                <span className="fw-cost"> Each deep job costs {fuel.jobCost} Fuel.</span>
              </div>
            )}
          </div>
        </div>
        <div className="fw-rows">
          {ROWS.filter((r) => (r.section ?? "earn") === "earn").map((row) => (
            <div key={row.label} className={`fw-row${row.kind ? " actionable" : " passive"}`}>
              <span className="fw-ic">{row.icon}</span>
              <div className="fw-text">
                <span className="fw-label">{row.label}</span>
                <span className="fw-hint">{row.hint}</span>
              </div>
              <span className="fw-amount">{row.amount}</span>
              {row.kind && (
                <button className="fw-go" onClick={() => onAction(row.kind!)}>Go</button>
              )}
            </div>
          ))}
          <div className="fw-section" style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.75, margin: "0.6rem 0 0.3rem 0" }}>
            Ways to spend Fuel
          </div>
          {ROWS.filter((r) => r.section === "spend").map((row) => (
            <div key={row.label} className="fw-row passive">
              <span className="fw-ic">{row.icon}</span>
              <div className="fw-text">
                <span className="fw-label">{row.label}</span>
                <span className="fw-hint">{row.hint}</span>
              </div>
              <span className="fw-amount">{row.amount}</span>
            </div>
          ))}
        </div>
        <div className="fw-foot">Her core upkeep and the living galaxy never cost Fuel — only her ambitious extra work does.</div>
      </div>
    </div>
  );
}
