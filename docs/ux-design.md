# UX Design — Soumaya · Second Brain

> **Workflow Phase 4.5 deliverable** ([`AI_ENGINEERING_WORKFLOW.md`](./AI_ENGINEERING_WORKFLOW.md)).
> Documented **retroactively** against the shipped UI (`packages/web/src`), so it
> reads as the spec the app was built to. Every screen, color, and state below is
> drawn from the code; component files are cited inline.

## Design language

- **Mood:** cinematic deep-space "second brain." Background `BG = #05010d`
  (near-black navy), nebulae + starfield, bloom on bright bodies. Glassy translucent
  panels float over the galaxy.
- **Accent: cyan `#7af9ff`** — the dominant UI accent (buttons, highlights, the
  Waystation, halos).
- **Type hues** (`graph/theme.ts` `TYPE_COLORS`) — the semantic color per node kind,
  used for chips, dots, citation pills, and as each body's tint seed:
  | Kind | Color | | Kind | Color |
  |---|---|---|---|---|
  | person | `#b388ff` violet | | knowledge | `#9dff8a` lime |
  | project | `#ffd166` gold | | concept | `#f4a6ff` magenta |
  | decision | `#ff7b54` coral | | other | `#c7c7e0` grey |
  | company | `#4fa3ff` blue | | moc (constellation) | `#ffe9a8` starlight gold |
  | meeting | `#5fe0b0` mint | | daily | `#7af9ff` cyan |
- **Celestial tiers** (`CELESTIAL_COLORS`) — a body's palette is chosen by its class:
  asteroid (dull greys) → moon (pale cold blues) → planet (vivid mixed hues) →
  gas_giant (warm earths) → giant (warm oranges/golds) → star (hot whites/yellows) →
  supergiant (cool whites/pinks). Hue picked deterministically from node id so the
  galaxy is varied but stable across renders.
- **Entropy / cooling:** a tended memory reads warm (white/copper); a neglected one
  shifts cold (blue tint) as entropy ticks up, and warms back on tending — the
  visual nudge of the maintenance loop.
- **Notification semantics:** warning (amber, low fuel / overdue), info (cyan,
  pending), error (red, LLM offline).

## Navigation map

```
LoginScreen ──(auth)──► App shell (3D galaxy + HUD)
                          │
   ┌──────────────────────┼───────────────────────────────────────┐
   │ FABs (mutually-exclusive overlays unless noted)                │
   │  🔍 SearchBox   📝 IngestPanel   ☰ RightDock(tabbed)           │
   │  💬 ChatDock(floating)   🔭 Observatory   ⚙️ SettingsPanel     │
   │  ? HelpPanel    🎯 Focus menu   ☄️ Flashback   ⊙/＋/－ camera  │
   │  🔊 Music   🛸/🌐/🛰️/👽 fleet-follow                            │
   └────────────────────────────────────────────────────────────────┘
RightDock tabs: Details · Sectors · List · Agenda · Insights ·
                [BrainName] · Fleet · Companion · Inbox · Awards · Hangar
⏏ (header) ──► switch brain (back to LoginScreen)
```

The galaxy canvas is the home surface; everything else is an overlay reachable from
a visible FAB or the header. No screen is URL-only.

## Screens

### 1. Login — private brains (`components/LoginScreen.tsx`)

Two-tab card: **Enter My Galaxy** (login, default) / **Create New Galaxy** (signup).
Fields: **Username** (2–40, lowercased, no autocorrect, `autocomplete="username"`; placeholder "e.g. pilot77"),
**Passcode** (≥4; "at least 4 characters"), and on signup **Brain / Companion name**
("e.g. Luna"). Submit is disabled until valid; button reads "Enter my galaxy" /
"Create my galaxy" → "Opening…" while busy. **Error state:** red text below the form
(e.g. the reserved-name guard "The Brain / Companion name 'Soumaya' is reserved — pick another."). Footer
note: the passcode is hashed, never stored in clear — "it's the only way back into
this brain." (This is the `x-space-id` auth from architecture: the brain id lives in
`localStorage`.)

### 2. App shell + HUD (`App.tsx`)

**Loading states (sequential):** auth check → loader orb + "Aligning the stars…";
then galaxy load → "Mapping your galaxy…"; AI work shows inline "🛸 [name] is
thinking…".

**Header (top):** brain name · switch-brain (⏏) · memory count · LLM status (model /
"offline mode" / "heuristic mode", from `/api/health`) · **Fuel gauge** (⛽ N/cap,
amber fill, "+X" popups on earn) · **Streak** (🔥 N-day) · Install-PWA (📲) when
available. Fuel + streak poll every 30s.

**FABs (float bottom/side, hidden while a panel is open):** Search 🔍, Flashback ☄️
(serendipity jump to an old memory), Help ?, Dock ☰, Recenter ⊙, Zoom ＋/－, **Focus
menu** 🎯 (stacking popup: Ship 🛸, Station 🌐, Beacons 🛰️ "N deployed", Visitors 👽
"N drifting in", Figurines slot 1/2; pulses cyan on new beacon), Music 🔊/🔈, Ingest
📝, Observatory 🔭, **Chat 💬** (pulses when Soumaya hails), Settings ⚙️.

### 3. Observatory — calm home overlay (`components/Observatory.tsx`)

Fades in once ~3.2s after the cinematic fly-in (never interrupts the intro);
reopen via 🔭; skipped in demo mode.
- **Empty (0 memories):** hero card — "Welcome, [name]. Your galaxy is empty. Add
  your first memory and watch it become a star." → "✍️ Add your first memory" /
  "Enter the galaxy →".
- **Established:** "Welcome back, [name]." + "N memories · 🔥 X-day streak", then
  cards: **Add a memory**; **Today's tending** (🎯 daily quests, each flips to ✓
  when done); **Soumaya surfaced a connection** (✨ latest insight snippet → flies to
  cited node); **Your constellations** (✦ clickable chips); **Jump back in** (🛰️
  recent-memory chips); "Enter the galaxy →".
  This is the Stage-2 "observatory" north-star entry, built as progressive
  disclosure (a few calm starting points, detail pushed into the dock).

### 4. Ingest — "Add a memory" (`components/IngestPanel.tsx`)

Heading "Add a memory". Required textarea ("A business idea, a reflection, a
random thought…"); collapsible **＋ Add more context**; **tag row** (curated
`SUGGESTED_TAGS` toggle chips + free "＋ tag" input); collapsible **＋ When / remind
me** (datetime-local "When did this happen?" + "Remind me"); **📌 Action item**
checkbox → expiry select (today 24h / 3 days / 1 week). Submit "Add to brain" (or
"Add action item"); optional **🎤 Speak** voice input (Web Speech API, "● Listening…").
On success: "+N node(s), M connection(s)" + fuel earned, form clears, galaxy refreshes.

### 5. Galaxy canvas (`graph/Graph3D.tsx`)

react-force-graph-3d + three.js. Bodies render by celestial class with bloom; the
**Sun** ("Self") sits fixed at the origin and grows with the brain; the **Waystation**
orbits; two deep-space **figurine** slots sit far back. Interaction: drag to orbit,
＋/－ fly the camera in/out (true 3D, clamped so you can't leave the galaxy), click a
node to select (lights it + its links, dims the rest). **Focus modes** (imperative
handle): `focusNode`, `isolateSystem`/`exitCluster` (show only a body + its orbiting
descendants), follow ship/station/satellite/visitor/figurine, `recenter`. Effects:
green ripples on user actions, colored bursts (user/fuel/serendipity), entropy
hue-shift, the comet sweep. When the dock is open the focused body lifts up so it
clears the panel.

### 6. RightDock — tabbed inspector (`components/RightDock.tsx`)

Tab row with a `←` history back, active highlight, `×` close. The **Inbox** tab
carries a red unseen-count badge. Demo mode disables destructive actions everywhere.

| Tab | Icon | Component | Purpose |
|---|---|---|---|
| Details | ⓘ | `NodeInspector` | Selected memory: text, celestial class/icon, importance slider, connections, **Chronicle** (lore history), ✦ Evolve (synthesis), isolate, delete. |
| Sectors | 🌌 | `SectorView` | Hub-centric clustered view (mass ≥ ~0.44): each hub card shows shared tags/people/time-span/tone + isolate. |
| List | 📋 | `NodeList` | Flat index; filter/sort by mass / recent / links / name and by emotion; timeline grouping. |
| Agenda | ✅ | `ActionsPanel` | Action items (kind="action") + reminders, with "in 5h" / "overdue" countdown badges and a ✓ done. |
| Insights | ✨ | `DigestPanel` | AI-surfaced latent connections, the daily digest (Soumaya's take + links), constellations, "save as constellation", manual run-digest. |
| [BrainName] | 🛰️ | `SoumayaPanel` | The companion's telemetry: task-label toggle, cockpit/orbit camera, drag-reorder her task queue, agent logs, Captain's Log, fuel + research-spend meters. |
| Fleet | 🚀 | `FleetPanel` | Roster (Soumaya, Station, Beacons, Scout, Defender) with role + live status + lore; visitor activity (which memories craft visit). |
| Companion | 🧠 | `CompanionPanel` | Customize her: **About Me** (auto-derived), **Custom Instructions** (stackable roles), **Knowledge** (upload txt/md/pdf/docx reference docs). |
| Inbox | 🔔 | `InboxPanel` | Persisted notification history; filter all/unseen/seen; mark seen; auto-cleanup. |
| Awards | 🏆 | `AchievementsPanel` | Rank banner (Lv N + progress), streak banner, awards grid (earned vs locked w/ progress), memory milestones. |
| Hangar | 🛠️ | `HangarPanel` | Cosmetics: ship skins, engine-trail colors, two figurine slots + visibility toggles (unlocked by achievements/milestones). |

(The gamification tabs — Awards, Hangar, Fleet, and the streak/fuel HUD — are
specified in detail in [`specs/gamification-layer.md`](./specs/gamification-layer.md).)

### 7. ChatDock — chat with your brain (`components/ChatDock.tsx`)

Floating panel (not inside the dock). Header "💬 [name]" + voice toggle 🔊/🔈,
**Distill** ✨ (appears after ≥2 turns), Clear 🗑️, close ×. **Empty state:** "Talk to
[name] about your galaxy — she answers from your memories and cites them. Tap ＋ on
anything worth keeping to save it." Messages: your turns vs Soumaya turns; her
answers carry **citation pills** (colored by type, click to fly to the memory) and a
**＋ save** button that ingests the answer as a new memory ("Soumaya is charting it
into your galaxy ✦"). Input: 🎤 mic + growing textarea + ➤ send; typing shows "…".
**Distillation** on close proposes saveable memories (＋ keep / ✕ skip). History
persists per-brain in `localStorage`. Optional spoken replies use the response `tone`.

### 8. Settings (`components/SettingsPanel.tsx`)

"⚙️ Settings" modal. **Account:** Display name + Username (unique) → "Save profile"
("Saved ✓"). **Preferences (toggles):** **Research Mode** ("Lets Soumaya spend fuel
on deep-dive research & charting" — the gate from the architecture/gamification
specs), **Voice replies**, **Show Soumaya's task label**.

### 9. Lore card (`components/ObjectLoreCard.tsx`)

Small glass card shown when focusing the ship / a beacon / the station: icon + title
+ ✕, body "✦ " + 1–3 sentence lore generated deterministically from graph state
(`graph/objectLore.ts`), mutating as the brain grows. Hidden whenever a panel is
open or it's dismissed.

### 10. Help (`components/HelpPanel.tsx`)

Interactive guide opened from the ? FAB.

## Notifications

- **Toasts** (`components/Toasts.tsx`): top-center, auto-dismiss (~8s default), max 4,
  pause-on-hover, manual ×, priority low/normal/high (logged to Inbox). Used for
  welcome lines, milestones, rank-ups, tier promotions ("✦ [memory] grew into a
  [class]"), fuel earns, offline-sync, and Soumaya's in-character connection lines.
  Buffered behind the Observatory so the intro isn't cluttered.
- **NotificationsBar** (`components/NotificationsBar.tsx`): persistent alert strip
  under the header (non-demo only) with a single action each — **Low fuel** →
  "Earn Fuel →" (Agenda), **Cloud LLM offline** → "Diagnostics →" (Soumaya tab),
  **Pending deep-dive questions** → "Resolve →", **Overdue actions** → "Agenda →".
  Hidden when there are no alerts.

## Empty / loading / error states (summary)

| Screen | Empty | Loading | Error |
|---|---|---|---|
| App boot | — | "Aligning the stars…" → "Mapping your galaxy…" | LLM status badge shows "offline/heuristic mode" |
| Login | clean form | submit disabled / "Opening…" | red inline message (reserved name, wrong passcode) |
| Observatory | hero "your galaxy is empty" + CTA | — | — |
| Ingest | empty textareas | submit disabled (busy) | feedback message span |
| Chat | intro/empty-state copy | "…" typing | falls back to heuristic answer silently |
| NodeList / Sectors / Insights / Agenda | per-tab "no … yet" messages | inline | — |
| NotificationsBar | hidden | — | LLM-offline alert chip |

## Responsiveness & accessibility

- **Mobile-first FABs + voice.** Capture and chat both expose a 🎤 mic (Web Speech
  API, mobile-Chrome compatible). The app is an installable **PWA** (📲 Add to Home
  Screen) and works offline (cached shell; live data still needs the network).
- **Desktop:** the same overlays with more room; the RightDock sits to the side and
  the canvas shifts focus up to clear it.
- Toasts cap at 4 and pause on hover; the canvas zoom is clamped so a user can never
  get lost outside the galaxy (a built-in "you can't break it" affordance).

> Note vs the workflow's Phase-4.5 accessibility bar: explicit contrast ratios,
> keyboard-navigation, and visible-focus specs are **not** yet codified here — they
> are a known follow-up for this retroactive doc, since the UI is canvas-/FAB-driven
> rather than form-heavy.
</content>
