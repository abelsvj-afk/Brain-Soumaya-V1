import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./http.js", () => ({ API: "/api", afetch: vi.fn() }));
import { afetch } from "./http.js";
import { findRelic, sampleRelicClaimStart, scanRelic } from "./relics.js";

const mockedFetch = afetch as unknown as ReturnType<typeof vi.fn>;
const resp = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => vi.clearAllMocks());

describe("findRelic client (A5 transport half)", () => {
  it("a refused find comes back not-ok with the server's plain message — the caller records nothing and celebrates nothing", async () => {
    mockedFetch.mockResolvedValue(resp(409, { error: "Every copy of this relic is held right now." }));
    const out = await findRelic("harbor-nail", "claim-1", [210, 38, 0]);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Every copy/);
  });
  it("a successful find returns the server state the caller caches", async () => {
    mockedFetch.mockResolvedValue(resp(200, { ok: true, state: { found: ["harbor-nail"] } }));
    const out = await findRelic("harbor-nail", "claim-1", [210, 38, 0]);
    expect(out.ok).toBe(true);
    expect(out.state?.found).toEqual(["harbor-nail"]);
  });
  it("I-4 contract: the claim body carries claimId + position and NO anchorKey — the server derives the anchor from samples", async () => {
    mockedFetch.mockResolvedValue(resp(200, { ok: true, state: { found: ["harbor-nail"] } }));
    await findRelic("harbor-nail", "claim-1", [210, 38, 0]);
    const body = JSON.parse((mockedFetch.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toEqual({ relicId: "harbor-nail", claimId: "claim-1", position: [210, 38, 0] });
    expect(body).not.toHaveProperty("anchorKey");
  });
  it("I-4: the settling sample and the scan pulse post their minimal bodies", async () => {
    mockedFetch.mockResolvedValue(resp(200, { ok: true, relicIds: ["harbor-nail"] }));
    const sampled = await sampleRelicClaimStart([210, 38, 0]);
    expect(sampled.ok).toBe(true);
    expect(JSON.parse((mockedFetch.mock.calls[0]![1] as { body: string }).body)).toEqual({ position: [210, 38, 0], kind: "claim-start" });
    mockedFetch.mockResolvedValue(resp(200, { ok: true, band: "Resonant", bearing: "the lower rim of the harbor" }));
    const pulse = await scanRelic("harbor-nail", [210, 38, 0]);
    expect(pulse.band).toBe("Resonant");
    expect(JSON.parse((mockedFetch.mock.calls[1]![1] as { body: string }).body)).toEqual({ relicId: "harbor-nail", position: [210, 38, 0], widened: false });
  });
});
