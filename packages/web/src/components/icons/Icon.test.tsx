import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ICON_NAMES, Icon, renderIcon } from "./Icon.js";

describe("HUD icon set", () => {
  it("every icon draws something, and is decorative (aria-hidden) — the button keeps its own name", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(50);
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden"), name).toBe("true");
      expect(svg.querySelectorAll("path,circle,ellipse").length, name).toBeGreaterThan(0);
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      unmount();
    }
  });
  it("renderIcon: i:name → svg, an emoji or an unknown name → text", () => {
    expect(render(<span>{renderIcon("i:search")}</span>).container.querySelector("svg")).toBeTruthy();
    expect(render(<span>{renderIcon("🔍")}</span>).container.textContent).toBe("🔍");
    expect(render(<span>{renderIcon("i:nope")}</span>).container.textContent).toBe("i:nope");
  });
});
