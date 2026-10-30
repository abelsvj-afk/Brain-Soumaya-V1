import type { DbHandle } from "../db/client.js";
import { STORY_ROAD_BY_ID, STORY_ROADS } from "@brain/shared";
import { StoryError } from "./story.js";

/**
 * A brain's private side-road choices (docs/specs/story-roads-2026-10-31.md). Progress through a road is DERIVED from finds and meetings and never stored;
 * this holds only whether the brain took a road, rested it, or finished it. Absence of a row means "not taken". Nothing here counts or can be lost.
 */
export type RoadState = "taken" | "rested" | "done";

export interface RoadRow {
  roadId: string;
  state: RoadState;
  updatedAt: string;
}

export class RoadsRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string,
  ) {}

  list(): RoadRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT road_id, state, updated_at FROM story_roads WHERE space_id = ? ORDER BY road_id`)
      .all(this.spaceId) as { road_id: string; state: RoadState; updated_at: string }[];
    return rows.filter((r) => STORY_ROAD_BY_ID.has(r.road_id)).map((r) => ({ roadId: r.road_id, state: r.state, updatedAt: r.updated_at }));
  }

  /**
   * Idempotent. `done` is accepted only when every FIND the road names is already in this brain's finds (a meeting can't be checked here — it lives on
   * the device — so it is trusted: a private game rule, not a security boundary). A finished road stays finished.
   */
  set(roadId: string, state: RoadState): RoadRow {
    const road = STORY_ROAD_BY_ID.get(roadId);
    if (!road) throw new StoryError("There is no such road.", 404);
    const db = this.h.sqlite;
    const current = db.prepare(`SELECT state FROM story_roads WHERE space_id = ? AND road_id = ?`).get(this.spaceId, roadId) as { state: RoadState } | undefined;
    if (current?.state === "done") return this.list().find((r) => r.roadId === roadId)!;
    if (state === "done") {
      const finds = new Set((db.prepare(`SELECT entry_id FROM story_finds WHERE space_id = ?`).all(this.spaceId) as { entry_id: string }[]).map((r) => r.entry_id));
      for (const step of road.steps) {
        if ("find" in step.signal && !finds.has(step.signal.find)) throw new StoryError("The road is not finished yet.", 403);
      }
    }
    db.prepare(
      `INSERT INTO story_roads (space_id, road_id, state, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (space_id, road_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    ).run(this.spaceId, roadId, state);
    return this.list().find((r) => r.roadId === roadId)!;
  }
}

export const ROAD_IDS: readonly string[] = STORY_ROADS.map((r) => r.id);
