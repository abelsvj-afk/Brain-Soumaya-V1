import { useState } from "react";
import type { GraphNode } from "@brain/shared";
import { askChat, deleteNode, ingestText } from "../api/client.js";
import { linkToJourney } from "../api/journeys.js";
import type { GardenGrove } from "../graph/gardenLayout.js";

/**
 * Garden v2, step 3 — the grove sheet (docs/specs/growing-place-v2-2026-10-29.md).
 * Opens when Soumaya's ship arrives at a Journey's grove. Everything here
 * is a real brain action through an existing route — no new contracts:
 * - Tend a mission: completing it is the same DELETE the rest of the app
 *   uses, which already credits the Journey (IM-140) — the grove tree grows.
 * - Plant a next step: a new action item (it waits 30 days, the longest an
 *   action may) linked to this Journey as a task.
 * - Place a memory: the memory she is carrying is linked to this Journey.
 * - Ask Soumaya here: chat scoped to this Journey's memories.
 * A failed save keeps the sheet open with the words intact (never punish).
 */

/** A planted step waits this long (ingest's max for an action item). */
export const PLANTED_STEP_TTL_HOURS = 24 * 30;

export function GardenGroveSheet({
  grove,
  missions,
  memories,
  carrying,
  onClose,
  onChanged,
  onPlaced,
}: {
  grove: GardenGrove;
  /** The grove's open missions (action nodes linked to it). */
  missions: GraphNode[];
  /** The grove's linked memories shown in it. */
  memories: GraphNode[];
  /** The memory her ship is carrying, if any — it can be placed here. */
  carrying: GraphNode | null;
  onClose: () => void;
  /** Something changed in the brain; re-read it (new node ids, if any). */
  onChanged: (newNodeIds?: number[]) => void;
  /** The carried memory was placed here. */
  onPlaced: () => void;
}) {
  const [step, setStep] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save — try again.");
    } finally {
      setBusy(null);
    }
  };

  const completeMission = (m: GraphNode) =>
    run(`done-${m.id}`, async () => {
      const r = await deleteNode(m.id);
      setDoneIds((prev) => new Set(prev).add(m.id));
      const credited = r.journeyProgress?.find((p) => p.journeyId === grove.journeyId);
      setNote(
        credited
          ? `“${m.label}” done — the ${grove.title} tree grows (${credited.missionsCompleted} done).`
          : `“${m.label}” done.`,
      );
      onChanged();
    });

  const plant = () =>
    run("plant", async () => {
      const text = step.trim();
      if (!text) return;
      const r = await ingestText(text, { kind: "action", ttlHours: PLANTED_STEP_TTL_HOURS });
      const node = r.nodes[0];
      if (!node) throw new Error("The step didn't plant — try again.");
      await linkToJourney(grove.journeyId, "task", node.id);
      setStep("");
      setNote(`Planted “${node.label}” — it waits here for 30 days.`);
      onChanged([node.id]);
    });

  const place = () =>
    run("place", async () => {
      if (!carrying) return;
      await linkToJourney(grove.journeyId, "node", carrying.id);
      setNote(`“${carrying.label}” now rests in ${grove.title}.`);
      onPlaced();
      onChanged();
    });

  const ask = () =>
    run("ask", async () => {
      const q = question.trim();
      if (!q) return;
      const r = await askChat(q, [], grove.journeyId);
      setAnswer(r.answer);
    });

  const status =
    grove.status === "paused" ? "Resting under mist" : grove.status === "done" ? "Completed" : "Growing";
  const open = missions.filter((m) => !doneIds.has(m.id));

  return (
    <div className="garden-sheet" role="dialog" aria-label={`${grove.title} grove`}>
      <div className="garden-sheet-head">
        <div>
          <h3>
            {grove.icon ?? "🌳"} {grove.title}
          </h3>
          <p>
            {status} · {grove.missionsCompleted} mission{grove.missionsCompleted === 1 ? "" : "s"} done
            {grove.unshown > 0 ? ` · ${grove.unshown} more linked than fit here` : ""}
          </p>
        </div>
        <button type="button" className="mini" onClick={onClose} aria-label="Close grove">
          ✕
        </button>
      </div>

      {note && <p className="garden-sheet-note" role="status">{note}</p>}
      {error && <p className="garden-sheet-error" role="alert">{error}</p>}

      {carrying && (
        <section>
          <h4>🧺 You're carrying a memory</h4>
          <p className="garden-sheet-quiet">{carrying.label}</p>
          <button type="button" onClick={() => void place()} disabled={busy !== null}>
            Place it in {grove.title}
          </button>
        </section>
      )}

      <section>
        <h4>🌱 Missions</h4>
        {open.length === 0 ? (
          <p className="garden-sheet-quiet">No open missions — plant a next step below.</p>
        ) : (
          <ul>
            {open.map((m) => (
              <li key={m.id}>
                <span>{m.label}</span>
                <button type="button" onClick={() => void completeMission(m)} disabled={busy !== null}>
                  ✓ Done
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>🌰 Plant a next step</h4>
        <div className="garden-sheet-row">
          <input
            value={step}
            onChange={(e) => setStep(e.target.value)}
            placeholder="What's the next small step?"
            aria-label="Next step"
            maxLength={300}
            onKeyDown={(e) => {
              if (e.key === "Enter") void plant();
            }}
          />
          <button type="button" onClick={() => void plant()} disabled={busy !== null || !step.trim()}>
            Plant
          </button>
        </div>
      </section>

      <section>
        <h4>💬 Ask Soumaya about {grove.title}</h4>
        <div className="garden-sheet-row">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What's my next step?"
            aria-label={`Ask Soumaya about ${grove.title}`}
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
            }}
          />
          <button type="button" onClick={() => void ask()} disabled={busy !== null || !question.trim()}>
            {busy === "ask" ? "…" : "Ask"}
          </button>
        </div>
        {answer && <p className="garden-sheet-answer">{answer}</p>}
      </section>

      {memories.length > 0 && (
        <section>
          <h4>🪨 Memories resting here</h4>
          <ul className="garden-sheet-memories">
            {memories.map((m) => (
              <li key={m.id}>{m.label}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
