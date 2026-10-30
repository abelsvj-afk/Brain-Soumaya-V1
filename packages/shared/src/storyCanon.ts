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
  E("relic.witness-without-a-name", "object", RELIC_BY_ID.get("witness-without-a-name")!.world, "The Witness Without a Name", ["A1", "A10"], ["c.relic.what-she-held-when-she-asked"], { text: { plain: RELIC_BY_ID.get("witness-without-a-name")!.lore } }),
  E("relic.harbor-nail", "object", RELIC_BY_ID.get("harbor-nail")!.world, "Harbor Nail", ["A3"], ["c.teru.walked-toward-the-sealed-seam"], { text: { plain: RELIC_BY_ID.get("harbor-nail")!.lore } }),
  E("relic.mooring-ring", "object", RELIC_BY_ID.get("mooring-ring")!.world, "Mooring Ring", ["A8"], ["c.brannoch.tied-to-nothing"], { text: { plain: RELIC_BY_ID.get("mooring-ring")!.lore } }),
  E("relic.dawn-leaf", "object", RELIC_BY_ID.get("dawn-leaf")!.world, "Dawn Leaf", ["A5"], ["c.iselle.tried-to-grow-her-back"], { text: { plain: RELIC_BY_ID.get("dawn-leaf")!.lore } }),
  E("relic.witness-seed", "object", RELIC_BY_ID.get("witness-seed")!.world, "Witness Seed", ["A5", "A2"], ["c.wend.planted-themself"], { text: { plain: RELIC_BY_ID.get("witness-seed")!.lore } }),
  E("relic.first-light-shard", "object", RELIC_BY_ID.get("first-light-shard")!.world, "First Light Shard", ["A11"], ["c.orsolya.first-record-in-matter"], { text: { plain: RELIC_BY_ID.get("first-light-shard")!.lore } }),
  E("relic.basin-stone", "object", RELIC_BY_ID.get("basin-stone")!.world, "Basin Stone", ["A4"], ["c.cael.tears-counted"], { text: { plain: RELIC_BY_ID.get("basin-stone")!.lore } }),
  E("relic.lantern-of-keeping", "object", RELIC_BY_ID.get("lantern-of-keeping")!.world, "Lantern of Keeping", ["A9"], ["c.perrin.kept-a-candle-for-the-unremembered"], { text: { plain: RELIC_BY_ID.get("lantern-of-keeping")!.lore } }),
  E("relic.hearth-ember", "object", RELIC_BY_ID.get("hearth-ember")!.world, "Hearth Ember", ["A9", "A10"], ["c.maud-edric.went-in-together"], { text: { plain: RELIC_BY_ID.get("hearth-ember")!.lore } }),
  E("relic.thread-of-many", "object", RELIC_BY_ID.get("thread-of-many")!.world, "Thread of Many", ["A6", "A8"], ["c.many-handed.forty-one-became-forty-two"], { text: { plain: RELIC_BY_ID.get("thread-of-many")!.lore } }),
  E("relic.star-hanger", "object", RELIC_BY_ID.get("star-hanger")!.world, "Star Hanger", ["A8"], ["c.sahl.hung-a-star-for-someone-walking"], { text: { plain: RELIC_BY_ID.get("star-hanger")!.lore } }),
  E("relic.sunward-compass", "object", RELIC_BY_ID.get("sunward-compass")!.world, "Sunward Compass", ["A8"], ["c.odessa.compass-points-where-she-could-not-look"], { text: { plain: RELIC_BY_ID.get("sunward-compass")!.lore } }),
  E("relic.stillness-seal", "object", RELIC_BY_ID.get("stillness-seal")!.world, "Stillness Seal", ["A1"], ["c.noor.asked-vesh-what-rest-was"], { text: { plain: RELIC_BY_ID.get("stillness-seal")!.lore } }),
  E("relic.unopened-fold", "object", RELIC_BY_ID.get("unopened-fold")!.world, "Unopened Fold", ["A1", "A9"], ["c.folded-one.letter-never-sent"], { text: { plain: RELIC_BY_ID.get("unopened-fold")!.lore } }),
  E("relic.unnumbered-fragment", "object", RELIC_BY_ID.get("unnumbered-fragment")!.world, "Unnumbered Fragment", ["A11", "A8"], ["c.uncounted.knew-her-before-the-hole"], { text: { plain: RELIC_BY_ID.get("unnumbered-fragment")!.lore } }),

  // --- The wrong things, objects of the cast, and the places that carry the web ---
  E("obj.tin-soldier", "object", "great-station", "Hesk's Tin Soldier", ["A4"], ["c.hesk.polishes-what-he-does-not-recognise"], {
    text: { plain: "A small tin soldier, one arm missing. It was found in the coat of a person no one remembers, and has been polished every day since by a man who says he has never seen it before." },
  }),
  E("sight.locked-room", "sight", "great-station", "Hesk's Locked Room", ["A4"], ["c.hesk.keeps-the-faded-belongings"], { text: { plain: "A door in the Warden-General's quarters that no one has seen unlocked. Beneath it comes the smell of old wool and polished tin. Behind it are hundreds of small belongings, each tagged in a careful hand: a tin toy, a ribbon, a boot. None of them is evidence of anything. He has not been able to throw one away." } }),
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
  E("sight.tamsins-ward", "sight", "people", "Tamsin's Ward", ["A4"], ["c.tamsin.counts-one-more"], { text: { plain: "A long warm room of narrow cots. The people in them are a little out of focus, as a face is in a window at dusk. A woman in a green apron counts them aloud each evening, and each evening the count comes out one higher than the cots. She says it is only a habit. She does not look at the empty one." } }),
  E("sight.empty-chair", "sight", "people", "The Empty Chair", ["A2", "A10"], ["c.hearths.one-place-too-many"], { text: { plain: "In every home the table is laid for one more than the family holds. No one remembers setting the place. No one has been seen to sit in it. No one will clear it." } }),
  E("obj.follower-ribbon", "object", "anywhere", "The Follower's Ribbon", ["A8"], ["c.follower.is-always-one-day-behind"], { text: { plain: "A ribbon tied to a gate post, still knotted. A day's dust lies on it, no more. Someone passed this way a day ahead of you and left it where you would find it. Carry it or leave it; the knot is the same either way." } }),
  E("obj.anonymous-payments", "object", "great-station", "The Mooring Payments", ["A8", "A4"], ["c.clerk.berth-paid-by-an-unknown-hand"], { text: { plain: "A berth-log for a mooring where no ship has ever tied. Each year the fee is paid in full by an unknown hand, a hand that changes as the century turns and is always, somehow, almost your own. The clerk has stopped asking whose. He enters it. The berth stays open." } }),
  E("sight.lane-to-nowhere", "sight", "anywhere", "The Lane That Goes Nowhere", ["A3"], ["c.cartographer.lane-ends-at-the-second-seam"], { text: { plain: "On the Cartographer's chart there is a lane that goes nowhere: it leaves a harbor, runs a long way through empty dark, and stops at a point that is on no map. Each time she unrolls the chart it is a little longer. Ships that drift along it say the dark grows warmer toward the end." } }),
  E("sight.ysmerel-at-the-edge", "sight", "anywhere", "The Choirmaster at the Edge", ["A4", "A6"], ["c.ysmerel.sits-at-the-hush-by-night"], { text: { plain: "At the pale wall, past the last lamp, a few people sit on stools through the night, doing nothing. One is a tall woman whose hand keeps a rhythm on her knee: eleven beats, and then a rest. When morning comes she is gone before the first hymn." } }),
  E("sight.long-room", "sight", "eternity", "The Long Room", ["A9", "A11", "A8"], ["c.eternity.tends-fifteen-lamps"], { text: { plain: "A corridor of open doors, each opening on a small warm room with a single lamp, and every lamp has been trimmed by the same careful hand. Nothing here is dusty. Nothing here is in use. At the far end a last door stands lit, and the room beyond it is set, quite plainly, for someone who has not yet arrived." } }),
  E("echo.eighth-bell", "echo", "eternity", "The Eighth Bell", ["A7", "A6"], ["c.watch.eighth-keeper-has-no-bell"], { text: { plain: "Seven bells ring the hours. After the seventh there is a pause the length of one more bell, and in the pause someone stands with a closed hand raised, ringing nothing, and the air agrees." } }),
  E("obj.dissenters-chart", "object", "anywhere", "The Dissenter's Chart", ["A5"], ["c.dissenter.hole-has-a-clean-edge"], { text: { plain: "A chart of the one place no one has charted, drawn with a clean edge and no coastline: a circle, perfectly smooth. In the margin, in a rude hand: it is the only place that is not his. Underneath, smaller, in the same hand, struck out: and I am afraid of it." } }),
  E("sight.unlooked-direction", "sight", "eternity", "The Direction He Does Not Look", ["A11", "A5"], ["c.eternity.never-looks-one-way"], { text: { plain: "He looks at everything. He does not look in one direction, and wherever you stand it is the same direction, as though the thing he does not look at were walking beside you." } }),
  E("sight.blank-nameplate", "sight", "anywhere", "The Blank Nameplate", ["A12"], ["c.soumaya.hull-has-no-nameplate"], { text: { plain: "Six ships of one family carry their names on the flank in a plain hand. Hers carries a clean rectangle of bare metal where a name would go. It has been polished, though no one admits to polishing it. When it is asked about, her engines hum a half-step lower." } }),
  E("sight.lullaby-hollow", "sight", "quiet-archive", "The Lullaby's Hollow", ["A12", "A1"], ["c.vesh.ship-has-a-hull-length-gap"], { text: { plain: "A long, hushed ship lies at its mooring in the Archive like a swan asleep with its head under its wing. Along its flank runs one smooth hollow, the whole length of the hull, where something was taken out so cleanly that the edges are soft. On quiet nights the hollow hums, very low, as a held note does." } }),
  // --- Draft 7 (locked 2026-10-31), the Station knot: a lamp kept for one who walked in; one person kept in three places. ---
  E("sight.gatepost-lamp", "sight", "great-station", "The Lamp Nobody Pays For", ["A3", "A8"], ["c.mara.keeps-a-lamp-lit-for-one-who-walked-in"], { text: { plain: "At the foot of the harbor gate stands one lantern on an iron post, lit every dusk by a weathered woman in a long green scarf. No berth is listed under it and no ship has ever moored near it. She pours the oil with great care, and never looks up, and says only that someone might be walking." } }),
  E("obj.linnets-coat", "object", "great-station", "The Coat on the Hook", ["A4", "A10"], ["c.linnet.one-person-kept-in-three-places"], { text: { plain: "In the locked store-room a long plain coat hangs alone on its hook beneath a single lamp. Beside it is pinned a child's drawing of a woman with no face. Elsewhere a narrow cot is made up each morning for whoever wore it. No one has put the three together, and each of the three who keep a part has been careful never to ask." } }),
  // --- Draft 7 slices B and C (the Archive's silence; the ward's laugh) ---
  E("sight.ruels-laugh", "sight", "people", "The Laugh in the Ward", ["A10", "A4"], ["c.ruel.laughs-on-days-tamsin-is-away"], { text: { plain: "In the ward one cot is occupied only on the days the woman in the green apron is elsewhere. Whoever lies there is faint at the edges and laughs, quietly, at something no one else heard, and the laugh is the warmest thing in the room. By the time she returns the cot is made and empty." } }),
  E("sight.aldous-at-rest", "sight", "quiet-archive", "The One Who Rests in the Alcove", ["A2", "A6"], ["c.aldous.stands-at-rest-in-the-silence"], { text: { plain: "Some visitors say the open alcove is not empty: a tall old man in a pale robe stands in it with a hymnal against his chest, faint as breath on glass. His eyes are closed. The hush gathers on the floor around him and goes no nearer. The book is missing a page, and he looks as if he had chosen that." } }),
  E("sight.ysmerels-hum", "sight", "quiet-archive", "The Note She Keeps", ["A4", "A6"], ["c.ysmerel.hums-the-first-note-once"], { text: { plain: "If you stay at the edge long enough, the choirmaster with her hand flat on her chest hums one note, once, the first of a verse, and stops. The silent singers do not move. In the aisle the stall that is always left empty is lit, and stays lit a little after the note is gone." } }),
  E("obj.blank-line", "object", "great-station", "The Line at the Foot of the Page", ["A4"], ["c.ledger.every-page-ends-in-one-blank-line"], { text: { plain: "Every page of the Great Book is ruled and filled to the last line but one. The last is left empty, and the binder swears it was a printing error. The keeper of the Book turns each page with his eyes on the room, never on that line, and his pen hovers over it a moment longer than over any other." } }),
  // --- Draft 7 slice D (the Garden, the Dawn, the Hearths): rests, not endings ---
  E("sight.marens-winter", "sight", "growing-place", "The Winter in the Garden", ["A5", "A8"], ["c.maren.rests-in-the-one-winter"], { text: { plain: "In one corner of the garden it is always a little winter. A long-handled spade stands upright in the snow there, a wool scarf knotted round its shaft. The snow is not drifted against it. The Keeper walks round it by habit, and says only that some things are not finished, only resting." } }),
  E("obj.orus-bead", "object", "deep-past", "A Bead of the First Morning", ["A3", "A8"], ["c.oru.keeps-the-morning-by-being-remembered-to"], { text: { plain: "A bead no larger than a thumbnail, held out by an old man who asks you, gently, what you were doing yesterday. Each time you tell him, it grows a little warmer in his palm, and he tells you a little more of a morning you did not see." } }),
  E("account.tall-tale", "account", "people", "The Tall Tale with One Thing Wrong", ["A8", "A6"], ["c.ossian.tells-it-wrong-the-same-way"], { text: { plain: "He tells the story the same way each time, with one small thing wrong in it, always the same small thing. Ask three people who were there and each will correct it differently, and no two corrections will agree, and he grins as though that were the point." } }),
  E("obj.sleepwalkers-cup", "object", "great-station", "The Cup She Keeps", ["A8", "A4"], ["c.sleepwalker.keeps-a-shared-cup-at-dawn"], { text: { plain: "At first light a woman in a pale nightgown stands at the end of the dock holding a plain cup in both hands, content, not knowing where she is. A tended lantern burns on the rail beside a second cup, empty, set out for no one in particular. When the light is full she is only a woman again, and she does not know you, and she does not put the cup down." } }),
  // --- The Faded Ward, Entire (S-VII; docs/specs/seam-faded-ward-2026-10-31.md): never a count, never whether they all return ---
  E("sight.ward-door", "sight", "faded-ward", "The Door Left Ajar", ["A4"], ["c.ward.door-is-never-latched"], { text: { plain: "The ward's door has no lock and has never been shut all the way. A hand's breadth of the hall's light lies across the threshold at every hour, and the people who go in are careful not to widen it." } }),
  E("sight.ward-long-hall", "sight", "faded-ward", "The Hall That Goes On", ["A4"], ["c.ward.hall-runs-past-the-fog"], { text: { plain: "Cots stand along both walls, made up and tidy, and they run on into the fog at the far end of the hall. Walk toward them and the near ones stay near. Nobody here has said where they stop, and nobody seems to want to." } }),
  E("sight.ward-lanterns", "sight", "faded-ward", "The Lanterns Trimmed by Night", ["A8","A10"], ["c.ward.lanterns-are-trimmed-by-an-unseen-hand"], { text: { plain: "Every lantern in the hall burns at the same height. They are trimmed in the night, evenly, by someone no visitor has met, and the wicks are never short." } }),
  E("obj.ward-bowl", "object", "faded-ward", "The Bowl That Stays Warm", ["A10"], ["c.ward.bowl-is-always-just-warm"], { text: { plain: "A single bowl of soup stands on a small table in the aisle. It is warm when you reach it, whatever the hour, and it has never been seen to be emptied or refilled." } }),
  E("obj.ward-soldier", "object", "faded-ward", "The Soldier Beside the Small Bed", ["A4","A10"], ["c.ward.tin-soldier-beside-a-small-bed"], { text: { plain: "On the floor beside a small bed stands a tin soldier, polished until its paint has worn through. The bed is made, and has a child's dent in the pillow. The soldier faces the door." } }),
  E("sight.ward-window", "sight", "faded-ward", "The Window That Keeps One Night", ["A8"], ["c.ward.window-shows-one-unchanging-night"], { text: { plain: "The tall window in the left wall shows the same few stars, in the same places, at every hour and on every visit. Someone has wiped the glass clean from the inside." } }),
  E("obj.ward-button", "object", "faded-ward", "A Button in a Pocket", ["A10"], ["c.tamsin.keeps-buttons-for-those-who-return"], { text: { plain: "She keeps a handful of loose buttons in her apron pocket and turns them over while she talks. Every one is from a coat no patient in the ward owns, and she has not yet been asked whose they are." } }),
  E("sight.ward-blank-cot", "sight", "faded-ward", "The Cot with a Blank Tag", ["A4","A10"], ["c.ward.one-cot-is-made-up-for-no-name"], { text: { plain: "One cot is made up fresh each morning with a folded blanket and a tag at its foot with nothing written on it. The coat on the hook above it is not anyone's in the ward. Whoever made the cot up does not say who it is for." } }),
  E("echo.ward-hum", "echo", "faded-ward", "The Hum Over the Cots", ["A10","A4"], ["c.ward.a-hum-answers-from-one-cot"], { text: { plain: "Under the quiet there is a hum that belongs to no one in the hall, low and even, and it answers from the same cot each time. When you stop to listen it keeps the same pitch as the laugh that was heard there." } }),
  E("echo.ward-far-breath", "echo", "faded-ward", "A Breath From the Far End", ["A4"], ["c.ward.something-breathes-where-the-hall-ends"], { text: { plain: "At the far end of the hall, where the fog thickens, there is a long slow breath, in and out. It is not any one sleeper's. It keeps time with the lanterns." } }),
  E("echo.ward-count", "echo", "faded-ward", "The Count She Loses", ["A4"], ["c.tamsin.loses-her-count-in-the-same-place"], { text: { plain: "She counts under her breath as she walks the rows, and loses the count at the same place each time, and begins again without complaint. She says there is always one more than she reaches." } }),
  E("obj.ward-wake", "object", "faded-ward", "What Is Left by the Door", ["A4","A10"], ["c.hesk.leaves-a-soldier-on-the-sill"], { text: { plain: "On the sill by the door a polished tin soldier sometimes stands overnight. By morning it has been taken away again, and the warden who leaves it will not say where it goes." } }),
  // --- The Road to the Seam (S-III; docs/specs/seam-road-to-the-seam-2026-10-31.md): never where Teru ended ---
  E("sight.road-mouth", "sight", "road-to-the-seam", "Where the Road Leaves the Station", ["A3"], ["c.road.leaves-by-a-plain-arch"], { text: { plain: "Under the Station, where the harbor's last lamp gives out, a plain stone arch opens on a road. No sign names it and no berth lists it. The dockhands cross the harbor floor to the arch only on errands, and come back by the same way, a little quieter." } }),
  E("sight.road-lamps", "sight", "road-to-the-seam", "Lamps at Even Spacing", ["A3","A8"], ["c.road.lamps-are-lit-ahead-of-you"], { text: { plain: "The lamps along the road hang at the same height and the same distance, on both walls. They are always lit a little ahead of wherever you stand, and no one has seen who lights them." } }),
  E("obj.road-nails", "object", "road-to-the-seam", "A Nail at Every Stride", ["A3"], ["c.road.a-warm-nail-every-stride"], { text: { plain: "In the right-hand wall an iron nail is set at every stride, at the height of a man's shoulder. Each is faintly warm to the hand, as if just set, and the line of them is the straightest thing on the road." } }),
  E("sight.road-chalk", "sight", "road-to-the-seam", "Chalk Low on the Wall", ["A3","A10"], ["c.road.a-child-counted-along-the-wall"], { text: { plain: "Low on the left-hand wall, at the height of a child, runs a line of short chalk strokes, counted off in small groups and never smudged. Whoever made them walked beside the wall for a long way, and did not once stop to rest." } }),
  E("obj.road-doorframe", "object", "road-to-the-seam", "A Door-Frame With Nothing In It", ["A3"], ["c.road.a-frame-stands-with-no-door"], { text: { plain: "Against the right-hand wall stands a door-frame with no door in it and nothing behind it but more wall. The hinges are bright. Someone keeps them oiled, and has never been seen to use them." } }),
  E("sight.road-post", "sight", "road-to-the-seam", "The Wardens' Post", ["A4"], ["c.road.an-empty-post-and-a-worn-bench"], { text: { plain: "An iron post stands at the roadside, and beside it a bench worn pale in two places. No Warden is stationed here and none has been for longer than the harbor keeps records. The bench is swept." } }),
  E("sight.road-chalk-end", "sight", "road-to-the-seam", "Where the Chalk Stops", ["A3","A10"], ["c.road.the-chalk-stops-and-the-road-does-not"], { text: { plain: "The chalk strokes on the wall stop in the middle of a group, as though the one making them had been called away. The road goes on past that point exactly as it did before it." } }),
  E("echo.road-steps", "echo", "road-to-the-seam", "Steps Ahead", ["A8"], ["c.road.steps-keep-just-ahead"], { text: { plain: "If you stand still on the road at the right hour, you can hear footsteps a little way ahead, small and sure. They keep their distance exactly. When you walk faster they do not, and when you stop they do not either." } }),
  E("obj.road-oil", "object", "road-to-the-seam", "A Can of Oil for the Lamps", ["A3","A8"], ["c.calend.leaves-oil-for-the-lamps"], { text: { plain: "A small can of lamp oil stands by the road with its lid screwed down and its sides dry. The Wayfarer says he leaves it where it will be needed, and does not say by whom." } }),
  E("sight.road-far", "sight", "road-to-the-seam", "The Road Goes On", ["A3","A4"], ["c.road.goes-on-past-the-last-lamp"], { text: { plain: "Past the last lamp the road does not stop. The floor goes on level into the fog, and the fog is lit from within. Nothing here suggests an end to it, and nothing here suggests that anyone is afraid of that." } }),
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
  // Draft 7 §3 — the Station knot
  T("sight.gatepost-lamp", "relic.harbor-nail", "provenance", "the lamp is kept by Teru's sister; it is lit for him"),
  T("sight.gatepost-lamp", "obj.doorkeepers-nail", "echo", "two warm things kept for the same man"),
  T("sight.gatepost-lamp", "sight.missing-berth", "absence", "a lamp with no berth beside a berth with no ship"),
  T("obj.linnets-coat", "sight.locked-room", "provenance", "it hangs among the belongings of the Faded"),
  T("obj.linnets-coat", "obj.kiths-drawing", "echo", "the coat the faceless woman is drawn in"),
  T("obj.linnets-coat", "sight.tamsins-ward", "echo", "the cot made up for whoever wore it"),
  // Draft 7 §3 — W7, W8, W9: the ward's laugh; the first Silence
  T("sight.ruels-laugh", "sight.tamsins-ward", "echo", "the laugh returns in a patient on the days she is not there"),
  T("sight.ruels-laugh", "sight.empty-chair", "absence", "a cot made up for someone who is only partly there"),
  T("sight.ruels-laugh", "relic.witness-without-a-name", "echo", "the one warm thing that survived"),
  T("sight.aldous-at-rest", "sight.open-alcove", "provenance", "the alcove is his; it only looks empty"),
  T("sight.aldous-at-rest", "echo.hymnal-gap", "provenance", "the page torn from the hymnal is the page he carried out"),
  T("sight.aldous-at-rest", "sight.ysmerel-at-the-edge", "absence", "she sits at the edge of the silence he went into first"),
  T("sight.ysmerels-hum", "sight.ysmerel-at-the-edge", "habit", "she keeps the edge by night"),
  T("sight.ysmerels-hum", "obj.choirmasters-breath", "echo", "the held breath, given once as a note"),
  T("sight.ysmerels-hum", "sight.aldous-at-rest", "provenance", "she hums toward the one who refused"),
  T("obj.blank-line", "obj.dorrows-page", "echo", "one page keeps a debt unrecorded; every page keeps a line unwritten"),
  T("obj.blank-line", "obj.anonymous-payments", "possession", "the Ledger leaves room for the hand that pays"),
  T("obj.blank-line", "echo.hymnal-gap", "echo", "a missing page and a missing line are one shape"),
  T("sight.marens-winter", "sight.dead-bough", "absence", "a bough that never leafs beside a corner that never thaws"),
  T("sight.marens-winter", "relic.dawn-leaf", "provenance", "Iselle walked in; Maren stayed with the silence"),
  T("sight.marens-winter", "relic.witness-seed", "echo", "the Keeper holds both an instruction and a seed"),
  T("obj.orus-bead", "relic.first-light-shard", "provenance", "the same morning, a shard and a bead"),
  T("obj.orus-bead", "sight.missing-stratum", "absence", "a morning with no layer of its own"),
  T("obj.orus-bead", "relic.basin-stone", "echo", "what is kept warm by being returned to"),
  T("account.tall-tale", "obj.follower-ribbon", "provenance", "he may have told her into being, one day behind"),
  T("account.tall-tale", "obj.anonymous-payments", "echo", "a small wrong thing repeated until it is a habit"),
  T("obj.sleepwalkers-cup", "companion.dock-1", "echo", "the stranger who shared a cup with you had shared one with her"),
  T("obj.sleepwalkers-cup", "obj.sleepwalkers-lantern", "possession", "she carries a flameless lantern by night and a cup at dawn"),
  T("obj.sleepwalkers-cup", "sight.gatepost-lamp", "echo", "a lamp kept lit on the dock for someone who is not there"),
  // The Road to the Seam (S-III)
  T("sight.road-mouth", "sight.second-seam", "echo", "the sealed seam the road is said to lead toward"),
  T("sight.road-mouth", "relic.harbor-nail", "provenance", "the arch beside the door where Teru set his nail"),
  T("sight.road-lamps", "sight.gatepost-lamp", "echo", "a lamp lit for someone who walked in"),
  T("sight.road-lamps", "sight.ward-lanterns", "echo", "lanterns trimmed by an unseen hand"),
  T("obj.road-nails", "relic.harbor-nail", "provenance", "set one to a stride, each warm"),
  T("obj.road-nails", "obj.doorkeepers-nail", "echo", "the same warmth in every nail"),
  T("sight.road-chalk", "obj.kiths-drawing", "echo", "a child's hand keeping a count"),
  T("sight.road-chalk", "sight.gatepost-lamp", "provenance", "the girl who later keeps the lamp"),
  T("obj.road-doorframe", "obj.doorkeepers-nail", "possession", "a frame a door-keeper oils"),
  T("obj.road-doorframe", "sight.ward-door", "absence", "a frame with no door beside a door never latched"),
  T("sight.road-post", "sight.locked-room", "habit", "the Wardens keep what others leave"),
  T("sight.road-post", "obj.tin-soldier", "echo", "a post held by someone who is not there"),
  T("sight.road-chalk-end", "sight.road-chalk", "provenance", "the same count, stopped"),
  T("sight.road-chalk-end", "sight.second-seam", "absence", "a count that does not reach the seam"),
  T("echo.road-steps", "relic.harbor-nail", "echo", "small sure steps ahead of a man with a nail"),
  T("echo.road-steps", "sight.second-seam", "echo", "a sound from where nothing should sound"),
  T("obj.road-oil", "sight.road-lamps", "possession", "the oil the lamps burn"),
  T("obj.road-oil", "obj.doorkeepers-nail", "habit", "left where it will be needed"),
  T("sight.road-far", "sight.road-mouth", "echo", "the road from its arch to its fog"),
  T("sight.road-far", "sight.second-seam", "absence", "an end that is not in view"),
  // The Faded Ward (S-VII)
  T("sight.ward-door", "sight.tamsins-ward", "habit", "a door left unlatched at the end of one ward and the start of another"),
  T("sight.ward-door", "sight.locked-room", "absence", "a door that is never locked beside a room that always is"),
  T("sight.ward-long-hall", "sight.tamsins-ward", "echo", "the rows that go on past the ward she can see"),
  T("sight.ward-long-hall", "relic.basin-stone", "echo", "a tally that the hall never closes"),
  T("sight.ward-lanterns", "sight.gatepost-lamp", "echo", "a lamp trimmed for someone who is not there"),
  T("sight.ward-lanterns", "obj.linnets-coat", "echo", "a small light kept by a coat on a hook"),
  T("obj.ward-bowl", "sight.ruels-laugh", "habit", "the soup is carried to the cot where a laugh is heard"),
  T("obj.ward-bowl", "sight.empty-chair", "echo", "a place kept warm for one more"),
  T("obj.ward-soldier", "obj.tin-soldier", "provenance", "the soldier's pair, polished by a Warden"),
  T("obj.ward-soldier", "sight.locked-room", "possession", "the other soldier is among the belongings"),
  T("sight.ward-window", "sight.hung-star", "echo", "a night kept for someone who is late"),
  T("sight.ward-window", "relic.star-hanger", "echo", "a light hung where it can be seen from a bed"),
  T("obj.ward-button", "sight.ruels-laugh", "provenance", "buttons from the coat of a man who is only partly returned"),
  T("obj.ward-button", "obj.kiths-drawing", "echo", "what a mother keeps and a child draws"),
  T("sight.ward-blank-cot", "obj.linnets-coat", "possession", "the coat above it hangs in the store-room too"),
  T("sight.ward-blank-cot", "sight.empty-chair", "absence", "one more than the count, laid every morning"),
  T("echo.ward-hum", "sight.ruels-laugh", "echo", "the same pitch as the laugh"),
  T("echo.ward-hum", "echo.hymnal-gap", "echo", "a hum where a verse is missing"),
  T("echo.ward-far-breath", "sight.ward-long-hall", "echo", "what the hall leads toward"),
  T("echo.ward-far-breath", "sight.second-seam", "echo", "a sound from where nothing should sound"),
  T("echo.ward-count", "sight.tamsins-ward", "habit", "she walks the rows each night"),
  T("echo.ward-count", "obj.measurers-cord", "echo", "a count that ends one short of finished"),
  T("obj.ward-wake", "obj.tin-soldier", "provenance", "the one he polishes"),
  T("obj.ward-wake", "sight.ward-door", "habit", "left where the door stands ajar"),
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
