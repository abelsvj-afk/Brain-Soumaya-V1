import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicClaimService } from "../relics/claims.js";
import { RelicExchangeService } from "../relics/exchange.js";
import {
  RELICS, RELIC_BY_ID, RELIC_THREADS, RELIC_ANCHOR_POINTS, eligibleExchangeThreads,
} from "@brain/shared";

/**
 * Relics canon entry (2026-10-31) — parity, concealment, and the L3
 * discovery sweep (implementation design §5.6; approved design §3.3).
 *
 * The fixture below carries the owner-approved canon text (the O-R1
 * approvals ledger, 2026-10-31) VERBATIM. DRIFT RULE: any future edit
 * to canon text must update the registry AND this fixture in the same
 * diff — this suite failing is how drift between the owner's ledger
 * and the shipped registry is caught, never a surprise in production.
 *
 * What is proven here:
 *  - the registry carries the approved L0/L2 for all fifteen relics
 *    and the approved L1 on each placed relic's FIRST anchor, character
 *    for character; the unplaced five's L1 stays OUT (it enters with
 *    their O-R6 anchors — the fixture holds it as pending);
 *  - RELIC_THREADS holds exactly the seven threads whose members are
 *    both placed, under their permanent ids; the four NOT-YET threads
 *    (T8–T11) are absent — ids, pairings, and texts (§3.3: an unplaced
 *    relic generates no references, not even a silhouette);
 *  - a viewer who discovered the placed members of NOT-YET threads
 *    sees no thread entry for them, and no NOT-YET text is serialized;
 *  - the discovery sweep: discovering both members of a thread
 *    unlocks it for both members with source='discovery' — including
 *    the Seed case, where a member (the Dawn Leaf) is discovered by
 *    being consumed and is never held — monotonically (an exchange
 *    afterwards never rewrites a discovery row), idempotently, on
 *    the legacy-sync path too, and never for NPC awards (which write
 *    no personal-discovery record);
 *  - the P2-1 completion pass: the lazy migration backfills
 *    both-members discovery rows for pairs a space had fully
 *    discovered BEFORE the sweep existed (a re-claim never reaches
 *    the sweep — the award core returns "already") — monotonically
 *    (rows an exchange already wrote keep their source — including
 *    the half-exchanged pair, whose missing member alone is filled),
 *    idempotently (a second pass, and a fresh handle's whole
 *    migration re-run, insert nothing), for Seed pairs too, and
 *    never from an NPC resident's finds;
 *  - the L1 place layer serves the approved place text (the first
 *    anchor's placeText), not the registry's short place phrase.
 */

/** The approved canon, per relic: L0 stirring, L1 place, L2 description.
 *  For the unplaced five, `place` is the approved L1 held PENDING — it is
 *  asserted absent from the registry until O-R6 gives the relic anchors. */
const CANON: Readonly<Record<string, { stirring: string; place: string; description: string }>> = {
  "harbor-nail": {
    stirring: "Before any ship was ever tied at the Station, someone set a single nail into the harbor's first seam — and tied nothing to it.",
    place: "The rim is where the Station stops being structure and starts being harbor. Everything that arrives passes this seam; everything that leaves crosses it going the other way. The nail was set here, at the join, because arrival needed a mark before it needed anything else.",
    description: "A nail of dark iron, longer than a hand, set into the harbor's first seam and never drawn out. It held no ship and carried no banner; nothing was ever fastened to it that the accounts name. It marked the place where arrival became possible — the harbor's first fact, older than its first traveler.",
  },
  "mooring-ring": {
    stirring: "A traveler once stopped where the harbor ends, tied up, and was not told to move on. The stopping is what the ring remembers.",
    place: "Here the harbor's stone gives out and the open road begins — the exact ground where arriving turns into departing. A ring set in this ground serves neither side. It serves the pause between them.",
    description: "A dark ring of metal set where the harbor's stone meets the open road. One account says it was placed so a traveler could pause without being told to depart again; another says nothing was ever tied to it. Both accounts survive. The ring settles nothing, and has outlasted everyone who argued over it.",
  },
  "dawn-leaf": {
    stirring: "Someone walking beneath the witness tree at first light gathered nothing and swept nothing away — and left one fallen leaf lying at the roots, exactly as it had fallen.",
    place: "The roots' edge is the tree's own ground, where the terraces end and the garden's oldest keeping begins. Things left at the roots here are not lost. They are kept by the slowest keeper in the garden, at the speed roots keep things.",
    description: "A leaf kept near the roots of the witness tree, its veins still holding the colors of a dawn that never finishes becoming day. It has not dried, and it has not greened; it stays at the moment just before morning completes itself. It is a reminder that growth counts before it arrives anywhere final.",
  },
  "witness-seed": {
    stirring: "At the base of the witness tree, something small was set into the ground and never once dug up to check. Whatever it is doing, it is doing it unobserved.",
    place: "The trunk's base is the closest ground to the tree there is — the place where what the tree is begins. A seed kept here is kept in the tree's own shadow, under a witness that reports nothing.",
    description: "A seed-shaped relic found beneath the witness tree. It is not the tree, and the garden's oldest account is careful to say so: the seed and the planting that made the tree a witness are different things. It never promised to become a tree. It keeps the possibility of becoming, nothing more.",
  },
  "first-light-shard": {
    stirring: "A traveler once stood at the basin in the first light and came away carrying a piece of it — or carrying only the mark of where it had touched something. The accounts divide there, and never rejoin.",
    place: "The basin is where the First Light rests in the Deep Past — the oldest light there is, kept at the bottom of the world. Anything found near it is found in the presence of the beginning, and accounts of it tend to become careful, and then to disagree.",
    description: "A pale fragment, translucent, with a warm light held inside it that does not flicker. Some accounts call it the earliest light kept in matter; others insist it is only a trace of the light, not the light itself. The difference is never settled, and the shard offers nothing to settle it with. It rests near the basin, where the question it carries is at home.",
  },
  "basin-stone": {
    stirring: "Someone once read the marks on a stone at the bottom of the basin and wrote down water levels for waters no one remembers. The reading is older than any flood it could describe.",
    place: "The basin floor is the lowest ground in the Deep Past, where everything the world above lets fall eventually settles. What rests here rests under the whole weight of the past — and the past, in this world, is kept rather than buried.",
    description: "A dark stone from the floor of the basin, its surface marked with shallow lines like waterlines. The marks have been read as the levels of forgotten waters, though no account records a flood. Whatever they measure, they were kept. The stone belongs to the story of keeping, not of loss.",
  },
  "lantern-of-keeping": {
    stirring: "In an alcove above the basin, a lantern was sealed lit and left burning where nothing needed to be seen by it. It burns for keeping's sake, not for finding.",
    place: "The alcoves are the Deep Past's quiet rooms, cut into the lowest stratum above the basin floor, where what is kept is kept out of the current. A lantern here does not light a way through. It makes what is stored here present, gently, without hauling it into the open.",
    description: "A small sealed lantern from the alcoves above the basin. Its light is quiet rather than bright, as if it were meant to make something present without forcing it into view. It was never opened to be lit, and never opened to be put out. Keeping need not mean disturbing.",
  },
  "witness-without-a-name": {
    stirring: "Everything that ever stood at the basin stood in sight of the thing at its center. No one who saw it carried away a name for it.",
    place: "The center of the basin is the stillest ground in the Deep Past, where the First Light rests and the sound of the falls arrives softened. The terraces and the stairs all face this way. Whatever was placed here was placed to be stood before, not to be used.",
    description: "A smooth, pale object from the oldest accounts of the first making, worn featureless by being looked at for longer than any language has existed. It has no surviving name in any tongue; the name in this Codex is only a convenience. It marks the boundary between the one who makes and the worlds that remember him, without explaining that boundary. Carry it with any two other relics, and the far gate will know you were seen.",
  },
  "hearth-ember": {
    stirring: "At the first hearths, someone took a coal out of the fire and set it apart — and it has been warm ever since, feeding on nothing.",
    place: "The field's heart is where the first hearths were set, and every path in People bends a little toward it. What is kept here is kept the way a hearth keeps a house: at the center, where the warmth reaches everyone and belongs to no one.",
    description: "A coal-like fragment from where the first hearths were set, dark except for a low amber light in its cracks. It gives off warmth without consuming itself, and it has never gone cold in any account. It is love given a place to live outside the mind that remembers it — kept where others can warm themselves by it.",
  },
  "thread-of-many": {
    stirring: "A thread was once carried from one hearth to another across the field — and at neither end was it tied fast. It arrived. It was never attached.",
    place: "Between the stones of the hearths is the closest ground in People: where one household's warmth ends and the path to the next begins. A thread resting here rests in the space between lives — touching both, belonging wholly to neither.",
    description: "A fine, unbroken thread found between the stones of the hearths. It is said to have passed from one hearth to another without joining them into a single flame. It connects without confusing one life with another, and nothing about it is frayed, though no account says how many crossings it has made.",
  },
  "star-hanger": {
    stirring: "The stars were hung one by one, each given its room. Whatever did the hanging left a small curved fragment of itself behind — in a world that has not opened yet.",
    place: "The Scale Space keeps the moment the universe was given room to be seen. A place in it is a place among placements: everything there rests where it was set, at distances meant to be looked across. Where in that vastness the fragment rests has not been decided, and this text does not pretend otherwise.",
    description: "A small curved fragment of bare metal from the moment the stars were hung. It resembles a hook, but no account says it was used to suspend any one star. It belongs to the image of a universe given room to be seen. Its world has not opened; the fragment waits, its story untested by any traveler's eyes.",
  },
  "sunward-compass": {
    stirring: "Along the sun's long road, a traveler once navigated by an instrument that refused to point — and arrived anyway. Or did not. The accounts keep both endings.",
    place: "The sun's long road is the Scale Space's great journey: the path light itself travels. Anything resting along it rests in the company of motion measured against a still center. The road is not open to travelers yet, and nothing here can be visited today.",
    description: "A round instrument with no ordinary needle, found along the sun's long road. Its center stays fixed while its markings suggest motion around it. Some call it a compass; others deny it points anywhere. The disagreement is part of the object, and it will still be there when its world opens.",
  },
  "stillness-seal": {
    stirring: "In an Archive that has not opened, a door was once closed on something worth keeping — and it is the closing, not the thing, that the seal remembers.",
    place: "The threshold of a quiet alcove is the Archive's characteristic ground: the line between a thing stored and a thing summoned. What rests there guards nothing by force. It marks the decision to let a kept thing rest. No traveler has crossed this threshold through the app; the Archive is not open.",
    description: "A smooth, dark seal from the threshold of a quiet alcove. It bears no command and no warning; nothing is written on it at all. It speaks of the difference between keeping something safe and calling it back into view: rest is not the same as erasure.",
  },
  "unopened-fold": {
    stirring: "Someone folded something small, once, and then did the harder thing: they put it away still folded, and let it stay that way.",
    place: "The Archive keeps what it is given without inventorying it into exposure; a kept thing there is shelved in the quiet, in the company of other kept things. A fold resting among them is not awaiting opening. It is complete as it is. The shelves themselves are not open to travelers yet.",
    description: "A small folded object kept in the Archive, its material like paper without behaving exactly like it. No account says what is inside, and the accounts are content with that. It is not a test of curiosity: its meaning is the permission to keep something without opening it.",
  },
  "unnumbered-fragment": {
    stirring: "A fragment was found in the uncounted space — by no one whose name survived — bearing an inscription about a maker that refuses, in the same breath, to give him a beginning.",
    place: "The vast uncounted space is where the Scale Space stops numbering things. A fragment resting there rests outside every register — which is, the accounts suggest, the only honest place for it. The space is not open; no traveler has stood in it through the app, and this text claims no visit.",
    description: "A small, translucent fragment that no world claims as its own, lit faintly from inside. Its inscription refuses to assign a date, an age, or a beginning to its maker. It is not a piece of him; it is a fragment of the created record struggling to describe the uncreated. What whole it broke from, no account says.",
  },
};

/** The seven threads entered into RELIC_THREADS (both members placed). */
const ENTERED_THREADS: readonly { threadId: string; relicA: string; relicB: string; text: string }[] = [
  { threadId: "harbor-nail--mooring-ring", relicA: "harbor-nail", relicB: "mooring-ring", text: "The nail and the ring are the Station's two courtesies, and they face opposite ways. The nail marks where arrival became possible; the ring marks where departure stopped being an order. Between them, a whole journey fits: come in, rest, leave when ready. Neither object hurries anyone. The Station was built around both permissions, and it keeps them at opposite ends of the same harbor." },
  { threadId: "witness-seed--dawn-leaf", relicA: "witness-seed", relicB: "dawn-leaf", text: "The seed and the leaf are the witness tree's two timepieces, and they disagree about what time is. The leaf holds a dawn that never finishes; the seed holds a becoming that has never once been hurried. One says growth is already real before it arrives anywhere final. The other says possibility is already kept before it grows into anything. Both belong to the same tree, and the tree has never ruled between them." },
  { threadId: "first-light-shard--witness-without-a-name", relicA: "first-light-shard", relicB: "witness-without-a-name", text: "At the bottom of the Deep Past, the light and the witness keep each other's company. The shard may be the earliest light kept in matter, or only its trace; the accounts never settle it. The Witness has no name the accounts can keep; they never settle that either. Two unsettled things rest in one basin, and the basin is not troubled by it. What the light first fell on was something that could be looked at. What has been looked at longest faces the light." },
  { threadId: "basin-stone--lantern-of-keeping", relicA: "basin-stone", relicB: "lantern-of-keeping", text: "The stone and the lantern are the Deep Past's two kinds of keeping. The stone keeps marks: the levels of forgotten waters, held as lines on a surface. The lantern keeps presence: a light sealed in, making what is stored gently visible without disturbing it. One keeps the record; the other keeps the room. Together they are the whole practice of the alcoves — the past is kept, not erased, and keeping need not mean disturbing." },
  { threadId: "hearth-ember--thread-of-many", relicA: "hearth-ember", relicB: "thread-of-many", text: "The ember and the thread are People's two answers to the same question: how does love travel? The ember says it stays — a warmth kept in one place, so that anyone may come to it. The thread says it crosses — carried from hearth to hearth without merging them into a single flame. Both are true in the field, and neither cancels the other. A life can be a place where others warm themselves, and a path others walk, at once." },
  { threadId: "harbor-nail--basin-stone", relicA: "harbor-nail", relicB: "basin-stone", text: "The nail and the stone remember beginnings differently, and both accounts stand. The nail remembers a harbor that was ready — a seam waiting for its first fastening, a place prepared. The stone's marks have been read as levels of waters older than any harbor, that came and went before arrival had a place at all. Read together, the Station may be younger than the ground it stands on. Neither object corrects the other. The disagreement is itself part of the record." },
  { threadId: "witness-seed--witness-without-a-name", relicA: "witness-seed", relicB: "witness-without-a-name", text: "Two witnesses, and neither testifies. The seed keeps the possibility of becoming, beneath a tree that watches a garden grow. The Witness at the basin's center has been looked at longer than any language has existed, and has given back no name. One witness is all future; the other is all having-been-seen. What joins them is the discipline they share: to witness is not to explain." },
];

/** The four NOT-YET threads (T8–T11): canon text under their would-be
 *  permanent ids — deliberately ABSENT from the registry until O-R6
 *  placement (design §3.3). */
const NOT_YET_THREADS: readonly { threadId: string; relicA: string; relicB: string; text: string }[] = [
  { threadId: "unnumbered-fragment--witness-without-a-name", relicA: "unnumbered-fragment", relicB: "witness-without-a-name", text: "These are the two relics no world claims as its own, and they answer each other. The Fragment's inscription refuses to give its maker a date, an age, or a beginning. The Witness has no name that any language survived to keep. One withholds the beginning; the other withholds the name. Between them they mark the boundary the record never crosses: the created can approach the uncreated only by saying, honestly, what it cannot say." },
  { threadId: "stillness-seal--unopened-fold", relicA: "stillness-seal", relicB: "unopened-fold", text: "The seal and the fold are the Archive's whole ethic in two objects. The seal says a kept thing may rest without being summoned; rest is not erasure. The fold says a kept thing may remain unopened without being unfinished; permission is not neglect. Together they draw the Archive's line: keeping is a form of care, not a failure to use. Their world has not opened. The ethic waits with them." },
  { threadId: "star-hanger--sunward-compass", relicA: "star-hanger", relicB: "sunward-compass", text: "The hanger and the compass are the Scale Space's two instruments, and both are about placement. The hanger belongs to the moment each star was given its place. The compass belongs to the road between places, and declines to point along it. One belongs to everything being set; the other, to no journey being commanded. A universe given room to be seen needs both. Their world has not opened; the instruments wait with the stars they describe." },
  { threadId: "lantern-of-keeping--stillness-seal", relicA: "lantern-of-keeping", relicB: "stillness-seal", text: "The lantern and the seal keep the same promise in two worlds. The lantern makes a kept thing present without forcing it into view. The seal lets a kept thing rest without calling it back. Presence without disturbance; rest without erasure. The Deep Past and the Quiet Archive keep different silences, but on this their relics agree completely. The seal's world has not opened, so for now the agreement is kept from one side — by the lantern, burning in its alcove." },
];


let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); });

const store = () => new RelicHoldingsStore(handle);
const svc = () => new RelicClaimService(handle);
const xchg = () => new RelicExchangeService(handle);

const l3Rows = (spaceId: string): { relic_id: string; thread_id: string; source: string }[] =>
  handle.sqlite.prepare(
    `SELECT relic_id, thread_id, source FROM relic_codex_layers WHERE space_id = ? AND layer = 'L3' ORDER BY thread_id ASC, relic_id ASC`,
  ).all(spaceId) as { relic_id: string; thread_id: string; source: string }[];

/** A personal discovery record written directly, bypassing every
 *  claim path — the database state of a space that found the relic
 *  BEFORE the canon entry, when no sweep existed to complete its
 *  threads (P2-1). */
const seedDiscovery = (spaceId: string, relicId: string): void => {
  handle.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(spaceId, `relic-${relicId}`);
};

const PLACED = Object.keys(CANON).filter((id) => (RELIC_ANCHOR_POINTS[id] ?? []).length > 0);
const UNPLACED = Object.keys(CANON).filter((id) => (RELIC_ANCHOR_POINTS[id] ?? []).length === 0);

describe("canon parity — the registry carries the approved text, character for character", () => {
  it("every def's L2 description and L0 stirring equal the approved canon (all fifteen)", () => {
    expect(RELICS).toHaveLength(15);
    expect(PLACED).toHaveLength(10);
    expect(UNPLACED).toHaveLength(5);
    for (const def of RELICS) {
      const canon = CANON[def.id];
      expect(canon, def.id).toBeTruthy();
      expect(def.lore, `${def.id} L2`).toBe(canon!.description);
      expect(def.loreStirring, `${def.id} L0`).toBe(canon!.stirring);
    }
  });

  it("each placed relic's FIRST anchor carries the approved L1; later anchors carry none; the unplaced five's L1 stays out", () => {
    for (const id of PLACED) {
      const anchors = RELIC_ANCHOR_POINTS[id]!;
      expect(anchors[0]!.placeText, `${id} first anchor L1`).toBe(CANON[id]!.place);
      for (const a of anchors.slice(1)) {
        expect(a.placeText, `${id} ${a.anchorKey}`).toBeUndefined();
      }
    }
    // The unplaced five have no anchors at all — their approved L1 has
    // no home until O-R6, and the pending text sits nowhere in the
    // shipped registry.
    const shipped = JSON.stringify({ RELICS, RELIC_ANCHOR_POINTS, RELIC_THREADS });
    for (const id of UNPLACED) {
      expect(RELIC_ANCHOR_POINTS[id], id).toEqual([]);
      expect(shipped, `${id} pending L1 must not be shipped`).not.toContain(CANON[id]!.place);
    }
  });

  it("RELIC_THREADS is exactly the seven fully-placed canon threads, under their permanent ids", () => {
    expect(RELIC_THREADS).toEqual(
      ENTERED_THREADS.map((t) => ({
        threadId: t.threadId, relicA: t.relicA, relicB: t.relicB,
        condition: "discovery", text: t.text, approved: true,
      })),
    );
  });

  it("none of the NOT-YET threads (T8–T11) is entered — no id, no pairing, no text (§3.3)", () => {
    const shipped = JSON.stringify({ RELICS, RELIC_ANCHOR_POINTS, RELIC_THREADS });
    for (const t of NOT_YET_THREADS) {
      expect(RELIC_THREADS.some((x) => x.threadId === t.threadId), t.threadId).toBe(false);
      expect(
        RELIC_THREADS.some((x) => (x.relicA === t.relicA && x.relicB === t.relicB) || (x.relicA === t.relicB && x.relicB === t.relicA)),
        t.threadId,
      ).toBe(false);
      expect(shipped, `${t.threadId} text must not be shipped`).not.toContain(t.text);
    }
  });

  it("exchange eligibility over the entered canon matches the design table for every relic", () => {
    const expected: Record<string, string[]> = {
      "harbor-nail": ["harbor-nail--mooring-ring", "harbor-nail--basin-stone"],
      "mooring-ring": ["harbor-nail--mooring-ring"],
      "dawn-leaf": ["witness-seed--dawn-leaf"],
      "witness-seed": ["witness-seed--dawn-leaf", "witness-seed--witness-without-a-name"],
      "first-light-shard": ["first-light-shard--witness-without-a-name"],
      "basin-stone": ["basin-stone--lantern-of-keeping", "harbor-nail--basin-stone"],
      "lantern-of-keeping": ["basin-stone--lantern-of-keeping"],
      "witness-without-a-name": ["first-light-shard--witness-without-a-name", "witness-seed--witness-without-a-name"],
      "hearth-ember": ["hearth-ember--thread-of-many"],
      "thread-of-many": ["hearth-ember--thread-of-many"],
      // The unplaced five: no thread is exchange-eligible — their only
      // threads are the omitted NOT-YET ones (T8/T9/T10), and T11's
      // placed member (the Lantern) lists T4 only, never T11.
      "star-hanger": [],
      "sunward-compass": [],
      "stillness-seal": [],
      "unopened-fold": [],
      "unnumbered-fragment": [],
    };
    for (const def of RELICS) {
      expect(eligibleExchangeThreads(def.id).map((t) => t.threadId), def.id).toEqual(expected[def.id]);
    }
  });
});

describe("NOT-YET concealment — a viewer of the placed members sees no thread pointing at an unplaced relic", () => {
  it("the Witness and the Lantern show only their entered threads; no NOT-YET text is serialized anywhere", () => {
    expect(store().claimFind("s1", "witness-without-a-name", "deep-past").ok).toBe(true);
    expect(store().claimFind("s1", "lantern-of-keeping", "deep-past").ok).toBe(true);
    const state = store().state("s1");
    const payload = JSON.stringify(state);

    const witness = state.codex?.find((c) => c.relicId === "witness-without-a-name");
    expect(witness!.layers.threads.entries.map((e) => e.threadId).sort()).toEqual([
      "first-light-shard--witness-without-a-name",
      "witness-seed--witness-without-a-name",
    ]);
    const lantern = state.codex?.find((c) => c.relicId === "lantern-of-keeping");
    expect(lantern!.layers.threads.entries.map((e) => e.threadId)).toEqual(["basin-stone--lantern-of-keeping"]);

    // No codex entry anywhere names an unplaced relic as a thread partner.
    for (const entry of state.codex ?? []) {
      for (const e of entry.layers.threads.entries) {
        expect(UNPLACED, `${entry.relicId} thread ${e.threadId}`).not.toContain(e.otherRelicId);
      }
    }
    // And none of the four NOT-YET texts — nor any still-locked entered
    // thread text — appears in the whole serialized state.
    for (const t of NOT_YET_THREADS) expect(payload).not.toContain(t.text);
    for (const t of ENTERED_THREADS) expect(payload).not.toContain(t.text);
  });
});

describe("the L3 discovery sweep (§5.6) — threads complete from personal discovery records", () => {
  it("T1: one discovery shows a silhouette only; the second completes the thread for BOTH members, source 'discovery'", () => {
    expect(store().claimFind("s1", "harbor-nail", "great-station").ok).toBe(true);
    // Silhouette present, words dark, nothing written.
    let nail = store().state("s1").codex?.find((c) => c.relicId === "harbor-nail");
    const t1 = nail!.layers.threads.entries.find((e) => e.threadId === "harbor-nail--mooring-ring");
    expect(t1).toBeTruthy();
    expect(t1!.unlocked).toBe(false);
    expect(t1!.text).toBeUndefined();
    expect(JSON.stringify(store().state("s1"))).not.toContain(ENTERED_THREADS[0]!.text);
    expect(l3Rows("s1")).toEqual([]);

    // The Ring is a Seed: its claim consumes it — the discovery record
    // is what completes the pair.
    expect(store().claimFind("s1", "mooring-ring", "great-station").ok).toBe(true);
    expect(l3Rows("s1")).toEqual([
      { relic_id: "harbor-nail", thread_id: "harbor-nail--mooring-ring", source: "discovery" },
      { relic_id: "mooring-ring", thread_id: "harbor-nail--mooring-ring", source: "discovery" },
    ]);
    nail = store().state("s1").codex?.find((c) => c.relicId === "harbor-nail");
    const done = nail!.layers.threads.entries.find((e) => e.threadId === "harbor-nail--mooring-ring");
    expect(done!.unlocked).toBe(true);
    expect(done!.text).toBe(ENTERED_THREADS[0]!.text);
    const ring = store().state("s1").codex?.find((c) => c.relicId === "mooring-ring");
    expect(ring!.layers.threads.entries.find((e) => e.threadId === "harbor-nail--mooring-ring")!.text).toBe(ENTERED_THREADS[0]!.text);
  });

  it("T2 (the Seed case): the Dawn Leaf is discovered by being consumed, never held — the thread still completes", () => {
    const leaf = store().claimFind("s2", "dawn-leaf", "growing-place");
    expect(leaf.ok).toBe(true);
    expect(store().state("s2").holdings.find((h) => h.relicId === "dawn-leaf")).toBeUndefined();
    expect(l3Rows("s2")).toEqual([]);
    expect(store().claimFind("s2", "witness-seed", "growing-place").ok).toBe(true);
    expect(l3Rows("s2")).toEqual([
      { relic_id: "dawn-leaf", thread_id: "witness-seed--dawn-leaf", source: "discovery" },
      { relic_id: "witness-seed", thread_id: "witness-seed--dawn-leaf", source: "discovery" },
    ]);
  });

  it("monotonic and idempotent: a later lore exchange never rewrites a discovery row, and re-claims write nothing twice", () => {
    expect(store().claimFind("s3", "basin-stone", "deep-past").ok).toBe(true);
    expect(store().claimFind("s3", "lantern-of-keeping", "deep-past").ok).toBe(true);
    // The sweep completed T4 the moment the Lantern was discovered.
    expect(l3Rows("s3")).toEqual([
      { relic_id: "basin-stone", thread_id: "basin-stone--lantern-of-keeping", source: "discovery" },
      { relic_id: "lantern-of-keeping", thread_id: "basin-stone--lantern-of-keeping", source: "discovery" },
    ]);
    // The lore exchange grants T4 (already open) + T6 — T4's rows keep
    // their discovery source; only T6's arrive as exchange rows.
    const out = xchg().exchange("s3", { relicId: "basin-stone", option: "lore", attemptKey: "canon-x1" }, "great-station");
    expect(out.ok).toBe(true);
    if (out.ok) expect([...out.unlockedThreadIds].sort()).toEqual(["basin-stone--lantern-of-keeping", "harbor-nail--basin-stone"]);
    const afterExchange = [
      { relic_id: "basin-stone", thread_id: "basin-stone--lantern-of-keeping", source: "discovery" },
      { relic_id: "lantern-of-keeping", thread_id: "basin-stone--lantern-of-keeping", source: "discovery" },
      { relic_id: "basin-stone", thread_id: "harbor-nail--basin-stone", source: "exchange" },
      { relic_id: "harbor-nail", thread_id: "harbor-nail--basin-stone", source: "exchange" },
    ];
    expect(l3Rows("s3")).toEqual(afterExchange);
    // Re-claiming the returned Basin Stone runs the sweep again — the
    // row set is byte-identical afterwards.
    expect(store().claimFind("s3", "basin-stone", "deep-past").ok).toBe(true);
    expect(l3Rows("s3")).toEqual(afterExchange);
  });

  it("the legacy-sync path completes threads by the same sweep", () => {
    handle.sqlite.prepare(`INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt) VALUES ('old', 'Old', 'old-tag', 'h', 's')`).run();
    store().ensureMigrated();
    const out = store().syncLegacy("old", ["harbor-nail", "mooring-ring"]);
    expect(out.synced).toBe(true);
    expect(l3Rows("old")).toEqual([
      { relic_id: "harbor-nail", thread_id: "harbor-nail--mooring-ring", source: "discovery" },
      { relic_id: "mooring-ring", thread_id: "harbor-nail--mooring-ring", source: "discovery" },
    ]);
  });

  it("NPC awards write no personal discovery and complete no threads for the space", () => {
    expect(svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail")).toBeTruthy();
    expect(svc().claimForNpc("npc-space", "harbor-controller", "great-station", "mooring-ring")).toBeTruthy();
    expect(l3Rows("npc-space")).toEqual([]);
    const nail = store().state("npc-space").codex?.find((c) => c.relicId === "harbor-nail");
    expect(nail!.discovered).toBe(false);
    const t1 = nail!.layers.threads.entries.find((e) => e.threadId === "harbor-nail--mooring-ring");
    expect(t1!.unlocked).toBe(false);
    expect(t1!.text).toBeUndefined();
  });
});

describe("the one-time completion pass (P2-1) — pairs discovered before the sweep are backfilled by the lazy migration", () => {
  const T4 = "basin-stone--lantern-of-keeping";
  const T2 = "witness-seed--dawn-leaf";

  it("both members discovered pre-entry, no L3 rows: the migration grants both-members discovery rows and the Codex thread reads unlocked", () => {
    seedDiscovery("pre", "basin-stone");
    seedDiscovery("pre", "lantern-of-keeping");
    // The pre-entry state: discoveries on record, no thread rows —
    // and nothing has run the migration yet.
    expect(l3Rows("pre")).toEqual([]);
    store().ensureMigrated();
    expect(l3Rows("pre")).toEqual([
      { relic_id: "basin-stone", thread_id: T4, source: "discovery" },
      { relic_id: "lantern-of-keeping", thread_id: T4, source: "discovery" },
    ]);
    const lantern = store().state("pre").codex?.find((c) => c.relicId === "lantern-of-keeping");
    const t4 = lantern!.layers.threads.entries.find((e) => e.threadId === T4);
    expect(t4!.unlocked).toBe(true);
    expect(t4!.text).toBe(ENTERED_THREADS.find((t) => t.threadId === T4)!.text);
  });

  it("only one member discovered pre-entry: the pass grants nothing", () => {
    seedDiscovery("solo", "basin-stone");
    expect(store().backfillDiscoveryThreadCompletions()).toBe(0);
    expect(l3Rows("solo")).toEqual([]);
  });

  it("a thread already unlocked via exchange keeps exactly its exchange rows — no duplicates, no source rewrite", () => {
    seedDiscovery("xf", "basin-stone");
    seedDiscovery("xf", "lantern-of-keeping");
    const ins = handle.sqlite.prepare(
      `INSERT INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES (?, ?, 'L3', ?, 'exchange')`,
    );
    ins.run("xf", "basin-stone", T4);
    ins.run("xf", "lantern-of-keeping", T4);
    expect(store().backfillDiscoveryThreadCompletions()).toBe(0);
    expect(l3Rows("xf")).toEqual([
      { relic_id: "basin-stone", thread_id: T4, source: "exchange" },
      { relic_id: "lantern-of-keeping", thread_id: T4, source: "exchange" },
    ]);
  });

  it("idempotent: a second pass inserts nothing and the row set is unchanged", () => {
    seedDiscovery("twice", "basin-stone");
    seedDiscovery("twice", "lantern-of-keeping");
    expect(store().backfillDiscoveryThreadCompletions()).toBe(2);
    const afterFirst = l3Rows("twice");
    expect(afterFirst).toHaveLength(2);
    expect(store().backfillDiscoveryThreadCompletions()).toBe(0);
    expect(l3Rows("twice")).toEqual(afterFirst);
    // The migration entry point itself is equally safe to touch again.
    store().ensureMigrated();
    expect(l3Rows("twice")).toEqual(afterFirst);
  });

  it("the T2 Seed case: a consumed Seed's pre-entry discovery record completes the pair", () => {
    // The Dawn Leaf's claim is a discovery record only — the Seed was
    // consumed, never held — and it stands in codex_claims like any
    // other's, so the pass completes T2 from the record alone.
    seedDiscovery("seedpair", "dawn-leaf");
    seedDiscovery("seedpair", "witness-seed");
    expect(store().backfillDiscoveryThreadCompletions()).toBe(2);
    expect(l3Rows("seedpair")).toEqual([
      { relic_id: "dawn-leaf", thread_id: T2, source: "discovery" },
      { relic_id: "witness-seed", thread_id: T2, source: "discovery" },
    ]);
  });

  it("NPC parity: an NPC resident's finds complete nothing for the space — and neither does a mixed pair", () => {
    // Both members claimed by an NPC resident: NPC awards write no
    // personal discovery record, so the pass has nothing to complete
    // from — the same reach the sweep has at claim time. The setup
    // proves itself: both claims report awarded for the named relic,
    // and the NPC-side records genuinely exist — the Nail's
    // npc_relic_holdings row and the consumed Ring's Seed effect
    // against the space — so the empty completion below is measured
    // against records that really landed, in every table a confused
    // implementation might read instead of the personal record.
    expect(svc().claimForNpc("npc-pre", "harbor-controller", "great-station", "harbor-nail"))
      .toMatchObject({ status: "awarded", relicId: "harbor-nail" });
    expect(svc().claimForNpc("npc-pre", "harbor-controller", "great-station", "mooring-ring"))
      .toMatchObject({ status: "awarded", relicId: "mooring-ring" });
    expect(handle.sqlite.prepare(`SELECT relic_id FROM npc_relic_holdings WHERE space_id = 'npc-pre'`).all())
      .toEqual([{ relic_id: "harbor-nail" }]);
    expect(handle.sqlite.prepare(`SELECT relic_id FROM relic_seed_effects WHERE space_id = 'npc-pre'`).all())
      .toEqual([{ relic_id: "mooring-ring" }]);
    store().ensureMigrated();
    expect(store().backfillDiscoveryThreadCompletions()).toBe(0);
    expect(l3Rows("npc-pre")).toEqual([]);
    // Mixed: the space personally discovered one member while an NPC
    // resident holds the other. The pair still does not complete —
    // completion reads the personal record only.
    seedDiscovery("mixed", "harbor-nail");
    expect(svc().claimForNpc("mixed", "harbor-controller", "great-station", "mooring-ring"))
      .toMatchObject({ status: "awarded", relicId: "mooring-ring" });
    expect(store().backfillDiscoveryThreadCompletions()).toBe(0);
    expect(l3Rows("mixed")).toEqual([]);
  });

  it("a partially exchanged thread: the pass inserts only the missing member, as 'discovery', and leaves the exchange row untouched", () => {
    // One member's unlock arrived via a lore exchange before the
    // pass ever ran; the other member has no row at all. Completion
    // fills exactly the gap — INSERT OR IGNORE against the layer
    // primary key — and reports the single row it wrote.
    seedDiscovery("partial", "basin-stone");
    seedDiscovery("partial", "lantern-of-keeping");
    handle.sqlite.prepare(
      `INSERT INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES (?, ?, 'L3', ?, 'exchange')`,
    ).run("partial", "basin-stone", T4);
    expect(store().backfillDiscoveryThreadCompletions()).toBe(1);
    expect(l3Rows("partial")).toEqual([
      { relic_id: "basin-stone", thread_id: T4, source: "exchange" },
      { relic_id: "lantern-of-keeping", thread_id: T4, source: "discovery" },
    ]);
  });

  it("re-entry on a fresh handle (a restart) completes nothing twice — the same rows, byte for byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "relic-canon-p21-"));
    const dbPath = join(dir, "brain.db");
    const rowsOn = (h: DbHandle): { relic_id: string; thread_id: string; source: string }[] =>
      h.sqlite.prepare(
        `SELECT relic_id, thread_id, source FROM relic_codex_layers WHERE space_id = 'restart' AND layer = 'L3' ORDER BY thread_id ASC, relic_id ASC`,
      ).all() as { relic_id: string; thread_id: string; source: string }[];
    try {
      const h1 = createDb(dbPath);
      h1.sqlite.prepare(`INSERT INTO codex_claims (space_id, reward_key) VALUES ('restart', 'relic-basin-stone')`).run();
      h1.sqlite.prepare(`INSERT INTO codex_claims (space_id, reward_key) VALUES ('restart', 'relic-lantern-of-keeping')`).run();
      new RelicHoldingsStore(h1).ensureMigrated();
      const afterFirst = rowsOn(h1);
      expect(afterFirst).toEqual([
        { relic_id: "basin-stone", thread_id: T4, source: "discovery" },
        { relic_id: "lantern-of-keeping", thread_id: T4, source: "discovery" },
      ]);
      h1.sqlite.close();
      // A fresh handle re-runs the whole migration family (the
      // WeakSet marker is per connection): the pass inserts nothing
      // and the rows are byte-identical.
      const h2 = createDb(dbPath);
      const s2 = new RelicHoldingsStore(h2);
      s2.ensureMigrated();
      expect(s2.backfillDiscoveryThreadCompletions()).toBe(0);
      expect(rowsOn(h2)).toEqual(afterFirst);
      h2.sqlite.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("L1 serving (Decision 1A) — the place layer serves the approved place text", () => {
  it("an arrival unlock ships the first anchor's approved place text, not the short registry phrase", () => {
    expect(store().claimFind("s1", "basin-stone", "deep-past").ok).toBe(true);
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES ('s1', 'basin-stone', 'L1', '', 'arrival')`,
    ).run();
    const basin = store().state("s1").codex?.find((c) => c.relicId === "basin-stone");
    expect(basin!.layers.place.state).toBe("unlocked");
    expect(basin!.layers.place.text).toBe(CANON["basin-stone"]!.place);
    expect(basin!.layers.place.text).not.toBe(RELIC_BY_ID.get("basin-stone")!.place);
    // A viewer without the unlock has the approved text nowhere.
    expect(JSON.stringify(store().state("s2"))).not.toContain(CANON["basin-stone"]!.place);
  });
});
