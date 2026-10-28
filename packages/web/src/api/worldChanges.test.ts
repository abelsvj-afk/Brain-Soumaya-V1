import { describe, it, expect, vi, afterEach } from "vitest";
import {
  decideWorldChangeProposal,
  getWorldChangeProposal,
  getWorldChangesLog,
  getWorldChangesState,
  listWorldChangeProposals,
  resolveWorldChangeTarget,
  sweepWorldChanges,
  undoWorldChangeProposal,
  WorldChangesClientError,
} from "./worldChanges.js";

/**
 * World-changes client: the binding over the §17 rail's contract. These
 * tests pin the wire shape (paths, query params, bodies, response
 * unwrapping) and the error grammar (server plain-language message +
 * code preserved; 404 mapped to NOT_FOUND). Transport is the global
 * fetch that afetch wraps.
 */

const proposal = {
  id: "wc-1",
  kind: "landmark",
  title: "A landmark for finishing the move",
  reason: "You marked the journey done, and the garden grows a landmark for real milestones.",
  evidence: "Journey “The move” marked done on Oct 24, 2026.",
  status: "pending",
  createdAt: "2026-10-26T12:00:00.000Z",
  target: "landmark:7",
};

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}
const jsonRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getWorldChangesState", () => {
  it("returns the server's warmth, season, and counts", async () => {
    stubFetch(async () =>
      jsonRes(200, { warmth: 0.6, season: "Late autumn", pendingCount: 2, appliedCount: 3 }),
    );
    const s = await getWorldChangesState();
    expect(s?.warmth).toBe(0.6);
    expect(s?.season).toBe("Late autumn");
    expect(s?.pendingCount).toBe(2);
    expect(s?.appliedCount).toBe(3);
  });

  it("returns null when the brain is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await getWorldChangesState()).toBeNull();
  });

  it("returns null when the shape is not the contract", async () => {
    stubFetch(async () => jsonRes(200, { warmth: "warm" }));
    expect(await getWorldChangesState()).toBeNull();
  });
});

describe("listWorldChangeProposals", () => {
  it("lists pending proposals with the status filter in the query", async () => {
    const fn = stubFetch(async () => jsonRes(200, { proposals: [proposal] }));
    const list = await listWorldChangeProposals({ status: "pending" });
    expect(list).toHaveLength(1);
    expect(list![0]!.id).toBe("wc-1");
    const [url] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/world-changes/proposals?status=pending");
  });

  it("passes the kind filter through", async () => {
    const fn = stubFetch(async () => jsonRes(200, { proposals: [] }));
    await listWorldChangeProposals({ status: "pending", kind: "path" });
    const [url] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/world-changes/proposals?status=pending&kind=path");
  });

  it("returns null on a failed fetch, never an invented list", async () => {
    stubFetch(async () => jsonRes(500, { error: "boom" }));
    expect(await listWorldChangeProposals()).toBeNull();
  });
});

describe("getWorldChangeProposal", () => {
  it("returns the one proposal (M6 door one)", async () => {
    const fn = stubFetch(async () => jsonRes(200, { proposal }));
    const p = await getWorldChangeProposal("wc-1");
    expect(p?.title).toMatch(/landmark/);
    const [url] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/world-changes/proposals/wc-1");
  });

  it("returns null when the proposal is missing", async () => {
    stubFetch(async () => jsonRes(404, { error: "Not found." }));
    expect(await getWorldChangeProposal("nope")).toBeNull();
  });
});

describe("decideWorldChangeProposal", () => {
  it("approves with the decision and an optional note", async () => {
    const fn = stubFetch(async () =>
      jsonRes(200, { proposal: { ...proposal, status: "approved" } }),
    );
    const p = await decideWorldChangeProposal("wc-1", "approve", "Yes — this one matters.");
    expect(p.status).toBe("approved");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/world-changes/proposals/wc-1/decide");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "approve", note: "Yes — this one matters." });
  });

  it("a defer carries no note when none is given, and never approves by silence", async () => {
    const fn = stubFetch(async () =>
      jsonRes(200, { proposal: { ...proposal, status: "deferred" } }),
    );
    const p = await decideWorldChangeProposal("wc-1", "defer");
    expect(p.status).toBe("deferred");
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ decision: "defer" });
  });

  it("surfaces a 409 with the server's code and plain-language message", async () => {
    stubFetch(async () =>
      jsonRes(409, { error: "That proposal was already decided.", code: "ALREADY_DECIDED" }),
    );
    await expect(decideWorldChangeProposal("wc-1", "approve")).rejects.toEqual(
      expect.objectContaining({
        name: "WorldChangesClientError",
        code: "ALREADY_DECIDED",
        message: "That proposal was already decided.",
      }),
    );
  });

  it("a 404 maps to NOT_FOUND", async () => {
    stubFetch(async () => jsonRes(404, { error: "Not found." }));
    await expect(decideWorldChangeProposal("nope", "reject")).rejects.toEqual(
      expect.objectContaining({ name: "WorldChangesClientError", code: "NOT_FOUND" }),
    );
  });

  it("WorldChangesClientError is an Error with a stable name", () => {
    const e = new WorldChangesClientError("X", "msg");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("WorldChangesClientError");
  });
});

describe("undoWorldChangeProposal", () => {
  it("returns the proposal plus the compensating log entry", async () => {
    const fn = stubFetch(async () =>
      jsonRes(200, {
        proposal: { ...proposal, status: "undone" },
        logEntry: {
          id: "log-9",
          kind: "landmark",
          summary: "Undid: a landmark for finishing the move.",
          reason: "You asked for it back.",
          appliedAt: "2026-10-27T10:00:00.000Z",
          proposalId: "wc-1",
        },
      }),
    );
    const r = await undoWorldChangeProposal("wc-1");
    expect(r.proposal.status).toBe("undone");
    expect(r.logEntry.id).toBe("log-9");
    const [url] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/world-changes/proposals/wc-1/undo");
  });
});

describe("getWorldChangesLog", () => {
  it("returns the chronological entries (M6 door two)", async () => {
    stubFetch(async () =>
      jsonRes(200, {
        entries: [
          {
            id: "log-1",
            kind: "landmark",
            summary: "Added a landmark for finishing the move.",
            reason: "You marked the journey done.",
            appliedAt: "2026-10-26T12:00:00.000Z",
            proposalId: "wc-1",
          },
        ],
      }),
    );
    const entries = await getWorldChangesLog();
    expect(entries).toHaveLength(1);
    expect(entries![0]!.summary).toMatch(/Added a landmark/);
  });
});

describe("sweepWorldChanges", () => {
  it("returns the sweep counts", async () => {
    const fn = stubFetch(async () =>
      jsonRes(200, { pending: 2, approvedUnapplied: 1, retried: 1, failed: 0 }),
    );
    const r = await sweepWorldChanges();
    expect(r).toEqual({ pending: 2, approvedUnapplied: 1, retried: 1, failed: 0 });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/world-changes/sweep");
    expect(init.method).toBe("POST");
  });
});

describe("resolveWorldChangeTarget", () => {
  it("resolves landmark and path targets", () => {
    expect(resolveWorldChangeTarget("landmark:7")).toEqual({ kind: "landmark", journeyId: 7 });
    expect(resolveWorldChangeTarget("path:1:2")).toEqual({ kind: "path", fromNodeId: 1, toNodeId: 2 });
    expect(resolveWorldChangeTarget("7")).toEqual({ kind: "landmark", journeyId: 7 });
  });

  it("an unresolvable target is unknown — never guessed", () => {
    expect(resolveWorldChangeTarget("")).toEqual({ kind: "unknown" });
    expect(resolveWorldChangeTarget("landmark:abc")).toEqual({ kind: "unknown" });
    expect(resolveWorldChangeTarget("path:1")).toEqual({ kind: "unknown" });
    expect(resolveWorldChangeTarget("tone:warm")).toEqual({ kind: "unknown" });
  });
});
