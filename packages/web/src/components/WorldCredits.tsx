/**
 * Worlds credits (Phase 2, P2-3) — the attribution surface the worlds
 * layer owes its asset sources. CC-BY attribution is a hard
 * requirement of the Station's base model (D-37), so this ships with
 * the layer, not as later polish. Entries land here WITH the asset that
 * uses them; nothing is credited that isn't in use.
 */
export interface WorldCredit {
  asset: string;
  credit: string;
}

export const WORLD_CREDITS: readonly WorldCredit[] = [
  {
    asset: "The Great Station — base model “Profondo”",
    credit:
      "Model by vostok, via BlendSwap. Licensed CC BY. Materials and lighting re-expressed for this app; the model was converted from its original Blender file.",
  },
  {
    asset: "Starfield — HYG star database",
    credit:
      "Star positions and colors derived from the HYG database (Astronexus). Licensed CC BY-SA 4.0. A subset of the brightest stars is used.",
  },
  {
    asset: "Her ship — soumaya-ship.glb",
    credit:
      "“Intergalactic Spaceship Version 2” by 3DHaupt (Dennis Haupt), licensed CC-BY-NC (non-commercial use only). Before any commercial use of the worlds, this ship must be replaced with the verified CC-BY-4.0 fallback, organic-spaceship.glb. Recorded in the P2-6 provenance inventory.",
  },
  {
    asset: "Traffic fleet — Quaternius Ultimate Spaceships",
    credit:
      "11 hulls by Quaternius, CC0 1.0 in-file — the CC0 grant inside the downloaded packs governs the files as shipped (the pack's website now shows QAL v1.0, last updated 2026-08-28). The raw packs are not redistributed. Converted from the native glTF mirror to GLB; textures resized 2048×2048 to 1024×1024.",
  },
  {
    asset: "Traffic, docked ships, and dressing — Kenney Space Kit and Station Kit",
    credit:
      "Models by Kenney (kenney.nl), CC0 1.0. Converted to GLB; materials re-expressed in-app. The Station Kit is interior furniture — it supplies dressing only, never the hauler or drydock witnesses.",
  },
  {
    asset: "Traffic regular — WATO spaceship",
    credit:
      "Model by XCVG, CC-BY 3.0. Converted to GLB; materials re-expressed in-app.",
  },
  {
    asset: "Station accessories, lighting, and approach dressing",
    credit: "Procedural work made for this app — beacons, docking lights, and dressing are atmosphere, not information. Traffic ships are real free assets, credited above — no placeholder procedural traffic remains.",
  },
  {
    asset: "Warp gates and the transit corridor",
    credit:
      "Procedural work made for this app — shared gate rings and the fly-through corridor are atmosphere, not information. The corridor sky is the same HYG data credited above. The transit ship is her own ship, credited above; the procedural hull is its load-failure fallback.",
  },
  {
    asset: "Eternity's figure — man-god-halo.glb",
    credit:
      "The owner's own file — his uploaded figure, split into body + halo for this app so the halo can glow on its own. No third-party source; no license applies. Scaled ×170 in Eternity's world.",
  },
  {
    asset: "Eternity's visitor fleet — Kenney speeders (speederA–D)",
    credit:
      "Four more Kenney Space Kit craft (kenney.nl), CC0 1.0 — the same kit and the same basis as the Station's Kenney entries above. The files carry no in-file license statement, matching their shipped siblings.",
  },
];

export default function WorldCredits() {
  return (
    <section aria-label="Worlds credits" className="world-credits">
      <h3>Credits</h3>
      <ul>
        {WORLD_CREDITS.map((c) => (
          <li key={c.asset}>
            <strong>{c.asset}.</strong> {c.credit}
          </li>
        ))}
      </ul>
    </section>
  );
}
