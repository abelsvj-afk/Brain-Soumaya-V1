import { useEffect, useRef, useState } from "react";
import { SATELLITE_LORE, SATELLITE_NAME } from "../graph/satellites.js";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { getSpaceId } from "../api/client.js";
import { playSfx } from "../graph/sfx.js";
import { pushToast } from "./Toasts.js";

interface Props {
  onClose: () => void;
  installPrompt?: any;
  onInstall?: () => void;
}

interface HelpItem {
  icon?: string;
  title: string;
  body: string;
  tags?: string[];
  /** IM-131 (remainder): a card about a feature takes you to THAT feature.
   *  `action` rides the brain-toast-action bridge (tab/panel/chat kinds App
   *  already routes); `event` names a dedicated open-event for surfaces that
   *  bridge can't reach (Connections, Lenses, Settings — App listens for
   *  brain-open-connections / brain-open-lenses / brain-open-settings). */
  tryIt?: { label: string; action?: { kind: string; value?: string }; event?: string };
}

function fireTryIt(t: NonNullable<HelpItem["tryIt"]>): void {
  try {
    if (t.event) window.dispatchEvent(new Event(t.event));
    else if (t.action) window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: t.action }));
  } catch { /* no window */ }
}

const CATEGORIES: {
  id: string;
  title: string;
  icon: string;
  desc: string;
  items: HelpItem[];
}[] = [
  {
    id: "start",
    title: "Getting Started",
    icon: "🌱",
    desc: "Your private brain, dumping raw thoughts, bringing in documents, and how a thought becomes a star.",
    items: [
      { icon: "🔐", title: "Your private brain", body: "Each brain is a private space protected by a name + passcode (no email needed). Sign in and your galaxy is yours alone — memories, links and progress are scoped to your space and never mix with anyone else's. The passcode is the only key, so keep it safe.", tags: ["login", "private", "space", "passcode", "account", "brain"] },
      { icon: "➕", title: "Dump a thought", body: "Tap the ＋ button to open 'Dump a thought' and write anything — a business idea, a reflection, a worry, a random spark. You don't organize it; the system reads it, extracts what matters, embeds it, and places it in your galaxy automatically. Brain-dump freely; structure emerges on its own.", tags: ["log", "memory", "capture", "ingest", "dump", "note", "add"], tryIt: { label: "➕ Dump a thought", action: { kind: "panel", value: "ingest" } } },
      { icon: "🏷️", title: "Add context & tags", body: "The optional second field is for the why — backstory, related people, how it makes you feel. Add tags to nudge how it links and clusters. More context means richer auto-connections and a more accurate importance rating, but a one-line thought works perfectly too.", tags: ["context", "tags", "importance", "detail", "emotion"] },
      { icon: "📄", title: "Bring in documents", body: "You can feed in existing material as well as fresh thoughts — paste long text, or import a document (PDF / Word / text). It's distilled into memories and woven into the same galaxy, so your notes and your knowledge live together.", tags: ["document", "pdf", "docx", "import", "file", "upload", "knowledge"], tryIt: { label: "➕ Open Dump a thought", action: { kind: "panel", value: "ingest" } } },
      { icon: "📎", title: "Attach files to a memory", body: "Open any memory's Details (ⓘ) and use the '📎 Attachments' section's '+ Add' button to keep a document right on that memory — a PDF, an image, a contract, a source note. It's stored with the memory and downloadable anytime with one tap, so the original lives alongside the thought instead of getting lost in a downloads folder. (Small files; big archives are best imported as text.)", tags: ["attachment", "attach", "file", "document", "download", "pdf", "image", "memory"], tryIt: { label: "ⓘ Open Details", action: { kind: "tab", value: "details" } } },
      { icon: "✨", title: "From thought to star", body: "Every memory you log becomes a celestial body. The AI rates its importance, links it to related thoughts by meaning, and gives it mass — so it appears as anything from a tiny asteroid to a blazing supergiant. Watch new memories get ferried into place by your companion as you add them.", tags: ["star", "mass", "celestial", "ingest", "pipeline"] }
    ]
  },
  {
    id: "navigation",
    title: "Controls & Flight",
    icon: "🛸",
    desc: "How to steer your camera, orbit clusters, isolate systems, lock targets, and fly through space.",
    items: [
      { icon: "🖐️", title: "Move and Orbit", body: "Click and drag (or drag with touch) anywhere on the background space to orbit the camera around the active focal point, allowing you to view your thought constellations from any angle.", tags: ["camera", "drag", "orbit", "steer", "navigation"] },
      { icon: "＋/－", title: "Flight Zoom", body: "Click the ＋ or − zoom buttons on the HUD to FLY your camera forward and backward in 3D space, rather than just scaling. This allows you to fly directly into high-density sectors.", tags: ["zoom", "fly", "hud", "buttons"] },
      { icon: "⊙", title: "Recenter focal lock", body: "Click the recenter icon to release any active focus targets, re-frame the entire galaxy at the center of your screen, and restore default camera distances.", tags: ["recenter", "focus", "focal", "reset"] },
      { icon: "🎯", title: "Focus & isolate a memory", body: "Click any memory to focus it and read its details. From the details panel you can 'isolate' its system — hiding the rest of the galaxy so you see just that memory and everything orbiting it, the cleanest way to study one cluster.", tags: ["focus", "isolate", "system", "cluster", "select"] },
      { icon: "🛸", title: "Focus Companion's ship", body: "Click the focus ship button (or select the companion ship in space) to lock the camera directly onto her flight path. The camera will follow her automatically, allowing you to inspect her tending tasks.", tags: ["ship", "camera", "follow", "focal"] },
      { icon: "🎥", title: "Cockpit vs Orbit camera", body: "In the Soumaya tab (🛰️) you can switch her follow camera between Orbit Follow (a cinematic chase view) and Cockpit Lock (ride along from the ship itself). Cockpit makes her maintenance runs feel like flying the galaxy first-person.", tags: ["cockpit", "camera", "view", "first-person", "orbit"] },
      { icon: "🌐", title: "Focus the Waystation", body: "Snap your camera focal lock onto Waystation Soumaya-Prime, the central megastructure orbiting the galaxy.", tags: ["station", "structure", "orbit", "focal"] },
      { icon: "🪐", title: "Visit your Megastructures", body: "Background figurines you've unlocked (and the black-hole Singularity) sit far out in deep space. Enable their HUD focus button in the Hangar, then tap it to fly all the way out and see your monuments up close — including ones you're still working toward.", tags: ["figurine", "megastructure", "focus", "blackhole", "singularity", "monument"] },
      { icon: "🛰️", title: "Jump to Aura beacons", body: "Click the beacon hotkeys or click a beacon physically in space. Beacons take orbit over memories going cold, giving you quick jumping points to stars that need tending.", tags: ["beacon", "jump", "cooling", "tending"] },
      { icon: "☄️", title: "Flashback Comet", body: "Tap the comet icon in the HUD to trigger a random serendipitous jump, launching the camera on a fast flight to a high-importance memory from the past.", tags: ["comet", "flashback", "random", "serendipity"] },
      { icon: "🔈", title: "Ambient soundscapes & playlist", body: "Click the 🔈 music button to play/pause the ambient soundtrack; double-click it (or click the now-playing chip beside it) to skip to the next track. There are several loops — Deep Space, Slow Tide, Interstellar — and the chip shows the title and how many there are (e.g. 2/3). The track title pops up briefly whenever it changes, and your last track is remembered across sessions. More loops get added over time.", tags: ["audio", "music", "drone", "sound", "playlist", "track", "skip", "song"] },
      { icon: "💭", title: "MindSpace — thoughts drifting in your galaxy", body: "MindSpace is the ambient layer of your galaxy: your passing thoughts drift as glowing motes through space, instead of sitting in a list. It's off until switched on — open the Mind tab (🧠) and flip the toggle. Each mote offers three gentle actions: Keep (pin it where it is), Make memory (weave it into your galaxy), or Let go (let it drift away). When there are more motes than fit on screen, '+N more' opens the Mind tab to see them all.", tags: ["mind", "mindspace", "thoughts", "motes", "ambient", "drift", "keep", "let go"], tryIt: { label: "🧠 Open Mind", action: { kind: "tab", value: "mind" } } },
      { icon: "🔉", title: "Interface sounds & haptics", body: "The app has a subtle sound kit — a soft tap on buttons, a warm chime when a memory saves, a distinct sting for achievements, a notification cue, and a home motif on your welcome-back. Soumaya's ship has a real engine — a jet startup that settles into a sustained thruster loop — that you only hear when you're focused on her (tap the focus-ship button or zoom in close); it fades away when you look elsewhere. Sounds sit on top of the music (which briefly ducks so cues punch through); toggle it all under Settings ⚙️ → Interface sounds. Respects your device's reduced-motion setting.", tags: ["sound", "sfx", "audio", "haptics", "feedback", "clicks", "thruster", "propulsion", "ship", "settings"] },
      { icon: "🌌", title: "Deep-space calm mode", body: "For a distraction-free reading session, open the Tools menu (🧰, top-right) and tap '🌌 Calm mode'. Everything but your galaxy fades back — the HUD, the buttons, the count badges — and the galaxy itself calms: orbits slow to a gentle drift and the ambient shimmer quiets. Non-essential toasts hush too (they still land in your inbox). Reach toward any control and it returns; come back out via the same Tools menu, where the item now reads '🌐 Exit calm'. Perfect for just sitting with your thoughts.", tags: ["focus", "deep space", "distraction-free", "reading", "calm", "zen", "hide", "dim"] }
    ]
  },
  {
    id: "rules",
    title: "Galaxy & Gravity",
    icon: "🪐",
    desc: "The rules of deep space: semantic orbits, entropy, cooling, and lore evolution.",
    items: [
      { icon: "🌌", title: "Constellations & Orbits", body: "Every memory behaves as a physical body with real gravity. Its mass—which determines its size and physical scale—is dynamically calculated from its connection count, emotional importance, and user-assigned significance. Heavy memories pull lighter thoughts into orbit around them, organizing your brain by association rather than folder structures.", tags: ["gravity", "size", "mass", "orbit", "connections"] },
      { icon: "🔌", title: "Auto-Semantic Connections", body: "When you log a new thought, it is automatically vectorized and linked to the nearest thoughts in meaning—completely bypassing the chore of manual tagging. Over time, these links naturally coalesce into cosmic clusters and constellations.", tags: ["links", "vector", "ai", "semantic", "automatic"] },
      { icon: "🧬", title: "Living synapses (the links)", body: "The lines between memories are living synapses — they're always visible and never disappear. Each one rests on a colour set by the emotion of the two memories it joins: green for a neutral spark, warm gold for joyful ones, and indigo for heavy ones. When Soumaya tends a connection she makes it flare bright like a neuron firing, then it eases back to its resting colour over a few days. She's energizing the link, never drawing or erasing it.", tags: ["links", "synapse", "connections", "colour", "emotion", "green", "gold", "pulse", "neuron"] },
      { icon: "❄️", title: "Entropy (Cooling & Neglect)", body: "Untended memories slowly cool down, fading in color and drifting towards a cold blue. Highly connected memories cool down much slower. To warm a memory back up, simply view it (focal lock) to inject user energy.", tags: ["entropy", "cooling", "blue", "tending", "energy"] },
      { icon: "☄️", title: "Star Classification & Tints", body: "Memories are classified from Asteroid to Moon, Planet, Gas Giant, Giant, Star, and Supergiant based on importance. Newly created stars burn hot white; older unconnected stars redshift over time into a weathered copper glow, leaving a visual fossil record.", tags: ["classification", "star", "white", "redshift", "fossil"] },
      { icon: "❇️", title: "Emerald Energy Ripples", body: "Performing manual updates (like manually adjusting importance sliders or forging paths) triggers a green glowing wave of user energy radiating through the surrounding connections.", tags: ["ripples", "green", "energy", "importance"] },
      { icon: "📖", title: "Chronicle & Lore Evolution", body: "Every memory keeps an append-only Chronicle—an evolving story tracking its life cycle. Tap '✦ Evolve' in details to let the AI write a new chapter connecting it to recent events, or watch the companion add chapters on her own.", tags: ["chronicle", "lore", "chapters", "evolve", "story"] }
    ]
  },
  {
    id: "structure",
    title: "Structure & Taxonomy",
    icon: "🗂️",
    desc: "How your brain organizes itself — memory types, constellation hubs (MOCs), sectors, tags, and provenance. There are no folders; structure emerges.",
    items: [
      { icon: "🗺️", title: "The Legend (reading your galaxy)", body: "Tap the 🗺️ button any time for the visual key — a glanceable glossary of the galaxy's whole language in one place: what each memory-type colour means, what a body's SIZE says about how much a memory matters (asteroid → supergiant), the special bodies (gold constellations, indigo beliefs, the Sun), what the glowing link colours mean (green neutral, gold joyful, indigo heavy) and their flares/dots, and every craft in the fleet. It shows once automatically for a new brain, then it's always a tap away — so you learn to read your mind at a glance instead of memorizing this guide. (It's generated from the app's real colours, so it's always accurate.)", tags: ["legend", "key", "colours", "colors", "swatch", "glossary", "reading", "visual", "size", "meaning", "belief", "constellation"] },
      { icon: "🏷️", title: "Memory types (the taxonomy)", body: "Every memory is auto-classified into a kind so the galaxy is navigable by type, not folders: Person (someone you know), Company (an org/team), Project (an effort with an outcome), Decision (a choice + its rationale), Meeting (a conversation at a point in time), Daily (a journal note / to-do / fleeting thought), Knowledge (a reference fact or learning), Concept (an abstract idea or theme), and Other. Each kind has its own color — see the 🗺️ Legend for the swatches.", tags: ["taxonomy", "types", "kinds", "person", "project", "decision", "knowledge", "concept", "classify", "folders"] },
      { icon: "🌌", title: "Constellations (Maps of Content / MOCs)", body: "When a cluster of related memories grows dense, you can promote it into a Constellation — a named, persistent hub memory (a 'Map of Content') that summarizes and anchors the whole group. From the Insights tab, tap '✦ Save as constellation', give it a name, and it renders as a bright golden hub you can navigate from. It's how big bodies of work get a single front door without imposing rigid folders.", tags: ["moc", "constellation", "hub", "map of content", "cluster", "promote", "summary"] },
      { icon: "🪐", title: "Hubs (your heavyweight anchors)", body: "The Browse tab's (📚) Hubs view lists the heavyweight memories real gravity has formed — the well-connected anchors other memories orbit. Each hub card shows its orbit count, shared tags/people, timespan and tone, with buttons to fly to it or isolate its whole system. It's a lens over the same emergent galaxy, not a separate filing system.", tags: ["hubs", "systems", "anchors", "browse", "isolate", "mass", "lens"] },
      { icon: "🪟", title: "Tags & life-areas", body: "Tags are optional labels you add when dumping a thought (Work, Health, Money, People, Learning, plus moods). They nudge clustering and power the life-area lens in Insights, which groups your memories into broad areas of life (Work & Projects, Relationships, Health, Money, Identity & Growth) so you can see where your attention actually goes. Tagging is never required — meaning-based auto-linking does the heavy lifting.", tags: ["tags", "life-area", "lens", "labels", "work", "health", "money"], tryIt: { label: "✨ Open Insights", action: { kind: "tab", value: "insights" } } },
      { icon: "✦", title: "Provenance (who charted it)", body: "Memories remember their origin. Ones you logged are yours; ones your companion created (a synthesized hub, a researched expansion) are marked '✦ Charted by Soumaya' in their details — except beliefs, which she also concludes but which never carry the mark — so you always know what came from you versus from her.", tags: ["provenance", "origin", "charted", "agent", "soumaya", "authorship"] },
      { icon: "🪐", title: "Drifting (orphan memories)", body: "Memories with no connections are 'drifting' — filter for them in the Browse tab (📚): in the All view, tap the '🪐 drifting' chip. They're candidates to link, fold into a constellation, or revisit. It keeps stray thoughts from getting lost in the dark.", tags: ["drifting", "orphan", "isolated", "lint", "unlinked", "browse"], tryIt: { label: "📚 Open Browse", action: { kind: "tab", value: "list" } } }
    ]
  },
  {
    id: "talk",
    title: "Talk & Companion",
    icon: "💬",
    desc: "Chat with your brain for cited answers, save conversations as memories, and shape your companion's voice.",
    items: [
      { icon: "💬", title: "Chat with your brain", body: "Tap the 💬 button to talk to Soumaya. Ask in plain language and she answers from YOUR memories, not the open web. She now remembers the thread — follow-ups like 'why?' or 'what about the second one?' work — and she reads the emotional register before speaking: heavy topics get a grounded, supportive voice, never a chipper one. Her living eye in the header blinks, drifts while she thinks, and shifts colour with the feeling of her reply (gold = joyful, green = steady, indigo = heavy) — the same tint marks each bubble's edge.", tags: ["chat", "ask", "conversation", "graphrag", "question", "eye", "mood", "emotion"], tryIt: { label: "💬 Open chat", action: { kind: "chat" } } },
      { icon: "🪞", title: "She asks back (interview instinct)", body: "When something clearly matters — strong emotion, a person, a decision, money, identity — and your galaxy holds too little context to answer it well, Soumaya won't bluff a generic reply. She gives what she honestly can, then asks ONE specific question back (a dashed 'she wants to understand' bubble). Answer it and she knows you better; wrap the chat with ✨ to save what surfaced as real memories.", tags: ["interview", "ask back", "clarify", "question", "context", "understanding"] },
      { icon: "🎤", title: "Hands-free mic", body: "Tap 🎤 and just talk — she waits through natural pauses (about 3 seconds of real silence) instead of cutting you off mid-thought, and keeps listening even when the browser tries to stop early. Your words auto-send when you go quiet, or tap the mic again to send immediately.", tags: ["mic", "microphone", "voice", "speech", "dictate", "hands-free", "cutoff"] },
      { icon: "🔎", title: "Grounded, cited answers", body: "Her answers are drawn from the memories most related to your question and come with the sources she used, so you can click straight to the stars behind any reply. If your brain doesn't hold the answer, she'll say so rather than invent one.", tags: ["cited", "sources", "grounded", "answers", "retrieval"] },
      { icon: "🔬", title: "Grounded Insight (a chat setting)", body: "Tap 🎭 inside the chat (💬) to open her Companion panel — under her Soul there is a 'Grounded insight' switch. When it's ON (the default), anything she tells you about YOURSELF stays specific and checkable — tied to real memories, said so you can confirm or correct it ('does that land?') — never vague, horoscope-style flattery that could apply to anyone. She also nudges concrete if-then plans instead of generic pep talk, and notices patterns without ever slapping a clinical label on you. Turn it OFF if you'd rather a looser, warmer read. It sharpens how she reflects; it doesn't override her voice, your custom roles, or your knowledge docs — those all still work.", tags: ["grounded insight", "anti-barnum", "horoscope", "specific", "falsifiable", "self-insight", "toggle", "setting", "companion", "reflection"] },
      { icon: "💾", title: "Save a reply as a memory", body: "Any line of a conversation can be saved into the galaxy as a real memory, so a good insight that surfaces mid-chat becomes a permanent star — linked into your brain like anything else you log.", tags: ["save", "memory", "chat", "capture"] },
      { icon: "🪄", title: "Distilled notes", body: "At the end of a conversation she proposes a few memory-worthy notes distilled from what you discussed. Keep the ones that matter with a tap and they're woven into your galaxy — turning a chat into lasting knowledge.", tags: ["distill", "notes", "summary", "proposals", "keep"] },
      { icon: "🎭", title: "Companion: Custom Instructions (her superpowers)", body: "Tap 🎭 inside the chat (💬) to give Soumaya ROLES — and this is one of her most powerful features. A role isn't a tone tweak; it turns her into a genuinely different mind on demand. Give her an 'IQ Examiner' instruction and she'll administer a real, scored aptitude test right in the chat, one question at a time. A 'Socratic Tutor' never hands you the answer; a 'Structured Interviewer' runs a graded mock interview; a 'Devil's Advocate' argues the hard other side. Tap a showcase card to load a full example, or write your own operating manual. She picks the role that FITS what you're talking about — she won't cram every role into every reply — and the chip under her answer shows which one she actually used. Set them to 'Auto' so she brings the right one in when the topic calls for it. Pair with Knowledge docs to give a role real material to work from.", tags: ["companion", "instructions", "persona", "roles", "custom", "chat", "iq test", "tutor", "interviewer", "superpower", "goal set", "template"] },
      { icon: "📚", title: "Companion: Knowledge", body: "Give your companion reference material under Knowledge — documents and notes she should always consider when answering. It blends with your memories so replies reflect both your brain and the context you've handed her.", tags: ["knowledge", "documents", "reference", "companion"] },
      { icon: "🪪", title: "Companion: About Me", body: "'About Me' is Soumaya's running picture of who you are — your goals, voice, and what you care about — and you don't fill it in: she derives it from your memories herself and keeps it current on her own (it isn't edited by hand). She stays aware of it when she talks to you and uses it to personalize what she surfaces. Read it in her Companion panel (tap 🎭 inside the chat 💬), and tap '↻ Update now' there to have her re-derive it from your latest memories.", tags: ["about", "persona", "profile", "identity", "voice"] },
      { icon: "🫀", title: "She reads how you're doing (behavioral awareness)", body: "Beyond who you are, Soumaya reads how you're doing RIGHT NOW — comparing this week to your own baseline. A heavier stretch than usual? She leads gently and keeps suggestions small. Mood swinging? She stays steady. You write in late-night bursts? She keeps replies compact. She notices what's newly occupying you, treats your heaviest recent memories as tender ground, and calibrates her daily questions to whether you've been answering them. All computed privately from your own patterns — she never recites it, it just shapes her delivery.", tags: ["behavior", "awareness", "tone", "adaptive", "mood", "baseline", "persona", "knows me"] },
      { icon: "🛰️", title: "Daily digest & Captain's Log", body: "Your companion writes a daily digest and a Captain's Log — her narrative read on how your galaxy evolved, what she tended, and what's worth your attention. Both live at the top of the Insights tab (✨) so her story of the day and its details read together.", tags: ["digest", "daily", "summary", "captain's log", "soumaya", "insights"] },
      { icon: "🌙", title: "While you were away", body: "Soumaya keeps tending your galaxy in the background even when the app is closed — connecting related memories, expanding important ones, keeping things tidy. When you return after a real absence, the Observatory home greets you with her report at the top: what she did, contradictions she found, reminders that came due, and a memory worth resurfacing today. One arrival screen, everything in one glance.", tags: ["away", "background", "welcome back", "return", "autonomous", "companion", "resurface", "observatory"] },
      { icon: "🪞", title: "Her daily question (the Daily Contact)", body: "Once a day, SHE reaches out first. Soumaya picks the single most valuable thing she could ask about your brain — an unanswered research question, a contradiction she can't reconcile, an important memory going cold, or something heavy she doesn't understand yet — and leads the Observatory with it. Answer right there and your reply becomes a real memory, linked to what she asked about, feeding your streak and fuel. She also brings her discovery of the day. If Telegram is linked, her question rides the daily digest so you can answer with /log from anywhere.", tags: ["daily", "question", "contact", "ritual", "interview", "streak", "comeback", "observatory", "telegram"] },
      { icon: "🌌", title: "The Night Replay", body: "Her overnight work isn't just a report — she PERFORMS it. When you arrive after being away, Soumaya retraces what her 24/7 loop actually did: flies to the memory she researched (watch its label — 'Last night: researched…'), to the duplicate she fused, to the sector she charted. And while you stay, brand-new background work surfaces live as toasts in her voice. What you see her do is your real backend data, acted out.", tags: ["replay", "night", "overnight", "background", "immersion", "theater", "live", "events"] },
      { icon: "🧰", title: "She acts on her own (her tools)", body: "Soumaya doesn't only answer — she has TOOLS she reaches for by herself, quietly, in the background. She FIRES REMINDERS the moment they come due (in-app, and pushed to Telegram if linked — no more reminders that just sit there). She turns a commitment you voiced ('I need to call the landlord') into a real ACTION ITEM linked to that memory. She surfaces an ORPHAN memory drifting with no connections and invites you to link it. She CHECKS IN when a stretch has been emotionally heavy or two of your memories contradict. And with Research Mode on, she can LOOK THINGS UP on the live web when a memory asks her to, attaching a cited note. Once a week she also writes you a short WEEKLY REVIEW — a warm look back over the past seven days: how many moments you logged, the mood that ran through them, and the one that stood out. She's gentle about it — at most one nudge of each kind per day (the review is once a week), and (with Research Mode) she even decides which are worth doing so she never floods you.", tags: ["tools", "reminders", "tasks", "action", "orphan", "check-in", "web lookup", "weekly review", "reflection", "digest", "autonomous", "agent", "proactive", "telegram"] },
      { icon: "💭", title: "She notices connections (and distant ones)", body: "Soumaya watches the shape of your galaxy and raises a quiet 💭 'noticing' when something's worth a question — two people or ideas she can't tell how they relate, a memory that seems to belong to a goal you didn't name, a tight cluster she could name as a constellation. Every so often she also plays a spark: she picks two memories that sit FAR apart with no thread between them and invites you to find the link. Naming it yourself is where the real insight forms — and your answer becomes a memory tying the two together.", tags: ["noticing", "noticed", "connections", "distant", "constellation", "insight", "proactive", "link", "bridge", "generation"] }
    ]
  },
  {
    id: "explore",
    title: "Organize & Explore",
    icon: "🗂️",
    desc: "Browse, search, group by sector, track action items, and surface the latent connections hiding in your brain.",
    items: [
      { icon: "ⓘ", title: "Memory details", body: "The Details tab (ⓘ) shows everything about the selected memory — its text, type, importance, connections, Chronicle, and actions to evolve, isolate, edit or delete it. It's the cockpit for working on a single thought.", tags: ["details", "inspector", "edit", "memory", "info"], tryIt: { label: "ⓘ Open Details", action: { kind: "tab", value: "details" } } },
      { icon: "📚", title: "Browse (All · Folders · Hubs)", body: "The Browse tab (📚) is the one place to read your memories, with three lenses over the same data: ALL — a flat, searchable index with filters (type, tier, emotion, cooling, drifting, timeline) and each row's 👽 visitor count; FOLDERS — every memory filed by kind (People, Projects, Decisions, Daily…) with readable previews and Markdown export (⬇ one note, a folder, or your whole brain); HUBS — the heavyweight anchor memories with their orbiting systems. Three old tabs (List, Library, Sectors) merged into this one.", tags: ["browse", "list", "index", "library", "folders", "export", "download", "markdown", "hubs", "sectors", "search", "filter"], tryIt: { label: "📚 Open Browse", action: { kind: "tab", value: "list" } } },
      { icon: "🗝️", title: "Tabs that unlock as you go", body: "A brand-new brain doesn't need all 11 dock tabs on day one — Details, Browse, Mind, Agenda, Soumaya, Inbox and Money are there from the start, while Insights, Progress and Hangar quietly appear once you log your first real memory — that's the only trigger for all three. Journeys is always there — nothing else in the app can create your first one. Nothing is ever removed or locked forever; a tab just waits to introduce itself until it has something to show you.", tags: ["tabs", "dock", "unlock", "progressive", "discovery", "onboarding", "new brain"] },
      { icon: "📖", title: "The Codex (your living atlas)", body: "Open the Progress tab (🏆) and pick the 📖 Codex chip: a collectible atlas of your galaxy. Entries start locked and are DISCOVERED as your galaxy grows — the named sectors of your mind (Kinship Reaches, Forge Fields, the Deep Field…), your constellations, the celestial bodies a memory can become (up to the black-hole Singularity at 365 memories), your fleet, and rare phenomena Soumaya uncovers. Each entry LEVELS UP the more you engage, there's an overall completion %, and every new discovery earns you a little fuel. The Codex covers everything you DISCOVER; Awards cover feats you DO — the two never double-reward, and completing the whole Codex earns the one crossover badge, Galactic Atlas. The Codex also has a whole 'Mind Layer' section (discover the goals, skills, people and ideas that give your galaxy direction) and grows with lifetime milestones.", tags: ["codex", "atlas", "collect", "unlock", "discover", "sectors", "lore", "completion", "gamification", "progress", "mind layer"], tryIt: { label: "🏆 Open Progress", action: { kind: "tab", value: "awards" } } },
      { icon: "✒️", title: "Soumaya's Field Notes (she grows the Codex herself)", body: "The Codex has a 'Soumaya's Field Notes' section that SHE fills in. As your galaxy grows she notices genuinely notable structures on her own — a constellation that's become a landmark, your most brilliantly-connected memory, a sector that's come of age — and charts each one as a discovery in her own voice, pinging you when she does. At most one new note a day, so the atlas fills over a lifetime rather than all at once. Alongside the Awards expansion, the whole Progress tab is built to keep unlocking things for years.", tags: ["field notes", "codex", "soumaya charts", "discovery", "autonomous", "landmark", "nexus", "atlas", "progress"] },
      { icon: "🧠", title: "The Mind tab (your cognitive layer)", body: "Beyond what you remember lives what you're pursuing and becoming. The Mind tab (🧠) lets you map goals, ideas, skills, the people you orbit, your identity, mental models, motivations and more — each becomes a first-class body in the galaxy with its own colour. Goals, identity, skills, people and motivations exert gravity: over time Soumaya pulls the memories that support them into their orbit (a 'supports' link), so your galaxy shows not just your past but your direction. Goals and skills carry a 0..1 progress you can nudge as you advance. Ideas are alive: they brighten as memories come to support them, dim and eventually fade if you never return to them, and near-duplicate ideas merge on their own. When an idea matures (enough support), a '✨ Ripe — promote to Goal' button appears so you can commit to it — turning it into a durable goal your memories orbit. Skills level up on their own: every memory that evidences practice raises the skill's level (Novice → Beginner → Practiced → Skilled → Advanced → Expert) and brightens it, so you never have to hand-crank the bar — just log what you do. Identities are held to the evidence of your life: memories that express who you are brighten an identity, while ones that contradict it (in your own words — 'I quit…', 'no longer…', 'I'm not…') dim it. Open 'Evidence' on an identity card to see what's affirming vs contesting it (▲/▼) and jump to those memories. People work like a lightweight CRM: add someone and every memory that mentions them orbits them; open 'Relationship' on a person card to see your interactions, when you last engaged, and the emotional tone (warm / heavy / mixed). Soumaya also spots names you mention a lot but haven't added and offers them as one-tap 'People you mention' chips, and quietly merges duplicate person entries. The mind also handles time and drive: a future event carries a date and shows a countdown ('in 3d', 'today', 'overdue'), then rolls into memory once it passes; an intention is a short-lived comet that either gets fulfilled (you act on it → it settles into memory) or expires if ignored; a motivation is a gravity well that brightens as more of your memories align with it; and mental models show what they're 'applied to'. A Life Vision (🌅) is the same '+' flow, one kind among the rest — but it's the one built for a whole desired chapter, not a single task: give it a target date, and open its card's 'Financial Goals' section to link the Money-tab goals funding it and see the deterministic total still needed and how much is already covered.", tags: ["mind", "cognitive", "goal", "idea", "skill", "identity", "person", "mental model", "motivation", "gravity", "progress", "direction", "promote", "fade", "merge", "lifecycle", "life vision", "vision", "target date", "financial goals", "funding"], tryIt: { label: "🧠 Open Mind", action: { kind: "tab", value: "mind" } } },
      { icon: "💭", title: "Working memory (thinking now)", body: "At the top of the Mind tab (🧠) is your mind space — 'Thinking now'. Hold a fleeting thought and it glows there, then slowly fades unless you return to it (↑ reinforce). Thoughts you keep coming back to are consolidated into your galaxy as real memories — mimicking how short-term thoughts become long-term memory. You can also ★ promote one into a memory instantly, or × let it go. Toggle '✧ Show in space' to float your live thoughts as glowing motes around the galaxy itself.", tags: ["working memory", "thinking now", "mind space", "thought", "reinforce", "consolidate", "ephemeral", "short-term", "promote"] },
      { icon: "🌌", title: "Views — one-tap category filters", body: "The 🌌 Views button (left edge of the screen) gives you quick, PRE-BUILT filters by category — one memory kind at a time, or an overlay layer like the Money sky or Journey hubs. It started as a performance fix: rendering every name and label at once was heavy on weaker phones, so showing one category at a time lightens the scene — and it still does that job. It uses the exact same isolate mechanism as a Smart Lens under the hood, just with fixed, hardcoded categories instead of ones you define. Reach for Views for a quick, zero-setup glance (or to lighten a busy galaxy on a slower phone); reach for a Lens when you want a saved, reusable, self-updating filter of your own — the same relationship \"recent files\" has to \"saved searches.\" Tap \"💾 Save as Lens\" while a category View is open to turn it into one instantly.", tags: ["views", "category", "filter", "quick", "money sky", "journey hubs", "isolate", "performance", "save as lens"] },
      { icon: "⧉", title: "Smart Lenses — saved views of your galaxy", body: "Think of a lens as a SAVED FILTER that lives on your galaxy. Instead of your whole cosmos at once, a lens shows you just one slice of it — like \"my heavy memories\", \"everything about Mara\", \"what's fading and due for review\", or \"this month's ideas\". Open the Tools menu (🧰, top-right) and tap '⧉ Lenses' to see your saved lenses or build a new one from simple dropdowns: mood (joyful / heavy / neutral), state (active, due for recall, orphans, archived), a minimum importance, how recent, and/or a keyword. Save it, and opening it dims everything except the matching stars and frames them for you. The magic part: a lens is LIVE — as you add memories, new matches light up in it and ones that no longer fit drop out, no re-doing it. Pin the ones you use most and they sit as one-tap chips right on the galaxy with a live count. Tip: focus a single memory first and the builder offers a one-tap \"everything linked to this\" lens. It's all instant, private, and offline — no AI, no fuel. Soumaya can even suggest one when a pile of loose or fading memories builds up.", tags: ["lens", "lenses", "smart lens", "saved view", "saved filter", "query", "filter", "self-updating", "constellation", "isolate", "pinned", "what is a lens", "slice"], tryIt: { label: "⧉ Open Lenses", event: "brain-open-lenses" } },
      { icon: "✅", title: "Agenda & action items", body: "Thoughts that imply a to-do surface in the Agenda tab (✅) as action items you can tick off. Completing them tends your brain and earns fuel — your reflections turn into a working task list.", tags: ["agenda", "tasks", "action items", "todo", "reminders"], tryIt: { label: "✅ Open Agenda", action: { kind: "tab", value: "actions" } } },
      { icon: "🕰️", title: "The Chronicle (your life timeline)", body: "Tap the 🕰️ button to open the Chronicle — a chronological, scrollable list of the chapters of your life, spaced by how much real time actually passed between them (a busy stretch reads dense; a quiet season leaves visible room) and grouped under month/year headers. Soumaya writes a new chapter when there's REAL change (a blend of momentum, emotional trend and new milestones), roughly 1–3 times a month — read as growth, a harder season, a turning point, or steady. Tap any chapter for its full card: the memories that drove it, its trend threads, and any photos attached. You can also '✍️ Mark this moment' to add your own chapter anytime. Established brains get an opening chapter seeded from their history on first open.", tags: ["chronicle", "timeline", "chapters", "life", "story", "photos", "growth"] },
      { icon: "🧠", title: "Recall sessions (memory that lasts)", body: "Memory is made by RETRIEVAL, not storage — so Soumaya helps you actually remember. As a memory ages toward its review point its star gently DIMS (the 'come revisit me' cue), and the 🧠 button (with a badge counting what's due) opens a calm recall session: she shows a memory, you try to recall it, then reveal and rate yourself (remembered / forgot). Get it right and she spaces the next review further out; miss it and she brings it back sooner — the same science as spaced repetition, but in her voice, never flashcards. She'll also nudge one due memory a day on her own.", tags: ["recall", "spaced repetition", "review", "remember", "retrieval", "srs", "dimming", "active recall", "fade"] },
      { icon: "✨", title: "Insights: latent connections", body: "The Insights tab (✨) is the synthesis digest — it surfaces non-obvious links between distant memories you'd never have spotted, the 'aha' connections that make a second brain worth having. Tap one to fly to it.", tags: ["insights", "synthesis", "latent", "connections", "digest", "serendipity"], tryIt: { label: "✨ Open Insights", action: { kind: "tab", value: "insights" } } },
      { icon: "⚡", title: "Insights: find contradictions", body: "In the Insights tab, tap '⚡ Find contradictions' to scan your same-topic memories for conflicts — a belief you changed, a goal you reversed, a shifting view of yourself. Each one shows both memories and a gentle reconciliation hypothesis so you can make peace with the tension or notice you've grown.", tags: ["contradiction", "conflict", "reconcile", "belief", "goal", "identity", "insights"] },
      { icon: "💭", title: "She notices connections and asks (proactive intelligence)", body: "Soumaya doesn't just wait — she watches your graph for meaningful situations and raises a grounded question in a '💭 Soumaya noticed…' card. Three kinds: a BRIDGE (a memory that ties two people/goals/hubs together that weren't connected — 'what's the dynamic between X and Y?'), an ANCHOR match (a note that clearly relates to a person/goal in your Mind even though you never named it — 'is this about X?'), and an emerging THEME (several recent memories circling one topic with no hub — 'is this becoming its own thing?'). Tap the chips to fly to what she means; answering becomes a real memory linked to those bodies (and earns fuel), so her noticing literally grows your brain. Wave it off with 'Not now' and she won't ask that one again.", tags: ["proactive", "noticed", "inquiry", "question", "connection", "bridge", "theme", "anchor", "dynamic", "intelligence", "relationship"] },
      { icon: "🔮", title: "She sees patterns coming (foresight)", body: "Emotional weather charts where your mood HAS been; foresight calls where it's about to go. Soumaya watches for recurring rough patches — a heavy month-end, a hard Monday that keeps repeating — and when the next one is within a few days, she gives you a gentle heads-up on the Observatory ('the last two month-ends ran heavy, and it's coming up again — want to get ahead of it?'). She also quietly leans in a little more during those windows in conversation. Purely your own patterns, computed privately; she only speaks when a pattern has genuinely repeated.", tags: ["foresight", "prediction", "pattern", "anticipate", "month-end", "cycle", "heads up", "wellbeing"] },
      { icon: "🌡️", title: "Insights: emotional weather", body: "The Insights tab also charts your 'emotional weather' — a mood-over-time sparkline drawn from the feeling in each memory, plus detected patterns (stress cycles, upswings, burnout risk, volatile stretches) with the trigger behind them and a gentle suggestion. It's a self-reflection mirror, computed privately on your own brain.", tags: ["emotional", "mood", "trajectory", "stress", "burnout", "pattern", "wellbeing", "insights"] },
      { icon: "💤", title: "Insights: dormant & worth reviving", body: "The Insights tab surfaces 'dormant' memories — skills, goals and projects that once mattered to you but have gone quiet (you haven't visited them in weeks). Each shows how long it's been silent and a hypothesis for why it faded, so you can decide to revive it or let it go. Tap one to fly straight to it (and visiting it warms it back up).", tags: ["dormant", "latent", "revive", "skill", "goal", "project", "abandoned", "reactivate", "insights"] },
      { icon: "🔗", title: "Insights: how your thinking evolved", body: "The Insights tab traces evolution chains — two memories on the same theme recorded far apart in time, shown older → newer with how strongly they relate, the gap between them, and how your mood around the topic shifted. It's a way to see your beliefs, goals and identity drift across months, not just a snapshot. Tap either end to fly to it.", tags: ["evolution", "temporal", "chain", "drift", "over time", "goal evolution", "identity", "insights"] },
      { icon: "🪟", title: "Insights: life-area lens", body: "The Insights tab includes a 'life-area lens' — an optional overlay that groups your memories into broad areas of life (Identity & Growth, Relationships, Work & Projects, Health, Money) and shows the balance between them, so you can see roughly which themes your memories fall into. It's an automatic keyword sort — a rough guess at themes, not measured attention — and a lens over the same emergent galaxy, never a folder system — your memories still cluster by similarity.", tags: ["life-area", "lens", "balance", "attention", "work", "health", "money", "relationships", "insights"] },
      { icon: "🖤", title: "Insights: what she believes about you", body: "Like sleep turning a day's events into lasting memory, Soumaya runs a 'dream cycle' — once a day she takes the densest cluster of your related memories and distills the single BELIEF, value, or pattern they reveal about you ('you keep returning to the same fear about money even when the facts change'). These beliefs live at the top of the Insights tab and as distinct indigo bodies in your galaxy, linked to the memories that formed them. They deepen and revise as you grow — nothing is deleted, the prior version is kept as history — and she draws on them in conversation, so 500 notes become a worldview she can actually reason from.", tags: ["belief", "beliefs", "dream", "consolidation", "understanding", "pattern", "worldview", "insights", "wisdom"] },
      { icon: "🔍", title: "Insights: Soumaya's self-check", body: "At the top of the Insights tab, Soumaya runs a read-only self-check — what she may be missing or that's worth your attention: drifting memories with no links, important blind spots she hasn't had researched in Research Mode, memories cooling from neglect, and contradictions awaiting reconciliation. She reports it rather than silently acting, so you stay in control.", tags: ["self-check", "coverage", "review", "drifting", "blind spots", "gaps", "insights"] },
      { icon: "🗃️", title: "When she researches (and when she doesn't)", body: "Not every thought needs deep research. After you dump a memory, an under-connected one at importance 0.45 or higher may be picked for Research Mode research — but only when Research Mode is on for your brain, the budget allows, and there's fuel in the tank. Lighter notes are simply stored, and any memory can be researched when you ask her to tend it — that path has no importance floor. It's how the system avoids wasting effort — only the consequential stuff gets her attention.", tags: ["research", "no research", "stored", "research-mode", "weight", "noise"] },
      { icon: "🔭", title: "The Observatory (home)", body: "The Observatory is your home view — a calm overview that greets you after the cinematic fly-in with the state of your brain. Reopen it any time from the 🔭 button to get your bearings.", tags: ["observatory", "home", "overview", "dashboard"] },
      { icon: "🔔", title: "Inbox & reminders", body: "The Inbox tab (🔔) collects what needs you — reminders coming due, action items that cleared, memories going cold, and companion notices. A red badge shows how many are unseen.", tags: ["inbox", "notifications", "reminders", "alerts", "badge"], tryIt: { label: "🔔 Open Inbox", action: { kind: "tab", value: "inbox" } } },
      { icon: "🔍", title: "Search your galaxy", body: "Use search to find any memory by meaning, not just keywords — type what you remember and the closest thoughts surface, ready to focus.", tags: ["search", "find", "semantic", "lookup"], tryIt: { label: "🔍 Open Search", action: { kind: "panel", value: "search" } } },
      { icon: "🔗", title: "Connections (suggested links)", body: "Open the Tools menu (🧰, top-right) and tap Connections for the links Soumaya held back because she was not sure about them — nothing uncertain is wired into your galaxy without you. Connect the real ones, dismiss the rest, or link any two memories yourself with the manual linker at the top (search two memories, tap Link — no AI required). Declutter weak links moves her weakest existing links into the same queue for your review — but it also permanently removes anchor links whose memory doesn't name the anchor, and trims over-linked anchors to 12 links. It asks you first.", tags: ["connections", "links", "suggested", "candidates", "manual link", "declutter", "weak links", "tools menu"], tryIt: { label: "🔗 Open Connections", event: "brain-open-connections" } },
    ]
  },
  {
    id: "fleet",
    title: "Economy & Fleet",
    icon: "⚡",
    desc: "Manage Research Mode, fuel cells, and check the roles of your autonomous fleet.",
    items: [
      { icon: "⛽", title: "Celestial Fuel (& how to earn it)", body: "A free energy currency earned by actively tending your brain — logging a memory (+15), each link forged (+2), adding to your Mind: a goal/person/skill/identity/idea (+6), capturing a thought (+2), clearing an agenda item (+3), your daily streak (+2) and Codex discoveries (+4). It also trickles back on its own (3.5/hour) up to a 200 tank, but real income comes from real tending. TAP the fuel gauge (or the low-fuel banner) to open '⛽ Ways to earn Fuel' — a cheat-sheet where every row is a button that takes you straight to the thing that earns it. Soumaya spends fuel on her ambitious extra work — Research Mode research, sector charting, web look-ups (2 per job) — spends pop in red on the gauge. Her core maintenance and the living galaxy always run free.", tags: ["fuel", "economy", "tending", "energy", "spend", "earn", "regen", "ways to earn", "gauge", "mind", "thought"] },
      { icon: "🔥", title: "Daily streak & nebula shields", body: "Feed your brain a memory each day and your streak climbs — the 🔥 ember on the left edge shows it, flickering 'at risk' on days you haven't logged yet. Miss a day and it normally resets, BUT you bank NEBULA SHIELDS (🛡️, shown on the ember): each shield forgives ONE missed day so your streak survives — a broken streak is data, not punishment. You start with two and earn one back for every 7-day run. Gentle by design.", tags: ["streak", "shield", "nebula", "freeze", "daily", "forgive", "ember"] },
      { icon: "🔬", title: "Research Mode", body: "Toggle Research Mode in the Soumaya tab (🛰️), next to the fuel it spends — the same switch also lives in Settings. It's private to YOUR brain — flipping it never affects anyone else on the deployment. When active, she consumes fuel to scan the frontier of your graph, searching for isolated ideas and forging new links.", tags: ["research", "mode", "toggle", "gaps", "connections"], tryIt: { label: "🛰️ Open Soumaya", action: { kind: "tab", value: "soumaya" } } },
      { icon: "🛸", title: "Her research may ask YOU questions", body: "When Research Mode research finds gaps only you can fill, she pauses and leaves clarifying questions on the memory (a 🛸 card in its Details tab, plus an alert chip up top). Answer them and she completes the research with your context folded in.", tags: ["research", "questions", "clarify", "answer", "details"] },
      { icon: "📋", title: "Active Flight Tasks", body: "The Soumaya tab (🛰️) lists her Active Flight Tasks — what she's doing now, what's planned next, and what just finished. You can reorder the planned queue (↑/↓) to steer which memory she visits first.", tags: ["tasks", "queue", "reorder", "flight", "plan"] },
      { icon: "🔧", title: "Autonomous systems (a real health check)", body: "The Soumaya tab's '🔧 Autonomous systems' box shows exactly when each of her background tools last actually ran — reminders, task creation, orphan surfacing, recall nudges, check-ins, web lookups, weekly review, Codex charting, bill-risk warnings — 'never yet' or 'Xh/Xd ago', pulled straight from the real log. If something you expect her to be doing shows 'never yet', that's a genuine signal something's off, not a guess.", tags: ["diagnostics", "health", "tools", "autonomous", "systems", "last ran"] },
      { icon: "🎯", title: "Her undertakings (multi-day arcs)", body: "Beyond minute-to-minute tasks, Soumaya commits to multi-day UNDERTAKINGS — a five-day arc with a visible progress bar in her tab ('Day 3 of 5 — Warming the cold belt'). She might warm your drifting cold memories, chart your densest sector, or weave your loneliest notes into the graph. It's autonomy with a story: she begins one, works it a little each day, and announces when it's done. Free — it rides the upkeep she already does.", tags: ["undertaking", "arc", "multi-day", "project", "autonomy", "progress", "narrative"] },
      { icon: "🚀", title: "The Fleet section", body: "Inside the Soumaya tab (🛰️), open '🚀 Fleet — her support craft' for the roster: each unit's role, live status dot, and lore. Visitor activity (which memories alien craft frequent) shows per-row 👽 counts in Browse instead.", tags: ["fleet", "roster", "status", "units", "visitors"] },
      { icon: "👽", title: "Visitors (alien drifters)", body: "Small alien craft wander in over time, drawn to your most gravitationally interesting memories. Each Browse row shows its 👽 visit count — a passive signal of which parts of your mind attract attention. Tap a visitor in the 3D view to see its lore card.", tags: ["visitors", "aliens", "drifters", "activity", "browse"] },
      { icon: "🚨", title: "Alert chips (top bar)", body: "Urgent states surface as chips along the top: low fuel, the cloud AI degraded/on cooldown, research questions waiting for your answers, and overdue action items. Tap a chip to jump straight to the fix.", tags: ["alerts", "chips", "low fuel", "degraded", "overdue", "notifications"] },
      { icon: "📱", title: "Telegram bridge", body: "Link a Telegram chat to your brain from the Soumaya tab (🛰️ → Telegram) and you can /log memories or ask questions from your phone's messenger; she also pushes a daily digest there. Logging via Telegram earns the same fuel and advances the same streak as the app.", tags: ["telegram", "bot", "link", "mobile", "digest", "log"] },
      { icon: "💵", title: "API budget (deployment-wide)", body: "The Soumaya tab's API-budget meter tracks the shared cloud-AI spend estimate for the whole deployment. Changing the budget or resetting the meter requires the ADMIN_TOKEN secret — it's the owner's control, not per-brain. When the budget runs out, everyone degrades gracefully to the offline heuristic until it's raised.", tags: ["budget", "usd", "api", "admin", "spend", "meter"], tryIt: { label: "🛰️ Open Soumaya", action: { kind: "tab", value: "soumaya" } } },
      { icon: "🎯", title: "How she prioritizes research", body: "Soumaya doesn't research at random. She scores under-connected memories by how consequential they are — strong emotion, being caught in a contradiction, identity statements, long-term goals, recurring themes — and researches the most meaningful blind spot first, skipping low-signal one-offs entirely so fuel is never wasted on noise. When a research job actually runs, it shows up in her activity log as a Research entry — the picking itself isn't logged, and if a job never runs (Research off, or out of fuel), nothing appears at all.", tags: ["research", "priority", "score", "decision", "emotion", "identity", "goals"] },
      { icon: "🔔", title: "She announces her decisions", body: "Whenever Soumaya chooses to do something consequential — Research Mode research on a memory, fuse two duplicates, chart a sector, or write the daily log — she announces it with a notification (a toast that also lands in your Inbox 🔔). Routine patrols and pruning stay quiet. So you're always aware of the meaningful moves she's making, not just discovering them afterward in her activity log.", tags: ["notification", "decision", "awareness", "toast", "inbox", "research", "announce"] },
      { icon: "🛸", title: "Fleet: Companion Starpilot", body: "Your main autonomous vessel — Soumaya herself. She flies between hubs, bridges semantic gaps, prunes duplicate notes, and writes the daily Captain's Log summarizing the evolution of your galaxy.", tags: ["ship", "starpilot", "maintenance", "log", "soumaya"] },
      { icon: "📡", title: `Fleet: Aura Beacons (${SATELLITE_NAME}s)`, body: SATELLITE_LORE, tags: ["beacon", "relays", "beams", "emotion", "satellite", "sentinels"] },
      { icon: "🛰️", title: "Fleet: The Scout", body: "A fast probe that flies to the newest, least-connected memories — the frontier — surveying what's just arrived and feeding Soumaya's curiosity when Research Mode is on.", tags: ["scout", "frontier", "survey", "probe"] },
      { icon: "🛡️", title: "Fleet: The Defender", body: "Holds station over your heaviest hub and breaks off to intercept hostile drifters that stray too close — the fleet's shield, maintaining spatial stability.", tags: ["defender", "guardian", "shield", "hubs", "drifters"] },
      { icon: "🚁", title: "Fleet: The Tender Squadron", body: "A wing of small drones that hover over your COOLING memories and warm them. What makes it special: the squadron GROWS as your galaxy grows — one more drone for roughly every 30 memories (up to five) — so a bigger mind gets more hands helping keep it warm. It's a visible helping hand around your galaxy; like the rest of her upkeep it costs no fuel and never makes Soumaya rush.", tags: ["tender", "squadron", "drones", "warmth", "cooling", "fleet", "grows", "help"] }
    ]
  },
  {
    id: "hangar",
    title: "Hangar, Awards & Settings",
    icon: "🏆",
    desc: "Unlock custom hulls and trails, mount deep-space megastructures, earn badges, and tune your preferences.",
    items: [
      { icon: "🛠️", title: "The Hangar Customizer", body: "Open the Hangar tab (🛠️) to customize your companion's ship. Swap the hull skin (Default Scout, Organic Specimen, Fusion Core Destroyer, Holographic Sentinel) — each earned through play — and pick an exhaust trail.", tags: ["hangar", "skins", "hull", "ship", "customization"], tryIt: { label: "🛠️ Open Hangar", action: { kind: "tab", value: "hangar" } } },
      { icon: "✨", title: "Engine trails", body: "Choose your companion's cosmic exhaust trail. Blue Nebula is default; Hyperdrive Neon, Solar Gold and Void Purple unlock through achievements (Consistent Pilot, Sector Pioneer, Grand Restorer).", tags: ["trail", "exhaust", "neon", "gold", "purple", "color"] },
      { icon: "🏆", title: "Achievements (Progress tab → Awards)", body: "Awards are FEATS — things you actively did: weave 25+ connections, keep every memory warm (Keeper of the Flame), hold a tending streak (Consistent Pilot), restore cold memories (Grand Restorer), deploy beacons, build a 5-memory path. Simple discoveries (first memory, first link, star class…) live in the Codex instead, and your memory COUNT is celebrated once, by Pilot Rank — no more triple toasts for one milestone. The Progress tab (🏆) holds both: the 📖 Codex chip and the 🏆 Awards chip (with your rank + streak banner), plus a shortcut to the Hangar to spend your unlocks.", tags: ["achievements", "badges", "awards", "unlocks", "progress", "feats", "rank"], tryIt: { label: "🏆 Open Progress", action: { kind: "tab", value: "awards" } } },
      { icon: "🪐", title: "Deep-space megastructures", body: "Unlock colossal background figurines and mount them in two slots far out in space: the Solar Monument (100 memories), Dyson Megastructure (250), plus achievement-gated ones — Quantum Singularity Core, Synapse Hyper-Array and Aegis Shield Spire. Enable each one's HUD focus button to fly out and admire it.", tags: ["figurine", "megastructure", "dyson", "monument", "slots"] },
      { icon: "🕳️", title: "The Singularity (black hole)", body: "The rarest figurine of all: a real black hole with a glowing accretion disk, unlocked by reaching 365 memories — a full year of your mind (also a Codex discovery). Equip it as a deep-space monument and fly out to witness it. You can preview it any time via the focus button even before it's earned.", tags: ["blackhole", "singularity", "365", "prestige", "rare", "accretion"] },
      { icon: "⚙️", title: "Settings & preferences", body: "The Settings panel (⚙️) holds more than the basics: Account (display name + gamer tag), Preferences (voice replies and interface sounds) and Accessibility (colour & motion — see its own card below), plus a large Graphics & performance section and a Diagnostics area (event recording, a render-isolation sweep and automated render checks) aimed at troubleshooting. Soumaya-specific switches — Research Mode and her floating task label — live in her own tab (🛰️) so there's exactly one switch for each.", tags: ["settings", "preferences", "account", "options", "voice", "sounds"], tryIt: { label: "⚙️ Open Settings", event: "brain-open-settings" } },
      { icon: "♿", title: "Accessibility (colour & motion)", body: "Settings (⚙️) → Accessibility has two switches. Colorblind-safe colours swaps the link/emotion palette to blue · orange · grey (clear for red-green colourblindness); the Legend relabels itself to match, and colour is never the only cue. Reduce motion calms the galaxy — orbits slow to a gentle drift, the ambient shimmer and link sparks quiet down — and it follows your device's system setting automatically if you'd rather not toggle it here.", tags: ["accessibility", "colorblind", "color blind", "palette", "reduce motion", "reduced motion", "a11y", "contrast", "vestibular"], tryIt: { label: "⚙️ Open Settings", event: "brain-open-settings" } },
    ]
  },
  {
    id: "money",
    title: "Money",
    icon: "💵",
    desc: "Safe to Spend, bills, income and expenses, what you can afford, and how it shows up in your galaxy and your chats with Soumaya.",
    items: [
      { icon: "💵", title: "Safe to Spend (the honest number)", body: "The Money tab (💵) opens on one hero number: Safe to Spend — your balance, minus what's reserved for bills due before your next expected income, minus your buffer, floored at $0. If bills outrun your balance it shows the real SHORTFALL explicitly instead of a misleading positive number. It's Zero-AI: plain deterministic math over what you've actually entered, never a guess.", tags: ["money", "safe to spend", "budget", "balance", "shortfall", "buffer", "finance"], tryIt: { label: "💵 Open Money", action: { kind: "tab", value: "money" } } },
      { icon: "🧾", title: "Bills, income & expenses", body: "Add your recurring bills (name, amount, frequency, autopay) under 'Manage recurring bills' — they materialize into upcoming due-dates automatically. Log income and expenses with ＋ Income / － Expense, or open '🧾 View / edit history' to edit or delete anything you've recorded. Everything is integer cents under the hood so the math is always exact.", tags: ["bills", "income", "expense", "recurring", "history", "edit", "category"] },
      { icon: "📷", title: "Photo or paste to log money fast", body: "'📷 Take a photo' reads a bank text or receipt image and drafts income/expense entries for you to confirm — nothing commits until you approve it. Pasting bank text works the same way. It's the fastest way to log a batch of transactions without typing each one.", tags: ["snap", "screenshot", "photo", "paste", "import", "ocr", "vision", "receipt", "draft"] },
      { icon: "📄", title: "Pay Stubs — upload, don't just snap", body: "Open '📄 Pay Stubs' and use '📤 Upload a pay stub' to hand over the actual PDF you downloaded from your employer — it reads every line (gross, net, hours, taxes, and non-hourly pay like per-mile or a flat day-rate) and saves the original so you can view it again later. '📷 Take a photo' works for a paper stub or a screenshot. Everything is editable before you confirm, and a trend line shows your gross and net over time as you add more.", tags: ["pay stub", "paystub", "upload", "pdf", "extraction", "deductions", "earnings", "trend"] },
      { icon: "🧮", title: "What can I afford?", body: "Open '🧮 What can I afford?' in the Money tab, type a dollar amount (and optionally 'extra $/week' to model picking up more income), and it tells you how many weeks at your current pace — or honestly says you're not currently saving toward it if your weekly surplus can't get there. Fully offline, no AI — built on the same weekly-surplus math the budget itself uses.", tags: ["afford", "calculator", "weeks", "forecast", "surplus", "scenario", "save up"] },
      { icon: "📈", title: "Growth — your income & net worth over time", body: "Open '📈 Growth' for an animated line showing your income (paycheck plus self-employed/business, if you log any) and your net worth (cash plus whatever savings/investment/retirement accounts you add under '💰 Manage accounts'). It's entirely manual for now — no bank connections yet — so Soumaya will nudge you about once a week if the numbers go stale.", tags: ["growth", "net worth", "income", "chart", "trend", "assets", "savings", "investment", "self-employed"] },
      { icon: "🌌", title: "Money in the galaxy (Money sky)", body: "Your bills render as their own layer of stars in the 3D galaxy — the Money sky. Open it from the 🌌 Views button to see only your money stars, colour-coded by how soon they're due, without leaving the galaxy view.", tags: ["money sky", "bills", "galaxy", "views", "stars"] },
      { icon: "💬", title: "Soumaya knows your budget", body: "Ask her about money in chat (💬) and she answers from real numbers — your balance, what's reserved, your safe-to-spend, weekly surplus, your full recurring-bill list, and your top spending categories from the last 30 days — never invented figures. If you haven't touched the Money tab, she simply stays quiet about it.", tags: ["chat", "budget aware", "surplus", "categories", "soumaya", "grounded"] },
      { icon: "💸", title: "Bill-risk heads-up", body: "If your spending pace could leave you short for an upcoming non-autopay bill, Soumaya warns you BEFORE it happens — at most once a day, and it lands as an in-app toast (plus Telegram if you've linked it) so you see it either way.", tags: ["bill risk", "shortfall", "warning", "nudge", "autopay", "proactive"] },
      { icon: "🧭", title: "Linking money to a Journey", body: "Expand an income/expense row or a recurring bill and you'll find the same 🧭 Journey chips used on memories — link a transaction to the life chapter it belongs to (Rent → Home, Gas → Career). A strongly-matching Journey can even suggest itself; see the Journeys section for the full linking model.", tags: ["journey", "link", "chips", "budget", "connect"] },
    ]
  },
  {
    id: "journeys",
    title: "Journeys",
    icon: "🧭",
    desc: "The life chapter everything else connects through — memories, tasks and money, in one place.",
    items: [
      { icon: "🧭", title: "What a Journey is", body: "A Journey is a meaningful chapter of your life — 'Become an RN', 'Recover Financially', 'Buy My First Home'. Instead of asking 'where do I save this?', the question becomes 'what Journey does this move forward?'. Open the Journeys tab (🧭) to create one with a name and icon; a few common ones are suggested to start you off.", tags: ["journey", "journeys", "chapter", "life", "goal", "organize"], tryIt: { label: "🧭 Open Journeys", action: { kind: "tab", value: "journeys" } } },
      { icon: "🔗", title: "Linking memories, tasks and money to a Journey", body: "🧭 Journey chips appear on memories (Details), action items, and Money rows (income/expense/bills) — tap ＋ Add to attach one. Linking is HYBRID: a strongly-matching Journey can attach itself automatically with a quiet toast to let you know, a moderate match shows as a one-tap '✨ Suggested' chip, and you can always search the full list yourself. Nothing is ever silently removed — unlink with the × on any chip.", tags: ["journey", "link", "chips", "auto-link", "suggested", "hybrid"] },
      { icon: "📖", title: "A Journey's story so far", body: "Expand a Journey card to see everything connected to it in one place: linked memories and tasks (tap to fly there), linked transactions with a running '+earned / -spent' total, and a note for any linked recurring bills. It's the proof that a Journey is real connective tissue, not just a label.", tags: ["journey", "detail", "progress", "total", "earned", "spent", "linked"] },
      { icon: "📊", title: "Journey progress", body: "Drag a Journey's progress slider as you move forward, pause it, or mark it complete — completing one keeps its links intact (only the Journey's own status changes; nothing linked to it is touched).", tags: ["journey", "progress", "complete", "pause", "status"] },
    ]
  },
  {
    // Verb 1 (Tend a plot) — the game loop's Help home. Copy is verbatim
    // from the game-loop design of record
    // (~/workspace/soumaya-readonly-audit/GAME-LOOP-FOUR-VERBS-2026-10-26.md,
    // "Help menu" section). Only the two cards for the built verb are here:
    // the overview, and Tend. Resurface, Commission, and Relic cards come
    // with their verbs — they are designed, not built.
    id: "play",
    title: "🎮 Playing the game",
    icon: "🎮",
    desc: "Soumaya is a second brain first and a game second. These are the four things you can actually do inside the worlds — and what each one does to your real memories.",
    items: [
      { icon: "🎮", title: "The four verbs", body: "There are four things you can do inside the worlds. Tend a plot in Growing Place. Resurface a memory in Deep Past. Take a commission at the Station. Find a relic anywhere. Each one is a real action on your real memories — never just an animation. Do them in any order, or ignore them entirely; your brain works fine without them.", tags: ["verbs", "game", "play", "worlds", "tend", "resurface", "commission", "relic"] },
      { icon: "🌱", title: "Tend a plot", body: "In Growing Place, every plot is one of your memories and every path is a link between two. Soumaya suggests three plots that have gone quiet. Pick one and tend it: add a line, link it to another memory, or just sit with it. The plot warms and glows. Tending with an edit earns fuel like Mind work. Just visiting warms the plot but earns nothing — so looking is never farmed.", tags: ["tend", "garden", "growing place", "plot", "warm", "cooling", "fuel"], tryIt: { label: "🌱 Travel to Growing Place", action: { kind: "travel", value: "growing-place" } } },
    ]
  }
];

/** With 60+ cards across every category and zero way to act on any of them, the
 *  manual was pure reading with no bridge back into the app it's describing —
 *  even though the brain-toast-action event ChatDock's quick-tools already use
 *  was sitting right there. One representative jump per category closes that
 *  without fabricating 60 uncertain mappings. IM-131 (remainder) adds PER-CARD
 *  targets (HelpItem.tryIt) for every card that names a distinct reachable
 *  surface — e.g. the Lenses card opens Lenses, the Connections card opens
 *  Connections — while cards describing a nuance of a feature keep only the
 *  category jump. Categories describing passive concepts (camera controls,
 *  galaxy physics) have no single tab to jump to and are deliberately left
 *  without a button. */
const CATEGORY_TRY_IT: Record<string, { label: string; action: { kind: string; value?: string } }> = {
  start: { label: "➕ Dump a thought", action: { kind: "panel", value: "ingest" } },
  structure: { label: "📚 Open Browse", action: { kind: "tab", value: "list" } },
  talk: { label: "💬 Open chat", action: { kind: "chat" } },
  explore: { label: "✨ Open Insights", action: { kind: "tab", value: "insights" } },
  fleet: { label: "🛰️ Open Soumaya", action: { kind: "tab", value: "soumaya" } },
  hangar: { label: "🛠️ Open Hangar", action: { kind: "tab", value: "hangar" } },
  money: { label: "💵 Open Money", action: { kind: "tab", value: "money" } },
  journeys: { label: "🧭 Open Journeys", action: { kind: "tab", value: "journeys" } },
  // Verb 1: the game loop's category jump — the existing Journeys tab.
  play: { label: "🧭 Open Journeys", action: { kind: "tab", value: "journeys" } },
};

/** Hoisted to module scope — this was a template literal recreated inline
 *  on every render (a new ~200-line string on every keystroke in the search
 *  box), even though it's pure static CSS with no interpolation. */
const HELP_CSS = `
        .help-overlay {
          padding: 24px;
        }
        .help-search-box {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          display: flex;
          align-items: center;
          padding: 6px 12px;
          margin-bottom: 20px;
          position: relative;
        }
        .help-search-input {
          border: none;
          background: transparent;
          color: white;
          flex: 1;
          outline: none;
          font-size: 14px;
          padding: 6px 0;
        }
        .help-search-input::placeholder {
          color: var(--muted);
          opacity: 0.6;
        }
        .help-search-clear {
          background: transparent;
          border: none;
          color: var(--muted);
          font-size: 18px;
          cursor: pointer;
          padding: 0 4px;
        }
        .help-layout {
          display: flex;
          flex: 1;
          overflow: hidden;
          gap: 20px;
        }
        .help-sidebar {
          width: 240px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          padding-right: 15px;
          overflow-y: auto;
        }
        .help-tab-btn {
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          color: var(--muted);
          text-align: left;
          padding: 10px 14px;
          font-size: 13.5px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .help-tab-btn:hover {
          background: rgba(255, 255, 255, 0.04);
          color: var(--text);
        }
        .help-tab-btn.active {
          background: rgba(100, 200, 255, 0.08);
          border-color: rgba(100, 200, 255, 0.25);
          color: var(--accent);
          font-weight: 500;
        }
        .help-content-scroll {
          flex: 1;
          overflow-y: auto;
          padding-right: 8px;
        }
        .help-category-header {
          margin: 0 0 15px 0;
        }
        .help-category-header h3 {
          margin: 0 0 4px 0 !important;
          font-size: 16px !important;
          color: var(--text) !important;
          text-transform: none !important;
          letter-spacing: normal !important;
        }
        .help-category-desc {
          margin: 0;
          font-size: 12.5px;
          color: var(--muted);
          line-height: 1.4;
        }
        .help-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
          padding-bottom: 20px;
        }
        .help-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 14px;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .help-card:hover {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.08);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
        }
        .help-card-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .help-card-icon {
          font-size: 16px;
          background: rgba(255, 255, 255, 0.04);
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .help-card-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text);
          margin: 0;
        }
        .help-card-body {
          font-size: 12px;
          color: #d7d4ee;
          line-height: 1.45;
          margin: 0;
          flex-grow: 1;
        }
        .help-card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 10px;
        }
        .help-card-tag {
          font-size: 9px;
          background: rgba(100, 200, 255, 0.06);
          border: 1px solid rgba(100, 200, 255, 0.12);
          color: var(--accent);
          padding: 1.5px 5px;
          border-radius: 3px;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        .help-card-category-badge {
          align-self: flex-start;
          font-size: 9px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--muted);
          padding: 1.5px 5px;
          border-radius: 3px;
          margin-top: 10px;
        }
        @media (max-width: 768px) {
          .help-layout {
            flex-direction: column;
          }
          .help-sidebar {
            width: 100%;
            flex-direction: row;
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            padding-right: 0;
            padding-bottom: 8px;
            overflow-x: auto;
            white-space: nowrap;
          }
          .help-tab-btn {
            padding: 8px 12px;
            font-size: 12.5px;
          }
          .help-content-scroll {
            padding-top: 10px;
          }
        }
`;

export function HelpPanel({ onClose, installPrompt, onInstall }: Props) {
  const [activeTab, setActiveTab] = useState<string>("start");
  const [search, setSearch] = useState<string>("");

  // Collect search results if search is not empty
  const isSearchActive = search.trim().length > 0;
  const searchResults: { item: HelpItem; category: string }[] = [];

  if (isSearchActive) {
    const query = search.toLowerCase();
    CATEGORIES.forEach((cat) => {
      cat.items.forEach((item) => {
        const titleMatch = item.title.toLowerCase().includes(query);
        const bodyMatch = item.body.toLowerCase().includes(query);
        const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(query));
        if (titleMatch || bodyMatch || tagMatch) {
          searchResults.push({ item, category: cat.title });
        }
      });
    });
  }

  const selectedCategory = CATEGORIES.find((cat) => cat.id === activeTab);

  // Reading the manual was completely unrewarded despite activeTab already
  // tracking which categories you'd visited — nothing ever used that. Persist
  // the seen-set per space and celebrate ONLY the real completion transition
  // (never on a mount that already has every category seen from a prior visit).
  useEffect(() => {
    try {
      const spaceId = getSpaceId() ?? "legacy";
      const key = `brain.help.seen.${spaceId}`;
      const seen = new Set<string>(JSON.parse(localStorage.getItem(key) || "[]"));
      const wasComplete = seen.size >= CATEGORIES.length;
      seen.add(activeTab);
      localStorage.setItem(key, JSON.stringify([...seen]));
      if (!wasComplete && seen.size >= CATEGORIES.length) {
        // Batch H (REG-212 / CN-13, pass-21 C-09): reading the manual pays no
        // fuel and unlocks nothing — neutral confirmation, not the achievement
        // jingle, which is reserved for moments that actually pay or unlock.
        playSfx("complete");
        pushToast("📖 You've read the whole Pilot Manual! ✦", "📖", 5000);
      }
    } catch {
      /* storage unavailable */
    }
  }, [activeTab]);

  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogA11y(overlayRef, onClose);

  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-label="Galaxy Pilot Manual"
      ref={overlayRef}
      style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <style>{HELP_CSS}</style>

      <div className="help-head">
        <h2>Galaxy Pilot Manual</h2>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <p className="help-intro" style={{ marginBottom: "15px" }}>
        Welcome to your personal second brain. Your thoughts form a dynamic physical galaxy where semantic connections organize themselves, and stars glow hot or cool down over time.
      </p>

      {installPrompt && onInstall && (
        <div className="help-install-container" style={{ margin: "0 0 15px 0" }}>
          <button className="help-install-btn" onClick={onInstall}>
            📲 Install Second Brain App
          </button>
        </div>
      )}

      {/* Interactive Search */}
      <div className="help-search-box">
        <span style={{ fontSize: "14px", marginRight: "8px", opacity: 0.6 }}>🔍</span>
        <input
          type="text"
          className="help-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search pilot guide for terms (e.g. fuel, orbit, beacon, trail, hangar)..."
          aria-label="Search the pilot guide"
        />
        {isSearchActive && (
          <button className="help-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      {/* Interactive Main Area */}
      <div className="help-layout">
        {!isSearchActive && (
          <div className="help-sidebar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`help-tab-btn ${activeTab === cat.id ? "active" : ""}`}
                onClick={() => setActiveTab(cat.id)}
              >
                <span>{cat.icon}</span>
                {cat.title}
              </button>
            ))}
          </div>
        )}

        <div className="help-content-scroll">
          {isSearchActive ? (
            <div>
              <div className="help-category-header">
                <h3>Search Results ({searchResults.length})</h3>
                <p className="help-category-desc">
                  Showing matching topics for "{search}"
                </p>
              </div>

              {searchResults.length > 0 ? (
                <div className="help-cards-grid">
                  {searchResults.map(({ item, category }) => (
                    <div key={`${category}::${item.title}`} className="help-card">
                      <div>
                        <div className="help-card-header">
                          <span className="help-card-icon">{item.icon || "💡"}</span>
                          <h4 className="help-card-title">{item.title}</h4>
                        </div>
                        <p className="help-card-body">{item.body}</p>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        {item.tags && item.tags.length > 0 && (
                          <div className="help-card-tags">
                            {item.tags.slice(0, 2).map((t) => (
                              <span key={t} className="help-card-tag">{t}</span>
                            ))}
                          </div>
                        )}
                        <span className="help-card-category-badge">{category}</span>
                      </div>
                      {item.tryIt && (
                        <div style={{ marginTop: "10px" }}>
                          <button className="mini" onClick={() => fireTryIt(item.tryIt!)}>{item.tryIt.label}</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: "40px 0", display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
                  <p className="empty" style={{ margin: 0 }}>
                    No guides match "{search}". Try searching for keywords like "fuel", "trail", "Dyson", or "lock".
                  </p>
                  <button
                    className="mini"
                    // REG-188 (C-06): carry the searched text as the question —
                    // App seeds ChatDock's input with it instead of opening an
                    // empty chat the user must retype into.
                    onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "chat", value: search } }))}
                  >
                    💬 Ask Soumaya instead
                  </button>
                </div>
              )}
            </div>
          ) : (
            selectedCategory && (
              <div>
                <div className="help-category-header">
                  <h3>{selectedCategory.title}</h3>
                  <p className="help-category-desc">{selectedCategory.desc}</p>
                  {CATEGORY_TRY_IT[selectedCategory.id] && (
                    <button
                      className="mini"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("brain-toast-action", { detail: CATEGORY_TRY_IT[selectedCategory.id]!.action }),
                        )
                      }
                    >
                      {CATEGORY_TRY_IT[selectedCategory.id]!.label}
                    </button>
                  )}
                </div>

                <div className="help-cards-grid">
                  {selectedCategory.items.map((item) => (
                    <div key={item.title} className="help-card">
                      <div>
                        <div className="help-card-header">
                          <span className="help-card-icon">{item.icon || "💡"}</span>
                          <h4 className="help-card-title">{item.title}</h4>
                        </div>
                        <p className="help-card-body">{item.body}</p>
                      </div>
                      {item.tags && item.tags.length > 0 && (
                        <div className="help-card-tags">
                          {item.tags.slice(0, 3).map((t) => (
                            <span key={t} className="help-card-tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.tryIt && (
                        <div style={{ marginTop: "10px" }}>
                          <button className="mini" onClick={() => fireTryIt(item.tryIt!)}>{item.tryIt.label}</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
