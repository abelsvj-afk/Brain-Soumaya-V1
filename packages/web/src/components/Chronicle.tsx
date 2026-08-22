import { useEffect, useState } from "react";
import type { LoreEntry, LoreSubjectType } from "@brain/shared";
import { getLore, evolveLore } from "../api/client.js";

/**
 * An object's evolving, versioned lore. Shows the latest chapter, lets you expand
 * the full history (how its story changed over time), and "✦ Evolve" to append a
 * new chapter.
 */
export function Chronicle({
  subjectType,
  subjectId,
}: {
  subjectType: LoreSubjectType;
  subjectId: string;
}) {
  const [history, setHistory] = useState<LoreEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHistory([]);
    setOpen(false);
    let alive = true;
    getLore(subjectType, subjectId).then((h) => {
      if (alive) setHistory(h);
    });
    return () => {
      alive = false;
    };
  }, [subjectType, subjectId]);

  const current = history[history.length - 1];
  const older = history.slice(0, -1).reverse();

  const evolve = () => {
    setBusy(true);
    evolveLore(subjectType, subjectId)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <div className="chronicle">
      <div className="chronicle-head">
        <h3>Chronicle</h3>
        <button className="mini" onClick={evolve} disabled={busy} title="Write the next chapter">
          {busy ? "…" : "✦ Evolve"}
        </button>
      </div>
      {current ? (
        <p className="chronicle-now">{current.text}</p>
      ) : (
        <p className="empty small">Its story hasn't been written yet.</p>
      )}
      {older.length > 0 && (
        <>
          <button className="chronicle-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide earlier chapters" : `Earlier chapters (${older.length})`}
          </button>
          {open && (
            <ol className="chronicle-history">
              {older.map((e) => (
                <li key={e.id}>
                  <span className="chronicle-v">ch.{e.version}</span> {e.text}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
