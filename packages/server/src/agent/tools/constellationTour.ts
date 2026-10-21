import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { mentions } from "../../analysis/cognitiveTokens.js";
import type { GraphNode } from "@brain/shared";
import {
  getTourSession,
  setTourSession,
  deleteTourSession,
  principalOf,
  listNeighbors,
  findEdgeBetween,
  type LiveNeighbor,
  type TourSession,
} from "../gameSessions.js";

/**
 * Telegram Parity Phase 5-B: constellation_tour — a guided multi-turn
 * walk through ONE connected cluster of the user's memories, driven by
 * the model across turns via the `action` argument (start / next / jump /
 * end / status). Session state (current node + visited path) lives
 * server-side in agent/gameSessions.ts (in-memory, keyed by (spaceId,
 * principal), idle-expired) — this tool is in the AGENT layer, so
 * Telegram and the web agent route tour identically through agentLoop().
 *
 * NO INVENTED CONNECTIONS (hard rule): every step is a REAL stored edge,
 * read with entity_lookup's own semantics (edges in both directions,
 * stored relationship values, live nodes only — see listNeighbors in
 * gameSessions.ts). `next` only ever proposes an unvisited neighbor that
 * a real edge reaches; `jump` verifies the named target is a real,
 * unvisited neighbor of the current node and refuses otherwise — the
 * walk can never teleport, revisit, or fabricate a link.
 *
 * "Most interesting" for `next` is deterministic and explainable: among
 * the current node's unvisited neighbors, prefer the best-connected one
 * (highest live degree — it opens the most of the cluster), then the
 * strongest edge weight, then the lowest id. The narration always names
 * the actual relationship and direction of the edge just traversed.
 */

type SqliteLike = Parameters<typeof listNeighbors>[0];

function degreeOf(tc: ToolContext, nodeId: number): number {
  return listNeighbors(tc.ctx.handle.sqlite as SqliteLike, tc.spaceId, nodeId).length;
}

/** Rank unvisited neighbors: most-connected first, strongest edge, lowest id. */
function rankNeighbors(tc: ToolContext, neighbors: LiveNeighbor[], visited: Set<number>): LiveNeighbor[] {
  return neighbors
    .filter((n) => !visited.has(n.otherId))
    .map((n) => ({ n, degree: degreeOf(tc, n.otherId) }))
    .sort((a, b) => b.degree - a.degree || b.n.weight - a.n.weight || a.n.otherId - b.n.otherId)
    .map((x) => x.n);
}

/** Resolve a node by id, or by literal label (entity_lookup's discipline:
 *  exact case-insensitive label first, then a whole-word `mentions` match;
 *  ambiguity is reported, never silently picked). */
function resolveNode(
  tc: ToolContext,
  args: Record<string, unknown>,
): { node?: GraphNode; error?: string } {
  const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
  const idArg = typeof args.id === "number" && Number.isInteger(args.id) ? args.id : null;
  const labelArg = String(args.label ?? "").trim();
  if (idArg !== null) {
    const node = repo.getById(idArg);
    return node ? { node } : { error: `no live node with id ${idArg} exists in this brain` };
  }
  if (!labelArg) return {};
  const candidates = repo
    .all()
    .filter((n) => n.label.toLowerCase() === labelArg.toLowerCase() || mentions(n.label, labelArg));
  if (candidates.length === 0) return { error: `no live node is labeled "${labelArg}"` };
  if (candidates.length > 1) {
    return {
      error:
        `"${labelArg}" matches ${candidates.length} different nodes — ask the user which one, or call again with an id: ` +
        candidates.map((c) => `#${c.id} "${c.label}"`).join(", "),
    };
  }
  return { node: candidates[0] };
}

function nodeBlock(tc: ToolContext, node: GraphNode): string {
  const neighbors = listNeighbors(tc.ctx.handle.sqlite as SqliteLike, tc.spaceId, node.id);
  const lines = [
    `📍 #${node.id} "${node.label}" [${node.type}${node.kind ? `/${node.kind}` : ""}]`,
    `   ${node.content.slice(0, 400)}`,
    `   Connections from here (${neighbors.length}): ` +
      (neighbors.length === 0
        ? "none — this memory is an island."
        : neighbors
            .map(
              (n) =>
                `${n.direction === "outgoing" ? "—" + n.relationship + "→" : "←" + n.relationship + "—"} #${n.otherId} "${n.otherLabel}"`,
            )
            .join("; ")),
  ];
  return lines.join("\n");
}

/** Narrate one traversed step: the thread that links it to the last node. */
function stepNarration(from: GraphNode, to: GraphNode, edge: LiveNeighbor): string {
  return edge.direction === "outgoing"
    ? `The thread: "${from.label}" —${edge.relationship}→ "${to.label}". We follow that stored "${edge.relationship}" link out of "${from.label}" to arrive at "${to.label}".`
    : `The thread: "${to.label}" —${edge.relationship}→ "${from.label}". We follow that stored "${edge.relationship}" link backwards — "${to.label}" points into "${from.label}" — to arrive at "${to.label}".`;
}

function pathRecap(tc: ToolContext, s: TourSession): string {
  const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
  const label = (id: number) => repo.getById(id)?.label ?? `#${id}`;
  const parts: string[] = [];
  s.visitedNodeIds.forEach((id, i) => {
    if (i === 0) {
      parts.push(`We began at "${label(id)}"`);
    } else {
      const step = s.steps[i - 1]!;
      parts.push(
        step.direction === "outgoing"
          ? `then followed its "${step.relationship}" link to "${label(id)}"`
          : `then followed the "${step.relationship}" link from "${label(id)}" back into the path`,
      );
    }
  });
  return (
    `🗺️ THE THREAD, as a story: ${parts.join(", ")} — ${s.visitedNodeIds.length} ` +
    `${s.visitedNodeIds.length === 1 ? "memory" : "memories"} visited, every step along a real stored connection, none repeated.`
  );
}

export const constellationTourTool: Tool = {
  name: "constellation_tour",
  description:
    "Take the user on a guided multi-turn walk through one connected cluster of their memories, stepping only along REAL stored connections. Drive it with the action argument across turns: action \"start\" begins at the node named by label/id args, or — with neither — at a well-connected memory she picks; present her narration verbatim and never invent a connection. Action \"next\" moves to the most interesting unvisited neighbor of the current memory and narrates the thread (the actual relationship) linking them. Action \"jump\" (with label or id) moves to a named neighbor — it only succeeds if a real edge connects it to the current memory and it hasn't been visited. Action \"status\" re-reads where the tour is; action \"end\" closes with the whole path retold as the story of the thread.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "next", "jump", "end", "status"],
        description: "Which step of the tour this call is.",
      },
      label: {
        type: "string",
        description: "For \"start\"/\"jump\": the memory's title/name, matched literally.",
      },
      id: {
        type: "integer",
        description: "For \"start\"/\"jump\": the memory's numeric id, when known (preferred).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const action = String(args.action ?? "");
    const principal = principalOf(tc);
    const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);

    // ----- start --------------------------------------------------------------
    if (action === "start") {
      let startNode: GraphNode | undefined;
      const hasTarget = typeof args.id === "number" || String(args.label ?? "").trim().length > 0;
      if (hasTarget) {
        const r = resolveNode(tc, args);
        if (r.error || !r.node) {
          return {
            ok: true,
            summary: "constellation_tour: start target unresolved",
            message: `CONSTELLATION TOUR: can't start there — ${r.error ?? "unresolved target"}. Say so honestly; offer to start at a well-connected memory instead (call start with no label/id).`,
          };
        }
        startNode = r.node;
      } else {
        // Her pick: the best-connected live node (ties → lowest id).
        const live = repo.all();
        if (live.length === 0) {
          return {
            ok: true,
            summary: "constellation_tour: empty brain",
            message: "CONSTELLATION TOUR: this brain has no memories yet, so there is nothing to tour. Say so honestly.",
          };
        }
        let best: GraphNode | undefined;
        let bestDegree = -1;
        for (const n of [...live].sort((a, b) => a.id - b.id)) {
          const d = degreeOf(tc, n.id);
          if (d > bestDegree) {
            best = n;
            bestDegree = d;
          }
        }
        startNode = best;
        if (!startNode || bestDegree === 0) {
          return {
            ok: true,
            summary: "constellation_tour: no connected cluster",
            message:
              "CONSTELLATION TOUR: no memory in this brain is connected to any other yet, so there is no cluster to walk. Say so honestly — a tour needs at least one real connection.",
          };
        }
      }
      const session: TourSession = {
        spaceId: tc.spaceId,
        principal,
        currentNodeId: startNode.id,
        visitedNodeIds: [startNode.id],
        steps: [],
        startedAt: tc.now,
        lastActiveAt: tc.now,
      };
      setTourSession(session);
      return {
        ok: true,
        summary: `constellation_tour: started at #${startNode.id}`,
        targets: [startNode.id],
        message:
          `CONSTELLATION TOUR — we walk one connected cluster, one real link at a time. Every step follows a stored connection; nothing is invented and we never revisit a stop.\n` +
          `We begin here:\n${nodeBlock(tc, startNode)}\n` +
          `Say "next" and I'll take the most interesting unvisited connection from here — or name a connected memory to jump to it.`,
      };
    }

    const session = getTourSession(tc.spaceId, principal, tc.now);
    if (!session) {
      return {
        ok: true,
        summary: "constellation_tour: no active session",
        message:
          `CONSTELLATION TOUR: no tour is running for this conversation (it may have ended or sat idle too long). ` +
          `Call constellation_tour with action "start" to begin one.`,
      };
    }
    const current = repo.getById(session.currentNodeId);
    if (!current) {
      deleteTourSession(tc.spaceId, principal);
      return {
        ok: true,
        summary: "constellation_tour: current node vanished",
        message:
          "CONSTELLATION TOUR: the memory we were standing on is gone (deleted), so the tour can't continue from here. It has been closed — start a new one whenever you're ready.",
      };
    }
    const visited = new Set(session.visitedNodeIds);

    // ----- next -----------------------------------------------------------------
    if (action === "next") {
      const neighbors = listNeighbors(tc.ctx.handle.sqlite as SqliteLike, tc.spaceId, current.id);
      const ranked = rankNeighbors(tc, neighbors, visited);
      if (ranked.length === 0) {
        const unvisitedElsewhere = repo.all().some((n) => !visited.has(n.id));
        return {
          ok: true,
          summary: "constellation_tour: next — no unvisited neighbor",
          message:
            `CONSTELLATION TOUR: from "${current.label}" every real connection leads somewhere we've already been` +
            (neighbors.length === 0 ? " — it has no connections at all" : "") +
            `. The walk can't move without inventing a link, so we stay here. ` +
            (unvisitedElsewhere
              ? `There are unvisited memories elsewhere, but none connected to this one — end the tour here, or start a new one at another memory.`
              : `You've now visited every memory in this cluster.`) +
            `\n${pathRecap(tc, session)}`,
        };
      }
      const edge = ranked[0]!;
      const next = repo.getById(edge.otherId)!;
      const why =
        `Why this one: of the ${ranked.length} unvisited connection${ranked.length === 1 ? "" : "s"} from here, "${next.label}" is the best-connected ` +
        `(it opens onto ${degreeOf(tc, next.id)} more) — the richest thread to pull next.`;
      session.steps.push({
        fromId: current.id,
        toId: next.id,
        relationship: edge.relationship,
        direction: edge.direction,
      });
      session.visitedNodeIds.push(next.id);
      session.currentNodeId = next.id;
      setTourSession(session);
      return {
        ok: true,
        summary: `constellation_tour: stepped #${current.id} -> #${next.id} via ${edge.relationship}`,
        targets: [next.id],
        message:
          `CONSTELLATION TOUR — step ${session.visitedNodeIds.length - 1}.\n` +
          `${stepNarration(current, next, edge)}\n${why}\n` +
          `Now we are here:\n${nodeBlock(tc, next)}\n` +
          `Visited so far: ${session.visitedNodeIds.map((id) => `#${id}`).join(" → ")}. Say "next" to keep walking, name a connected memory to jump, or "end" for the story of the thread.`,
      };
    }

    // ----- jump -------------------------------------------------------------------
    if (action === "jump") {
      const r = resolveNode(tc, args);
      if (r.error || !r.node) {
        return {
          ok: true,
          summary: "constellation_tour: jump target unresolved",
          message: `CONSTELLATION TOUR: can't jump — ${r.error ?? "no target given (pass a label or id)"}. We stay at "${current.label}".`,
        };
      }
      const target = r.node;
      if (visited.has(target.id)) {
        return {
          ok: true,
          summary: "constellation_tour: jump refused — already visited",
          message:
            `CONSTELLATION TOUR: we've already visited "${target.label}" on this tour, and the walk never repeats a stop. ` +
            `We stay at "${current.label}" — say "next" for an unvisited connection.`,
        };
      }
      const edge = findEdgeBetween(tc.ctx.handle.sqlite as SqliteLike, tc.spaceId, current.id, target.id);
      if (!edge) {
        return {
          ok: true,
          summary: "constellation_tour: jump refused — no real edge",
          message:
            `CONSTELLATION TOUR: there is NO stored connection between "${current.label}" and "${target.label}", so the tour can't jump there — ` +
            `every step must follow a real link. We stay at "${current.label}". Its real connections are listed in the current stop; pick one of those, or say "next".`,
        };
      }
      session.steps.push({ fromId: current.id, toId: target.id, relationship: edge.relationship, direction: edge.direction });
      session.visitedNodeIds.push(target.id);
      session.currentNodeId = target.id;
      setTourSession(session);
      return {
        ok: true,
        summary: `constellation_tour: jumped #${current.id} -> #${target.id} via ${edge.relationship}`,
        targets: [target.id],
        message:
          `CONSTELLATION TOUR — jump.\n${stepNarration(current, target, edge)}\n` +
          `Now we are here:\n${nodeBlock(tc, target)}\n` +
          `Visited so far: ${session.visitedNodeIds.map((id) => `#${id}`).join(" → ")}.`,
      };
    }

    // ----- status -------------------------------------------------------------------
    if (action === "status") {
      return {
        ok: true,
        summary: `constellation_tour: status at #${current.id}, ${session.visitedNodeIds.length} visited`,
        targets: [current.id],
        message:
          `CONSTELLATION TOUR STATUS: standing at #${current.id} "${current.label}" after visiting ` +
          `${session.visitedNodeIds.length} ${session.visitedNodeIds.length === 1 ? "memory" : "memories"}.\n` +
          `${nodeBlock(tc, current)}\n${pathRecap(tc, session)}`,
      };
    }

    // ----- end -----------------------------------------------------------------------
    if (action === "end") {
      const recap = pathRecap(tc, session);
      const stops = session.visitedNodeIds
        .map((id, i) => {
          const label = repo.getById(id)?.label ?? `#${id}`;
          if (i === 0) return `  1. #${id} "${label}" — where we began`;
          const step = session.steps[i - 1]!;
          return `  ${i + 1}. #${id} "${label}" — reached via "${step.relationship}" from #${step.fromId}`;
        })
        .join("\n");
      deleteTourSession(tc.spaceId, principal);
      return {
        ok: true,
        summary: `constellation_tour: ended, ${session.visitedNodeIds.length} stops`,
        message: `CONSTELLATION TOUR — the end of the walk.\n${recap}\nThe stops, in order:\n${stops}`,
      };
    }

    return { ok: false, summary: `constellation_tour: unknown action "${action}"` };
  },
};
