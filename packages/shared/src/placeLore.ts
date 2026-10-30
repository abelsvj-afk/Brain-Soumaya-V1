/**
 * Places with a past (docs/specs/living-worlds-dialogue-2026-10-31.md, S4). A landmark in a world says something when you are parked beside it and look closely — a short passage in
 * the voice of an item description, not an explanation. These are SCENERY: reading one finds nothing, scores nothing, and is never a prerequisite. Several quietly face a thing in the
 * Book (a seam, an empty cradle, a ribbon) so a patient player is turned toward it, but none says what it means. Anchors are the same named holders the lore spots use
 * (web/graph/worldPlaces.ts); a landmark whose model has not loaded simply cannot be looked at. Never numbers; never the things the lore forbids saying.
 */
export interface PlaceLore {
  id: string;
  world: string;
  /** Regex SOURCE of a scene holder (PLACE_RULES), or `origin` for the garden's witness tree. */
  place?: string;
  origin?: boolean;
  /** Reach, in place-radii (or units for an origin). */
  near: number;
  min?: number;
  title: string;
  text: string;
}

export const PLACE_LORE: readonly PlaceLore[] = [
  { id: "station.ring", world: "great-station", place: "^station-rotating$", near: 0.6, title: "The Ring", text: "The great ring turns slowly, and has turned longer than the harbor has kept records. Its lower rim is older than its upper, and the join is not quite where the plans say it should be." },
  { id: "station.gantry", world: "great-station", place: "^witness-drydock-gantry$", near: 1.6, title: "The Drydock Gantry", text: "An empty cradle, swept and oiled for a ship that is not expected. The harbor lists its berths each morning. The cradle is not one of them, and no one has asked why it is kept." },
  { id: "station.annexes", world: "great-station", place: "^annex-(?!model)", near: 1.8, title: "The Annexes", text: "Small rooms along the harbor wall, each with a door and a plate. Most are in use. One is not, and its door is kept shut by a hand that never stands near it." },
  { id: "deep-past.rim", world: "deep-past", place: "^place-rim$", near: 0.8, title: "The Rim", text: "The basin's edge is layered like the pages of a book, each stratum a different hour. Run a finger down them and you will find a place where the page seems to turn without a line." },
  { id: "deep-past.stair", world: "deep-past", place: "^stair$", near: 0.6, title: "The Stair", text: "A stair cut for feet no one remembers. A ribbon is tied to the post at the top, and it has been renewed. It is always a day newer than you." },
  { id: "scale.station", world: "scale", place: "^iss-holder$", near: 2.0, title: "The Station in the Sky", text: "A small, real thing at its true size. Beside the planets it looks like a toy, and yet someone lived in it, and went on living, a little at a time." },
  { id: "scale.planets", world: "scale", place: "^planet-(?!model)", near: 1.8, title: "The Planets", text: "Each hangs at its true size, and none is large enough to hold what people ask of it. The surveyors call that the lesson, and say they have never finished learning it." },
  { id: "archive.threshold", world: "quiet-archive", place: "^still-threshold$", near: 1.6, title: "The Still Threshold", text: "A door that is always open and has never been walked through in a hurry. Those who stand here are quiet without being told. The hearths are lit at one hour and not another, and no one remembers who set the hour." },
  { id: "archive.field", world: "quiet-archive", place: "^field-ground$", near: 0.5, title: "The Field", text: "Soft ground under low lights. Now and then the grass lies down in a long shape, as though someone had rested there and gone." },
  { id: "people.field", world: "people", place: "^field-ground$", near: 0.5, title: "The Hearthfield", text: "Many small fires, each laid for the guests at its table. Look closely and you will see each is laid for a place more than the people who came." },
  { id: "garden.tree", world: "growing-place", origin: true, near: 190, title: "The Witness Tree", text: "The oldest thing in the garden, and slow to answer. One bough is bare. The rest lean toward the light, and that one leans toward nothing." },
];

export const PLACE_LORE_FOR = (world: string): readonly PlaceLore[] => PLACE_LORE.filter((p) => p.world === world);
