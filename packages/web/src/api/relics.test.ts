import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./http.js", () => ({ API: "/api", afetch: vi.fn() }));
import { afetch } from "./http.js";
import { findRelic } from "./relics.js";

const mockedFetch = afetch as unknown as ReturnType<typeof vi.fn>;
const resp = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => vi.clearAllMocks());

describe("findRelic client (A5 transport half)", () => {
  it("a refused find comes back not-ok with the server's plain message — the caller records nothing and celebrates nothing", async () => {
    mockedFetch.mockResolvedValue(resp(409, { error: "Every copy of this relic is held right now." }));
    const out = await findRelic("harbor-nail");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Every copy/);
  });
  it("a successful find returns the server state the caller caches", async () => {
    mockedFetch.mockResolvedValue(resp(200, { ok: true, state: { found: ["harbor-nail"] } }));
    const out = await findRelic("harbor-nail");
    expect(out.ok).toBe(true);
    expect(out.state?.found).toEqual(["harbor-nail"]);
  });
});
