import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/relics.js", () => ({ getRelicsState: vi.fn(), syncLegacyRelics: vi.fn() }));
import * as api from "../api/relics.js";
import { loadFoundRelics, markRelicFound, refreshFoundRelicsFromServer } from "./relicsFound.js";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const stateWith = (found: string[]) => ({ found, held: [], holdings: [], buffs: {}, gate: {}, recentDepartures: [], isOwnerSpace: false, scarcityOff: false, currentAnchorByRelic: {} });

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("found-store as a server cache (A5/A24 web halves)", () => {
  it("refresh replaces the local cache with the server's found set", async () => {
    markRelicFound("cache-space", "relic-harbor-nail");
    mocked.getRelicsState!.mockResolvedValue(stateWith(["harbor-nail", "dawn-leaf"]));
    await refreshFoundRelicsFromServer("cache-space");
    expect(loadFoundRelics("cache-space")).toEqual(new Set(["relic-harbor-nail", "relic-dawn-leaf"]));
    expect(mocked.syncLegacyRelics).not.toHaveBeenCalled();
  });

  it("one-time legacy sync offers local finds the server lacks, then caches the server state", async () => {
    markRelicFound("legacy-space", "relic-dawn-leaf");
    mocked.getRelicsState!.mockResolvedValue(stateWith([]));
    mocked.syncLegacyRelics!.mockResolvedValue({ ok: true, synced: true, added: ["dawn-leaf"], state: stateWith(["dawn-leaf"]) });
    await refreshFoundRelicsFromServer("legacy-space");
    expect(mocked.syncLegacyRelics).toHaveBeenCalledWith(["dawn-leaf"]);
    expect(loadFoundRelics("legacy-space")).toEqual(new Set(["relic-dawn-leaf"]));
  });

  it("a failed server reach leaves the local cache exactly as it was", async () => {
    markRelicFound("offline-space", "relic-harbor-nail");
    mocked.getRelicsState!.mockResolvedValue(null);
    await refreshFoundRelicsFromServer("offline-space");
    expect(loadFoundRelics("offline-space")).toEqual(new Set(["relic-harbor-nail"]));
  });
});
