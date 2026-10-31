import type { DbHandle } from "../db/client.js";
import { FOLDED_LETTER_WORLD_KEY } from "@brain/shared";
import { StoryError } from "./story.js";
import { TravelRepo } from "../repositories/travel.repo.js";

/**
 * The Folded Letter's one choice (docs/specs/seam-the-folded-letter-2026-10-31.md §Choice; audit gap G2). A brain may keep the letter folded or open it. The server stores ONLY which — never any text,
 * because the sentence is never shown to anyone and is not stored anywhere. The row lives in the existing `story_roads` table under a reserved `choice.` id (so backups and account deletion already cover it, and
 * RoadsRepo ignores it: it only lists ids that are real roads). Rules: it can only be made from inside the room; keeping is not final (you may open it later); opening cannot be undone (a read sentence cannot be
 * unread); nothing is scored, counted or rewarded either way.
 */
export type FoldChoice = "kept" | "opened";
export const FOLD_CHOICE_ID = "choice.fold-letter";

export class ChoicesRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string,
  ) {}

  foldLetter(): FoldChoice | null {
    const row = this.h.sqlite.prepare(`SELECT state FROM story_roads WHERE space_id = ? AND road_id = ?`).get(this.spaceId, FOLD_CHOICE_ID) as { state: string } | undefined;
    return row?.state === "kept" || row?.state === "opened" ? row.state : null;
  }

  setFoldLetter(value: FoldChoice, nowMs: number = Date.now()): FoldChoice {
    if (new TravelRepo(this.h, this.spaceId).currentWorld(nowMs) !== FOLDED_LETTER_WORLD_KEY) throw new StoryError("That is a choice for the room itself.", 403);
    const current = this.foldLetter();
    if (current === "opened") return "opened"; // a read sentence cannot be unread; asking again changes nothing
    this.h.sqlite
      .prepare(
        `INSERT INTO story_roads (space_id, road_id, state, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (space_id, road_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(this.spaceId, FOLD_CHOICE_ID, value);
    return value;
  }
}
