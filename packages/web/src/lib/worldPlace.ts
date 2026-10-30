import { useEffect, useState } from "react";

/**
 * Where the traveller is RIGHT NOW, as the screen shows it — fed by the worlds layer (the only thing that
 * knows what it is drawing). The Observatory and the welcome card read it so their words match the place
 * (docs/specs/owner-feedback-2026-10-30-place-truth-welcome.md). `world` is null at home.
 */
export const WORLD_PLACE_EVENT = "worlds:surface-visible";
/** Ask the worlds layer to take the traveller home (the same warp as its "← Galaxy" button). */
export const GO_HOME_EVENT = "worlds:go-home";

export interface WorldPlace {
  /** The world key being shown, or null in the home galaxy. */
  world: string | null;
  /** In the warp between places. */
  transit: boolean;
}

export const HOME_PLACE: WorldPlace = { world: null, transit: false };

export function announcePlace(visible: boolean, place: WorldPlace): void {
  window.dispatchEvent(new CustomEvent(WORLD_PLACE_EVENT, { detail: { visible, ...place } }));
}

export function requestGoHome(): void {
  window.dispatchEvent(new Event(GO_HOME_EVENT));
}

export function useWorldPlace(): WorldPlace {
  const [place, setPlace] = useState<WorldPlace>(HOME_PLACE);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ visible?: boolean; world?: string | null; transit?: boolean }>).detail;
      if (!d?.visible) setPlace(HOME_PLACE);
      else setPlace({ world: d.world ?? null, transit: !!d.transit });
    };
    window.addEventListener(WORLD_PLACE_EVENT, on);
    return () => window.removeEventListener(WORLD_PLACE_EVENT, on);
  }, []);
  return place;
}
