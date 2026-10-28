import { agoPlain } from "../npcs/harbor.js";
import type { ScoutFacts } from "./repo.js";

/**
 * Scouting reports: a plain-words observation of a true fact, never
 * a fabrication, never urgency. Every sentence here comes from the
 * facts the server verified — the travel ledger and the world's own
 * server-side count. A world with no count reports only its journeys;
 * the report says what the fleet saw and nothing more.
 *
 * The Growing Place and Deep Past are not mission destinations
 * (AD4), so they have no sentences here — a report never names a
 * world the fleet cannot visit.
 */

const WORLD_NAMES: Record<string, string> = {
  home: "Home",
  "great-station": "the Great Station",
  people: "the People",
  "quiet-archive": "Quiet/Archive",
  scale: "Scale",
};

function worldName(key: string): string {
  return WORLD_NAMES[key] ?? key;
}

/** One scouting report, in plain words, from verified facts only. */
export function buildScoutingReport(destination: string, facts: ScoutFacts, nowMs: number): string {
  const name = worldName(destination);
  const lines: string[] = [];

  if (facts.arrivals === 0) {
    lines.push(`No journey of yours has arrived at ${name} yet.`);
  } else if (facts.arrivals === 1 && facts.lastArrivalMs !== null) {
    lines.push(`One journey of yours has arrived at ${name} — the last came ${agoPlain(facts.lastArrivalMs, nowMs)}.`);
  } else if (facts.lastArrivalMs !== null) {
    lines.push(
      `${facts.arrivals} journeys of yours have arrived at ${name} — the last came ${agoPlain(facts.lastArrivalMs, nowMs)}.`,
    );
  }

  if (facts.worldCount !== null && facts.worldCountLabel !== null) {
    const n = facts.worldCount;
    lines.push(
      n === 1
        ? `It holds 1 ${singularLabel(destination, facts.worldCountLabel)}.`
        : `It holds ${n} ${facts.worldCountLabel}.`,
    );
  }
  if (facts.arrivalsToday !== null && facts.inbound !== null) {
    const today =
      facts.arrivalsToday === 0
        ? "No journeys have arrived here today."
        : facts.arrivalsToday === 1
          ? "One journey has arrived here today."
          : `${facts.arrivalsToday} journeys have arrived here today.`;
    const inbound =
      facts.inbound === 0
        ? "Nothing is on its way in."
        : facts.inbound === 1
          ? "One journey is on its way in."
          : `${facts.inbound} journeys are on their way in.`;
    lines.push(`${today} ${inbound}`);
  }
  if (facts.peopleCount !== null) {
    lines.push(
      facts.peopleCount === 1
        ? "One person is gathered here."
        : `${facts.peopleCount} people are gathered here.`,
    );
  }

  lines.push("That is what the fleet saw — nothing more, nothing added.");
  return lines.join(" ");
}

/** The singular of a count label, for the one-item sentence. Only the
 *  labels this builder emits are listed — an unknown label reads as
 *  itself rather than a guessed singular. */
function singularLabel(destination: string, label: string): string {
  if (destination === "quiet-archive") return "thing resting";
  return label;
}
