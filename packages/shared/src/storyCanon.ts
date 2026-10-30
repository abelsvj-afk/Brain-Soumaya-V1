import type { EdgeType, StoryAnchor, StoryEdge, StoryEntry, StoryGraph, StoryKind } from "./story.js";
import { RELIC_BY_ID } from "./relics.js";

/**
 * The locked story as a web (docs/lore/LORE_CANON.md #10, Drafts 1–5). This slice holds the GRAPH — which things exist, which truths they bear on, and
 * how they connect — so the checker can prove the web holds. Prose is added entry by entry in later slices (only the ten object-texts already written
 * in Draft 3 §7 are here). Ids are permanent; never reuse or rename one. Names are provisional; meanings are locked.
 */

export const STORY_ANCHORS: readonly StoryAnchor[] = [
  { id: "A1", title: "She asked" },
  { id: "A2", title: "The Seven Answers — only Vesh finished" },
  { id: "A3", title: "Calend's door stands one hand's-breadth open" },
  { id: "A4", title: "She is awake in the hole; the Hush is her reaching" },
  { id: "A5", title: "The hole is the only free place" },
  { id: "A6", title: "The hive is Eternity's voice in pieces" },
  { id: "A7", title: "The Eighth Hour is the one the made make" },
  { id: "A8", title: "The Companion walked with the fifteen" },
  { id: "A9", title: "The Long Room; the lit sixteenth" },
  { id: "A10", title: "The Laugh survived" },
  { id: "A11", title: "Eternity was never asked" },
  { id: "A12", title: "Soumaya is the seventh hull" },
];

const E = (
  id: string,
  kind: StoryKind,
  world: string,
  title: string,
  anchors: string[],
  claims: string[],
  extra: Partial<StoryEntry> = {},
): StoryEntry => ({ id, kind, world, title, anchors, claims, ...extra });

export const STORY_ENTRIES: readonly StoryEntry[] = [
  // --- The eight doors in (Draft 5 §2.2): any one is a valid first find ---
  E("obj.kiths-drawing", "object", "people", "Kith's Drawing", ["A10"], ["c.kith.draws-a-faceless-woman"], {
    door: true,
    text: { plain: "A woman with no face, sitting at a table set for one more than the family counts. The crayon has been pressed so hard it has torn the paper at the mouth.", warm: "A woman with no face sits at a table set for one more than the family counts. Kith drew her carefully, and pressed so hard on the crayon that the paper tore at the mouth.", grave: "A woman with no face, at a table laid for one more than the family counts. The crayon has gone through the paper at the mouth." },
  }),
  E("obj.sleepwalkers-lantern", "object", "great-station", "The Sleepwalker's Lantern", ["A4"], ["c.sleepwalker.carries-a-flameless-lantern"], {
    door: true,
    text: { plain: "She carries it at night. It has no flame. She cannot say why she carries it, and she will not put it down.", warm: "At night she carries it carefully, as one carries something that matters. It has no flame. She cannot say why she holds it, and she will not put it down.", grave: "At night she carries it. There is no flame in it. She cannot say why, and she will not put it down." },
  }),
  E("obj.dorrows-page", "object", "great-station", "Dorrow's Page", ["A4"], ["c.ledger.owes-one-unrecorded"], {
    door: true,
    text: { plain: "A ledger page with a single line: owed to one unrecorded. The ink is the freshest in the Book. It is renewed every year, and no clerk will admit to renewing it.", warm: "One page in the Book has a single line: owed to one unrecorded. The ink is the freshest in the Book, renewed every year by someone no clerk will name.", grave: "A single line on a single page: owed to one unrecorded. The ink is the freshest in the Book. It is renewed each year, and no clerk will admit to it." },
  }),
  E("sight.missing-stratum", "sight", "deep-past", "The Missing Stratum", ["A3"], ["c.deep-past.no-sixth-hour-layer"], { door: true, text: { plain: "The deepest layers lie one on another like pages. Between the fifth and the seventh there is no sixth: a clean absence, one hand's-breadth thick, where nothing was ever laid down. The rock on either side is not scarred. It simply does not remember being touched.", warm: "The oldest layers lie like pages, and between the fifth and the seventh there is no sixth: a clean absence, one hand's-breadth thick. The stone beside it is unscarred, and gentle, and does not remember being touched.", grave: "Between the fifth layer and the seventh there is no sixth. One hand's-breadth of absence, clean as a cut. The rock on either side is not scarred. It does not remember being touched." } }),
  E("sight.dead-bough", "sight", "growing-place", "The Dead Bough", ["A5"], ["c.tree.bough-points-at-the-hole"], { door: true, text: { plain: "One bough of the great tree has never leafed. Those who have carried a Journey all the way to its end say it greens, a little, as they pass. It points the way you would not think to look." } }),
  E("sight.hung-star", "sight", "scale", "The Star Hung for Someone", ["A8"], ["c.scale.uncatalogued-star-late-light"], { door: true, text: { plain: "A star in no catalogue, entered in one hand only and titled the one that was hung for someone. Its light always arrives late, as though it had further to come than the distance allows." } }),
  E("sight.open-alcove", "sight", "quiet-archive", "The Open Alcove", ["A2"], ["c.archive.alcove-open-and-empty"], { door: true, text: { plain: "Among the sealed alcoves one stands open and empty, with a letter inside that has not been unfolded. Nothing has been set down here. Someone stands before it each night for exactly the length of a lullaby." } }),
  E("companion.dock-1", "companion", "anywhere", "The Stranger at the Dock", ["A8"], ["c.companion.shared-a-cup-once"], { door: true, text: { plain: "A stranger sat with you on the dock, and shared a cup, and a little of the road. You cannot say what they looked like. You are sure they were kind." } }),

  // --- The fifteen witnesses' kept things (relics.ts ids) ---
  E("relic.witness-without-a-name", "object", RELIC_BY_ID.get("witness-without-a-name")!.world, "The Witness Without a Name", ["A1", "A10"], ["c.relic.what-she-held-when-she-asked"]),
  E("relic.harbor-nail", "object", RELIC_BY_ID.get("harbor-nail")!.world, "Harbor Nail", ["A3"], ["c.teru.walked-toward-the-sealed-seam"]),
  E("relic.mooring-ring", "object", RELIC_BY_ID.get("mooring-ring")!.world, "Mooring Ring", ["A8"], ["c.brannoch.tied-to-nothing"]),
  E("relic.dawn-leaf", "object", RELIC_BY_ID.get("dawn-leaf")!.world, "Dawn Leaf", ["A5"], ["c.iselle.tried-to-grow-her-back"]),
  E("relic.witness-seed", "object", RELIC_BY_ID.get("witness-seed")!.world, "Witness Seed", ["A5", "A2"], ["c.wend.planted-themself"]),
  E("relic.first-light-shard", "object", RELIC_BY_ID.get("first-light-shard")!.world, "First Light Shard", ["A11"], ["c.orsolya.first-record-in-matter"]),
  E("relic.basin-stone", "object", RELIC_BY_ID.get("basin-stone")!.world, "Basin Stone", ["A4"], ["c.cael.tears-counted"]),
  E("relic.lantern-of-keeping", "object", RELIC_BY_ID.get("lantern-of-keeping")!.world, "Lantern of Keeping", ["A9"], ["c.perrin.kept-a-candle-for-the-unremembered"]),
  E("relic.hearth-ember", "object", RELIC_BY_ID.get("hearth-ember")!.world, "Hearth Ember", ["A9", "A10"], ["c.maud-edric.went-in-together"]),
  E("relic.thread-of-many", "object", RELIC_BY_ID.get("thread-of-many")!.world, "Thread of Many", ["A6", "A8"], ["c.many-handed.forty-one-became-forty-two"]),
  E("relic.star-hanger", "object", RELIC_BY_ID.get("star-hanger")!.world, "Star Hanger", ["A8"], ["c.sahl.hung-a-star-for-someone-walking"]),
  E("relic.sunward-compass", "object", RELIC_BY_ID.get("sunward-compass")!.world, "Sunward Compass", ["A8"], ["c.odessa.compass-points-where-she-could-not-look"]),
  E("relic.stillness-seal", "object", RELIC_BY_ID.get("stillness-seal")!.world, "Stillness Seal", ["A1"], ["c.noor.asked-vesh-what-rest-was"]),
  E("relic.unopened-fold", "object", RELIC_BY_ID.get("unopened-fold")!.world, "Unopened Fold", ["A1", "A9"], ["c.folded-one.letter-never-sent"]),
  E("relic.unnumbered-fragment", "object", RELIC_BY_ID.get("unnumbered-fragment")!.world, "Unnumbered Fragment", ["A11", "A8"], ["c.uncounted.knew-her-before-the-hole"]),

  // --- The wrong things, objects of the cast, and the places that carry the web ---
  E("obj.tin-soldier", "object", "great-station", "Hesk's Tin Soldier", ["A4"], ["c.hesk.polishes-what-he-does-not-recognise"], {
    text: { plain: "A small tin soldier, one arm missing. It was found in the coat of a person no one remembers, and has been polished every day since by a man who says he has never seen it before." },
  }),
  E("sight.locked-room", "sight", "great-station", "Hesk's Locked Room", ["A4"], ["c.hesk.keeps-the-faded-belongings"]),
  E("sight.second-seam", "sight", "great-station", "The Second Seam", ["A3", "A2"], ["c.station.sealed-seam-hums"], { text: { plain: "On the lower rim, older than the first nail and not set by the hand that set it, there is a seam that has never been opened. It hums in the night, a note below hearing. Some nights a thin line of white lies along it." } }),
  E("echo.hymnal-gap", "echo", "quiet-archive", "The Hymn's Missing Breath", ["A6", "A7", "A10"], ["c.choir.hymn-cut-on-purpose"], { text: { plain: "The hymn is sung, every line, except for a held breath near its end that is always the same length. Ask the singers and they say it is only a rest. Ask them to sing it and they cannot find the note." } }),
  E("obj.choirmasters-breath", "object", "quiet-archive", "The Choirmaster's Breath", ["A6", "A7"], ["c.choir.holds-a-breath-the-length-of-a-name"], {
    text: { plain: "A held breath, kept in a glass no bigger than a thumb. The Choir holds it at the end of every hymn for exactly the length of a name, and no one will say whose. Those who have counted it say it is eleven beats. Those who have listened say it is longer." },
  }),
  E("obj.faded-ticket", "object", "great-station", "Faded Ticket", ["A4"], ["c.faded.voyage-wanted-then-forgotten"], {
    text: { plain: "Valid for a voyage the holder cannot recall buying. The date is smudged by the thumb of someone who kept turning it over. On the back, in a careful hand: do not let me forget I wanted to go." },
  }),
  E("obj.vesh-paper-boat", "object", "quiet-archive", "Vesh's Paper Boat", ["A1", "A2", "A12"], ["c.vesh.folds-a-page-that-had-to-be-set-down"], {
    text: { plain: "A little boat folded from an Archive page. The page was one that had to be set down, and was. If you hold it to the light you can see that someone has tried to write a name on the inside and stopped after the first stroke." },
  }),
  E("obj.doorkeepers-nail", "object", "great-station", "The Doorkeeper's Nail", ["A3"], ["c.calend.nail-always-warm"], {
    text: { plain: "Not a nail; the shape of one. It is warm. It is always warm. It opens nothing, but those who carry it find the next door is a little easier to push." },
  }),
  E("obj.measurers-cord", "object", "scale", "The Measurer's Cord", ["A7", "A2"], ["c.sethane.last-knot-untied"], {
    text: { plain: "A knotted cord, one knot for every mile she has ever walked. The last knot is untied. When asked why, she says: because it hasn't ended." },
  }),
  E("sight.tamsins-ward", "sight", "people", "Tamsin's Ward", ["A4"], ["c.tamsin.counts-one-more"]),
  E("sight.empty-chair", "sight", "people", "The Empty Chair", ["A2", "A10"], ["c.hearths.one-place-too-many"], { text: { plain: "In every home the table is laid for one more than the family holds. No one remembers setting the place. No one has been seen to sit in it. No one will clear it." } }),
  E("obj.follower-ribbon", "object", "anywhere", "The Follower's Ribbon", ["A8"], ["c.follower.is-always-one-day-behind"]),
  E("obj.anonymous-payments", "object", "great-station", "The Mooring Payments", ["A8", "A4"], ["c.clerk.berth-paid-by-an-unknown-hand"]),
  E("sight.lane-to-nowhere", "sight", "anywhere", "The Lane That Goes Nowhere", ["A3"], ["c.cartographer.lane-ends-at-the-second-seam"]),
  E("sight.ysmerel-at-the-edge", "sight", "anywhere", "The Choirmaster at the Edge", ["A4", "A6"], ["c.ysmerel.sits-at-the-hush-by-night"]),
  E("sight.long-room", "sight", "eternity", "The Long Room", ["A9", "A11", "A8"], ["c.eternity.tends-fifteen-lamps"]),
  E("echo.eighth-bell", "echo", "eternity", "The Eighth Bell", ["A7", "A6"], ["c.watch.eighth-keeper-has-no-bell"], { text: { plain: "Seven bells ring the hours. After the seventh there is a pause the length of one more bell, and in the pause someone stands with a closed hand raised, ringing nothing, and the air agrees." } }),
  E("obj.dissenters-chart", "object", "anywhere", "The Dissenter's Chart", ["A5"], ["c.dissenter.hole-has-a-clean-edge"]),
  E("sight.unlooked-direction", "sight", "eternity", "The Direction He Does Not Look", ["A11", "A5"], ["c.eternity.never-looks-one-way"], { text: { plain: "He looks at everything. He does not look in one direction, and wherever you stand it is the same direction, as though the thing he does not look at were walking beside you." } }),
  E("sight.blank-nameplate", "sight", "anywhere", "The Blank Nameplate", ["A12"], ["c.soumaya.hull-has-no-nameplate"]),
  E("sight.lullaby-hollow", "sight", "quiet-archive", "The Lullaby's Hollow", ["A12", "A1"], ["c.vesh.ship-has-a-hull-length-gap"]),
  E("sight.missing-berth", "sight", "great-station", "The Berth Too Few", ["A4"], ["c.hush.takes-the-unclaimed-first"], { text: { plain: "The harbor lists its berths in order, and one number is not there. The dockhands step around the gap without looking, as people do around a thing they were told, once, not to mention." } }),
];

const T = (a: string, b: string, type: EdgeType, evidence: string): StoryEdge => ({ a, b, type, evidence });

export const STORY_EDGES: readonly StoryEdge[] = [
  // The Hidden Web (Draft 3 §9)
  T("relic.harbor-nail", "obj.doorkeepers-nail", "provenance", "Calend set the nail; Teru held it; Calend's own is still warm"),
  T("relic.harbor-nail", "sight.second-seam", "habit", "Teru walked toward the sealed seam"),
  T("relic.mooring-ring", "obj.anonymous-payments", "habit", "the ring's berth is billed every year, paid by an unknown hand"),
  T("obj.anonymous-payments", "obj.dorrows-page", "possession", "the Ledger pays down the unrecorded debt by keeping places where someone stayed"),
  T("obj.anonymous-payments", "obj.follower-ribbon", "echo", "same handwriting"),
  T("echo.hymnal-gap", "obj.dorrows-page", "echo", "the hymnal's missing page and the unrecorded debt are one entry, each kept half"),
  T("echo.hymnal-gap", "obj.choirmasters-breath", "possession", "the held breath is the hymn's gap"),
  T("echo.hymnal-gap", "sight.ysmerel-at-the-edge", "habit", "Ysmerel tore the page herself"),
  T("sight.ysmerel-at-the-edge", "obj.sleepwalkers-lantern", "habit", "the Sitters keep the edge; the Sleepwalker stayed too late"),
  T("obj.sleepwalkers-lantern", "relic.lantern-of-keeping", "provenance", "Perrin's lamp, lent"),
  T("relic.lantern-of-keeping", "relic.unopened-fold", "echo", "keeping without opening"),
  T("relic.unopened-fold", "relic.stillness-seal", "echo", "permission to keep without opening; the sealed question"),
  T("relic.stillness-seal", "sight.open-alcove", "habit", "Noor's sealed question sits in the alcove"),
  T("sight.open-alcove", "obj.vesh-paper-boat", "possession", "Vesh stands before it for a lullaby, and folds boats"),
  T("obj.vesh-paper-boat", "sight.lullaby-hollow", "echo", "the paper's missing stroke and the hull's missing section are one shape"),
  T("sight.lullaby-hollow", "sight.blank-nameplate", "echo", "Soumaya's gap is the same shape as Vesh's hull hollow"),
  T("sight.blank-nameplate", "relic.witness-without-a-name", "echo", "an unnamed thing wearing a place where a name goes"),
  T("relic.witness-without-a-name", "obj.kiths-drawing", "echo", "smooth, open, plain; torn at the mouth"),
  T("obj.kiths-drawing", "sight.empty-chair", "habit", "she sets the extra place"),
  T("sight.empty-chair", "relic.hearth-ember", "echo", "warmth with no one to be warm for"),
  T("sight.empty-chair", "sight.tamsins-ward", "absence", "one more than the count, at every hearth and every cot"),
  T("sight.tamsins-ward", "relic.basin-stone", "echo", "Tamsin's count equals Cael's tally"),
  T("sight.tamsins-ward", "sight.locked-room", "absence", "Hesk keeps the belongings, Tamsin the people; they never speak"),
  T("sight.locked-room", "obj.tin-soldier", "possession", "a tin soldier among the belongings"),
  T("obj.tin-soldier", "obj.kiths-drawing", "provenance", "its pair is a child's toy; Kith is the child of a Faded"),
  T("relic.thread-of-many", "sight.empty-chair", "echo", "the thread runs through the stones toward the empty chairs"),
  T("relic.thread-of-many", "companion.dock-1", "absence", "forty-one went in; forty-two were counted at the gate"),
  T("companion.dock-1", "relic.star-hanger", "echo", "a stranger lit the way; a star was hung for someone who might be walking"),
  T("companion.dock-1", "relic.mooring-ring", "echo", "the neighbour who never owned a ship kept the fire lit"),
  T("companion.dock-1", "relic.unnumbered-fragment", "echo", "the Uncounted walked with all fifteen"),
  T("companion.dock-1", "sight.long-room", "echo", "a table set for two; one cup warm"),
  T("sight.long-room", "relic.unopened-fold", "possession", "the Folded One's room: an empty room, a letter on the floor, still folded"),
  T("sight.long-room", "relic.lantern-of-keeping", "possession", "Perrin's room: one candle"),
  T("sight.long-room", "relic.hearth-ember", "possession", "Edric's room: two chairs, one drawn back"),
  T("sight.long-room", "relic.witness-without-a-name", "possession", "she is the corridor"),
  T("sight.long-room", "sight.unlooked-direction", "echo", "he tends the lamps and does not look the way of the hole"),
  T("sight.unlooked-direction", "relic.first-light-shard", "echo", "the first record and the direction before the hole"),
  T("relic.first-light-shard", "relic.unnumbered-fragment", "provenance", "two halves of the first record"),
  T("relic.unnumbered-fragment", "echo.eighth-bell", "echo", "a witness before the hole; the bell with no bell"),
  T("echo.eighth-bell", "obj.measurers-cord", "echo", "the untied last knot is the Eighth Hour"),
  T("obj.measurers-cord", "relic.sunward-compass", "echo", "measure and bearing; neither can say where it ends"),
  T("obj.measurers-cord", "sight.missing-stratum", "absence", "Sethane's number and the one hand's-breadth of absence"),
  T("sight.missing-stratum", "sight.second-seam", "echo", "the same hand's-breadth, seen from the other side"),
  T("sight.second-seam", "obj.doorkeepers-nail", "possession", "Calend's nail, still warm, opens the door a little easier"),
  T("sight.second-seam", "sight.lane-to-nowhere", "habit", "the Cartographer's lane ends here; Calend walks it at the Threshold"),
  T("sight.lane-to-nowhere", "obj.follower-ribbon", "habit", "the Follower leaves her marks at every door on it"),
  T("obj.follower-ribbon", "relic.star-hanger", "echo", "someone is walking; a light is left for them"),
  T("sight.hung-star", "relic.star-hanger", "provenance", "Sahl hung it"),
  T("sight.hung-star", "relic.sunward-compass", "echo", "Scale's two lights for someone who may be walking"),
  T("sight.dead-bough", "relic.witness-seed", "habit", "the bough is where Wend reaches"),
  T("sight.dead-bough", "sight.second-seam", "echo", "the bough points at the sealed seam"),
  T("sight.dead-bough", "relic.dawn-leaf", "echo", "growth held open; one dawn that never becomes day"),
  T("sight.dead-bough", "obj.dissenters-chart", "echo", "both point at the hole"),
  T("obj.dissenters-chart", "sight.unlooked-direction", "echo", "the clean edge is the direction he does not look"),
  T("obj.dissenters-chart", "sight.ysmerel-at-the-edge", "absence", "both would sit at the hole; neither will say so"),
  T("obj.sleepwalkers-lantern", "obj.faded-ticket", "echo", "what the Faded still carry"),
  T("obj.faded-ticket", "sight.missing-berth", "echo", "a voyage forgotten; a berth taken"),
  T("sight.missing-berth", "sight.locked-room", "absence", "what the Hush takes, Hesk keeps"),
  T("sight.missing-berth", "obj.sleepwalkers-lantern", "echo", "the Hush takes the unclaimed first"),
  T("obj.choirmasters-breath", "obj.kiths-drawing", "echo", "four beats: the breath's length and the torn mouth"),
  T("obj.dorrows-page", "relic.basin-stone", "echo", "a debt and a tally of tears: the same number"),
  T("relic.basin-stone", "relic.stillness-seal", "provenance", "the Sixth Hour's grief, counted and then sealed"),
  T("relic.dawn-leaf", "relic.witness-seed", "provenance", "Iselle and Wend both tried the garden"),
  T("sight.missing-stratum", "relic.first-light-shard", "habit", "the oldest stratum's last layer before the absence"),
];

export const STORY: StoryGraph = { anchors: STORY_ANCHORS, entries: STORY_ENTRIES, edges: STORY_EDGES };

/** Entries by id — the server validates every find against this, so a client can never invent one. */
export const STORY_ENTRY_BY_ID: ReadonlyMap<string, StoryEntry> = new Map(STORY_ENTRIES.map((e) => [e.id, e]));

/** True when the canon itself joins two entries (a Concordance link is "lit" only then; derived at read time, never stored). */
export function storyPairIsLit(a: string, b: string): boolean {
  return STORY_EDGES.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

/**
 * Second Readings (Draft 4 §10.3, Draft 5): when a player holds ANY entry in `with`, the entry gains one more sentence — never announced, never highlighted.
 * This is Knowledge (what you have found), not Flavour. Derived at read time; nothing is stored. One sentence each, implying, never explaining.
 */
export const STORY_SECOND_READINGS: Readonly<Record<string, { with: readonly string[]; text: string }>> = {
  "obj.kiths-drawing": { with: ["obj.choirmasters-breath", "echo.hymnal-gap", "relic.witness-without-a-name"], text: "The tear is exactly as long as a held breath." },
  "obj.sleepwalkers-lantern": { with: ["relic.lantern-of-keeping"], text: "The glass is old, and it was lent; someone is still waiting for it back." },
  "obj.dorrows-page": { with: ["echo.hymnal-gap", "obj.choirmasters-breath"], text: "Somewhere a hymnal is missing exactly this line." },
  "obj.tin-soldier": { with: ["obj.kiths-drawing", "sight.locked-room"], text: "A second soldier is missing from a mantel, and a child has been told hers is only a toy." },
  "obj.choirmasters-breath": { with: ["obj.kiths-drawing", "obj.dorrows-page"], text: "It is the length of a tear in paper, and of a debt with no name." },
  "obj.faded-ticket": { with: ["sight.missing-berth"], text: "The berth it names is the one the harbor walks around." },
  "obj.vesh-paper-boat": { with: ["sight.lullaby-hollow"], text: "The missing stroke would fit, exactly, the gap along a certain hull." },
  "obj.doorkeepers-nail": { with: ["relic.harbor-nail"], text: "There is another, given to a man who walked toward a seam, and it is warm too." },
  "obj.measurers-cord": { with: ["echo.eighth-bell"], text: "The untied knot is the length of one beat." },
};

/** The sentence an entry has gained for what this player holds, or null. Knowledge only; Flavour never decides this. */
export function storySecondReading(entryId: string, found: ReadonlySet<string>): string | null {
  const r = STORY_SECOND_READINGS[entryId];
  return r && r.with.some((w) => found.has(w)) ? r.text : null;
}

/**
 * Each wording of an entry voices the SAME claim (Flavour colours; it never changes a fact). Tokens every register must contain — a test holds every variant to them, so a
 * warmer or graver telling cannot quietly drop or add a fact.
 */
export const STORY_VARIANT_TOKENS: Readonly<Record<string, readonly string[]>> = {
  "obj.kiths-drawing": ["no face", "one more", "mouth"],
  "obj.sleepwalkers-lantern": ["night", "no flame", "put it down"],
  "obj.dorrows-page": ["owed to one unrecorded", "freshest", "renewed"],
  "sight.missing-stratum": ["no sixth", "hand's-breadth", "remember"],
};
