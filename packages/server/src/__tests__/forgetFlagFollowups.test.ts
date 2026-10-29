import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { deleteUnresolvedFlagRow } from "../sources/forgetSource.js";

/**
 * V1 tracked follow-ups (ChatGPT final re-audit on fdbc0b84) —
 * repo-level tests for the two P2 hardening items in
 * `deleteUnresolvedFlagRow`:
 *
 *  T-FU1 (item 1): the `user_model` inbound `replaced_by` cleanup
 *    must be scoped to the flag's own space. A row in ANOTHER space
 *    whose `replaced_by` happens to reference the flagged row (a
 *    state only reachable at the DB level — app flows scope the
 *    link) must remain byte-identical.
 *
 *  T-FU2 (item 2): the `forget_flag_row_deleted` audit entry must
 *    be atomic with the deletion — written inside the same
 *    transaction, the `forget_source_applied` pattern. Proven by
 *    failure injection: a trigger that aborts the audit insert
 *    must roll the whole deletion back.
 */

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

const NOW = new Date().toISOString();

function insertUserModelRow(
  space: string,
  content: string,
  replacedBy: number | null = null,
): number {
  return Number(
    handle.sqlite
      .prepare(
        `INSERT INTO user_model (space_id, slot, content, confidence, evidence_ids, valid_at, origin, replaced_by)
         VALUES (?, 'belief', ?, 0.8, '[]', ?, 'stated', ?)`,
      )
      .run(space, content, NOW, replacedBy).lastInsertRowid,
  );
}

function insertOpenFlag(space: string, rowId: number): number {
  return Number(
    handle.sqlite
      .prepare(
        `INSERT INTO forget_unresolved_flags (space_id, request_id, source_id, table_name, row_id, policy_reason, status)
         VALUES (?, 1, 1, 'user_model', ?, 'stated_user_model', 'open')`,
      )
      .run(space, rowId).lastInsertRowid,
  );
}

function rowsOf(space: string): Record<string, unknown>[] {
  return handle.sqlite
    .prepare(`SELECT * FROM user_model WHERE space_id = ? ORDER BY id`)
    .all(space) as Record<string, unknown>[];
}

describe("V1 follow-up item 1 — replaced_by cleanup is space-scoped", () => {
  it("T-FU1 — deleting a flagged row in space A never touches space B", () => {
    const A = "space-a";
    const B = "space-b";
    // The flagged row in space A, plus a same-space successor whose
    // inbound link the cleanup is supposed to clear.
    const targetA = insertUserModelRow(A, "the flagged claim in A");
    const childA = insertUserModelRow(A, "A's successor claim", targetA);
    // Space B: a row of its own, plus — seeded at the DB level only —
    // a row whose replaced_by references space A's flagged row. App
    // flows never create this (the link is space-scoped in
    // userModel.ts), but the unscoped UPDATE would null it anyway.
    insertUserModelRow(B, "B's own unrelated claim");
    insertUserModelRow(B, "B row pointing across spaces", targetA);

    const spaceBBefore = rowsOf(B);
    expect(spaceBBefore).toHaveLength(2);

    const flagId = insertOpenFlag(A, targetA);
    const view = deleteUnresolvedFlagRow(handle, A, flagId);
    expect(view?.status).toBe("resolved_deleted");

    // The flagged row is gone and its own space's inbound link was
    // cleared (the cleanup still does its job in space A).
    expect(
      handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM user_model WHERE id = ?`).get(targetA),
    ).toEqual({ c: 0 });
    const childRow = handle.sqlite
      .prepare(`SELECT replaced_by FROM user_model WHERE id = ?`)
      .get(childA) as { replaced_by: number | null };
    expect(childRow.replaced_by).toBeNull();

    // Space B is byte-identical: the cross-space reference survives.
    expect(rowsOf(B)).toEqual(spaceBBefore);
  });
});

describe("V1 follow-up item 2 — flag-deletion audit entry is atomic with the deletion", () => {
  it("T-FU2 — if the audit insert fails, the deletion rolls back (no silent un-audited delete)", () => {
    const A = "space-a";
    const targetA = insertUserModelRow(A, "the flagged claim in A");
    const flagId = insertOpenFlag(A, targetA);

    // Failure injection: abort any insert of the audit action.
    handle.sqlite.exec(
      `CREATE TRIGGER v1fu_fail_flag_audit
       BEFORE INSERT ON agent_logs
       WHEN NEW.action = 'forget_flag_row_deleted'
       BEGIN SELECT RAISE(ABORT, 'v1fu injected audit failure'); END`,
    );

    expect(() => deleteUnresolvedFlagRow(handle, A, flagId)).toThrow(
      /v1fu injected audit failure/,
    );

    // The contract: deletion and audit stand or fall together. The
    // row is still there and the flag is still open — the caller
    // sees an error AND nothing was deleted.
    expect(
      handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM user_model WHERE id = ?`).get(targetA),
    ).toEqual({ c: 1 });
    const flag = handle.sqlite
      .prepare(`SELECT status FROM forget_unresolved_flags WHERE id = ?`)
      .get(flagId) as { status: string };
    expect(flag.status).toBe("open");
    expect(
      handle.sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM agent_logs WHERE action = 'forget_flag_row_deleted' AND space_id = ?`,
        )
        .get(A),
    ).toEqual({ c: 0 });
  });

  it("T-FU2b — a successful delete writes exactly one audit entry, ids only", () => {
    const A = "space-a";
    const targetA = insertUserModelRow(A, "the flagged claim in A");
    const flagId = insertOpenFlag(A, targetA);

    const view = deleteUnresolvedFlagRow(handle, A, flagId);
    expect(view?.status).toBe("resolved_deleted");
    expect(
      handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM user_model WHERE id = ?`).get(targetA),
    ).toEqual({ c: 0 });
    const logs = handle.sqlite
      .prepare(
        `SELECT description FROM agent_logs WHERE action = 'forget_flag_row_deleted' AND space_id = ?`,
      )
      .all(A) as { description: string }[];
    expect(logs).toHaveLength(1);
    expect(logs[0]!.description).toContain(`flag_id=${flagId}`);
    expect(logs[0]!.description).not.toContain("the flagged claim");
  });
});
