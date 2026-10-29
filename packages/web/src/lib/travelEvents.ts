/**
 * Travel events — how the separate pieces of the worlds layer hear about each other.
 *
 * The travel panel, the world scene layer and the world map each keep their own copy of the
 * travel state (useTravel). These window events are the only wiring between them. The server
 * stays the only authority; an event just says "go look again" or "the traveller asked for this".
 */

/** Fired after any travel ACTION settles. `detail.from` tags the sender so it can skip its own echo;
 *  `detail.action` says what happened. */
export const TRAVEL_CHANGED_EVENT = "worlds:travel-changed";

/** The traveller asked to look at the world they are in (the scene layer opens). */
export const ENTER_WORLD_EVENT = "worlds:enter";

export type TravelAction = "depart" | "cancel" | "turn-back" | "arrive";

export interface TravelChangedDetail {
  from?: string;
  action?: TravelAction;
}

export function announceTravelChanged(action: TravelAction, from?: string): void {
  window.dispatchEvent(new CustomEvent<TravelChangedDetail>(TRAVEL_CHANGED_EVENT, { detail: { from, action } }));
}

export function requestEnterWorld(): void {
  window.dispatchEvent(new Event(ENTER_WORLD_EVENT));
}
