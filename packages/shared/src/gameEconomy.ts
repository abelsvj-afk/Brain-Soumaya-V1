/**
 * G1 "The Hold" — the Credits economy's NUMBERS and vocabulary, shared so the
 * client can render the Buyer's Guide, recipes, and prices without hardcoding
 * a copy of them (the fuel constants precedent: `economy.ts` in this package).
 *
 * Requirements: Soumaya-G1-Economy-Requirements-2026-10-29.md v0.2.1
 * (SIGNED OFF 2026-10-29, conditions C1–C3). ALL §9 tuning values live here
 * and ONLY here — retuning is a constants edit, never a rules edit.
 *
 * O-1 WALL (owner decision, D-02/D-05 architecture §11): sales pay in
 * **Credits**, a separate ledger beside Fuel. Credits and Fuel NEVER convert
 * into each other in either direction — no constant in this file (or anywhere)
 * prices one in terms of the other, and no G1 type carries a Fuel field.
 * Fuel stays travel energy only; this module is Credits-only by construction.
 */

/** The five G1 goods (§2): three gathered, two crafted. Integer unit counts,
 *  stackable, identical per unit — no quality grades in G1. */
export const GAME_GOODS = ["ore", "salvage", "data", "component", "circuit"] as const;
export type GameGood = (typeof GAME_GOODS)[number];

export const GAME_GOOD_LABELS: Record<GameGood, string> = {
  ore: "Ore",
  salvage: "Salvage",
  data: "Data",
  component: "Component",
  circuit: "Circuit",
};

/** Gathered goods (§2) — everything else is crafted at the Station refinery. */
export const GATHERED_GOODS: readonly GameGood[] = ["ore", "salvage", "data"];
/** Crafted goods (§2) — produced only by recipes R-1 / R-2. */
export const CRAFTED_GOODS: readonly GameGood[] = ["component", "circuit"];

export function isGameGood(x: unknown): x is GameGood {
  return typeof x === "string" && (GAME_GOODS as readonly string[]).includes(x);
}

/** Hold capacity (§4, §9): 20 units total across ALL goods, one size for
 *  every ship until G3 fittings. Station storage is unlimited (§4). */
export const HOLD_CAPACITY = 20;

/** A new player starts at 0 Credits (§6, §9) — no soft-lock: raw sales cost
 *  nothing, so the first sale always precedes any fee. */
export const CREDITS_START = 0;

/**
 * Base prices (§9) — Credits per unit at the Station Exchange, which buys
 * ALL goods in unlimited quantity (the guaranteed route / never-punish
 * floor: a haul is never unsellable). Prices are FIXED posted prices in G1;
 * moving prices are G4.
 */
export const BASE_PRICES: Record<GameGood, number> = {
  ore: 4,
  salvage: 6,
  data: 8,
  component: 40,
  circuit: 60,
};

/** The five Station buyers (§5). All sit at the Great Station in G1. */
export const GAME_BUYERS = [
  "station-exchange",
  "station-foundry",
  "salvage-yard",
  "archive-broker",
  "fleet-quartermaster",
] as const;
export type GameBuyerId = (typeof GAME_BUYERS)[number];

export interface GameBuyer {
  id: GameBuyerId;
  name: string;
  location: string;
  /** Goods this buyer pays a PREMIUM for (the Exchange lists none — it pays
   *  base for everything, which its `buysAll` flag states). */
  premiumGoods: readonly GameGood[];
  /** True only for the Station Exchange: buys every good at base price. */
  buysAll: boolean;
  /** Daily premium demand cap in units per (space, buyer, good, local-day
   *  period) — §5/R2 + §9. null = unlimited (the Exchange floor). The cap is
   *  a per-good allowance: each premium good gets this many units of demand
   *  per period (the demand table is keyed per good, §5's tracking tuple). */
  dailyDemandCap: number | null;
}

export const BUYERS: readonly GameBuyer[] = [
  {
    id: "station-exchange",
    name: "Station Exchange",
    location: "Great Station",
    premiumGoods: [],
    buysAll: true,
    dailyDemandCap: null,
  },
  {
    id: "station-foundry",
    name: "Station Foundry",
    location: "Great Station",
    premiumGoods: ["ore", "component"],
    buysAll: false,
    dailyDemandCap: 40,
  },
  {
    id: "salvage-yard",
    name: "Salvage Yard",
    location: "Great Station",
    premiumGoods: ["salvage", "circuit"],
    buysAll: false,
    dailyDemandCap: 40,
  },
  {
    id: "archive-broker",
    name: "Archive Broker",
    location: "Great Station (Quiet's desk)",
    premiumGoods: ["data", "circuit"],
    buysAll: false,
    dailyDemandCap: 40,
  },
  {
    id: "fleet-quartermaster",
    name: "Fleet Quartermaster",
    location: "Fleet Deck, Great Station",
    premiumGoods: ["component", "circuit"],
    buysAll: false,
    dailyDemandCap: 12,
  },
];

export function buyerById(id: string): GameBuyer | undefined {
  return BUYERS.find((b) => b.id === id);
}

export function isGameBuyerId(x: unknown): x is GameBuyerId {
  return typeof x === "string" && (GAME_BUYERS as readonly string[]).includes(x);
}

/**
 * Premium prices (§9, explicit table — verified in review): Credits per unit
 * for the (buyer, good) pairs that pay premium. Every other pair is NOT a
 * premium pair: specialized buyers decline goods outside their list, and the
 * Exchange pays base. Absence from this table means "no premium", never 0.
 */
export const PREMIUM_PRICES: Partial<Record<GameBuyerId, Partial<Record<GameGood, number>>>> = {
  "station-foundry": { ore: 6, component: 60 },
  "salvage-yard": { salvage: 9, circuit: 90 },
  "archive-broker": { data: 12, circuit: 90 },
  "fleet-quartermaster": { component: 55, circuit: 90 },
};

/** The posted price a buyer pays for a good, or null when that buyer does
 *  not buy that good at all. The Exchange buys everything at base; a
 *  specialized buyer buys ONLY its premium goods (at premium) — the
 *  guaranteed route for everything else is the Exchange (§5 matrix). */
export function postedPrice(buyerId: GameBuyerId, good: GameGood): number | null {
  const buyer = buyerById(buyerId);
  if (!buyer) return null;
  if (buyer.buysAll) return BASE_PRICES[good];
  return PREMIUM_PRICES[buyerId]?.[good] ?? null;
}

/** Recipes (§3): refining is INSTANT and happens only at the Station
 *  refinery. One atomic transaction per refine: inputs consumed, output
 *  produced, fee deducted — if the fee cannot be paid, nothing is consumed. */
export interface GameRecipe {
  id: "R-1" | "R-2";
  output: GameGood;
  inputs: Partial<Record<GameGood, number>>;
  /** Refinery fee in Credits, burned (a sink, §8). Never Fuel — O-1 wall. */
  feeCredits: number;
}

export const RECIPES: readonly GameRecipe[] = [
  { id: "R-1", output: "component", inputs: { ore: 3, salvage: 2 }, feeCredits: 5 },
  { id: "R-2", output: "circuit", inputs: { salvage: 2, data: 3 }, feeCredits: 8 },
];

export function recipeById(id: string): GameRecipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** Node yields (§9): renewable belt/signal nodes refill to full at the local
 *  day boundary; wreck sites are finite per site and rotate daily (§7). */
export const BELT_NODE_YIELD = 20; // Ore per belt node per day
export const SIGNAL_NODE_YIELD = 15; // Data per signal node per day
export const WRECK_YIELD_MIN = 4; // Salvage per wreck site
export const WRECK_YIELD_MAX = 10;

/** Default node set per space (G1 plays in the known worlds near home, §1):
 *  the counts are placement, the yields above are the tuned numbers. */
export const BELT_NODE_COUNT = 3;
export const SIGNAL_NODE_COUNT = 2;
export const WRECKS_PER_DAY = 3;

/** Resource node kinds (§7). */
export const GAME_NODE_KINDS = ["belt", "signal", "wreck"] as const;
export type GameNodeKind = (typeof GAME_NODE_KINDS)[number];

/** Which good each node kind yields (server-side truth; clients never
 *  assert a yield — architecture I-5). */
export const NODE_KIND_GOOD: Record<GameNodeKind, GameGood> = {
  belt: "ore",
  signal: "data",
  wreck: "salvage",
};
