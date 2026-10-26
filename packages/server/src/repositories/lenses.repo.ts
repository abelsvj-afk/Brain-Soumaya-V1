import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { Lens, LensQuery } from "@brain/shared";

/**
 * Owns all SQL for the `lenses` table (Smart Lenses). A lens is a saved query the
 * galaxy renders as a live constellation; the query JSON is opaque here (validated at
 * the route with zod, evaluated by `analysis/lenses.ts`). Space-scoped like every repo.
 */
export class LensesRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  /**
   * Batch H (REG-214 / CN-16): a corrupt stored query used to fail OPEN — the
   * catch substituted `{}` ("rather than throwing"), and an empty query
   * "returns all non-archived bodies", so a damaged lens silently became an
   * everything-lens with the whole-brain count. Now the lens parses as
   * `broken: true` and the routes refuse to evaluate it (its count is null,
   * its nodes endpoint 422s); the name is kept so the panel can say WHICH
   * lens is broken. The parsed `query` is still `{}` for type-compat — no
   * consumer may treat a broken lens's query as a real query.
   */
  private parse(row: { id: number; name: string; query: string; pinned: number }): Lens {
    let query: LensQuery = {};
    let broken = false;
    try {
      query = JSON.parse(row.query) as LensQuery;
    } catch {
      broken = true;
    }
    return { id: row.id, name: row.name, query, pinned: row.pinned === 1, ...(broken ? { broken: true as const } : {}) };
  }

  list(): Lens[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT id, name, query, pinned FROM lenses WHERE space_id = ? ORDER BY pinned DESC, id DESC`)
      .all(this.spaceId) as { id: number; name: string; query: string; pinned: number }[];
    return rows.map((r) => this.parse(r));
  }

  get(id: number): Lens | null {
    const row = this.handle.sqlite
      .prepare(`SELECT id, name, query, pinned FROM lenses WHERE id = ? AND space_id = ?`)
      .get(id, this.spaceId) as { id: number; name: string; query: string; pinned: number } | undefined;
    return row ? this.parse(row) : null;
  }

  create(name: string, query: LensQuery, pinned = false): Lens {
    const info = this.handle.sqlite
      .prepare(`INSERT INTO lenses (space_id, name, query, pinned) VALUES (?, ?, ?, ?)`)
      .run(this.spaceId, name, JSON.stringify(query), pinned ? 1 : 0);
    return { id: Number(info.lastInsertRowid), name, query, pinned };
  }

  update(id: number, patch: { name?: string; query?: LensQuery; pinned?: boolean }): Lens | null {
    const row = this.handle.sqlite
      .prepare(`SELECT id, name, query, pinned FROM lenses WHERE id = ? AND space_id = ?`)
      .get(id, this.spaceId) as { id: number; name: string; query: string; pinned: number } | undefined;
    if (!row) return null;
    const cur = this.parse(row);
    const next: Lens = {
      ...cur,
      name: patch.name ?? cur.name,
      query: patch.query ?? cur.query,
      pinned: patch.pinned ?? cur.pinned,
    };
    // Batch H (REG-214): when the patch carries no new query, write back the
    // STORED query string verbatim. Re-serializing the parsed query would
    // silently rewrite a corrupt stored query as "{}" — an all-matching lens.
    const storedQuery = patch.query ? JSON.stringify(patch.query) : row.query;
    this.handle.sqlite
      .prepare(`UPDATE lenses SET name = ?, query = ?, pinned = ? WHERE id = ? AND space_id = ?`)
      .run(next.name, storedQuery, next.pinned ? 1 : 0, id, this.spaceId);
    return next;
  }

  remove(id: number): boolean {
    return (
      this.handle.sqlite.prepare(`DELETE FROM lenses WHERE id = ? AND space_id = ?`).run(id, this.spaceId).changes > 0
    );
  }
}
