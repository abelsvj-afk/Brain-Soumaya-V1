import { STORY_BANNED } from "./story.js";

/**
 * Side roads (docs/specs/story-roads-2026-10-31.md): a road only NAMES an order of things the app already sees — finds and meetings. Progress is derived from
 * those; nothing here scores, counts or can be lost, and a later find reached early just leaves the road waiting at the earlier line.
 */
export type RoadSignal = { find: string } | { meet: string; min: number };

export interface RoadStep {
  id: string;
  line: string;
  signal: RoadSignal;
}

export interface StoryRoad {
  id: string;
  world: string;
  /** Cast id of whoever offers it; a road is offered once they have been met. */
  giver: string;
  title: string;
  offer: string;
  steps: readonly RoadStep[];
  gift: string;
}

const S = (id: string, line: string, signal: RoadSignal): RoadStep => ({ id, line, signal });
const find = (entryId: string): RoadSignal => ({ find: entryId });
const meet = (npc: string, min = 1): RoadSignal => ({ meet: npc, min });

export const STORY_ROADS: readonly StoryRoad[] = [
  {
    id: "road.door-closed", world: "great-station", giver: "hesk", title: "A Door Closed",
    offer: "A routine inspection. Walk the store-room with me; there is one door I keep shut, and I would rather you did not mention it to the Wayfarer.",
    steps: [
      S("locked-room", "Find the store-room where the belongings of the Faded are kept.", find("sight.locked-room")),
      S("soldier", "Notice what a Warden polishes when he thinks no one is looking.", find("obj.tin-soldier")),
    ],
    gift: "He keeps a key for a door that does not exist. He does not say whose it was.",
  },
  {
    id: "road.seventh-berth", world: "great-station", giver: "wim", title: "The Seventh Berth",
    offer: "The berth-log will not reconcile. One mooring is paid every year and never used. Help me find who pays it?",
    steps: [
      S("payments", "Read the log of a berth where no ship has ever tied.", find("obj.anonymous-payments")),
      S("missing", "Find the number the harbor does not say.", find("sight.missing-berth")),
    ],
    gift: "He gives you the slip to keep. It has no name on it, and he is relieved to be rid of it.",
  },
  {
    id: "road.wayfarers-patch", world: "great-station", giver: "wayfarer", title: "What the Wayfarer Left in the Coat",
    offer: "A patch has come loose. Hold it while I rest, will you? It belongs to someone who has not come yet.",
    steps: [
      S("nail", "See the nail he set in the door at the foot of the harbor.", find("obj.doorkeepers-nail")),
      S("lamp", "Find the lamp at the gate-post that no berth lists.", find("sight.gatepost-lamp")),
    ],
    gift: "The patch is the colour of someone who has not arrived.",
  },
  {
    id: "road.tall-tale", world: "people", giver: "ossian", title: "The Tall Tale's Second Verse",
    offer: "I will tell you a story with one thing wrong in it. Find what.",
    steps: [
      S("ribbon", "Find the ribbon someone tied a day ahead of you.", find("obj.follower-ribbon")),
      S("again", "Hear him tell it once more, and listen for the same wrong detail.", meet("ossian", 2)),
    ],
    gift: "He grins. The wrong thing was in every telling, and it was always the same wrong thing.",
  },
  {
    id: "road.cartographers-margin", world: "scale", giver: "ilsabet", title: "The Cartographer's Margin",
    offer: "I am drawing a lane past the seam. I need someone to stand where I cannot.",
    steps: [
      S("lane", "Find the lane on her chart that goes nowhere.", find("sight.lane-to-nowhere")),
      S("again", "Bring her what you saw.", meet("ilsabet", 2)),
    ],
    gift: "She redraws the lane a little farther. She does not say where it ends.",
  },
  {
    id: "road.open-alcove", world: "quiet-archive", giver: "archivist", title: "The Open Alcove",
    offer: "Do not fill the alcove. Only stand where it can be seen, and tell me what you hear.",
    steps: [
      S("alcove", "Stand where the open alcove can be seen.", find("sight.open-alcove")),
      S("rest", "Wait until the alcove has someone resting in it.", find("sight.aldous-at-rest")),
    ],
    gift: "She thanks you for leaving it open.",
  },
  {
    id: "road.hymn-that-rests", world: "quiet-archive", giver: "cantor", title: "The Hymn That Rests",
    offer: "Come to the edge of the quiet at night. I will not ask you to sing.",
    steps: [
      S("edge", "Sit at the pale wall past the last lamp.", find("sight.ysmerel-at-the-edge")),
      S("hum", "Stay until she gives the one note.", find("sight.ysmerels-hum")),
    ],
    gift: "That is the shape of it, she says. The Choir will keep a breath for you.",
  },
  {
    id: "road.penitents-shelf", world: "quiet-archive", giver: "archivist", title: "The Penitent's Shelf",
    offer: "One shelf is out of order by a single book. I will not read it to place it. Will you read only the spine?",
    steps: [
      S("fold", "Find the letter she keeps and has never opened.", find("relic.unopened-fold")),
    ],
    gift: "She does not look at where you put it. The letter rests with her, thanked.",
  },
  {
    id: "road.last-knot", world: "scale", giver: "surveyor", title: "The Last Knot",
    offer: "Hold this end of the cord while I measure the old station. There is a knot in it that I was told never to tie.",
    steps: [
      S("cord", "Find the cord that measured what was lost.", find("obj.measurers-cord")),
      S("again", "Hold the cord for her once more.", meet("surveyor", 2)),
    ],
    gift: "She names the untied knot, and tells you not to tie it. The knot waits.",
  },
  {
    id: "road.buttons", world: "people", giver: "tamsin", title: "Buttons",
    offer: "I found a button in the ward and cannot think whose it is. Would you ask?",
    steps: [
      S("ward", "Find the ward where the cots are made up.", find("sight.tamsins-ward")),
      S("laugh", "Stay until a patient laughs.", find("sight.ruels-laugh")),
    ],
    gift: "Every patient says the button is not theirs. She puts it in her pocket with the others.",
  },
  {
    id: "road.coat-in-a-locked-room", world: "great-station", giver: "hesk", title: "A Coat in a Locked Room",
    offer: "There is a coat in the store-room I cannot place. Tell me if you meet anyone who describes one.",
    steps: [
      S("coat", "Find the coat on its hook.", find("obj.linnets-coat")),
      S("drawing", "Find the drawing of a woman in it.", find("obj.kiths-drawing")),
    ],
    gift: "He listens to what the child drew, and says nothing, and sets down the soldier he was polishing.",
  },
  {
    id: "road.ledger-of-the-planets", world: "great-station", giver: "broker", title: "A Blank Line",
    offer: "Every page of the Great Book ends in one empty line. The binder calls it a printing error. Would you look at it for me?",
    steps: [
      S("page", "Find the page that owes one unrecorded.", find("obj.dorrows-page")),
      S("line", "Find the line no one writes on.", find("obj.blank-line")),
    ],
    gift: "He does not ask what you saw. He turns the page, and his pen waits a moment longer than it needs to.",
  },
  {
    id: "road.letters-late", world: "deep-past", giver: "pell", title: "Letters That Arrive Late",
    offer: "Leave a note at the stair post. It will have been read before you wrote it.",
    steps: [
      S("ribbon", "Find the ribbon tied a day ahead of you.", find("obj.follower-ribbon")),
      S("star", "Find the star whose light is late.", find("sight.hung-star")),
    ],
    gift: "She is, for once, not behind. She nods as though she had been waiting.",
  },
  {
    id: "road.seed-without-a-name", world: "growing-place", giver: "keeper", title: "Do Not Water What You Cannot Name",
    offer: "The seed has not sprouted. Bring me a name for it, any name, and I will tell you if it is the one.",
    steps: [
      S("seed", "Find the seed that was planted by a person.", find("relic.witness-seed")),
      S("winter", "Find the corner where it is always a little winter.", find("sight.marens-winter")),
    ],
    gift: "It is not the name, she says, and she is glad you tried. She goes on tending it.",
  },
  {
    id: "road.berth-count", world: "great-station", giver: "wim", title: "The Berth Count",
    offer: "Three of us count the berths and get three answers. Would you carry what each of us says to the next?",
    steps: [
      S("ring", "Find the ring whose berth is paid every year.", find("relic.mooring-ring")),
      S("payments", "Read the log of the berth where no ship has ever tied.", find("obj.anonymous-payments")),
      S("page", "Find the page the Ledger keeps for the unrecorded.", find("obj.dorrows-page")),
    ],
    gift: "Each of the three is right about one thing. None of them is wrong.",
  },
  {
    id: "road.soup-for-the-ward", world: "faded-ward", giver: "tamsin", title: "Soup for the Ward",
    offer: "Carry the bowl down the rows with me tonight. Say nothing. Listen.",
    steps: [
      S("bowl", "Find the bowl that stays warm.", find("obj.ward-bowl")),
      S("hum", "Listen over the cots until something hums back.", find("echo.ward-hum")),
    ],
    gift: "She takes the bowl from you and sets it down where it was. She does not say what you heard, and neither do you.",
  },
];

export const STORY_ROAD_BY_ID: ReadonlyMap<string, StoryRoad> = new Map(STORY_ROADS.map((r) => [r.id, r]));

export interface RoadContext {
  found: ReadonlySet<string>;
  meetings: Readonly<Record<string, number>>;
}

export function signalTrue(s: RoadSignal, ctx: RoadContext): boolean {
  return "find" in s ? ctx.found.has(s.find) : (ctx.meetings[s.meet] ?? 0) >= s.min;
}

export interface RoadView {
  /** Lines already walked, in order. */
  past: readonly string[];
  /** The line the road is waiting at, or null when finished. */
  current: string | null;
  done: boolean;
}

/** Ordered: a step counts only when every earlier one does. */
export function roadView(road: StoryRoad, ctx: RoadContext): RoadView {
  const past: string[] = [];
  for (const step of road.steps) {
    if (!signalTrue(step.signal, ctx)) return { past, current: step.line, done: false };
    past.push(step.line);
  }
  return { past, current: null, done: true };
}

/** Offered once the giver has been met at least once. */
export function roadOffered(road: StoryRoad, ctx: RoadContext): boolean {
  return (ctx.meetings[road.giver] ?? 0) >= 1;
}

export function checkStoryRoads(roads: readonly StoryRoad[], entryIds: ReadonlySet<string>, castIds: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const r of roads) {
    if (seen.has(r.id)) issues.push(`duplicate road ${r.id}`);
    seen.add(r.id);
    if (!castIds.has(r.giver)) issues.push(`${r.id}: giver ${r.giver} is not in the cast`);
    if (r.steps.length < 1) issues.push(`${r.id}: no steps`);
    const stepIds = new Set<string>();
    const texts = [r.title, r.offer, r.gift];
    for (const st of r.steps) {
      if (stepIds.has(st.id)) issues.push(`${r.id}: duplicate step ${st.id}`);
      stepIds.add(st.id);
      texts.push(st.line);
      if ("find" in st.signal && !entryIds.has(st.signal.find)) issues.push(`${r.id}/${st.id}: unknown entry ${st.signal.find}`);
      if ("meet" in st.signal && !castIds.has(st.signal.meet)) issues.push(`${r.id}/${st.id}: unknown person ${st.signal.meet}`);
    }
    for (const t of texts) {
      if (/\d/.test(t)) issues.push(`${r.id}: a digit in "${t.slice(0, 30)}…"`);
      for (const re of STORY_BANNED) if (re.test(t)) issues.push(`${r.id}: banned wording in "${t.slice(0, 30)}…"`);
    }
  }
  return issues;
}
