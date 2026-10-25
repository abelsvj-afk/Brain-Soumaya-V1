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
    asset: "Station accessories, lighting, and approach dressing",
    credit: "Procedural work made for this app — beacons, docking lights, and traffic are atmosphere, not information.",
  },
  {
    asset: "Warp gates and the transit corridor",
    credit:
      "Procedural work made for this app — shared gate rings, the fly-through corridor, and the procedural ship hull are atmosphere, not information. The corridor sky is the same HYG data credited above.",
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
