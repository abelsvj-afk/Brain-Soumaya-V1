import { useEffect, useMemo, useState } from "react";
import type { GraphData, GraphNode, NodeType } from "@brain/shared";
import { CELESTIAL_ICON, CELESTIAL_LABEL, NODE_TYPE_LABEL, normalizeNodeType } from "@brain/shared";
import { colorForType } from "../graph/theme.js";
import { getArchivedNodes, archiveNode } from "../api/client.js";
import { parseTolerantMs } from "../utils/dueReminders.js";
import {
  BROWSE_EMOTION_DOT,
  BROWSE_EMOTION_LABEL,
  emotionBucketOf,
  fmtBrowseDateWithRelative,
} from "../utils/browseFormat.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";

/**
 * Library — a browsable, foldered view of the whole brain. The galaxy is beautiful
 * but not a filing cabinet; this is the "open the drawer and read what's inside" view.
 * Memories are grouped into folders by kind (People, Projects, Companies, Meetings,
 * Constellations/MOCs …), each folder expandable to read its notes, fly to them, and
 * export them as Markdown. Read-only, offline, dependency-free.
 */

// Plural folder names + a stable display order.
const FOLDER_ORDER: { key: NodeType | "moc"; label: string }[] = [
  { key: "moc", label: "Constellations (MOCs)" },
  { key: "person", label: "People" },
  { key: "company", label: "Companies" },
  { key: "project", label: "Projects" },
  { key: "decision", label: "Decisions" },
  { key: "meeting", label: "Meetings" },
  { key: "daily", label: "Daily notes" },
  { key: "knowledge", label: "Knowledge" },
  { key: "concept", label: "Concepts" },
  { key: "other", label: "Other" },
];

/**
 * The memory's date as the VIEWER's local calendar date (YYYY-MM-DD) — the same
 * date NodeInspector shows for the same memory (date/time accuracy rule 4:
 * panels must agree). The old `.slice(0, 10)` returned the UTC date, so an
 * evening memory (22:00 ET = 02:00 UTC next day) showed Oct 19 here and
 * Oct 20 in the Inspector. Parsed via the shared tolerant parser (naive
 * SQLite strings read as UTC, exactly as NodeInspector's fmtWhen reads them);
 * unparseable values keep the raw prefix rather than disappearing.
 */
const dateOf = (n: GraphNode): string => {
  const raw = n.occurredAt ?? n.createdAt ?? "";
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return raw.slice(0, 10);
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/** The visible clipping was only CSS (maxHeight/overflow) — a long note's FULL
 *  body still landed in the DOM for every row across every open folder. A plain
 *  character cap keeps what's shown identical (still clipped well before this
 *  length) while bounding actual DOM/memory size. */
const PREVIEW_CHARS = 400;
function previewOf(content: string): string {
  return content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}…` : content;
}

function memoryMarkdown(n: GraphNode): string {
  const typeLabel = NODE_TYPE_LABEL[normalizeNodeType(n.type)];
  const lines = [
    `## ${n.label}`,
    ``,
    `- **Type:** ${typeLabel}`,
    dateOf(n) ? `- **Date:** ${dateOf(n)}` : "",
    n.tags && n.tags.length ? `- **Tags:** ${n.tags.join(", ")}` : "",
    typeof n.importance === "number" ? `- **Importance:** ${Math.round(n.importance * 100)}%` : "",
    ``,
    n.content || "_(no body)_",
    ``,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/** Returns whether the download actually started — this can silently do nothing
 *  on mobile Safari / restricted contexts, where "⬇ Export all" used to produce
 *  no file, no toast, and no console error. */
function download(filename: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 1s used to be cut close for a large "Export all" on a slow disk/device —
    // there's no reliable "download actually finished" event, so give it a wide
    // margin rather than risk revoking mid-write. The blob's only cost until
    // then is memory, which is trivial for markdown-sized exports.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brain";

export function LibraryPanel({
  graph,
  onFocus,
  spaceName = "brain",
}: {
  graph: GraphData;
  onFocus: (id: number) => void;
  spaceName?: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // IM-38: Folders used to be scroll-and-expand only while its sibling All
  // view has a full discovery stack. Same stack here: text search over
  // label+content, a kind filter, and sort — applied within the folders.
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [sort, setSort] = useState<"recent" | "name" | "mass" | "links">("recent");
  // IM-40: previews used to be CSS-clipped and clicking one left the tab,
  // though the full content is already client-side. Clicking now expands
  // the note in place; the label pill remains the fly-to control.
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const toggleNote = (id: number) =>
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Archived (resting) memories — lazily fetched when the section is expanded.
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<GraphNode[] | null>(null);
  const [archivedError, setArchivedError] = useState(false);
  useEffect(() => {
    // A failed fetch used to fall back to `[]`, which is indistinguishable from
    // "really has zero archived memories" AND, since `archived` was no longer
    // null, meant the effect's own condition never retried — a failure was
    // permanent for the rest of the session. Track the failure separately so
    // the empty state can tell the two apart and offer a real retry.
    if (showArchived && archived === null && !archivedError) {
      void getArchivedNodes()
        .then(setArchived)
        .catch(() => setArchivedError(true));
    }
  }, [showArchived, archived, archivedError]);
  const retryArchived = () => setArchivedError(false);
  const restore = async (id: number) => {
    if (await archiveNode(id, false)) {
      setArchived((a) => (a ? a.filter((n) => n.id !== id) : a));
      window.dispatchEvent(new Event("brain-memory-added")); // nudge the galaxy to refresh
      // A failed restore already toasted; a successful one had no feedback at
      // all beyond the row quietly vanishing from the Archived list.
      playSfx("chime");
      pushToast("Memory restored to your galaxy.", "↩", 3000);
    } else {
      pushToast("Couldn't restore that memory — try again.", "⚠️", 3500);
    }
  };

  // Group non-action memories into folders, newest first within each.
  const folders = useMemo(() => {
    const byKey = new Map<string, GraphNode[]>();
    for (const n of graph.nodes as GraphNode[]) {
      if (n.kind === "action") continue;
      const key = n.kind === "moc" ? "moc" : normalizeNodeType(n.type);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(n);
    }
    for (const arr of byKey.values()) arr.sort((a, b) => (dateOf(a) < dateOf(b) ? 1 : -1));
    return FOLDER_ORDER.map((f) => ({ ...f, items: byKey.get(f.key) ?? [] })).filter((f) => f.items.length > 0);
  }, [graph.nodes]);

  const total = folders.reduce((s, f) => s + f.items.length, 0);

  // IM-38: the discovery-filtered view of the folders. Exports keep using the
  // unfiltered `folders` above — filtering the display must never silently
  // shrink an "Export all".
  const filtering = q.trim() !== "" || kindFilter !== "all";
  const visibleFolders = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return folders
      .filter((f) => kindFilter === "all" || f.key === kindFilter)
      .map((f) => {
        const items = f.items.filter(
          (n) =>
            !needle ||
            n.label.toLowerCase().includes(needle) ||
            n.content.toLowerCase().includes(needle),
        );
        const sorted = [...items].sort((a, b) => {
          switch (sort) {
            case "name":
              return a.label.localeCompare(b.label);
            case "mass":
              return (b.mass ?? 0) - (a.mass ?? 0);
            case "links":
              return (b.degree ?? 0) - (a.degree ?? 0);
            default:
              return (
                (parseTolerantMs(b.occurredAt ?? b.createdAt) || 0) -
                (parseTolerantMs(a.occurredAt ?? a.createdAt) || 0)
              );
          }
        });
        return { ...f, items: sorted };
      })
      .filter((f) => f.items.length > 0);
  }, [folders, q, kindFilter, sort]);
  const visibleTotal = visibleFolders.reduce((s, f) => s + f.items.length, 0);

  const exportFolder = (label: string, items: GraphNode[]) => {
    const body = `# ${label}\n\n_${items.length} ${items.length === 1 ? "memory" : "memories"} · exported from ${spaceName}_\n\n${items.map(memoryMarkdown).join("\n---\n\n")}`;
    if (download(`${slug(spaceName)}-${slug(label)}.md`, body)) {
      playSfx("chime");
    } else {
      pushToast("Couldn't export — your browser blocked the download.", "⚠️", 4000);
    }
  };

  const exportAll = () => {
    const body = `# ${spaceName} — full library\n\n_${total} memories across ${folders.length} folders_\n\n${folders
      .map((f) => `# ${f.label}\n\n${f.items.map(memoryMarkdown).join("\n---\n\n")}`)
      .join("\n\n")}`;
    if (download(`${slug(spaceName)}-library.md`, body)) {
      playSfx("chime");
    } else {
      pushToast("Couldn't export — your browser blocked the download.", "⚠️", 4000);
    }
  };

  if (total === 0) {
    return (
      <div className="dock-body">
        <p className="empty">Your library is empty. Dump a few thoughts and they'll file themselves into folders here.</p>
      </div>
    );
  }

  return (
    <div className="dock-body" style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <div className="dock-head">
        <h3>📚 Library</h3>
        <button className="mini" onClick={exportAll} title="Download every memory as Markdown">
          ⬇ Export all
        </button>
      </div>
      <p style={{ fontSize: "0.78rem", opacity: 0.75, margin: "0 0 0.9rem 0" }}>
        {total} memories filed into {folders.length} folders. Open a folder to read, fly to, or export its notes.
      </p>

      {/* IM-38: discovery stack, consistent with the All view. */}
      <input
        className="list-filter"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${total} memories…`}
        aria-label="Search folders"
      />
      <div className="discovery-filters">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          title="Memory kind"
          aria-label="Filter folders by kind"
        >
          <option value="all">any kind</option>
          {folders.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          title="Sort by"
          aria-label="Sort memories in folders"
        >
          <option value="recent">most recent</option>
          <option value="mass">heaviest</option>
          <option value="links">most connected</option>
          <option value="name">name A–Z</option>
        </select>
      </div>
      {filtering && (
        <p style={{ fontSize: "0.74rem", opacity: 0.7, margin: "0 0 0.6rem 0" }}>
          Showing {visibleTotal} of {total} memories.
        </p>
      )}
      {filtering && visibleTotal === 0 && (
        <div className="empty" style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", padding: "0.8rem" }}>
          <span>No matches — loosen the search or filters.</span>
          <button
            className="mini"
            onClick={() => {
              setQ("");
              setKindFilter("all");
            }}
          >
            Clear search &amp; filters
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {visibleFolders.map((f) => {
          // While searching/filtering, matching folders open themselves —
          // the matches are the point of the view.
          const isOpen = !!open[f.key] || filtering;
          return (
            <div key={f.key} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", overflow: "hidden" }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 0.7rem", cursor: "pointer", background: "rgba(255,255,255,0.03)" }}
                onClick={() => setOpen((o) => ({ ...o, [f.key]: !o[f.key] }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen((o) => ({ ...o, [f.key]: !o[f.key] }));
                  }
                }}
              >
                <span style={{ opacity: 0.7, width: "0.9rem" }}>{isOpen ? "▾" : "▸"}</span>
                {/* "moc" is a real NodeType with its own starlight-gold swatch —
                    this used to force it to "concept" instead, making the
                    Constellations folder look identical to a plain concept. */}
                <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: colorForType(f.key), flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: "0.86rem", flex: 1 }}>{f.label}</span>
                <span style={{ fontSize: "0.74rem", opacity: 0.6 }}>{f.items.length}</span>
                <button
                  className="mini"
                  style={{ padding: "0.15rem 0.4rem", fontSize: "0.72rem" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    exportFolder(f.label, f.items);
                  }}
                  title={`Export ${f.label} as Markdown`}
                >
                  ⬇
                </button>
              </div>
              {isOpen && (
                <ul style={{ listStyle: "none", margin: 0, padding: "0.3rem 0.5rem 0.5rem" }}>
                  {f.items.map((n) => {
                    const expanded = expandedNotes.has(n.id);
                    const emo = emotionBucketOf(n.emotionalWeight);
                    const humanDate = fmtBrowseDateWithRelative(n.occurredAt ?? n.createdAt);
                    return (
                    <li key={n.id} style={{ padding: "0.35rem 0.3rem", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <button
                          className="pill"
                          style={{ borderColor: colorForType(normalizeNodeType(n.type)), flex: 1, textAlign: "left" }}
                          onClick={() => onFocus(n.id)}
                          title="Fly to this memory in the galaxy"
                        >
                          {n.label}
                        </button>
                        {/* IM-43: human local date, same format as the All view —
                            the raw YYYY-MM-DD storage shape stays only in the
                            Markdown export, where ISO is the right format. */}
                        {humanDate && <span style={{ fontSize: "0.68rem", opacity: 0.5 }}>{humanDate}</span>}
                        <button
                          className="mini"
                          style={{ padding: "0.12rem 0.35rem", fontSize: "0.7rem" }}
                          onClick={() => download(`${slug(n.label)}.md`, memoryMarkdown(n))}
                          title="Download this memory note as Markdown"
                        >
                          ⬇
                        </button>
                      </div>
                      {/* IM-40: same row richness as All — tier, emotion, tags, links. */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", fontSize: "0.68rem", opacity: 0.75, marginTop: "0.2rem" }}>
                        <span title="growth stage">
                          {CELESTIAL_ICON[n.celestial ?? "moon"]} {CELESTIAL_LABEL[n.celestial ?? "moon"]}
                        </span>
                        <span title={`${emo} feeling`}>
                          · <span className="nl-emodot" style={{ background: BROWSE_EMOTION_DOT[emo] }} /> {BROWSE_EMOTION_LABEL[emo]}
                        </span>
                        {(n.degree ?? 0) > 0 && (
                          <span title="connections">· {n.degree} link{n.degree === 1 ? "" : "s"}</span>
                        )}
                        {n.tags && n.tags.length > 0 && <span>{n.tags.slice(0, 4).map((t) => `#${t}`).join(" ")}</span>}
                      </div>
                      {n.content && (
                        <p
                          role="button"
                          tabIndex={0}
                          aria-expanded={expanded}
                          style={{
                            fontSize: "0.74rem",
                            opacity: 0.75,
                            margin: "0.25rem 0 0 0",
                            whiteSpace: "pre-wrap",
                            cursor: "pointer",
                            ...(expanded ? {} : { maxHeight: "4.5rem", overflow: "hidden" }),
                          }}
                          onClick={() => toggleNote(n.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleNote(n.id);
                            }
                          }}
                          title={expanded ? "Click to collapse" : "Click to read the full note here"}
                        >
                          {expanded ? n.content : previewOf(n.content)}
                        </p>
                      )}
                      {n.content && (
                        <button
                          className="mini ghost"
                          style={{ fontSize: "0.66rem", padding: "1px 6px", marginTop: "0.15rem" }}
                          onClick={() => toggleNote(n.id)}
                          aria-expanded={expanded}
                        >
                          {expanded ? "▴ Collapse" : "▾ Read here"}
                        </button>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Archived (resting) memories — kept, out of the galaxy, restorable. */}
      <div style={{ marginTop: "0.9rem", border: "1px solid rgba(150,134,255,0.18)", borderRadius: "8px", overflow: "hidden" }}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={showArchived}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 0.7rem", cursor: "pointer", background: "rgba(150,134,255,0.06)" }}
          onClick={() => setShowArchived((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowArchived((v) => !v);
            }
          }}
        >
          <span style={{ opacity: 0.7, width: "0.9rem" }}>{showArchived ? "▾" : "▸"}</span>
          <span style={{ fontWeight: 600, fontSize: "0.86rem", flex: 1 }}>📥 Archived</span>
          {archived && <span style={{ fontSize: "0.74rem", opacity: 0.6 }}>{archived.length}</span>}
        </div>
        {showArchived && (
          <ul style={{ listStyle: "none", margin: 0, padding: "0.3rem 0.5rem 0.5rem" }}>
            {archivedError && (
              <li style={{ padding: "0.4rem", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.76rem" }}>
                <span style={{ flex: 1, opacity: 0.75 }}>⚠️ Couldn't load your archived memories.</span>
                <button className="mini" onClick={retryArchived}>Retry</button>
              </li>
            )}
            {archived === null && !archivedError && <li style={{ padding: "0.4rem", opacity: 0.6, fontSize: "0.76rem" }}>Loading…</li>}
            {archived && archived.length === 0 && (
              <li style={{ padding: "0.4rem", opacity: 0.6, fontSize: "0.76rem" }}>Nothing archived. Rest a memory from its details (📥) to tuck it away here.</li>
            )}
            {archived?.map((n) => (
              <li key={n.id} style={{ padding: "0.35rem 0.3rem", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ flex: 1, fontSize: "0.82rem" }}>{n.label}</span>
                <button className="mini" style={{ padding: "0.12rem 0.45rem", fontSize: "0.72rem" }} onClick={() => void restore(n.id)} title="Bring this memory back into the galaxy">
                  ↩ Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
