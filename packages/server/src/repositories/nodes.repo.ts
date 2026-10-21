import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { GraphNode, NodeType } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { nodes, DEFAULT_SPACE, type NodeRow } from "../db/schema.js";
import { upsertEmbedding, deleteEmbedding } from "../db/vec.js";
import { ftsUpsert, ftsDelete } from "../db/fts.js";

export interface NewNode {
  label: string;
  celestialTitle?: string;
  type: NodeType;
  content: string;
  emotionalWeight?: number;
  importance?: number;
  color?: string;
  origin?: "user" | "agent";
  kind?: GraphNode["kind"];
  /** 0..1 progress (goal completion / skill level) — cognitive layer. */
  progress?: number;
  /** Cognitive layer: other names this entry answers to (person/place aliases). */
  aliases?: string[];
  expiresAt?: string;
  occurredAt?: string;
  remindAt?: string;
  tags?: string[];
  /** Phase 1 agent loop: idempotency key (the approval id). */
  idempotencyKey?: string;
  /** W1 temporal truth: when the fact became true in the real world (canonical ISO UTC). */
  validFrom?: string;
  /** W1 temporal truth: when the fact stopped being true (canonical ISO UTC). */
  validTo?: string;
}

/** W1: the "what's true now" drizzle condition — superseded rows are excluded. */
const currentOnly = isNull(nodes.supersededAt);

function toGraphNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    label: row.label,
    celestialTitle: row.celestialTitle ?? undefined,
    type: row.type as NodeType,
    content: row.content,
    emotionalWeight: row.emotionalWeight ?? undefined,
    importance: row.importance ?? undefined,
    color: row.color ?? undefined,
    origin: (row.origin as "user" | "agent" | null) ?? undefined,
    agent: row.agent ?? undefined,
    kind: (row.kind as GraphNode["kind"]) ?? undefined,
    status: (row.status as "active" | "archived" | null) ?? undefined,
    progress: row.progress ?? undefined,
    aliases: parseTags(row.aliases),
    expiresAt: row.expiresAt ?? undefined,
    lastTendedAt: row.lastTendedAt ?? undefined,
    occurredAt: row.occurredAt ?? undefined,
    remindAt: row.remindAt ?? undefined,
    tags: parseTags(row.tags),
    researchQuestions: parseJson<string[]>(row.researchQuestions),
    researchAnswers: parseJson<Record<string, string>>(row.researchAnswers),
    createdAt: row.createdAt,
  };
}

function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Tags are stored as a JSON array string; tolerate null/legacy/malformed values. */
function parseTags(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) return arr.map(String);
  } catch {
    /* ignore malformed */
  }
  return undefined;
}

/**
 * Persistence for nodes + their embeddings. Kept behind this class so a libsql
 * swap (native vectors) only touches the repo + db/vec.ts, not callers.
 */
export class NodesRepo {
  /** Every query is scoped to one private space (defaults to the legacy space). */
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  /** Insert a node and (atomically) store its embedding. */
  create(input: NewNode, embedding: Float32Array): GraphNode {
    // W1: canonical timestamps set explicitly in application code (never rely on
    // SQLite CURRENT_TIMESTAMP — the old 'YYYY-MM-DD HH:MM:SS' format breaks
    // lexicographic comparison). recorded_at is the immutable "when the system
    // learned this" marker; the DB default is only a backstop.
    const nowIso = new Date().toISOString();
    const tx = this.h.sqlite.transaction(() => {
      const row = this.h.db
        .insert(nodes)
        .values({
          spaceId: this.spaceId,
          label: input.label,
          celestialTitle: input.celestialTitle ?? null,
          type: input.type,
          content: input.content,
          emotionalWeight: input.emotionalWeight ?? null,
          importance: input.importance ?? null,
          color: input.color ?? null,
          origin: input.origin ?? null,
          kind: input.kind ?? null,
          progress: input.progress ?? null,
          aliases: input.aliases && input.aliases.length > 0 ? JSON.stringify(input.aliases) : null,
          expiresAt: input.expiresAt ?? null,
          occurredAt: input.occurredAt ?? null,
          remindAt: input.remindAt ?? null,
          tags: input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null,
          idempotencyKey: input.idempotencyKey ?? null,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          recordedAt: nowIso,
          createdAt: nowIso,
          lastTendedAt: nowIso, // freshly tended on creation
        })
        .returning()
        .get();
      upsertEmbedding(this.h.sqlite, row.id, embedding);
      ftsUpsert(this.h.sqlite, row.id, row.label, row.content);
      return row;
    });
    return toGraphNode(tx());
  }

  getById(id: number): GraphNode | undefined {
    const row = this.h.db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, id), eq(nodes.spaceId, this.spaceId), isNull(nodes.deletedAt)))
      .get();
    return row ? toGraphNode(row) : undefined;
  }

  /**
   * W1: "is this currently true?" — returns the row only if it has not been
   * superseded. For truth queries (digest, chat context, proactive candidates).
   * getById() remains the history/detail path (returns superseded rows as-is).
   */
  getCurrentById(id: number): GraphNode | undefined {
    const row = this.h.db
      .select()
      .from(nodes)
      .where(
        and(
          eq(nodes.id, id),
          eq(nodes.spaceId, this.spaceId),
          isNull(nodes.deletedAt),
          currentOnly,
        ),
      )
      .get();
    return row ? toGraphNode(row) : undefined;
  }

  /** Soft-delete: flag a redundant memory as merged into another (recoverable). */
  softDelete(id: number, mergedIntoId: number): boolean {
    // W1: use canonical ISO timestamp (not CURRENT_TIMESTAMP legacy format).
    const info = this.h.sqlite
      .prepare(
        `UPDATE nodes SET deleted_at = ?, merged_into = ? WHERE id = ? AND space_id = ?`,
      )
      .run(new Date().toISOString(), mergedIntoId, id, this.spaceId);
    deleteEmbedding(this.h.sqlite, id); // drop from KNN/redundancy index
    ftsDelete(this.h.sqlite, id);
    return info.changes > 0;
  }

  /**
   * Edit a node's label and/or body text (IM-26: the Details tab's edit flow).
   * Only the fields present in `patch` are touched; soft-deleted rows are not
   * editable. Embedding/FTS refresh is the route's job (it owns the providers).
   */
  updateDetails(
    id: number,
    patch: { label?: string; content?: string },
  ): GraphNode | undefined {
    const set: { label?: string; content?: string } = {};
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.content !== undefined) set.content = patch.content;
    if (Object.keys(set).length === 0) return this.getById(id);
    const row = this.h.db
      .update(nodes)
      .set(set)
      .where(and(eq(nodes.id, id), eq(nodes.spaceId, this.spaceId), isNull(nodes.deletedAt)))
      .returning()
      .get();
    return row ? toGraphNode(row) : undefined;
  }

  /** Manually override (or, with null, clear) a node's importance weight. */
  updateImportance(id: number, importance: number | null): GraphNode | undefined {
    const row = this.h.db
      .update(nodes)
      .set({ importance })
      .where(and(eq(nodes.id, id), eq(nodes.spaceId, this.spaceId)))
      .returning()
      .get();
    return row ? toGraphNode(row) : undefined;
  }

  /** Delete a node, its embedding, and every edge touching it. Returns true if removed. */
  delete(id: number): boolean {
    const tx = this.h.sqlite.transaction(() => {
      // Confirm the node belongs to this space before touching anything.
      const owns = this.h.sqlite
        .prepare(`SELECT 1 FROM nodes WHERE id = ? AND space_id = ?`)
        .get(id, this.spaceId);
      if (!owns) return false;
      this.h.sqlite.prepare(`DELETE FROM edges WHERE source = ? OR target = ?`).run(id, id);
      this.h.sqlite.prepare(`DELETE FROM insights WHERE node_a = ? OR node_b = ?`).run(id, id);
      // Drop attached files too, so deleting a memory can't orphan multi-MB blobs.
      this.h.sqlite.prepare(`DELETE FROM attachments WHERE node_id = ?`).run(id);
      deleteEmbedding(this.h.sqlite, id);
      ftsDelete(this.h.sqlite, id);
      const info = this.h.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(id);
      return info.changes > 0;
    });
    return tx();
  }

  /** "Tend" a memory — reset its entropy clock (visiting/editing/linking). */
  tend(id: number): boolean {
    const info = this.h.sqlite
      .prepare(`UPDATE nodes SET last_tended_at = ? WHERE id = ? AND space_id = ?`)
      .run(new Date().toISOString(), id, this.spaceId);
    return info.changes > 0;
  }

  /**
   * Agenda edit/reschedule/snooze (IM-51): update a node's label/content and/or
   * its agenda timestamps. `remindAt`/`expiresAt` accept null to clear. Only the
   * fields present in `patch` are touched. Returns the updated node, or
   * undefined when the node isn't in this space. Keeps FTS in sync when the
   * label/content change, and tends the node (editing = visiting it).
   */
  updateAgenda(
    id: number,
    patch: { label?: string; content?: string; remindAt?: string | null; expiresAt?: string | null },
  ): GraphNode | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.label !== undefined) { sets.push("label = ?"); vals.push(patch.label); }
    if (patch.content !== undefined) { sets.push("content = ?"); vals.push(patch.content); }
    if (patch.remindAt !== undefined) { sets.push("remind_at = ?"); vals.push(patch.remindAt); }
    if (patch.expiresAt !== undefined) { sets.push("expires_at = ?"); vals.push(patch.expiresAt); }
    if (sets.length === 0) return existing;
    sets.push("last_tended_at = ?");
    vals.push(new Date().toISOString());
    vals.push(id, this.spaceId);
    const info = this.h.sqlite
      .prepare(`UPDATE nodes SET ${sets.join(", ")} WHERE id = ? AND space_id = ?`)
      .run(...(vals as never[]));
    if (info.changes === 0) return undefined;
    const updated = this.getById(id);
    if (updated && (patch.label !== undefined || patch.content !== undefined)) {
      ftsUpsert(this.h.sqlite, id, updated.label, updated.content);
    }
    return updated;
  }

  /** Attribute which autonomous agent last worked this node (e.g. after research). */
  setAgent(id: number, agent: string): void {
    this.h.sqlite
      .prepare(`UPDATE nodes SET agent = ? WHERE id = ? AND space_id = ?`)
      .run(agent, id, this.spaceId);
  }



  /** Most recent nodes, for grounding LLM extraction context.
   * W1: superseded rows are excluded by default (they're not "recent truth").
   * Pass { includeSuperseded: true } for history views. */
  recent(limit = 20, opts: { includeSuperseded?: boolean } = {}): GraphNode[] {
    const conditions = [eq(nodes.spaceId, this.spaceId), isNull(nodes.deletedAt)];
    if (!opts.includeSuperseded) conditions.push(currentOnly);
    return this.h.db
      .select()
      .from(nodes)
      .where(and(...conditions))
      .orderBy(desc(nodes.id))
      .limit(limit)
      .all()
      .map(toGraphNode);
  }

  /** Live memories for the galaxy — excludes archived (they rest out of view).
   * W1: also excludes superseded by default; opt-in via includeSuperseded. */
  all(opts: { includeSuperseded?: boolean } = {}): GraphNode[] {
    const conditions = [
      eq(nodes.spaceId, this.spaceId),
      isNull(nodes.deletedAt),
      ne(nodes.status, "archived"),
    ];
    if (!opts.includeSuperseded) conditions.push(currentOnly);
    return this.h.db
      .select()
      .from(nodes)
      .where(and(...conditions))
      .all()
      .map(toGraphNode);
  }

  /**
   * Archived memories (for the Browse "Archived" lens).
   *
   * W1: this is a HISTORY/BROWSE view — archival status is orthogonal to
   * temporal truth. Archived rows MAY include superseded nodes; hiding them
   * would conflate "user put this away" with "this is no longer true".
   * Callers that need only currently-true archived facts should filter
   * `superseded_at IS NULL` themselves.
   */
  archived(): GraphNode[] {
    return this.h.db
      .select()
      .from(nodes)
      .where(and(eq(nodes.spaceId, this.spaceId), isNull(nodes.deletedAt), eq(nodes.status, "archived")))
      .all()
      .map(toGraphNode);
  }

  /** Archive / restore a memory (kept, not deleted). Returns true if it changed. */
  setStatus(id: number, status: "active" | "archived"): boolean {
    const info = this.h.sqlite
      .prepare(`UPDATE nodes SET status = ? WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
      .run(status, id, this.spaceId);
    return info.changes > 0;
  }

  byIds(ids: number[], opts: { includeSuperseded?: boolean } = {}): GraphNode[] {
    if (ids.length === 0) return [];
    const conditions = [inArray(nodes.id, ids), eq(nodes.spaceId, this.spaceId), isNull(nodes.deletedAt)];
    if (!opts.includeSuperseded) conditions.push(currentOnly);
    return this.h.db
      .select()
      .from(nodes)
      .where(and(...conditions))
      .all()
      .map(toGraphNode);
  }

  /**
   * Total non-deleted records in this space.
   *
   * W1: this counts ALL non-deleted rows INCLUDING superseded ones — it is a
   * storage total, not a count of currently-believed facts. If a feature
   * needs the current-truth count, add a separately named method (e.g.
   * `countCurrent()`) with explicit semantics rather than changing this one.
   */
  count(): number {
    const r = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE deleted_at IS NULL AND space_id = ?`)
      .get(this.spaceId) as { c: number };
    return r.c;
  }

  updateResearch(id: number, questions: string[] | null, answers: Record<string, string> | null): GraphNode | undefined {
    const row = this.h.db
      .update(nodes)
      .set({
        researchQuestions: questions ? JSON.stringify(questions) : null,
        researchAnswers: answers ? JSON.stringify(answers) : null,
      })
      .where(and(eq(nodes.id, id), eq(nodes.spaceId, this.spaceId)))
      .returning()
      .get();
    return row ? toGraphNode(row) : undefined;
  }
}
