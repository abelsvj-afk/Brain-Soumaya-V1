import { EXTRACTABLE_NODE_TYPES } from "./types.js";
import { CELESTIAL_CLASSES } from "./celestial.js";

/**
 * The Codex catalog — the SINGLE SOURCE OF TRUTH for which Codex entry ids exist
 * and may claim their one-time fuel reward.
 *
 * The web client (packages/web/src/components/codex.ts) builds its entries from
 * these lists, and the server (packages/server/src/api/routes/maintenance.ts)
 * validates `POST /maintenance/codex-claim` against CODEX_STATIC_KEYS. Until
 * IM-93 the two sides each kept a hand-mirrored copy and silently drifted: the
 * server's list never gained the mind layer, five phenomena, or field notes,
 * so those discoveries were rejected with 400 and their fuel was lost.
 *
 * Two id families are deliberately NOT in the static set because they are
 * dynamic and verified against live data server-side instead:
 *  - `constellation-<hubId>` — verified against the space's real MOC hubs.
 *  - `fieldnote-<key>`       — verified against the space's codex_discoveries.
 */

/** Mind-layer kinds, one Codex entry each (`mind-<kind>`). Mirrors MIND_DEFS in the web codex. */
export const CODEX_MIND_KINDS = [
  "goal",
  "skill",
  "person_entity",
  "identity",
  "idea",
  "intention",
  "motivation",
] as const;
export type CodexMindKind = (typeof CODEX_MIND_KINDS)[number];

/** Phenomenon ids, one Codex entry each (`phenom-<id>`). Mirrors phenomenaEntries in the web codex. */
export const CODEX_PHENOMENA = [
  "firstlink",
  "star",
  "supernova",
  "deep",
  "crown",
  "goldenhour",
  "theweight",
  "aurora",
  "ancient",
  "cooling",
  "tender",
] as const;
export type CodexPhenomenon = (typeof CODEX_PHENOMENA)[number];

/** Fleet unit ids, one Codex entry each (`fleet-<unit>`). Mirrors fleetEntries in the web codex. */
export const CODEX_FLEET_UNITS = ["soumaya", "station", "beacon"] as const;

/** Every static (enumerable) rewardable Codex entry id, exactly as the client generates them. */
export const CODEX_STATIC_KEYS: ReadonlySet<string> = new Set<string>([
  ...EXTRACTABLE_NODE_TYPES.map((t) => `sector-${t}`),
  ...CELESTIAL_CLASSES.map((c) => `body-${c}`),
  "body-singularity",
  ...CODEX_FLEET_UNITS.map((u) => `fleet-${u}`),
  ...CODEX_MIND_KINDS.map((k) => `mind-${k}`),
  ...CODEX_PHENOMENA.map((p) => `phenom-${p}`),
]);
