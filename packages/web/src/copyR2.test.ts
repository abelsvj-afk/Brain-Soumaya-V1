import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

describe("Reviewer r2 (#173/#174) copy follow-ups", () => {
  const login = read("components/LoginScreen.tsx");
  it("the login username field offers saved usernames (autocomplete)", () => {
    expect(login).toMatch(/placeholder="e\.g\. pilot77"\s*autoComplete="username"/);
    expect(login).toMatch(/autoComplete=\{isSignUp \? "new-password" : "current-password"\}/);
  });
  it("the reserved-name error names the field as it is labelled", () => {
    expect(login).toContain("Brain / Companion name\n");
    expect(login).toContain("The Brain / Companion name 'Soumaya' is reserved");
    expect(login).not.toContain("The brain name 'Soumaya'");
  });
  it("first-run copy says 'add', not 'drop/log', and doesn't assume one welcome star", () => {
    expect(read("components/Observatory.tsx")).toContain("✍️ Add your first memory");
    expect(read("components/HelpPanel.tsx")).toContain("add your first real memory");
    const hud = read("components/GalaxyHud.tsx");
    expect(hud).not.toContain("lit one star");
    expect(hud).toContain("Soumaya lit up your sky to welcome you");
  });
});
