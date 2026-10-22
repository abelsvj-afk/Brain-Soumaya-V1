import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, renderHook, act, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  AudioStateChip,
  BeaconReadout,
  EmptyGalaxyCue,
  ModelFallbackNote,
  SceneIdentityCard,
  ShipStatusStack,
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

describe("IM-21 AudioStateChip", () => {
  it("shows all three channel states and opens audio settings on tap", () => {
    const open = vi.fn();
    render(<AudioStateChip sfx={false} voice={false} music={false} onOpenAudioSettings={open} />);
    const chip = screen.getByRole("button", { name: /Audio:/ });
    expect(chip.textContent).toContain("Sounds off");
    expect(chip.textContent).toContain("Voice off");
    expect(chip.textContent).toContain("Music off");
    fireEvent.click(chip);
    expect(open).toHaveBeenCalled();
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
  const audioProps = { sfx: true, voice: true, music: false, onOpenAudioSettings: () => {} };
  const beacon = (detail: string) => ({
    beacon: { active: true, detail, targets: [{ id: 5, label: "Old house" }], pending: 0 },
  });

  it("collapsed shows the Drifter line first and counts the folded lines", () => {
    const { container } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <VisitorChip visitors={[{ variantName: "Void Wanderer", targetLabel: "Heavy day" }]} />
        <BeaconReadout status={beacon("3 warming memories")} />
        <AudioStateChip {...audioProps} />
      </ShipStatusStack>,
    );
    const mini = container.querySelector(".ship-status-mini");
    expect(mini).not.toBeNull();
    expect(container.querySelector(".ship-status-stack")).toBeNull();
    expect(mini!.textContent).toContain("Void Wanderer");
    expect(mini!.textContent).toContain("＋2"); // beacon + audio folded away
    expect(mini!.textContent).not.toContain("3 warming memories");
    expect(mini!.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapsed with no visitor shows the beacon HEAD line only — targets and hint stay expanded-only", () => {
    const { container } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout status={beacon("3 warming memories")} />
        <AudioStateChip {...audioProps} />
      </ShipStatusStack>,
    );
    const mini = container.querySelector(".ship-status-mini")!;
    expect(mini.textContent).toContain("📡 3 warming memories");
    expect(mini.textContent).not.toContain("Old house");
    expect(mini.textContent).not.toContain("Visit a beamed memory");
    expect(mini.textContent).toContain("＋1"); // only the audio line is folded
  });

  it("collapsed with nothing but audio shows the audio line and no count", () => {
    const { container } = render(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout
          status={{ beacon: { active: false, detail: "None deployed", targets: [], pending: 0 } }}
        />
        <AudioStateChip {...audioProps} />
      </ShipStatusStack>,
    );
    const mini = container.querySelector(".ship-status-mini")!;
    expect(mini.textContent).toContain("Sounds on");
    expect(mini.textContent).not.toContain("＋");
  });

  it("the whole mini-bar is the expand target", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ShipStatusStack collapsed onToggle={onToggle}>
        <BeaconReadout status={beacon("3 warming memories")} />
        <AudioStateChip {...audioProps} />
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
        <AudioStateChip {...audioProps} />
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
        <AudioStateChip {...audioProps} />
      </ShipStatusStack>,
    );
    expect(container.querySelector(".ship-status-mini")!.classList.contains("pulse")).toBe(false);
    rerender(
      <ShipStatusStack collapsed onToggle={() => {}}>
        <BeaconReadout
          status={{ beacon: { active: true, detail: "Dispatching 1…", targets: [], pending: 1 } }}
        />
        <AudioStateChip {...audioProps} />
      </ShipStatusStack>,
    );
    const mini = container.querySelector(".ship-status-mini")!;
    expect(mini.classList.contains("pulse")).toBe(true);
    expect(mini.textContent).toContain("Dispatching 1…");
    expect(container.querySelector(".ship-status-stack")).toBeNull(); // still collapsed
  });
});

describe("HUD round 3 — useShipStatusOpen (per-brain persistence + defaults)", () => {
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

  it("a stored preference wins, and the toggle round-trips it under ship.status.<id>", () => {
    localStorage.setItem("ship.status.brain-a", "0");
    const { result } = renderHook(() => useShipStatusOpen("brain-a"));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("ship.status.brain-a")).toBe("1");
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem("ship.status.brain-a")).toBe("0");
  });

  it("phone, no preference: the first run reveals expanded and marks seen; the next mount defaults collapsed", () => {
    setViewport(390, 780);
    const first = renderHook(() => useShipStatusOpen("brain-b"));
    expect(first.result.current[0]).toBe(true);
    expect(localStorage.getItem("ship.statusSeen.brain-b")).toBe("1");
    first.unmount();
    const second = renderHook(() => useShipStatusOpen("brain-b"));
    expect(second.result.current[0]).toBe(false);
  });

  it("desktop, no preference: starts expanded and does not consume the phone reveal", () => {
    setViewport(1440, 900);
    const { result } = renderHook(() => useShipStatusOpen("brain-c"));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("ship.statusSeen.brain-c")).toBeNull();
  });

  it("resolveShipStatusOpen: a stored preference beats every default, both ways", () => {
    localStorage.setItem("ship.status.brain-d", "1");
    expect(resolveShipStatusOpen("brain-d", 390, 780)).toEqual({ open: true, reveal: false });
    localStorage.setItem("ship.status.brain-d", "0");
    expect(resolveShipStatusOpen("brain-d", 1440, 900)).toEqual({ open: false, reveal: false });
  });
});
