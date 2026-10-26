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
      "Model by 3DHaupt aka Dennis Haupt (in-file copyright). No license statement ships with the file and no credit line existed for it — provenance UNVERIFIED, a pre-existing open audit item; the file already ships in the home galaxy. Recorded in the P2-6 provenance inventory.",
  },
  {
    asset: "Traffic fleet — Quaternius Ultimate Spaceships",
    credit:
      "11 hulls by Quaternius, CC0 1.0 in-file (the pack's website now shows QAL v1.0 — see the P2-6 provenance inventory for the flag). Converted from the native glTF mirror to GLB; textures resized 2048×2048 to 1024×1024.",
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
