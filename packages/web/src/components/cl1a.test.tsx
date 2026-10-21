import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Fuel, GraphData } from "@brain/shared";
import {
  foresightChipText, formatToastTime, toastPriorityLabel, formatDueLocal,
  inquiryKindLabel, inquiryAgeText, flashbackLoreLine, humanizeAuthError,
} from "./cl1a.helpers.js";
import { humanizeJobType, shipTaskLabel, JOB_TYPE_LABELS } from "../lib/jobLabels.js";
import { objectLoreFor } from "../graph/objectLore.js";
import { FuelGauge } from "./FuelGauge.js";
import { StreakEmber } from "./StreakEmber.js";
import { FuelEarnSheet } from "./FuelEarnSheet.js";
import { ObjectLoreCard } from "./ObjectLoreCard.js";
import { WelcomeIntro } from "./WelcomeIntro.js";
import { Legend } from "./Legend.js";

afterEach(() => cleanup());
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

const fuel: Fuel = { fuel: 42, capacity: 120, jobCost: 7 };
function graphWith(nodes: Partial<import("@brain/shared").GraphNode>[]): GraphData {
  return {
    nodes: nodes.map((n, i) => ({
      id: i + 1, label: `M${i + 1}`, type: "daily", content: "", createdAt: "2026-01-01 00:00:00", ...n,
    })) as GraphData["nodes"],
    links: [],
  } as unknown as GraphData;
}

describe("IM-03 foresight chip", () => {
  it("renders the server's actual foresight text + inDays, never the old constant", () => {
    const out = foresightChipText({ text: "Your Thursdays keep colliding with deadlines", inDays: 3 });
    expect(out).toContain("Your Thursdays keep colliding");
    expect(out).toContain("in 3 days");
    expect(out).not.toBe("She sees a pattern coming");
    expect(foresightChipText({ text: "X", inDays: 0 })).toContain("today");
    expect(foresightChipText({ text: "X", inDays: 1 })).toContain("in 1 day");
  });
});

describe("IM-04 job labels", () => {
  it("humanizes every server job type; no raw snake_case token survives", () => {
    for (const t of ["synthesis", "calibration", "patrol", "pruning", "harmonization", "research", "merging", "sector_vibe", "daily_log"]) {
      expect(JOB_TYPE_LABELS[t]).toBeTruthy();
      expect(humanizeJobType(t)).not.toContain("_");
    }
    expect(humanizeJobType("sector_vibe")).toBe("Charting the sector");
    expect(humanizeJobType("some_new_job")).toBe("Some new job");
    expect(shipTaskLabel({ type: "sector_vibe" })).toBe("Charting the sector");
    expect(shipTaskLabel({ type: "patrol", description: "Custom run" })).toBe("Custom run");
  });
});

describe("IM-05 toast helpers", () => {
  it("formats a local time and labels only non-normal priorities", () => {
    expect(formatToastTime(new Date(2026, 9, 21, 15, 4).getTime())).toMatch(/3:04\s?PM/);
    expect(toastPriorityLabel("high")).toBe("Urgent");
    expect(toastPriorityLabel("normal")).toBeNull();
  });
});

describe("IM-06 due times", () => {
  it("renders a local due time from stored timestamps", () => {
    // Stored timestamps are UTC ("2026-10-21 15:04:00" = 15:04 UTC); the
    // rendered string must be that instant in the RUNNING zone — derive the
    // expectation from the instant instead of hard-coding one zone's wall
    // time (a hard-coded "3:04 PM" only passes under TZ=UTC).
    const out = formatDueLocal("2026-10-21 15:04:00");
    const instant = new Date(Date.UTC(2026, 9, 21, 15, 4));
    const expected =
      `${instant.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ` +
      `${instant.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    expect(out).toBe(expected);
    expect(formatDueLocal("garbage")).toBe("");
    expect(formatDueLocal(undefined)).toBe("");
  });
});

describe("IM-07 inquiry kind + age", () => {
  it("labels kinds and ages inquiries", () => {
    expect(inquiryKindLabel("hub_suggestion")).toBe("Constellation suggestion");
    expect(inquiryKindLabel("anchor")).toBe("Connection");
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(inquiryAgeText("2026-10-19 12:00:00", now)).toBe("2d ago");
    expect(inquiryAgeText("2026-10-21 11:30:00", now)).toBe("30m ago");
  });
});

describe("IM-09 FuelGauge", () => {
  it("shows capacity + job cost visibly (not only in a title)", () => {
    render(<FuelGauge fuel={fuel} pops={[]} />);
    expect(screen.getByText("of 120")).toBeTruthy();
    expect(screen.getByText("7/job")).toBeTruthy();
  });
});

describe("IM-10 StreakEmber", () => {
  it("shows best, the TRUE shield count (4, not capped at 2 icons), and taps through", () => {
    const onClick = vi.fn();
    render(<StreakEmber streak={5} best={12} atRisk={false} shields={4} onClick={onClick} />);
    expect(screen.getByText("best 12")).toBeTruthy();
    expect(screen.getByText("🛡️×4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("IM-11 FuelEarnSheet", () => {
  it("Recall + Codex rows are Go actions; spend side shows jobCost as a number; sheet animates in", () => {
    const onAction = vi.fn();
    const { container } = render(<FuelEarnSheet fuel={fuel} onAction={onAction} onClose={() => {}} />);
    expect(container.querySelector(".fuel-ways-enter")).toBeTruthy();
    expect(screen.getByText(/Each deep job costs 7 Fuel/)).toBeTruthy();
    const gos = screen.getAllByText("Go");
    expect(gos.length).toBeGreaterThanOrEqual(6); // memory/mind/action/thought/recall/codex
    fireEvent.click(gos[4]!);
    expect(onAction).toHaveBeenCalledWith("recall");
    fireEvent.click(gos[5]!);
    expect(onAction).toHaveBeenCalledWith("codex");
  });
});

describe("IM-12 ObjectLore", () => {
  it("never asserts the fabricated stability index; numbers surface as stats; coldest is a fly-to", () => {
    const g = graphWith([{ label: "Freezing", entropy: 0.99 }, { label: "Warm", entropy: 0.1 }]);
    for (const k of ["station", "ship", "satellite", "visitor", "fleet"] as const) {
      expect(objectLoreFor(k, g).log).not.toContain("12%");
      expect(objectLoreFor(k, g).log).not.toMatch(/stability index/i);
    }
    const onFocus = vi.fn();
    render(<ObjectLoreCard kind="station" graph={g} onClose={() => {}} onFocus={onFocus} />);
    expect(screen.getByText("2 memories")).toBeTruthy();
    fireEvent.click(screen.getByText(/Coldest:/));
    expect(onFocus).toHaveBeenCalledWith(1);
  });
});

describe("IM-17/IM-13 WelcomeIntro", () => {
  it("has galaxy star language, mentions Capture, and shows her eye", () => {
    const { container } = render(<WelcomeIntro companionName="Luna" onClose={() => {}} />);
    expect(container.querySelector(".welcome-stars")).toBeTruthy();
    expect(container.querySelector(".soumaya-eye")).toBeTruthy();
    expect(screen.getByText("Capture", { exact: false })).toBeTruthy();
    expect(screen.getAllByText(/becomes a star/).length).toBeGreaterThanOrEqual(1);
  });
});

describe("IM-08 Legend", () => {
  it("covers Fuel, streak/shields, motes, ship label, Flashback, Focus, Views-vs-Lens, beacon beam/guard", () => {
    render(<Legend onClose={() => {}} />);
    const text = document.body.textContent ?? "";
    for (const needle of ["Fuel", "Nebula shields", "MindSpace motes", "Ship task label", "Beacon beam", "Guard", "Flashback", "Focus mode", "Views vs Lens"]) {
      expect(text).toContain(needle);
    }
  });
});

describe("IM-14 flashback lore line", () => {
  it("carries a lore line + the age + a tap cue", () => {
    const out = flashbackLoreLine({ label: "Old plan", celestialTitle: "Red giant" }, 30);
    expect(out).toContain("30d ago");
    expect(out).toContain("Red giant");
    expect(out).toContain("Tap to fly back");
  });
});

describe("IM-18 human auth errors", () => {
  it("never passes a raw HTTP status through as user copy", () => {
    expect(humanizeAuthError("Couldn't open that brain (401)")).not.toContain("401");
    expect(humanizeAuthError("Failed to fetch")).toMatch(/reach Soumaya/);
    expect(humanizeAuthError("That gamer tag and passcode didn't match.")).toContain("didn't match");
  });
});
