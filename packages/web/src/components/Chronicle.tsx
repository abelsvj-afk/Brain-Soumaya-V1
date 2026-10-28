import { useCallback, useEffect, useState } from "react";
import type { LoreEntry, LoreSubjectType } from "@brain/shared";
import { getLoreStrict, evolveLore } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { parseTolerantMs } from "../utils/dueReminders.js";

/**
 * An object's evolving, versioned lore. Shows the latest chapter, lets you expand
 * the full history (how its story changed over time), and "✦ Evolve" to append a
 * new chapter.
 *
 * Truthful states (IM-31): loading, failure, and genuinely-empty are three
 * different renders. Loading shows a skeleton (IM-29); failure shows an error
 * with Retry and NEVER the "hasn't been written yet" copy; only a successful
 * empty load shows the empty text. Chapters carry their trigger (what caused
 * them) and their local date (IM-35).
 */

/** Local date for a lore chapter; a stored value that won't parse becomes a
 *  human placeholder, never the raw storage string (same rule as IM-33). */
export function fmtLoreWhen(raw: string): string {
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "date unavailable";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** REG-109: chapter triggers are internal vocabulary (genesis, manual, …) —
 *  render each as a plain-language cause. Unknown future tokens get a human
 *  fallback (split + lowercased), never the raw token; an empty value reads
 *  as a plain "updated". */
export function fmtLoreTrigger(trigger: string): string {
  const known: Record<string, string> = {
    genesis: "her first telling",
    manual: "you asked for a new chapter",
    revised: "revised as beliefs changed",
    merged: "merged from related chapters",
    linked: "linked to new memories",
    evolved: "grew from new memories",
  };
  const hit = known[trigger];
  if (hit) return hit;
  const humanized = trigger
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return humanized || "updated";
}

function ChapterMeta({ entry }: { entry: LoreEntry }) {
  return (
    <span className="chronicle-meta">
      {" · "}
      {fmtLoreTrigger(entry.trigger)} · {fmtLoreWhen(entry.createdAt)}
    </span>
  );
}

export function Chronicle({
  subjectType,
  subjectId,
}: {
  subjectType: LoreSubjectType;
  subjectId: string;
}) {
  const [history, setHistory] = useState<LoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    return getLoreStrict(subjectType, subjectId)
      .then((h) => setHistory(h))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [subjectType, subjectId]);

  useEffect(() => {
    setHistory([]);
    setOpen(false);
    let alive = true;
    setLoading(true);
    setLoadError(false);
    getLoreStrict(subjectType, subjectId)
      .then((h) => {
        if (alive) setHistory(h);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
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
      .then((h) => {
        setHistory(h);
        setLoadError(false);
      })
      .catch(() => pushToast("Couldn't write the next chapter — try again.", "⚠️", 3500))
      .finally(() => setBusy(false));
  };

  return (
    <div className="chronicle">
      <div className="chronicle-head">
        <h3>Chronicle</h3>
        <button className="mini" onClick={evolve} disabled={busy || loading} title="Write the next chapter">
          {busy ? "…" : "✦ Evolve"}
        </button>
      </div>
      {loading ? (
        <div className="chronicle-skeleton" role="status" aria-label="Loading chronicle">
          <span className="skeleton-line" />
          <span className="skeleton-line short" />
        </div>
      ) : loadError ? (
        <div className="chronicle-error" role="alert">
          <p className="empty small">Couldn’t load its story — the chronicle didn’t answer.</p>
          <button className="mini" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : current ? (
        <>
          <p className="chronicle-now">{current.text}</p>
          <p className="chronicle-current-meta">
            <span className="chronicle-v">ch.{current.version}</span>
            <ChapterMeta entry={current} />
          </p>
        </>
      ) : (
        <p className="empty small">Its story hasn't been written yet.</p>
      )}
      {!loading && !loadError && older.length > 0 && (
        <>
          <button className="chronicle-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide earlier chapters" : `Earlier chapters (${older.length})`}
          </button>
          {open && (
            <ol className="chronicle-history">
              {older.map((e) => (
                <li key={e.id}>
                  <span className="chronicle-v">ch.{e.version}</span> {e.text}
                  <ChapterMeta entry={e} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
