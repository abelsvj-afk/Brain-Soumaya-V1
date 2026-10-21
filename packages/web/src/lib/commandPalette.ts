import type { DockTab } from "../components/RightDock.js";

/**
 * IM-142 — command palette (⌘K) command catalogue. Pure data + filtering so
 * the palette component stays a thin shell over it (unit-tested in
 * commandPalette.test.ts). App.tsx executes the ids against its existing
 * navigation state (panel / tab / overlay setters) — the palette itself owns
 * no navigation logic. Tab names/icons mirror RightDock's TABS list.
 */
export type PaletteCommandId =
  | "capture"
  | "chat"
  | "search"
  | "observatory"
  | "timeline"
  | "review"
  | "connections"
  | "settings"
  | `tab:${DockTab}`;

export interface PaletteCommand {
  id: PaletteCommandId;
  icon: string;
  title: string;
  /** Right-aligned hint (e.g. the keyboard shortcut), "" when none. */
  hint: string;
  /** Extra match terms beyond the title (synonyms a user might type). */
  keywords: string;
}

const TAB_COMMANDS: { tab: DockTab; icon: string; name: string; keywords: string }[] = [
  { tab: "details", icon: "ⓘ", name: "Details", keywords: "open go tab dock panel selected memory info" },
  { tab: "list", icon: "📚", name: "Browse", keywords: "open go tab dock panel all memories list library" },
  { tab: "mind", icon: "🧠", name: "Mind", keywords: "open go tab dock panel goals ideas cognitive" },
  { tab: "actions", icon: "✅", name: "Agenda", keywords: "open go tab dock panel actions tasks todos" },
  { tab: "insights", icon: "✨", name: "Insights", keywords: "open go tab dock panel patterns" },
  { tab: "soumaya", icon: "🛰️", name: "Soumaya", keywords: "open go tab dock panel ops console ship" },
  { tab: "inbox", icon: "🔔", name: "Inbox", keywords: "open go tab dock panel notifications" },
  { tab: "awards", icon: "🏆", name: "Progress", keywords: "open go tab dock panel awards achievements codex rank streak" },
  { tab: "journeys", icon: "🧭", name: "Journeys", keywords: "open go tab dock panel trips quests" },
  { tab: "money", icon: "💵", name: "Money", keywords: "open go tab dock panel finance bills wealth budget" },
  { tab: "hangar", icon: "🛠️", name: "Hangar", keywords: "open go tab dock panel ships unlocks music" },
];

export const PALETTE_COMMANDS: PaletteCommand[] = [
  { id: "capture", icon: "📝", title: "Capture a thought", hint: "C", keywords: "new add memory dump ingest note quick write" },
  { id: "chat", icon: "💬", title: "Ask Soumaya", hint: "", keywords: "chat talk conversation maya question" },
  { id: "search", icon: "🔍", title: "Search your mind", hint: "", keywords: "find lookup memories full search box" },
  { id: "observatory", icon: "🔭", title: "Open the Observatory", hint: "", keywords: "home overview digest today" },
  ...TAB_COMMANDS.map(
    (t): PaletteCommand => ({
      id: `tab:${t.tab}`,
      icon: t.icon,
      title: `Go to ${t.name}`,
      hint: "",
      keywords: t.keywords,
    }),
  ),
  { id: "timeline", icon: "🕰️", title: "Open the Timeline", hint: "", keywords: "chronicle history life when" },
  { id: "review", icon: "🧠", title: "Review / Recall", hint: "", keywords: "recall due spaced repetition flashcards" },
  { id: "connections", icon: "🔗", title: "Open Connections", hint: "", keywords: "links suggestions candidates merge" },
  { id: "settings", icon: "⚙️", title: "Open Settings", hint: "", keywords: "preferences profile config account" },
];

/** Every whitespace-separated token of the query must appear in the title+keywords. */
export function filterPaletteCommands(query: string): PaletteCommand[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return PALETTE_COMMANDS;
  return PALETTE_COMMANDS.filter((c) => {
    const hay = `${c.title} ${c.keywords}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
