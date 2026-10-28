/**
 * Phase M first-launch framing (docs/specs/soumaya-product-audit.md, "no explanation of what
 * Soumaya/the companion/the Galaxy are"). Shown ONCE per space (gated by the caller via
 * localStorage, same pattern as the existing one-time Legend reveal in App.tsx) — a single,
 * short, dismissible card, not a multi-step tour. Copy is deliberately literal about what each
 * part actually does — no claim of omniscience, no implication the Galaxy holds everything.
 *
 * Phase AC.1 (docs/specs/soumaya-connective-tissue-onboarding.md): the audit found this screen
 * named "goals, money, people, and journeys" only in passing inside the first bullet — a new
 * user had no way to learn Money/Wealth, Life Vision, and Journeys are real, separate places to
 * go, not just words in a sentence. Added one more bullet naming them concretely, plus a link to
 * the full Help manual (`onSeeHelp`) for anyone who wants more than this one-screen framing —
 * deliberately NOT expanded into a tour or manual itself.
 */
import { SoumayaEye } from "./SoumayaEye.js";

export function WelcomeIntro({
  companionName,
  onClose,
  onSeeHelp,
}: {
  companionName: string;
  onClose: () => void;
  /** Optional: dismisses this card AND opens the existing Help manual in one tap.
   *  Omit to fall back to a plain dismiss (the button simply doesn't render). */
  onSeeHelp?: () => void;
}) {
  return (
    <div className="welcome-overlay" role="dialog" aria-label="Welcome to Soumaya" onClick={onClose}>
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        {/* IM-17: the card speaks galaxy visually too — a small star field,
            each dot a memory-as-star, matching its own copy below. */}
        <div className="welcome-stars" aria-hidden="true">
          {["✦", "·", "✦", "⭐", "·", "✦", "·", "✦"].map((s, i) => (
            <span key={i} className={`welcome-star ws-${i}`}>{s}</span>
          ))}
        </div>
        <h2>👋 Welcome</h2>
        <div className="welcome-eye"><SoumayaEye state="idle" mood="thoughtful" size={40} /></div>
        <ul className="welcome-list">
          <li>
            <b>Soumaya</b> is your personal Life + Financial Operating System — your memories,
            goals, money, people, and journeys, all connected in one place instead of scattered
            across separate apps.
          </li>
          <li>
            <b>{companionName}</b> is who you talk to. Ask her about anything you've told her —
            she reasons over what's actually in your galaxy, and says so plainly when something
            isn't in there yet.
          </li>
          <li>
            <b>The Galaxy</b> is the living map of it: each memory becomes a star, sized by how
            much it matters and linked to the goals, people, and money it relates to.
          </li>
          <li>
            <b>Money and Journeys</b> are real tabs, not just words — and Life Vision is a real section at the top of the Mind tab — track what you
            earn and owe, name what you're ultimately building toward, and group it all into the
            life chapters (journeys) it actually belongs to.
          </li>
          <li>
            <b>Capture</b> is how a memory becomes a star: tap ＋, dump a thought, and it lands in
            your galaxy, linked to what it relates to.
          </li>
        </ul>
        {onSeeHelp && (
          <button className="welcome-help-link" onClick={onSeeHelp}>
            📖 Show me the full map in Help
          </button>
        )}
        <button className="welcome-start" onClick={onClose}>Let's go →</button>
      </div>
    </div>
  );
}
