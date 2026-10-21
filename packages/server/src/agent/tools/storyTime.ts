import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { LoreRepo, getOrCreateLore } from "../../lore/engine.js";

/**
 * Telegram Parity Phase 5-C: story time — narrate one of his memories back
 * as a chronicle-style chapter.
 *
 * Chronicle path reused (found, not reinvented):
 * - Chapters live in the `lore` table, versioned per subject, written/read
 *   through `lore/engine.ts` (`LoreRepo`, `getOrCreateLore`, `evolveLore`) —
 *   the same engine behind `GET/POST /api/lore/:subjectType/:subjectId`
 *   (`api/routes/lore.ts`). Its genesis chapter is the offline heuristic
 *   chronicler in that engine; the richer prose layer is the LLM provider's
 *   `chronicle()` method (`llm/adapter.ts`), whose implementations build
 *   their prompt from `CHRONICLE_SYSTEM` + `buildChroniclePrompt`
 *   (`llm/prompts.ts`). The lore route's evolve handler upgrades a freshly
 *   written heuristic chapter through exactly that `chronicle()` call and
 *   persists it with `LoreRepo.updateText` — this tool mirrors that step.
 * - If a memory ALREADY has a stored chapter, it is served VERBATIM: no new
 *   chapter is written and the LLM is never called. Generation only happens
 *   for a memory with no chapter yet.
 *
 * Selection (stated in the result, deterministic):
 * - `memoryId` when given, else a literal label match for `query`
 *   (exact case-insensitive label first, then label-contains), else the
 *   default pick: among live memories (kind unset or 'memory'), prefer ones
 *   with no stored chapter yet, then highest importance (unset importance
 *   counts as 0.4, the codebase's default weight), tie-break smallest id.
 *
 * Output is TEXT only, returned in `message` on the normal reply path. There
 * is deliberately NO voice/TTS here: the Q3 Telegram TTS feature lives on
 * another branch (env-gated `TELEGRAM_TTS_*`) and is not in this tree. The
 * seam is that this text flows through the agent loop's normal reply, which
 * is exactly what a future voice layer would speak — narration never blocks
 * on voice being enabled or configured.
 *
 * Read-only in the pin's terms EXCEPT that a first-ever telling persists
 * its generated chapter in the lore store (the app's own read path,
 * `getOrCreateLore`, does the same on first view). It never edits the
 * memory itself. No approval required.
 */

export const storyTimeTool: Tool = {
  name: "story_time",
  description:
    "Narrate one of the user's memories back to them as a chronicle-style chapter (story time). Give memoryId when you know which memory, or query with its label/title; with neither, a deterministic pick is made (highest-importance memory that has no chapter yet) and stated in the reply. If the memory already has a stored chronicle chapter, that chapter is told verbatim; otherwise a new chapter is generated through the same chronicle path the app uses and stored. The result is text for the normal reply — read it back as your answer.",
  parameters: {
    type: "object",
    properties: {
      memoryId: {
        type: "integer",
        description: "The memory node's numeric id, when known (preferred — unambiguous).",
      },
      query: {
        type: "string",
        description:
          "The memory's label/title (matched literally, case-insensitive) when no id is known. Omit both to let the deterministic pick choose.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
    const lore = new LoreRepo(tc.ctx.handle, tc.spaceId);
    const idArg = typeof args.memoryId === "number" && Number.isInteger(args.memoryId) ? args.memoryId : null;
    const query = String(args.query ?? "").trim();

    // ----- Resolve the memory. -----
    let node = idArg !== null ? repo.getById(idArg) : undefined;
    let selection: string;
    if (idArg !== null) {
      if (!node) {
        return {
          ok: true,
          summary: `story_time: memory #${idArg} not found`,
          message: `STORY TIME: no memory with id ${idArg} exists in this brain. Say so honestly — do not invent a story for it.`,
        };
      }
      selection = `the memory you named (#${node.id})`;
    } else if (query) {
      const live = repo.all();
      const exact = live.filter((n) => n.label.toLowerCase() === query.toLowerCase());
      const contains = live.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()));
      const candidates = exact.length > 0 ? exact : contains;
      if (candidates.length === 0) {
        return {
          ok: true,
          summary: "story_time: label not found",
          message: `STORY TIME: no live memory is labeled like "${query}". Say so honestly — do not guess a different memory's story.`,
        };
      }
      if (candidates.length > 1) {
        return {
          ok: true,
          summary: `story_time: label ambiguous (${candidates.length} candidates)`,
          targets: candidates.map((c) => c.id),
          message:
            `STORY TIME: "${query}" matches ${candidates.length} memories — ask which one they mean, or call again with a memoryId:\n` +
            candidates.map((c) => `- #${c.id} "${c.label}"`).join("\n"),
        };
      }
      node = candidates[0];
      selection = `the memory you named (#${node!.id})`;
    } else {
      // Deterministic default pick (see header): live memories only,
      // unstoried first, then highest importance, then smallest id.
      const memories = repo
        .all()
        .filter((n) => n.kind == null || n.kind === "memory")
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      if (memories.length === 0) {
        return {
          ok: true,
          summary: "story_time: no memories",
          message: "STORY TIME: there are no memories in this brain yet to tell a story from. Say so honestly.",
        };
      }
      const unstoried = memories.filter((n) => !lore.current("memory", String(n.id)));
      const pool = unstoried.length > 0 ? unstoried : memories;
      pool.sort(
        (a, b) => (b.importance ?? 0.4) - (a.importance ?? 0.4) || a.id - b.id,
      );
      node = pool[0];
      selection =
        `my pick: the highest-importance ${unstoried.length > 0 ? "memory with no chapter yet" : "memory"} (#${node!.id})`;
    }
    if (!node) return { ok: false, summary: "story_time: unresolved" };

    const subjectId = String(node.id);

    // ----- Stored chapter? Serve it verbatim (preferred path). -----
    const stored = lore.current("memory", subjectId);
    if (stored) {
      const lines = [
        `STORY TIME — "${node.label}" (#${node.id}, ${selection}; stored chapter ${stored.version}, told verbatim):`,
        "",
        stored.text,
      ];
      return {
        ok: true,
        summary: `story_time: told stored chapter ${stored.version} of "${node.label}"`,
        targets: [node.id],
        message: lines.join("\n"),
      };
    }

    // ----- No chapter yet: generate through the app's chronicle path. -----
    // getOrCreateLore writes the genesis chapter via the lore engine's
    // chronicler (the same first-view path the app uses).
    const history = getOrCreateLore(tc.ctx.handle, tc.spaceId, "memory", subjectId);
    const created = history[history.length - 1];
    if (!created) {
      return { ok: false, summary: `story_time: could not create a chapter for #${node.id}` };
    }
    let text = created.text;
    let upgraded = false;
    // Best-effort richer prose, mirroring POST /api/lore/.../evolve: when a
    // cloud LLM is available, its chronicle() (CHRONICLE_SYSTEM /
    // buildChroniclePrompt inside the provider) rewrites the chapter and
    // the rewrite is persisted over the heuristic text. Offline-safe: any
    // failure keeps the heuristic chapter.
    if (tc.ctx.llm.chronicle) {
      try {
        const richer = await tc.ctx.llm.chronicle(
          `memory "${subjectId}"`,
          `Current heuristic chapter: ${created.text}\nPrior chapter: (this is the first chapter)`,
        );
        if (richer && richer.trim()) {
          lore.updateText(created.id, richer.trim());
          text = richer.trim();
          upgraded = true;
        }
      } catch {
        /* keep the heuristic chapter — offline-safe, same as the lore route */
      }
    }

    const lines = [
      `STORY TIME — "${node.label}" (#${node.id}, ${selection}; new chapter ${created.version}${upgraded ? ", written by the chronicle voice" : ""}):`,
      "",
      text,
    ];
    return {
      ok: true,
      summary: `story_time: generated chapter ${created.version} of "${node.label}"`,
      targets: [node.id],
      message: lines.join("\n"),
    };
  },
};
