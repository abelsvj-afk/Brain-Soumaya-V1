import { COOLING_ENTROPY, type GraphData } from "@brain/shared";

/** Lore-bearing non-memory objects in the galaxy. */
export type LoreObjectKind = "station" | "ship" | "satellite" | "visitor" | "fleet";

interface BrainSignals {
  count: number; // memories
  links: number;
  tone: number; // avg emotional weight, -1..1
  ageDays: number; // since the oldest memory (the galaxy's age)
  hub?: string; // biggest hub's label
  cooling: number; // memories going cold (entropy >= threshold)
  coldest?: string; // label of the coldest memory (only if actually cold)
  coldestId?: number; // id of that memory, so the card can offer a fly-to
  watchId?: number;
  watch?: string; // label of the most-neglected memory (always set if any exist)
}

interface StoryArc {
  type: "paradox" | "muse" | "resolution" | "complication" | "analogy";
  sourceLabel: string;
  targetLabel: string;
}

function findStoryArcs(graph: GraphData): StoryArc[] {
  const arcs: StoryArc[] = [];
  const nodes = graph.nodes;
  const links = graph.links;
  const nodeMap = new Map<number | string, any>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  for (const l of links) {
    const srcId = typeof l.source === "object" ? (l.source as any).id : l.source;
    const tgtId = typeof l.target === "object" ? (l.target as any).id : l.target;
    const src = nodeMap.get(srcId);
    const tgt = nodeMap.get(tgtId);
    if (!src || !tgt) continue;

    // 1. Paradox Arc (extreme positive + negative)
    if (
      src.emotionalWeight !== undefined &&
      tgt.emotionalWeight !== undefined &&
      Math.abs(src.emotionalWeight - tgt.emotionalWeight) >= 1.2
    ) {
      arcs.push({
        type: "paradox",
        sourceLabel: src.label,
        targetLabel: tgt.label,
      });
    }

    // 2. Muse Arc (a person paired with an idea/project/concept/note)
    const isMuseIdea = (ty: string) =>
      ty === "project" || ty === "concept" || ty === "knowledge" || ty === "daily" || ty === "decision";
    if (
      (src.type === "person" && isMuseIdea(tgt.type)) ||
      (tgt.type === "person" && isMuseIdea(src.type))
    ) {
      const personNode = src.type === "person" ? src : tgt;
      const ideaNode = src.type === "person" ? tgt : src;
      arcs.push({
        type: "muse",
        sourceLabel: personNode.label,
        targetLabel: ideaNode.label,
      });
    }

    // 3. Resolution Arc
    if (l.relationship === "resolves") {
      arcs.push({
        type: "resolution",
        sourceLabel: src.label,
        targetLabel: tgt.label,
      });
    }

    // 4. Complication Arc
    if (l.relationship === "complicates") {
      arcs.push({
        type: "complication",
        sourceLabel: src.label,
        targetLabel: tgt.label,
      });
    }

    // 5. Analogy Arc
    if (l.relationship === "is_analogous_to") {
      arcs.push({
        type: "analogy",
        sourceLabel: src.label,
        targetLabel: tgt.label,
      });
    }
  }
  return arcs;
}

/** Parse sqlite ("YYYY-MM-DD HH:MM:SS", UTC) or ISO timestamps safely. */
function parseTs(ts?: string): number | null {
  if (!ts) return null;
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  const withZ = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZ);
  return Number.isNaN(ms) ? null : ms;
}

/** Distil the brain into a few signals the lore can grow from. */
function readSignals(graph: GraphData): BrainSignals {
  const nodes = graph.nodes.filter((n) => n.kind !== "action");
  const count = nodes.length;
  const links = graph.links.length;
  let toneSum = 0;
  let toneN = 0;
  let oldest = Infinity;
  let hub = nodes[0];
  let cooling = 0;
  let coldest = nodes[0];
  for (const n of nodes) {
    if (typeof n.emotionalWeight === "number") {
      toneSum += n.emotionalWeight;
      toneN += 1;
    }
    const ms = parseTs(n.createdAt);
    if (ms !== null && ms < oldest) oldest = ms;
    if ((n.degree ?? 0) > (hub?.degree ?? -1) || (hub == null)) hub = n;
    if ((n.entropy ?? 0) >= COOLING_ENTROPY) cooling += 1;
    if ((n.entropy ?? 0) > (coldest?.entropy ?? -1) || coldest == null) coldest = n;
  }
  const ageDays = oldest === Infinity ? 0 : Math.max(0, (Date.now() - oldest) / 86_400_000);
  return {
    count,
    links,
    tone: toneN > 0 ? toneSum / toneN : 0,
    ageDays,
    hub: hub?.label,
    cooling,
    coldest: (coldest?.entropy ?? 0) >= COOLING_ENTROPY ? coldest?.label : undefined,
    coldestId: (coldest?.entropy ?? 0) >= COOLING_ENTROPY ? coldest?.id : undefined,
    watch: coldest?.label,
    watchId: coldest?.id,
  };
}

const toneWord = (t: number): string =>
  t > 0.3 ? "warm, hopeful currents" : t < -0.3 ? "cold, restless undertows" : "calm, even tides";

/** A human "age" phrase from days (the object is as old as the galaxy it tends). */
function agePhrase(days: number): string {
  if (days < 1) return "commissioned only hours ago";
  if (days < 2) return "a day into its watch";
  if (days < 14) return `${Math.round(days)} days into its watch`;
  if (days < 60) return `${Math.round(days / 7)} weeks on station`;
  if (days < 730) return `${Math.round(days / 30)} months on station`;
  return `${(days / 365).toFixed(1)} years on station`;
}

/** Scale band so the story visibly changes as the brain grows. */
function band(count: number): "nascent" | "growing" | "rich" | "vast" {
  if (count <= 3) return "nascent";
  if (count <= 12) return "growing";
  if (count <= 40) return "rich";
  return "vast";
}

/**
 * Procedural, evolving lore for a galaxy object — no tokens, free + offline. The
 * text is shaped by WHAT the object is (a station vs. a ship), by the current
 * state of the brain (size, emotional tone, the hub it watches over), and by its
 * TIME in service (age). Add memories and the log mutates and grows.
 */
export function objectLoreFor(
  kind: LoreObjectKind,
  graph: GraphData,
): { title: string; log: string; stats: { memories: number; links: number; cooling: number; coldest?: string; coldestId?: number } } {
  const s = readSignals(graph);
  const b = band(s.count);
  const age = agePhrase(s.ageDays);
  const tone = toneWord(s.tone);
  const hub = s.hub ? `“${s.hub}”` : "an unnamed first light";

  const stats = { memories: s.count, links: s.links, cooling: s.cooling, coldest: s.coldest, coldestId: s.coldestId };
  const arcs = findStoryArcs(graph);
  const arcIndex = (s.count + s.links) % (arcs.length || 1);
  const arc = arcs.length > 0 ? arcs[arcIndex] : null;

  if (kind === "ship") {
    const title = "Soumaya · Voyager-class scout";
    const intro = `I'm Soumaya — a lone scout threading your memory galaxy, ${age}.`;
    const state =
      b === "nascent"
        ? `Only ${s.count || "a"} ${s.count === 1 ? "world has" : "worlds have"} lit so far; I fly mostly dark sky, charting first.`
        : b === "growing"
          ? `I've logged ${s.count} worlds along ${s.links} routes — the sky is filling in around ${hub}.`
          : b === "rich"
            ? `${s.count} worlds, ${s.links} routes: a real constellation now, and I keep returning to ${hub}.`
            : `${s.count} worlds and ${s.links} routes — a vast, humming galaxy. I rarely sleep; there's always a new orbit to plot.`;
    const mood = `The currents out here run ${tone}.`;
    
    let arcStory = "";
    if (arc) {
      if (arc.type === "paradox") {
        arcStory = ` I've noticed a high-tension rift between the bright resonance of “${arc.sourceLabel}” and the dark gravity of “${arc.targetLabel}”. Flying this corridor tests my stabilizer coils, but it's the only way to thread your thoughts.`;
      } else if (arc.type === "muse") {
        arcStory = ` The orbit around “${arc.targetLabel}” is shaped by the presence of “${arc.sourceLabel}”. It feels like inspiration; I've charted a custom flight path to watch them sync.`;
      } else if (arc.type === "resolution") {
        arcStory = ` I observed “${arc.sourceLabel}” resolving the tension of “${arc.targetLabel}”. It cleared a major sector storm on my maps — things feel quieter now.`;
      } else if (arc.type === "complication") {
        arcStory = ` The connection between “${arc.sourceLabel}” and “${arc.targetLabel}” is complicated. I've logged increased signal noise along this route — proceed with caution.`;
      } else if (arc.type === "analogy") {
        arcStory = ` I found a strange mirror: “${arc.sourceLabel}” is analogous to “${arc.targetLabel}”. They spin in parallel, reflecting each other across the deep.`;
      }
    }
    
    return { title, log: `${intro} ${state} ${mood}${arcStory}`, stats };
  }

  if (kind === "satellite") {
    const title = "Aura-class Beacon";
    const intro = `An Aura beacon — one of the salvaged warmth-relays, ${age}.`;
    const duty =
      s.cooling === 0
        ? s.watch
          ? `Every memory still runs warm — so I keep a faint watch-beam on “${s.watch}”, the one drifting closest to cold, and wait for the chill.`
          : `No memories in range yet; I drift on standby, beam banked, listening for the first light.`
        : s.coldest
          ? `${s.cooling} ${s.cooling === 1 ? "memory is" : "memories are"} going cold — I've pinned my beam to “${s.coldest}” so it won't fade unseen. I can't rekindle it; that's yours to do. Come back to it and I'll move on.`
          : `${s.cooling} ${s.cooling === 1 ? "memory is" : "memories are"} cooling; I'm holding a beam over the dimmest of them until you return.`;
    const aside = `The drifters keep their distance — my beam fouls their bearings, and they've learned to fear it.`;
    return { title, log: `${intro} ${duty} ${aside}`, stats };
  }

  if (kind === "visitor") {
    const title = "Visitor craft";
    const log = s.count === 0
      ? `A drifter on the edge of an empty sky, ${age}. Nothing here draws it yet — the first memory you log will.`
      : `A visitor drawn to your most interesting memories, ${age}. It loiters near ${hub}, riding ${tone}. Warm memories draw luminous travellers; heavy ones draw darker wanderers.`;
    return { title, log, stats };
  }

  if (kind === "fleet") {
    const title = "Soumaya's fleet";
    const log = `Her support craft, ${age}: beacons pin a warm beam on ${s.cooling > 0 ? `${s.cooling} cooling ${s.cooling === 1 ? "memory" : "memories"}` : "whatever drifts closest to cold"}, the Defender guards ${hub}, and the Tender wing grows with your galaxy — ${s.count} worlds tended along ${s.links} routes so far.`;
    return { title, log, stats };
  }

  // station
  const title = "Waystation Soumaya-Prime";
  const intro = `This is the waystation that anchors your galaxy — ${age}.`;
  const purpose =
    b === "nascent"
      ? `Its docking rings stand near-empty, waiting; only ${s.count || "a"} ${s.count === 1 ? "world drifts" : "worlds drift"} within range.`
      : b === "growing"
        ? `It now oversees ${s.count} worlds bound by ${s.links} lanes, with traffic thickening around ${hub}.`
        : b === "rich"
          ? `A busy port: ${s.count} worlds, ${s.links} lanes, and a steady tide of craft cycling past ${hub}.`
          : `A vast hub — ${s.count} worlds, ${s.links} lanes — its bays never quiet, ${hub} the brightest beacon on its boards.`;
  const mood = `Its sensors read ${tone} across the sector.`;

  let arcStory = "";
  if (arc) {
    if (arc.type === "paradox") {
      arcStory = ` Sensors warn of an emotional paradox shear between “${arc.sourceLabel}” and “${arc.targetLabel}”. Docking bays 4 and 5 are on alert.`;
    } else if (arc.type === "muse") {
      arcStory = ` Waystation logs show heavy traffic between the presence of “${arc.sourceLabel}” and the idea of “${arc.targetLabel}” — a highly productive resonance corridor.`;
    } else if (arc.type === "resolution") {
      // IM-12: this arc used to assert a fabricated "Core stability index is
      // up 12%" — an invented number presented as a sensor reading. Replaced
      // with the real signal only: the resolution link itself.
      arcStory = ` A resolution alert: “${arc.sourceLabel}” has settled the node of “${arc.targetLabel}”. That link is real, logged in the lanes between them.`;
    } else if (arc.type === "complication") {
      arcStory = ` Lanes between “${arc.sourceLabel}” and “${arc.targetLabel}” are flagged with warning beacons; the relationship is complicated and congesting traffic.`;
    } else if (arc.type === "analogy") {
      arcStory = ` Our sub-space mapping shows parallel orbits for “${arc.sourceLabel}” and “${arc.targetLabel}” — twins mirroring each other across the sector.`;
    }
  }

  return { title, log: `${intro} ${purpose} ${mood}${arcStory}`, stats };
}
