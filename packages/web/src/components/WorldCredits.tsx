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
    asset: "Scale — the International Space Station and NASA probes",
    credit:
      "The ISS model and the Kepler, Pioneer 10, Dawn, and Voyager 1 models are NASA 3D Resources, public domain. The ISS is the catalog's low-poly model (6,642 triangles); the heavier ISS variant was not used. Probe models are the NASA 3D Resources versions; the starfield is the same HYG data credited above.",
  },
  {
    asset: "Eternity's figure — man-god-halo.glb",
    credit:
      "The owner's own file — his uploaded figure, split into body + halo for this app so the halo can glow on its own. No third-party source; no license applies. Shown ×170 in Eternity's world.",
  },
  {
    asset: "Eternity's visitor fleet — Kenney speeders (speederA–D)",
    credit:
      "Four more Kenney Space Kit craft (kenney.nl), CC0 1.0 — the same kit and the same basis as the Station's Kenney entries above. The files carry no in-file license statement, matching their shipped siblings.",
  },
  {
    asset: "Low Poly Space Pack — reodesuxz (all worlds + galaxy drifters)",
    credit:
      "26 models by reodesuxz (itch.io), free for commercial use, no attribution required. The raw pack files are not redistributed — only the models used in-app ship inside the app. Planets, the Moon and its outpost, asteroid belts, encounters, docked ships, dressing, the drydock gantry, the stratum crystal, Sputnik, and the galaxy drifters.",
  },
  {
    asset: "FlexUnit UFO",
    credit:
      "“3D Game Ready UFO Spaceship” by FlexUnit, CC0. Converted from FBX to GLB; scaled up on placement (the converted file measures tiny in its own units).",
  },
  {
    asset: "Poly Pizza models — hunt #2",
    credit:
      "Models from Poly Pizza (the former Google Poly library plus community uploads), CC-BY 3.0 unless noted: “Black hole”, “Comet”, “Sun”, “Moon”, “Planets (set)”, “Asteroid”, “Hubble telescope” by Poly by Google; “Earth and Moon”, “Solar System”, “Asteroids” by Jarlan Perez; “The solar system” by Diego Dilley; “Asteroid” by J-Toastie; “Planet” ×3, “Star”, “Debris Pile” by Quaternius, CC0 1.0; “Pixel Planet WISE 0855-0714” by AstroJar, CC0 1.0; “Stars” by MiniPoly; “Cloud” by jeremy; “Rubble Rocks” by Kyle Hickman.",
  },
  {
    asset: "NASA supernova remnants — hunt #2",
    credit:
      "Bennu, G292.0+1.8, and Pillar 1B of the Pillars of Creation — NASA 3D Resources / STScI, public domain. Pillar 1B was converted from the published STL (which carries no color) and is given a rose-gold nebula material in-app.",
  },
  {
    asset: "reodesuxz packs — hunt #2",
    credit:
      "81 models by reodesuxz (itch.io), free for commercial use, no attribution needed. The raw pack files are not redistributed — only the models used in-app ship inside the app. Each pack merges to one call as an annex settlement (Lunar Annex, Colony Ring, Station Stores).",
  },
  {
    asset: "Kenney station picks — hunt #2",
    credit:
      "Table-display planet, rocks, structure, and tall container by Kenney (kenney.nl), CC0 1.0. The kit's other files are interior furniture with no home in the app.",
  },
  {
    asset: "Nebula renders — hunt #2",
    credit:
      "Three of fourteen “Space, nebula, starfield renders” by Jattenalle, OpenGameArt, CC-BY 3.0, used as huge static backdrop planes far outside the orbit. They are pictures of nebulas, not 3D nebulas.",
  },
  {
    asset: "Sketchfab models — owner-downloaded",
    credit:
      "“Planetary Nebula” by Tycho Magnetic Anomaly, “Black Hole” by SebastianSosnowski, “Pulsar | AstroRiah” by MonstroCount (@AstroRiah), “Nebula traveller” by tamminen, “Supernova remnant” by Aiekick, “Lava planet” by FPSunreal, and “Ice planet with procedural textures” by imperioame — all Sketchfab, all CC-BY 4.0, all downloaded by the owner himself on 2026-10-27. The nebula and black hole are Scale centerpieces (animated, loaded as-is), the pulsar is a Scale encounter (loaded as-is so its glow survives), the nebula traveller is the sixth galaxy drifter (loaded as-is so its glass and morph clip survive), the supernova remnant ships only as a slimmed point cloud in the Deep Past (216,902 points, 10% of the source), the lava planet is a Great Station backdrop planet, and the ice planet is a Growing Place backdrop planet (both loaded as-is, 4,000 units out).",
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
