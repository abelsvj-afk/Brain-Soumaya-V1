import { useEffect, useRef, useState } from "react";
import type { Journey, JourneyLinkKind } from "@brain/shared";
import { getJourneys, journeysFor, suggestJourneys, linkToJourney, unlinkFromJourney } from "../api/journeys.js";
import { pushToast } from "./Toasts.js";

/**
 * Which Journeys an object belongs to + add/remove/suggest (Vision 2.0: everything
 * belongs to a Journey). Links only — the object itself is untouched. Hybrid
 * auto-link/suggest (docs/specs/journeys-connective-tissue.md): a strongly-matching
 * Journey (embedding similarity >=0.72, nodes only) links itself silently with a toast;
 * a moderate match (0.40-0.72, or any keyword-overlap match for finance rows) shows as
 * a one-tap "✨ Suggested" chip. Generalized from the original memory-only version — any
 * link kind the server validates (node/income/expense/bill/...) works here.
 */
export function JourneyChips({ kind, refId }: { kind: JourneyLinkKind; refId: number }) {
  const [mine, setMine] = useState<Journey[]>([]);
  const [all, setAll] = useState<Journey[]>([]);
  const [suggested, setSuggested] = useState<Journey[]>([]);
  const [adding, setAdding] = useState(false);
  // Journeys already auto-linked THIS mount — without this, a re-fetch after linking
  // would see the same autoLink candidate again (it's still the best match) and could
  // spam the link call / toast in a refresh loop.
  const autoLinkedRef = useRef<Set<number>>(new Set());

  const refresh = async () => {
    const [m, a, s] = await Promise.all([journeysFor(kind, refId), getJourneys(), suggestJourneys(kind, refId)]);
    const mineList = m ?? [];
    setMine(mineList);
    setAll(a ?? []);
    const mineIds = new Set(mineList.map((j) => j.id));
    const suggestions = s ?? { autoLink: [], suggested: [] };
    for (const cand of suggestions.autoLink) {
      if (mineIds.has(cand.journey.id) || autoLinkedRef.current.has(cand.journey.id)) continue;
      autoLinkedRef.current.add(cand.journey.id);
      void linkToJourney(cand.journey.id, kind, refId).then((ok) => {
        if (ok) {
          pushToast(`🧭 Linked to ${cand.journey.title}`, "🧭");
          void refresh();
        }
      });
    }
    setSuggested(suggestions.suggested.filter((s2) => !mineIds.has(s2.journey.id)).map((s2) => s2.journey));
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, refId]);

  const mineIds = new Set(mine.map((j) => j.id));
  const suggestedIds = new Set(suggested.map((j) => j.id));
  const addable = all.filter((j) => !mineIds.has(j.id) && !suggestedIds.has(j.id) && j.status !== "done");

  return (
    <div className="ni-journeys">
      <div className="ni-journeys-label">🧭 Journeys</div>
      <div className="ni-journeys-row">
        {mine.map((j) => (
          <span key={j.id} className="jn-chip on">
            {j.icon ?? "🧭"} {j.title}
            <button className="jn-chip-x" aria-label={`Remove from ${j.title}`}
              onClick={async () => {
                // REG-164/JN-07: a failed unlink used to fail silently (the
                // boolean result was discarded) — toast like the picker and
                // panel already do, so the user knows the chip didn't come off.
                const ok = await unlinkFromJourney(j.id, kind, refId);
                if (!ok) { pushToast("Couldn't remove that from the Journey — try again.", "⚠️", 3500); return; }
                await refresh();
              }}>×</button>
          </span>
        ))}
        {mine.length === 0 && suggested.length === 0 && !adding && <span className="ni-journeys-empty">Not part of a journey yet.</span>}
        {!adding && (all.length === 0
          ? <span className="ni-journeys-empty">Create a journey in the 🧭 tab first.</span>
          : addable.length > 0 && <button className="jn-chip add" onClick={() => setAdding(true)}>＋ Add</button>)}
      </div>
      {suggested.length > 0 && (
        <div className="ni-journeys-row ni-journeys-suggested">
          {suggested.map((j) => (
            <button key={j.id} className="jn-chip suggest" onClick={async () => {
              // REG-164/JN-07: check the link result — a failed tap used to
              // close nothing and say nothing.
              const ok = await linkToJourney(j.id, kind, refId);
              if (!ok) { pushToast("Couldn't link that — try again.", "⚠️", 3500); return; }
              await refresh();
            }}>
              ✨ {j.icon ?? "🧭"} {j.title}
            </button>
          ))}
        </div>
      )}
      {adding && (
        <div className="ni-journeys-add">
          {addable.map((j) => (
            <button key={j.id} className="jn-chip" onClick={async () => {
              // REG-164/JN-07: same failure honesty as the suggested chips.
              const ok = await linkToJourney(j.id, kind, refId);
              if (!ok) { pushToast("Couldn't link that — try again.", "⚠️", 3500); return; }
              setAdding(false);
              await refresh();
            }}>
              {j.icon ?? "🧭"} {j.title}
            </button>
          ))}
          <button className="jn-chip" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
