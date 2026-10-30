/**
 * Talking to the cast (docs/specs/living-worlds-dialogue-2026-10-31.md, S3). A conversation is AUTHORED CHOICES, never free text: it works offline, costs nothing to choose, and
 * the NPC fence is intact (they answer; they never reach into a brain). Each person has the same shape —
 *   who they are · what this place is to them · what they do · a THREAD (a few steps that open as you meet them more and hear the one before) · "is there something I should
 *   look for?" (a pointer, in their own words, toward a thing in the Book you have not found — never a number or a map pin) · goodbye.
 * Threads are surface only (Draft 3 §5): each person keeps back the one thing they will not say. Nothing here can be failed, lost, bought or required — a thread you leave simply
 * rests and they are still there. The people who may be talked to are exactly the speaking cast bar Eternity (who cannot be asked) and the harbor controller (who answers in her own panel).
 */

export interface TalkStep {
  /** Stable id; matches the cast member's `lore.layers[].key`. */
  id: string;
  /** What the player says (kept short; reads as a question or an invitation, never a command). */
  ask: string;
  /** What they answer (one short passage, no digits). */
  say: string;
  /** Opens after this many meetings. */
  minMeetings: number;
  /** Opens only once this earlier step has been heard (a thread, in order). */
  after?: string;
}

export interface TalkPoint {
  /** A Book entry the person can point toward while it is not yet found. */
  entryId: string;
  say: string;
}

export interface NpcTalk {
  npc: string;
  who: string;
  /** What this place is to them: at home, and away from home. */
  placeHome: string;
  placeAway: string;
  job: string;
  thread: readonly TalkStep[];
  points: readonly TalkPoint[];
  /** When there is nothing left to point at. */
  allFound: string;
  farewell: string;
}

export const NPC_TALK: readonly NpcTalk[] = [
  {
    npc: "wayfarer",
    who: "They call me the Wayfarer. Calend, if you like the name. I keep doors, mostly. I walk until I find one that wants keeping.",
    placeHome: "The Station is where arriving became possible. Before the harbor there was a nail in a gate-post, and someone stood beside it and did not leave.",
    placeAway: "Every place I walk was somebody's first door. This one is no different, only further from the Station.",
    job: "I hold doors. Open some, leave a few a hand's-breadth ajar. You would be surprised what walks through a door that is not quite shut.",
    thread: [
      { id: "calend.arrived", ask: "Where are you always going?", say: "Have you ever felt you had arrived somewhere before you had? Do not answer. Most people do, the moment they stop to ask.", minMeetings: 1 },
      { id: "calend.seam", ask: "What do you keep looking at?", say: "There is a seam on the Station's lower rim, older than the rest, and it hums. If you are ever still near it, listen. It does not hum for everyone.", minMeetings: 2, after: "calend.arrived" },
      { id: "calend.first", ask: "Who came through first?", say: "The first traveller after the long grief came through here once. I know their name. It does not come out when I try. I have stopped being embarrassed by that.", minMeetings: 3, after: "calend.seam" },
      { id: "calend.door", ask: "Is there something you want of me?", say: "One day I will ask you to hold a door for someone. Not today. You will know the door when you are standing in it.", minMeetings: 4, after: "calend.first" },
    ],
    points: [
      { entryId: "sight.second-seam", say: "Go to the Station's lower rim, where the old seam is, and be still there a while. Better at the turn of the day than in the middle of it." },
      { entryId: "sight.locked-room", say: "Up among the annexes there is a door someone keeps shut. Not to hide anything. They cannot bear to open it. Stand near it, quietly, in the first light." },
      { entryId: "obj.faded-ticket", say: "Someone once wanted to go somewhere badly enough to buy a ticket. It is still lying about the annexes. Sit where the hearths are lit, and notice." },
    ],
    allFound: "You have been where I would have sent you. Then you know more of the doors than I tell people.",
    farewell: "Mind the doors.",
  },
  {
    npc: "cantor",
    who: "I lead the Choir. The Last Choirmaster, they say, as if there might be another. I am Ysmerel, and I keep the hours in song.",
    placeHome: "The Archive is quiet because we keep it so. Quiet is a kind of singing, if you do it well.",
    placeAway: "Even here the hours turn, and I sing them under my breath. It is a habit. It is also a mercy.",
    job: "I give the hours their voices. Every hymn has its place and its time, and I see that none of them is rushed.",
    thread: [
      { id: "ysmerel.torn", ask: "What is the hymnal like?", say: "There is a page torn out of the hymnal. I did not tear it. I have never quite asked who did.", minMeetings: 1 },
      { id: "ysmerel.gap", ask: "Why does the Choir pause?", say: "Every hymn we sing has a held breath in it, always the same length. We do not speak of why. We keep it, as one keeps a chair at a table.", minMeetings: 3, after: "ysmerel.torn" },
      { id: "ysmerel.hum", ask: "Could I hear it?", say: "Sometimes I ask a visitor to hum the gap. No one has ever hummed it the same way twice. It is not that they are wrong.", minMeetings: 4, after: "ysmerel.gap" },
    ],
    points: [
      { entryId: "echo.hymnal-gap", say: "Stand in the Archive, near the still threshold, when the hearths are lit, and be quiet. You may hear where the hymn catches." },
      { entryId: "sight.open-alcove", say: "One alcove in the Archive was left open and empty. Do not fill it. But go and look, when the day is done." },
      { entryId: "sight.ysmerel-at-the-edge", say: "At night I sit at the edge of the quiet, where the lights end. If you see me there, do not call out. Only stay a little." },
    ],
    allFound: "You have heard where the hymn catches. Then you know what we hold, though not why.",
    farewell: "Go gently.",
  },
  {
    npc: "broker",
    who: "Dorrow Quint, Grandmaster of the Ledger. A grand way of saying I keep the Great Book, and the Book keeps me.",
    placeHome: "Everything here has a price. I only write it down; I never set it. That is a distinction people forget.",
    placeAway: "Away from the Ledger the prices are friendlier and the debts are the same. I carry a pocket-book everywhere, you understand.",
    job: "Fuel, goods, favours. Ask me what anything costs and I will tell you, plainly. It is the one honest trade.",
    thread: [
      { id: "dorrow.owes", ask: "What is in the Book?", say: "Everyone owes someone. It is the first line of the Book, and the last. I did not write it. I only keep it from smudging.", minMeetings: 1 },
      { id: "dorrow.page", ask: "Is any debt strange?", say: "There is one page where the creditor's name ought to be. It reads: a person unrecorded. The Ledger was founded to settle that entry, and it has been trying a very long time.", minMeetings: 3, after: "dorrow.owes" },
      { id: "dorrow.pay", ask: "Could it be paid?", say: "Would you like to pay it? Do not answer quickly. I never have.", minMeetings: 5, after: "dorrow.page" },
    ],
    points: [
      { entryId: "sight.missing-berth", say: "The harbor lists its berths, and it lists its ships, and they do not match. Go and stand where the board hangs, and be quiet, in the rest of the day." },
      { entryId: "sight.blank-nameplate", say: "Six ships of one family carry their names. Look for the seventh near the drydock. Be still there, at the growing hour." },
      { entryId: "obj.tin-soldier", say: "A warden here keeps a tin toy he cannot account for. Near the drydock, at rest, you may see where he keeps it." },
    ],
    allFound: "You have read what is not in the Book. I will not charge you for that.",
    farewell: "Come back with your accounts in order.",
  },
  {
    npc: "dissenter",
    who: "I am the Dissenter. I say what the others will not. They find it rude, and they are usually wrong, or half right.",
    placeHome: "Every place has its official story. I like to stand where the story runs out and see what is there.",
    placeAway: "Another place, another official story. I am enjoying how little it agrees with the last one.",
    job: "I argue. Someone has to. It is astonishing how much goes unchecked when no one does.",
    thread: [
      { id: "dissenter.hole", ask: "What do you argue about?", say: "They say the hole is a wound. I say it is the one place no one is watching. We have never settled it, and I am not sorry.", minMeetings: 1 },
      { id: "dissenter.edge", ask: "How do you know?", say: "I draw charts of it. The edge is clean. A wound does not have a clean edge. Someone cut, and cut carefully.", minMeetings: 3, after: "dissenter.hole" },
      { id: "dissenter.free", ask: "What would you do with it?", say: "It is the only place that is not his. Think about what you would do with that. I would go in without a witness's token. Would you?", minMeetings: 5, after: "dissenter.edge" },
    ],
    points: [
      { entryId: "sight.lane-to-nowhere", say: "The Cartographer's lane on the Station runs out at the old seam. Walk it to where it stops, and stand there a while." },
      { entryId: "sight.second-seam", say: "The Station's oldest seam has the same clean edge as my charts. Go to the lower rim, be still there, and see whether it agrees with me." },
    ],
    allFound: "You have looked where I looked. We will disagree about what it means. That is the best news I have had all week.",
    farewell: "Do not take my word for it.",
  },
  {
    npc: "surveyor",
    who: "The Surveyor. I measure things at their true size and I tell people. Sethane taught me, and has not yet told me to stop.",
    placeHome: "Here, at last, things are shown at their real size. It is humbling and it is wonderful, and I will not be talked out of either.",
    placeAway: "I measure this place too, in my head. It is a long habit. It is bigger than you think, unless it is smaller.",
    job: "I measure. Ships, journeys, rooms, lives. People ask for the number and then are quiet. I tell them anyway.",
    thread: [
      { id: "surveyor.size", ask: "What have you learned?", say: "The first thing you learn: nothing is as big as it looks, and a few things are bigger. I have not stopped being surprised by which.", minMeetings: 1 },
      { id: "surveyor.star", ask: "Is anything out of place?", say: "There is a star in no catalogue, and its light arrives late. Late for someone. I have stopped asking for whom.", minMeetings: 3, after: "surveyor.size" },
      { id: "surveyor.cord", ask: "What is Sethane like?", say: "Sethane's cord has one knot untied. She never said why, and I never asked. I think that was the right way round.", minMeetings: 4, after: "surveyor.star" },
    ],
    points: [
      { entryId: "sight.hung-star", say: "Fly out among the planets and be still beside one for a while, near the measuring hour. There is a star there that does not belong to any chart." },
      { entryId: "obj.measurers-cord", say: "A knotted cord is left by the old station in the sky. Its last knot is untied. Do not tie it. Stay near it, and keep quiet." },
    ],
    allFound: "You have seen what I could not make fit. Good. Then it is not only me.",
    farewell: "Measure twice.",
  },
  {
    npc: "archivist",
    who: "I am the Archivist. I sort what people set down and I do not read it. That is the whole of the trade, and the whole of the difficulty.",
    placeHome: "Nothing here asks anything of you. What is set aside is not forgotten. It is only kept.",
    placeAway: "I am out of my shelves, and I feel it. Everything is read here, and nothing is put away.",
    job: "I shelve what you have put down so that nothing is lost. I have never once been tempted to open one. I tell myself so often.",
    thread: [
      { id: "archivist.fold", ask: "What are you keeping?", say: "There is a folded paper here, sealed, that someone gave me to keep. I have never opened it. I have only held it, which is harder than it sounds.", minMeetings: 1 },
      { id: "archivist.alcove", ask: "Is there anything you leave alone?", say: "One alcove in the Archive is open and empty, and it was left so on purpose. I dust round it. I do not put anything in it.", minMeetings: 3, after: "archivist.fold" },
      { id: "archivist.penance", ask: "Why do you not read?", say: "I serve someone who would rather I did not say their name here. I read nothing, in return. It is not a punishment. It is a promise.", minMeetings: 4, after: "archivist.alcove" },
    ],
    points: [
      { entryId: "sight.open-alcove", say: "Go to the still threshold, when the day is resting, and stand there. Look for the alcove that was left open." },
      { entryId: "obj.vesh-paper-boat", say: "A boat folded from a page that had to be put down rests near the threshold. Sit where the day rests, and it may be there." },
      { entryId: "sight.lullaby-hollow", say: "A long hushed ship is moored in the Archive. Be still by it in the first light. Mind the hollow along its side." },
    ],
    allFound: "You have found what I could only shelve round. Thank you. It was heavy to carry alone.",
    farewell: "Soft steps.",
  },
  {
    npc: "keeper",
    who: "I am the Keeper. I tend the groves here, and I am Maren's heir, if anyone is. I would be glad of the help.",
    placeHome: "Everything here is slower than you expect, and better for it. Even the stalled things are only growing somewhere you cannot see.",
    placeAway: "I carry a little seed-packet wherever I go. It is not useful. It is comforting, which I have decided is a use.",
    job: "I tend the groves and I watch what grows from your Journeys. Mostly I wait. Waiting is half the work and no one believes me.",
    thread: [
      { id: "keeper.seed", ask: "Is anything not growing?", say: "There is a seed on a terrace that will not sprout. Maren left one instruction about it: Do not water what you cannot name.", minMeetings: 1 },
      { id: "keeper.bough", ask: "What about the great tree?", say: "The witness tree has one dead bough. It points somewhere. I have stopped asking where, and I check every morning that it still does.", minMeetings: 3, after: "keeper.seed" },
      { id: "keeper.water", ask: "Have you ever watered it?", say: "I have stood over it with the can, many times. I have never decided whether I am more afraid that it will grow or that it will not.", minMeetings: 5, after: "keeper.bough" },
    ],
    points: [
      { entryId: "sight.dead-bough", say: "Walk to the great tree and stand beneath it, quietly, in the growing hour. Look up along the dead bough, and where it points." },
    ],
    allFound: "You have stood under the bough. Then you have seen what I have, and you are not the only one now.",
    farewell: "Go slowly. Things grow where you are patient.",
  },
  {
    npc: "hesk",
    who: "Hesk. Warden-General. I see that the harbor's rules are kept, and I keep a few of my own.",
    placeHome: "The Station runs on small rules, kept every day. A harbor that forgets them stops being one. I have never once enjoyed saying so.",
    placeAway: "Different harbor, same rules in other words. I look for the one they have all stopped enforcing. It is usually the kind one.",
    job: "I inspect, I patrol, I keep the keys. Mostly I fold what strangers leave behind, so it is ready if they come back for it.",
    thread: [
      { id: "hesk.inspect", ask: "Is my ship in order?", say: "Your trail is clean and your papers are in order. That is all an inspection is, and no one believes me. I only ask because the harbor must.", minMeetings: 1 },
      { id: "hesk.door", ask: "Which door do you keep shut?", say: "There is a door in the annexes I keep locked. It is not a secret. There is a room behind it, of small things, and I cannot give them away or throw them out.", minMeetings: 2, after: "hesk.inspect" },
      { id: "hesk.keep", ask: "What is in the room?", say: "A boot. A ribbon. A tin soldier I do not know the owner of, and polish anyway. One day I will ask you to keep one safe, off the books. Not today.", minMeetings: 4, after: "hesk.door" },
    ],
    points: [
      { entryId: "sight.locked-room", say: "Go up among the annexes in the first light and be quiet beside the locked door. It will not open. Stand there anyway." },
      { entryId: "obj.tin-soldier", say: "Near the drydock, when the day rests, a tin toy has been put where it can be found." },
      { entryId: "sight.tamsins-ward", say: "In the People world there is a long warm ward of narrow cots. Sit in it in the first light, and say nothing." },
    ],
    allFound: "You have seen what I keep. Say nothing of it. Thank you.",
    farewell: "Keep your trail clean.",
  },
  {
    npc: "tamsin",
    who: "Tamsin. I tend the ward for the Open Hand. I have buttons, if you have lost one.",
    placeHome: "People is narrow cots and long soup. I like it because no one hurries here, and no one is hushed for crying.",
    placeAway: "I carry my apron wherever I go. The ill are everywhere, and so are the ones who do not yet know they are keeping someone.",
    job: "I tend the Faded. They come back in pieces, and the pieces are other people's. I sit with each piece and ask it nothing.",
    thread: [
      { id: "tamsin.soup", ask: "Could I help with the ward?", say: "Carry the soup, and set it down gently. Some of them will thank you in a voice that is not theirs. Do not correct it.", minMeetings: 1 },
      { id: "tamsin.pieces", ask: "How do they come back?", say: "In pieces of whoever remembered them. The more a person is remembered, the more of them returns. So I remember them. It is the only medicine I have.", minMeetings: 3, after: "tamsin.soup" },
      { id: "tamsin.keep", ask: "Could I remember one?", say: "Keep one in your mind a while. Not forever. Just long enough that they can finish. I will not ask whose. You will know.", minMeetings: 5, after: "tamsin.pieces" },
    ],
    points: [
      { entryId: "sight.tamsins-ward", say: "There is a long warm ward in the People world. Go in the first light and be still at the foot of a cot." },
      { entryId: "sight.empty-chair", say: "Every table in the hearths is laid for one more than came. Sit at one when the hearths are lit." },
      { entryId: "obj.kiths-drawing", say: "A child draws a woman with no face. It is left where the growing hour finds it, among the hearths." },
    ],
    allFound: "You have sat where I sit. Then you know why I do not hurry.",
    farewell: "Mind the soup.",
  },
  {
    npc: "ossian",
    who: "Ossian Reed. The last honest liar, which sounds like a joke and is a trade. I tell a wrong story so you will go looking for the right one.",
    placeHome: "The Station is where stories are swapped for berths. I once traded one tale for a whole season's passage, and it was the wrong one.",
    placeAway: "Every place has its own version of the same lie. I collect them. I keep the best for when I am sure you are listening.",
    job: "I tell tales. One word in each is wrong. Catch it, and I owe you the true one. No one has collected yet. It is a very patient debt.",
    thread: [
      { id: "ossian.wrong", ask: "Tell me a story.", say: "Once a ribbon was tied to a stair-post, and each morning it was a day older than the hand that tied it. That is nearly how it goes. Ask someone else, and see where we differ.", minMeetings: 1 },
      { id: "ossian.three", ask: "Which part is wrong?", say: "Ask three people for it. The wrong word will be the same wrong word in each, because I told them all the same. That is how you will know it was me.", minMeetings: 3, after: "ossian.wrong" },
      { id: "ossian.true", ask: "What is the true one?", say: "I am coming to it. There is a girl in it who is always a day behind, and I have never decided whether I invented her or only gave her a name. Not today.", minMeetings: 5, after: "ossian.three" },
    ],
    points: [
      { entryId: "obj.follower-ribbon", say: "Walk the stair in the Deep Past at the turn of the day, and be still. There is a ribbon on the post." },
      { entryId: "sight.lane-to-nowhere", say: "On the Station a lane runs out where the old seam is. Stop where it stops, and listen." },
    ],
    allFound: "You have found where I told it wrong. I owe you nothing, and I will tell you anyway.",
    farewell: "Mind the loose word.",
  },
  {
    npc: "ilsabet",
    who: "Ilsabet Marrow. Cartographer. My charts change when they are unrolled, which I have stopped apologising for.",
    placeHome: "Scale is the one place that shows things at their true size. A map here is a kindness: it says how small you are, and how far.",
    placeAway: "I map wherever I stand. It is a bad habit, and every place is grateful for it once it has been drawn.",
    job: "I draw lanes. The ones that exist, and the one that ends at a seam, which I cannot stop drawing.",
    thread: [
      { id: "ilsabet.lane", ask: "What are you drawing?", say: "A lane on the Station that runs to the old seam and stops. I did not make it stop. I only drew where it did.", minMeetings: 1 },
      { id: "ilsabet.copy", ask: "Is someone using your charts?", say: "The Dissenter has a copy of mine. We stopped speaking over whether to publish it. We were both right, which is the worst way to stop speaking.", minMeetings: 3, after: "ilsabet.lane" },
      { id: "ilsabet.margin", ask: "What lies past the seam?", say: "I do not know. I am drawing a lane beyond it, in pencil. Stand at the lower rim, be still, and tell me what you hear. I cannot stand there myself.", minMeetings: 4, after: "ilsabet.copy" },
    ],
    points: [
      { entryId: "sight.second-seam", say: "Go to the Station's lower rim and be still there, when the day turns. Tell me whether it hums." },
      { entryId: "sight.lane-to-nowhere", say: "Walk the lane on the Station to where it stops. Stand a while." },
      { entryId: "sight.hung-star", say: "Among the planets there is a star no chart owns. Be still beside one, near the measuring hour." },
    ],
    allFound: "You have stood where I cannot. Thank you. I will draw it in pencil first.",
    farewell: "Pencil first.",
  },
  {
    npc: "pell",
    who: "Pell. I leave notes. I am always, always a little late, and I have stopped minding. Mostly.",
    placeHome: "The harbor was where the world was yesterday when I arrived. It is always yesterday here for me, and very tidy.",
    placeAway: "Everywhere I arrive is where the world was yesterday. It is a long way to be behind.",
    job: "I follow. A coin, a ribbon, a note: that is how I say I was here, and I hope it is how you know.",
    thread: [
      { id: "pell.note", ask: "Did you leave this?", say: "I leave a note ahead of me. It is meant for whoever comes next. Today that is you.", minMeetings: 1 },
      { id: "pell.ribbon", ask: "Why a ribbon?", say: "A ribbon is a day newer each morning, if you tie it right. It is how I know where you were.", minMeetings: 2, after: "pell.note" },
      { id: "pell.light", ask: "Why are you always behind?", say: "I think I am walking in a star's late light. Someone hung it for whoever might be walking, and I took it for mine. I hope that was allowed.", minMeetings: 4, after: "pell.ribbon" },
    ],
    points: [
      { entryId: "sight.hung-star", say: "Its light is late, as I am. Be still beside a planet near the measuring hour, and it may reach you." },
      { entryId: "obj.follower-ribbon", say: "On the stair in the Deep Past there is a ribbon. Be quiet there at the turn of the day." },
    ],
    allFound: "You have been where my light lands. Then we have almost met.",
    farewell: "See you yesterday.",
  },
  {
    npc: "wim",
    who: "Wim Ostler, junior clerk to the berth-log. I keep it tidy, and I try very hard to keep it true.",
    placeHome: "The Station keeps a berth for everyone who might arrive. I like that. I like that it keeps one for someone who never has.",
    placeAway: "Away from the harbor I still count: berths, ships, loaves, hours. It is calming. The numbers rarely disagree with me, only with each other.",
    job: "I reconcile the berth-log. Every berth is paid, and every ship is accounted for, and one of each somehow is not.",
    thread: [
      { id: "wim.log", ask: "Does the log balance?", say: "Nearly. One berth is paid every year and never occupied. I cannot find who pays it. I can find who does not ask.", minMeetings: 1 },
      { id: "wim.empty", ask: "Where is the empty berth?", say: "By the drydock. The cradle is swept and oiled. I went once to prove it was only a cradle. It was only a cradle. It was also warm.", minMeetings: 3, after: "wim.log" },
      { id: "wim.pay", ask: "Who pays it?", say: "I would rather you did not ask me that. Ask me whether I mind. I do not. Brannoch taught me that what is kept is not owed to you. It is for you.", minMeetings: 5, after: "wim.empty" },
    ],
    points: [
      { entryId: "sight.missing-berth", say: "Stand where the berth board hangs, when the day rests, and be quiet. Count what you can." },
      { entryId: "sight.blank-nameplate", say: "By the drydock a hull is expected that has no name yet. Be still there at the growing hour." },
    ],
    allFound: "You have stood where I count. Please do not tell me what you found. I would have to know.",
    farewell: "Mind the berths.",
  },
];

export const NPC_TALK_BY_ID: ReadonlyMap<string, NpcTalk> = new Map(NPC_TALK.map((t) => [t.npc, t]));

/** Who can be talked to: exactly the people with a conversation (Eternity cannot be asked; the harbor controller answers in her own panel). */
export const canTalkTo = (npc: string): boolean => NPC_TALK_BY_ID.has(npc);

export interface TalkContext {
  meetings: number;
  /** Thread steps already heard (remembered on the device; a presentation memory only — nothing is gated on it but the next step). */
  heard: ReadonlySet<string>;
  /** Entries already found in the Book. */
  found: ReadonlySet<string>;
}

/** The thread steps the player may ask about now, in order. */
export function openSteps(t: NpcTalk, ctx: Pick<TalkContext, "meetings" | "heard">): TalkStep[] {
  return t.thread.filter((s) => s.minMeetings <= ctx.meetings && (!s.after || ctx.heard.has(s.after)));
}

/** The first thing they can still point toward (not yet found), or null. */
export function pointerFor(t: NpcTalk, found: ReadonlySet<string>): TalkPoint | null {
  return t.points.find((p) => !found.has(p.entryId)) ?? null;
}
