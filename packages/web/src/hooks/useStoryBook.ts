import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteStoryLink,
  getStoryBook,
  postStoryFind,
  postStoryRecall,
  putStoryLink,
  putStoryNote,
  type StoryBookData,
  type StoryLinkRow,
} from "../api/story.js";

const EMPTY: StoryBookData = { finds: [], links: [], notes: [] };

/**
 * The player's Book (docs/specs/lore-storage-2026-10-30.md). The server is the only authority: this hook sends EVENTS (a find, a link, a note, a recall) and re-reads the
 * Book afterwards. An unreachable server leaves the last-known Book on screen and never invents a find.
 */
export function useStoryBook(enabled: boolean = true) {
  const [book, setBook] = useState<StoryBookData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    const d = await getStoryBook();
    if (!alive.current) return;
    if (d) setBook(d);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const find = useCallback(
    async (entryId: string, source: string) => {
      const r = await postStoryFind(entryId, source);
      if (r) await reload();
      return r;
    },
    [reload],
  );
  const link = useCallback(
    async (a: string, b: string): Promise<StoryLinkRow | null> => {
      const r = await putStoryLink(a, b);
      if (r) await reload();
      return r;
    },
    [reload],
  );
  const unlink = useCallback(
    async (a: string, b: string) => {
      await deleteStoryLink(a, b);
      await reload();
    },
    [reload],
  );
  const saveNote = useCallback(
    async (entryId: string, note: string) => {
      const r = await putStoryNote(entryId, note);
      if (r) await reload();
      return !!r;
    },
    [reload],
  );
  const recall = useCallback(
    async (entryId: string) => {
      await postStoryRecall(entryId);
      await reload();
    },
    [reload],
  );
  return { book, loaded, reload, find, link, unlink, saveNote, recall };
}
