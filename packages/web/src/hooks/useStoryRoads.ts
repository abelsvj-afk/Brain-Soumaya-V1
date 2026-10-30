import { useCallback, useEffect, useRef, useState } from "react";
import { getStoryRoads, putStoryRoad, type RoadState } from "../api/story.js";

/**
 * The brain's side-road choices (docs/specs/story-roads-2026-10-31.md): which roads were taken, rested or finished. Progress along a road is derived from the
 * Book + meetings by the caller; the server only keeps these choices. Unreachable server = no roads shown, never an invented one.
 */
export function useStoryRoads(enabled: boolean = true) {
  const [states, setStates] = useState<Record<string, RoadState>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void getStoryRoads().then((rows) => {
      if (rows && alive.current) setStates(Object.fromEntries(rows.map((r) => [r.roadId, r.state])));
    });
  }, [enabled]);
  const set = useCallback(async (roadId: string, state: RoadState) => {
    const res = await putStoryRoad(roadId, state);
    if (res && alive.current) setStates((s) => ({ ...s, [res.road.roadId]: res.road.state }));
    return !!res;
  }, []);
  return { states, set };
}
