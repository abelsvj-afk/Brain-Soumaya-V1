import { useCallback, useEffect, useRef, useState } from "react";
import { hourBand, npcGifts, pickNoticed } from "@brain/shared";
import { useStoryBook } from "./useStoryBook.js";
import { emitReveal } from "../lib/narrationBus.js";
import { getNarrationMode } from "../lib/narration.js";

/** How long a player has to stay still for the world to answer. One constant; same under reduced motion (it is time, not animation). */
export const NOTICE_MS = 4000;
const FIRST_DAY_KEY = "soumaya.story.first-day";

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * How a player comes to find things in the story (docs/lore/DRAFT_5_THE_WEB.md §2). Pure triggers live in shared/storyTriggers.ts; the SERVER validates every find against
 * them and the travel ledger — this hook only reports what the player did ("I stayed still here", "I met someone", "I found a relic") and reads the Book back.
 * Nothing is a timer the player can miss: the Hour only decides what a stillness turns up FIRST.
 */
export function useStoryNotice({
  active,
  world,
  notify,
}: {
  /** The worlds layer is showing a world (not the warp, not home). */
  active: boolean;
  world: string | null | undefined;
  notify: (text: string) => void;
}) {
  const sb = useStoryBook(active);
  const foundRef = useRef<Set<string>>(new Set());
  foundRef.current = new Set(sb.book.finds.map((f) => f.entryId));
  const findRef = useRef(sb.find);
  findRef.current = sb.find;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [noticing, setNoticing] = useState<"regard" | "listen" | null>(null);
  const [caption, setCaption] = useState("");
  const timer = useRef<number | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const report = useCallback(async (entryId: string, source: string): Promise<boolean> => {
    const r = await findRef.current(entryId, source);
    // If the player asked for the lore to be read to them, a new find opens in the Book and begins (the Book's own Listen otherwise).
    if (r?.isNew && getNarrationMode() === "on") emitReveal(entryId);
    return !!r?.isNew;
  }, []);

  const begin = useCallback(
    (how: "regard" | "listen") => {
      if (!world) return;
      if (timer.current !== null) {
        // Pressed again: the stillness is let go.
        clearTimer();
        setNoticing(null);
        setCaption("");
        return;
      }
      setNoticing(how);
      setCaption(how === "regard" ? "You stay still, and regard this place…" : "You stay still, and listen…");
      timer.current = window.setTimeout(async () => {
        timer.current = null;
        setNoticing(null);
        const id = pickNoticed(world, how, hourBand(new Date()), foundRef.current);
        if (!id) {
          setCaption("Nothing stirs. The world is as it was.");
          window.setTimeout(() => setCaption(""), 4500);
          return;
        }
        const isNew = await report(id, how);
        if (isNew) {
          setCaption("");
          notifyRef.current(how === "regard" ? "Something answered your stillness. It is kept in the Book." : "You heard something. It is kept in the Book.");
        } else {
          setCaption("Nothing stirs. The world is as it was.");
          window.setTimeout(() => setCaption(""), 4500);
        }
      }, NOTICE_MS);
    },
    [world, report],
  );

  // Leaving the world (or the layer) lets a held stillness go.
  useEffect(() => {
    if (!active || !world) {
      clearTimer();
      setNoticing(null);
      setCaption("");
    }
    return () => {
      clearTimer();
    };
  }, [active, world]);

  const onRelic = useCallback(
    async (relicId: string) => {
      if (await report(`relic.${relicId}`, "relic")) notifyRef.current("What you found has been added to the Book.");
    },
    [report],
  );

  const onMeeting = useCallback(
    async (npcId: string, meetings: number) => {
      for (const id of npcGifts(npcId, meetings, foundRef.current)) {
        if (await report(id, `npc:${npcId}`)) notifyRef.current("They gave you something to keep. It is in the Book.");
      }
    },
    [report],
  );

  // The stranger at the dock: once, on a harbour, on a later day than the first time the worlds were opened. Early and without ceremony.
  useEffect(() => {
    if (!active || world !== "great-station" || !sb.loaded || foundRef.current.has("companion.dock-1")) return;
    try {
      const first = localStorage.getItem(FIRST_DAY_KEY);
      if (!first) {
        localStorage.setItem(FIRST_DAY_KEY, localDay());
        return;
      }
      if (first === localDay()) return;
    } catch {
      return;
    }
    void report("companion.dock-1", "companion").then((isNew) => {
      if (isNew) notifyRef.current("Someone shared a cup with you on the dock. It is kept in the Book.");
    });
  }, [active, world, sb.loaded, report]);

  return { noticing, caption, begin, onRelic, onMeeting, loaded: sb.loaded };
}
