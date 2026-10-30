import { useCallback, useEffect, useRef, useState } from "react";
import { neutralFlavor, type FlavorKey } from "@brain/shared";
import { getStoryFlavor, putStoryFlavor } from "../api/story.js";

/**
 * How the story is voiced for this brain (docs/specs/story-flavor-engine-2026-10-30.md). Always returns a key: until the read lands, or if it fails, the neutral one (plain
 * wording, the whole canon). `setOn` is the opt-out switch. Flavour colours; it never changes what is there.
 */
export function useStoryFlavor(enabled: boolean = true): { flavor: FlavorKey; on: boolean; setOn: (on: boolean) => Promise<void> } {
  const [state, setState] = useState<{ flavor: FlavorKey; on: boolean }>(() => ({ flavor: neutralFlavor(), on: true }));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void getStoryFlavor().then((r) => {
      if (r && alive.current) setState({ flavor: r.key, on: r.on });
    });
  }, [enabled]);
  const setOn = useCallback(async (on: boolean) => {
    const r = await putStoryFlavor(on);
    if (r && alive.current) setState({ flavor: r.key, on: r.on });
  }, []);
  return { ...state, setOn };
}
