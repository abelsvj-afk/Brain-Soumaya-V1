import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, renderHook, act, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  BeaconReadout,
  EmptyGalaxyCue,
  ModelFallbackNote,
  SceneIdentityCard,
  ShipStatusStack,
  SHIP_STATUS_AUTO_COLLAPSE_MS,
  VisitorChip,
  resolveShipStatusOpen,
  useShipStatusOpen,
} from "./GalaxyHud.js";

afterEach(() => cleanup());

describe("IM-20 BeaconReadout", () => {
  it("shows the beacon's target labels where the beam is seen, fly-to on tap", () => {
    const onFocus = vi.fn();
    render(
      <BeaconReadout
        status={{ beacon: { active: true, detail: "1 warming a memory", targets: [{ id: 5, label: "Old house" }], pending: 0 } }}
        onFocus={onFocus}
      />,
    );
    expect(screen.getByText(/Old house/)).toBeTruthy();
    expect(screen.getByText(/Visit a beamed memory/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Old house/ }));
    expect(onFocus).toHaveBeenCalledWith(5);
  });
  it("renders nothing when no beacon is deployed", () => {
    const { container } = render(
      <BeaconReadout status={{ beacon: { active: false, detail: "None deployed", targets: [], pending: 0 } }} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("IM-19 visitor + fleet identity in the shell", () => {
  it("visitor chip names the variant and its target memory", () => {
    render(<VisitorChip visitors={[{ variantName: "Void Wanderer", targetLabel: "Heavy day" }]} />);
    expect(screen.getByText(/Void Wanderer/)).toBeTruthy();
    expect(screen.getByText(/Heavy day/)).toBeTruthy();
  });
  it("identity card for a followed fleet craft carries roster name + live detail", () => {
    render(
      <SceneIdentityCard
        identity={{ kind: "fleet", unitId: "defender", detail: "Guarding “Big hub”", targetLabel: "Big hub" }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Defender/)).toBeTruthy();
    expect(screen.getByText(/Guarding “Big hub”/)).toBeTruthy();
  });
  it("identity card for a followed visitor names the variant", () => {
    render(
      <SceneIdentityCard
        identity={{ kind: "visitor", variantName: "Luminous Traveler", targetId: 3, targetLabel: "Lisbon trip" }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Luminous Traveler/)).toBeTruthy();
    expect(screen.getByText(/Lisbon trip/)).toBeTruthy();
  });
});

describe("IM-23 EmptyGalaxyCue", () => {
  it("gives the first-star cue and an add action", () => {
    const onAdd = vi.fn();
    render(<EmptyGalaxyCue onAdd={onAdd} />);
    expect(screen.getByText(/first star goes here/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /first memory/ }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("IM-24 ModelFallbackNote", () => {
  it("surfaces a failed model swap as a visible note, not console-only", () => {
    render(<ModelFallbackNote assets={["The Waystation model"]} />);
    expect(screen.getByText(/Waystation model couldn't load/)).toBeTruthy();
    expect(screen.getByText(/stand-in/)).toBeTruthy();
  });
  it("renders nothing when every model loaded", () => {
    const { container } = render(<ModelFallbackNote assets={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("HUD round 3 — the summonable ShipStatusStack", () => {
  const beacon = (detail: string) => ({
    beacon: { active: true, detail, targets: [{ id: 5, label: "Old house" }], pending: 0 },
  });

  it("collapsed shows the Drifter line first and counts the folded lines", () => {
    const { container } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <VisitorChip visitors={[{ variantName: "Void Wanderer", targetLabel: "Heavy day" }]} />
        <BeaconReadout status={beacon("3 warming memories")} />
      </ShipStatusStack>,
    );
    const mini = container.querySelector(".ship-status-mini");
    expect(mini).not.toBeNull();
    expect(container.querySelector(".ship-status-stack")).toBeNull();
    expect(mini!.textContent).toContain("Void Wanderer");
    expect(mini!.textContent).toContain("＋1"); // the beacon line is folded away
    expect(mini!.textContent).not.toContain("3 warming memories");
    expect(mini!.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapsed with no visitor shows the beacon HEAD line only — targets and hint stay expanded-only", () => {
    const { container } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout status={beacon("3 warming memories")} />
      </ShipStatusStack>,
    );
    const mini = container.querySelector(".ship-status-mini")!;
    expect(mini.textContent).toContain("📡 3 warming memories");
    expect(mini.textContent).not.toContain("Old house");
    expect(mini.textContent).not.toContain("Visit a beamed memory");
    expect(mini.textContent).not.toContain("＋"); // nothing else to fold
  });

  it("collapsed with an idle beacon and no visitor shows no pill at all", () => {
    const { container } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout
          status={{ beacon: { active: false, detail: "None deployed", targets: [], pending: 0 } }}
        />
      </ShipStatusStack>,
    );
    expect(container.querySelector(".ship-status-mini")).toBeNull();
  });

  it("the whole mini-bar is the expand target", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ShipStatusStack collapsed onToggle={onToggle}>
        <BeaconReadout status={beacon("3 warming memories")} />
      </ShipStatusStack>,
    );
    fireEvent.click(container.querySelector(".ship-status-mini")!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("expanded renders every line plus a ▾ fold-away with its own target", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ShipStatusStack onToggle={onToggle}>
        <VisitorChip visitors={[{ variantName: "Void Wanderer", targetLabel: "Heavy day" }]} />
        <BeaconReadout status={beacon("3 warming memories")} />
      </ShipStatusStack>,
    );
    expect(container.querySelector(".ship-status-stack")).not.toBeNull();
    expect(container.querySelector(".ship-status-mini")).toBeNull();
    expect(screen.getByText(/Old house/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide ship status" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("without onToggle there is no fold-away — the legacy shape is preserved", () => {
    const { container } = render(
      <ShipStatusStack>
        <div>x</div>
      </ShipStatusStack>,
    );
    expect(container.querySelector(".ship-status-collapse")).toBeNull();
    expect(container.querySelector(".ship-status-mini")).toBeNull();
  });

  it("a new status while collapsed pulses the bar once and swaps the line — it never expands", () => {
    const { container, rerender } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout
          status={{ beacon: { active: true, detail: "1 warming a memory", targets: [], pending: 0 } }}
        />
      </ShipStatusStack>,
    );
    expect(container.querySelector(".ship-status-mini")!.classList.contains("pulse")).toBe(false);
    rerender(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout
          status={{ beacon: { active: true, detail: "Dispatching 1…", targets: [], pending: 1 } }}
        />
      </ShipStatusStack>,
    );
    const mini = container.querySelector(".ship-status-mini")!;
    expect(mini.classList.contains("pulse")).toBe(true);
    expect(mini.textContent).toContain("Dispatching 1…");
    expect(container.querySelector(".ship-status-stack")).toBeNull(); // still collapsed
  });
});

describe("Warming card (t38u) — useShipStatusOpen always starts as the pill", () => {
  const realW = window.innerWidth;
  const realH = window.innerHeight;
  const setViewport = (w: number, h: number) => {
    Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
  };
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    setViewport(realW, realH);
    localStorage.clear();
  });

  it("starts collapsed on desktop and phone, even with an old stored 'expanded' preference", () => {
    for (const [w, h] of [[1440, 900], [390, 844], [844, 390]] as const) {
      setViewport(w, h);
      localStorage.setItem("ship.status.brain-a", "1");
      const seen: boolean[] = [];
      function Probe() {
        const [open] = useShipStatusOpen("brain-a");
        seen.push(open);
        return null;
      }
      const { unmount } = render(<Probe />);
      expect(seen[0]).toBe(false);
      expect(seen[seen.length - 1]).toBe(false);
      unmount();
    }
    expect(resolveShipStatusOpen("brain-a", 1440, 900)).toEqual({ open: false, reveal: false });
  });

  it("the toggle opens and closes it for the current brain; a brain switch starts collapsed", () => {
    const { result, rerender } = renderHook(({ id }) => useShipStatusOpen(id), { initialProps: { id: "brain-b" } });
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    rerender({ id: "brain-c" });
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});

describe("Warming card (t38u) — the expanded stack folds itself away", () => {
  afterEach(() => vi.useRealTimers());
  it(`calls onToggle after ${SHIP_STATUS_AUTO_COLLAPSE_MS}ms, but not while hovered`, () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    const { container } = render(
      <ShipStatusStack onToggle={onToggle}>
        <div>x</div>
      </ShipStatusStack>,
    );
    const stack = container.querySelector(".ship-status-stack")!;
    fireEvent.pointerEnter(stack);
    act(() => { vi.advanceTimersByTime(SHIP_STATUS_AUTO_COLLAPSE_MS + 100); });
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.pointerLeave(stack);
    act(() => { vi.advanceTimersByTime(SHIP_STATUS_AUTO_COLLAPSE_MS - 100); });
    expect(onToggle).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it("never auto-folds a stack rendered without onToggle", () => {
    vi.useFakeTimers();
    render(<ShipStatusStack><div>x</div></ShipStatusStack>);
    act(() => { vi.advanceTimersByTime(SHIP_STATUS_AUTO_COLLAPSE_MS * 3); });
  });
  it("collapsed with nothing to report renders no pill at all", () => {
    const { container } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout status={null} />
      </ShipStatusStack>,
    );
    expect(container.querySelector(".ship-status-mini")).toBeNull();
  });
});
