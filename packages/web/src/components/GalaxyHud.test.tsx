import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  AudioStateChip,
  BeaconReadout,
  EmptyGalaxyCue,
  ModelFallbackNote,
  SceneIdentityCard,
  VisitorChip,
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
