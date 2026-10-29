import { logDiagnosticEvent } from "./diagnostics/buffer";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties } from "react";
import type { GraphData, GraphNode, Fuel, Streak, AwayDigest, UnlockableItem, UnlockStats } from "@brain/shared";
import { CELESTIAL_CLASSES, CELESTIAL_LABEL, COOLING_ENTROPY, WORLDS_TRAVEL_ENABLED } from "@brain/shared";
// Pure presentational helpers live in App.helpers.ts (Post-MVP D4 split).
import { focusItemStyle, songDotStyle, getFigurineIcon, getFigurineLabel, mergeGraphData, resolveFocusNode, billNotificationKey, hasLoggedToday, fanLayout, fanWindow, fanDownBottomPx, fanTargetCaption, galaxyEntityToastText, hudChromeHidden, shieldSavedToastText, measureSafeBottomInset } from "./App.helpers.js";
import { useSpaceTimeZone } from "./utils/spaceTimezone.js";
import { foresightChipText, flashbackLoreLine } from "./components/cl1a.helpers.js";

import { type Graph3DHandle, type FleetStatus } from "./graph/Graph3D.js";
// Lazy-load the 3D galaxy so three.js (~600 kB) isn't in the initial bundle — the
// login/shell + lite mode render without it (Post-MVP Phase 11 code-split). It only
// downloads once the galaxy actually mounts (gated by `galaxyWillMount`).
const Graph3D = lazy(() => import("./graph/Graph3D.js").then((m) => ({ default: m.Graph3D })));
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { makeAmbientAudio, TRACKS, type AmbientAudio } from "./graph/audio.js";
import { setGraphicsMode, resolveGraphics, getGraphics } from "./graph/graphicsConfig.js";
import { IngestPanel } from "./components/IngestPanel.js";
import { Observatory } from "./components/Observatory.js";
import { ChatDock } from "./components/ChatDock.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ConnectionsPanel } from "./components/ConnectionsPanel.js";
import { TimelineView } from "./components/TimelineView.js";
import { FuelEarnSheet, type EarnKind } from "./components/FuelEarnSheet.js";
import { ReviewPanel } from "./components/ReviewPanel.js";
import { getDueReviews } from "./api/client.js";
import { FuelGauge } from "./components/FuelGauge.js";
import { StreakEmber } from "./components/StreakEmber.js";
import { SearchBox, type SearchSession } from "./components/SearchBox.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { isCaptureShortcut, isPaletteShortcut, isTextEntryTarget, parseShareLanding } from "./lib/quickCapture.js";
import type { PaletteCommand } from "./lib/commandPalette.js";
import { RightDock, type DockTab } from "./components/RightDock.js";
import { HelpPanel } from "./components/HelpPanel.js";
import { WealthFullscreen } from "./components/WealthFullscreen.js";
import { FinanceFullscreen } from "./components/FinanceFullscreen.js";
import { Legend } from "./components/Legend.js";
import { WelcomeIntro } from "./components/WelcomeIntro.js";
import { LensesPanel } from "./components/LensesPanel.js";
import { GalaxyViews } from "./components/GalaxyViews.js";
import { GalaxyErrorCard } from "./components/GalaxyErrorCard.js";
import TravelPanel from "./components/TravelPanel.js";
import ToursPanel from "./components/ToursPanel.js";
import ApprovalsInbox from "./components/ApprovalsInbox.js";
import WorldChangesView from "./components/WorldChangesView.js";
import WorldsSurface from "./components/WorldsSurface.js";
import WorldMap from "./components/WorldMap.js";
import TravelSheet from "./components/TravelSheet.js";
import { getMoneySky } from "./api/finance.js";
import { galaxyEntity, galaxyEntityKindFromRef } from "./api/graph.js";
import { MindSpace } from "./components/MindSpace.js";
import { NoticingCard } from "./components/NoticingCard.js";
import { playSfx, sfxEnabled } from "./graph/sfx.js";
import { isVoiceEnabled } from "./voice.js";
import {
  AudioStateChip,
  BeaconReadout,
  ShipStatusStack,
  EmptyGalaxyCue,
  SceneIdentityCard,
  VisitorChip,
  useShipStatusOpen,
} from "./components/GalaxyHud.js";
import type { SceneIdentity } from "./graph/sceneIdentity.js";
import { triggerHaptic } from "./graph/haptics.js";
import { createChirpScheduler, playRadioChirp } from "./graph/adaptiveAudio.js";
import { deriveCoolingConcern, connectionReaction } from "./lib/coolingConcern.js";
import { useCountUp } from "./hooks/useCountUp.js";
import { usePolledCount } from "./hooks/usePolledCount.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { Toasts, pushToast, cleanupNotifications, setToastsPaused, setToastsQuiet, type ToastAction } from "./components/Toasts.js";
import { PerfHUD } from "./components/PerfHUD.js";
import { setFocusCalm } from "./graph/motion.js";
import { ACHIEVEMENTS, unlockedIds, loadUnlocked, recordUnlocked } from "./components/achievements.js";
import { pilotRank } from "./components/rank.js";
import { buildCodex, codexProgress, fieldNoteEntries } from "./components/codex.js";
import {
  buildUnlockStats,
  firstAlwaysUnlockedTrackIndex,
  firstUnlockedTrackIndex,
  isTrackAlwaysUnlocked,
  isTrackUnlocked,
  lockedTrackNotes,
  nextAlwaysUnlockedTrackIndex,
  nextUnlockedTrackIndex,
  readDevUnlockAll,
  trackLocked,
  unlockableForTrack,
} from "./components/unlockables.js";
import { useUnlockWatcher } from "./hooks/useUnlockWatcher.js";
import { useCodexDiscoveryClaims } from "./components/useCodexDiscoveryClaims.js";
import { useCelebrationQueue } from "./hooks/useCelebrationQueue.js";
import { UnlockCelebration } from "./components/UnlockCelebration.js";
import { ObjectLoreCard } from "./components/ObjectLoreCard.js";
import { NotificationsBar } from "./components/NotificationsBar.js";
import { NavRail } from "./components/NavRail.js";
import { ToolsMenu } from "./components/ToolsMenu.js";
import { ActionRail } from "./components/ActionRail.js";
import {
  currentSpace,
  getGraph,
  getGraphWithCompletion,
  getHealth,
  getFuel,
  getStreak,
  getDigest,
  getAwayDigest,
  markAwaySeen,
  getAgentLogs,
  getDailyContact,
  getBeliefs,
  flushIngestQueue,
  logoutSpace,
  onAiActivity,
  tendNode,
  getCandidates,
  burnFuel,
  getCodexDiscoveries,
  type AgentDiscovery,
  type Health,
  type ProactiveContext,
  type ProactiveContextSource,
} from "./api/client.js";

type Panel = "search" | "ingest" | "dock" | null;

// Phase Y/Z: which `tool:*` agent-log actions carry a Proactive → Chat handoff, and what
// `ProactiveContextSource` each maps to. Adding a future third source is exactly one more
// entry here — no new dispatch code, no new framework.
const PROACTIVE_TOAST_SOURCE: Record<string, ProactiveContextSource> = {
  "tool:goal_trend": "goal_trend",
  "tool:bill_risk": "bill_risk",
};

export default function App() {
  const renderCount = useRef(0);
  renderCount.current++;
  useEffect(() => {
    logDiagnosticEvent('event', 'App', { action: 'mount', render: renderCount.current });
    return () => logDiagnosticEvent('event', 'App', { action: 'unmount' });
  }, []);
  // Audit-2 item 2: kick off the space-timezone load at boot and re-render
  // when the configured zone arrives — every day derivation below (bill
  // notification keys, streak "logged today", and all spaceLocalDay
  // defaults via utils/spaceTimezone.ts) follows the SPACE's zone.
  const spaceTimeZone = useSpaceTimeZone();
  const [space, setSpace] = useState<{ id: string; name: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  // Several panels can request a graph refresh at once. Only the response from the
  // newest request may update state; otherwise an older response can arrive last and
  // overwrite a just-completed ingest/edit with stale data.
  const graphRefreshSequenceRef = useRef(0);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  // Fuel on the main HUD (was buried in the Soumaya tab) — polled while signed in.
  const [fuel, setFuel] = useState<Fuel | null>(null);
  // Batch I (REG-067 / GH-09): whether the fuel load has FAILED. The
  // gauge keeps the last known value while offline, but when fuel has
  // never arrived the gauge must say the load failed (with a retry),
  // not render nothing at all.
  const [fuelError, setFuelError] = useState(false);
  const retryFuel = useCallback(() => {
    setFuelError(false);
    void getFuel()
      .then((f) => {
        setFuel(f);
        setFuelError(false);
      })
      .catch(() => setFuelError(true));
  }, []);
  const [fuelPops, setFuelPops] = useState<{ id: number; text: string; spend?: boolean }[]>([]);
  const prevFuelRef = useRef<number | null>(null);
  // Daily-tending streak (flame on the HUD + Awards tab) — polled while signed in.
  const [streak, setStreak] = useState<Streak | null>(null);
  // Floating chat with Soumaya (opened by the 💬 FAB).
  const [showChat, setShowChat] = useState(false);
  // Phase Y/Z: one-shot proactive → Chat handoff. Set only from a real toast click
  // (`kind:"chat"` action carrying `"<source>:<id>"`), consumed by ChatDock on the
  // very next message it actually sends, then cleared — never replayed, never
  // persisted, never inferred from anything the user typed.
  const [pendingProactiveContext, setPendingProactiveContext] = useState<ProactiveContext | null>(null);
  // Phase AC.1: one-shot Journey-scoped Chat handoff — mirrors pendingProactiveContext
  // exactly, just keyed by a Journey id instead of a proactive source. Set only from a
  // real "Ask Soumaya about this" click in JourneysPanel; consumed by ChatDock on the
  // very next message it actually sends, then cleared.
  const [pendingJourneyId, setPendingJourneyId] = useState<number | null>(null);
  // REG-159/JN-01: the armed journey's title, carried alongside its id so the
  // chat banner can NAME the scope (an id alone names nothing on screen).
  const [pendingJourneyTitle, setPendingJourneyTitle] = useState<string | null>(null);
  // REG-159/JN-01: the armed journey context dies with the chat — every path
  // that hides the dock (×, Escape, FAB toggle, quick-tool navigation) flows
  // through showChat going false, so disarm here, once, instead of hunting
  // each close call site. An unrelated question later must never silently
  // inherit a stale journey scope.
  useEffect(() => {
    if (!showChat) {
      setPendingJourneyId(null);
      setPendingJourneyTitle(null);
    }
  }, [showChat]);
  const [showWealthFullscreen, setShowWealthFullscreen] = useState(false);
  const [showFinanceFullscreen, setShowFinanceFullscreen] = useState(false);
  const [chatPulse, setChatPulse] = useState(false); // she's hailing — pulse the FAB
  const hailedRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showFuelWays, setShowFuelWays] = useState(false);
  const [showReview, setShowReview] = useState(false);
  // The world map overlay (Rev 116) and the world it should focus the
  // travel panel on when the map hands the traveller over.
  const [showWorldMap, setShowWorldMap] = useState(false);
  const [travelFocus, setTravelFocus] = useState<string | null>(null);
  // The travel sheet: the worlds panels' one positioned home. Every way in
  // (Tools → Travel, the map's handoff, a Try-It "travel" action) goes
  // through openTravel, so no entry point can set a focus the traveller
  // never sees. Opening from Tools passes no world and clears a stale one.
  const [showTravel, setShowTravel] = useState(false);
  const openTravel = useCallback((world: string | null = null) => {
    setTravelFocus(world);
    setShowTravel(true);
  }, []);
  // A full-screen "rank up" celebration moment (not just a quiet toast).
  const [rankUp, setRankUp] = useState<{ title: string; level: number } | null>(null);
  // The "🔓 Unlocked!" celebration moment for the Unlockables system (IM-133).
  // A QUEUE (REG-178/HN-04): several items routinely unlock in one
  // evaluation, and a single slot collapsed them to the last item's card.
  // Every item now gets its moment in unlock order; dismissing the head
  // reveals the next.
  const {
    current: unlockMoment,
    enqueue: enqueueUnlockMoment,
    dismissCurrent: dismissUnlockMoment,
  } = useCelebrationQueue();
  const [awayDigest, setAwayDigest] = useState<AwayDigest | null>(null);
  // The Observatory home overlay — fades in once, after the cinematic fly-in settles.
  const [showObs, setShowObs] = useState(false);
  // Phase M first-launch framing (docs/specs/soumaya-product-audit.md) — a single, one-time
  // "what is Soumaya / the companion / the Galaxy" card, shown before the Observatory/Legend
  // reveals so a genuinely new space doesn't stack three separate "welcome" surfaces at once.
  const [showIntro, setShowIntro] = useState(false);
  // Deep-space calm mode (#2): a distraction-free reading session — dims the chrome,
  // calms ambient motion, and quiets non-essential toasts. Ephemeral (not persisted).
  const [focusMode, setFocusMode] = useState(false);
  const focusModeSeenRef = useRef(false);
  useEffect(() => {
    // IM-15: announce focus-mode entry/exit (it used to change silently).
    if (!focusModeSeenRef.current) { focusModeSeenRef.current = true; return; }
    pushToast(
      focusMode ? "Calm mode on — the chrome has dimmed for a calm read. Toggle it in Tools to exit." : "Calm mode off — welcome back.",
      "🎯",
      3500,
      focusMode ? "high" : "normal",
    );
  }, [focusMode]);
  useEffect(() => {
    setFocusCalm(focusMode);
    setToastsQuiet(focusMode);
  }, [focusMode]);
  const obsShownRef = useRef(false);
  // True once we're past the Observatory gate (it was shown+closed, or won't show).
  // Until then, toasts are buffered so a celebration never hides behind the cards.
  const [obsSettled, setObsSettled] = useState(false);
  const [tab, setTab] = useState<DockTab>("details");
  // Galaxy entity detail focus (Phase O): a one-shot "open this entity's existing
  // domain panel and scroll to it" request. `nonce` is bumped on every click (even a
  // repeat click on the same entity) so the receiving panel's effect always re-fires,
  // without needing the panel to report back that it "consumed" the request.
  const [focusJourney, setFocusJourney] = useState<{ id: number; nonce: number } | null>(null);
  const [focusGoal, setFocusGoal] = useState<{ id: number; nonce: number } | null>(null);
  // Phase AC.1: same pattern for a Bill clicked in the Money Sky — closes the one
  // remaining Galaxy click-through gap (Goal/Journey already had this).
  const [focusBill, setFocusBill] = useState<{ id: number; nonce: number } | null>(null);
  const focusNonceRef = useRef(0);

  // Hangar system equipped states
  const [equippedShip, setEquippedShip] = useState<string>("default");
  const [equippedTrail, setEquippedTrail] = useState<string>("blue");
  // Trail preview (REG-181/HN-07): a transient, never-persisted trail
  // override so the Hangar can show a trail in the galaxy before equip.
  // Cleared by any equip, by a space change, or by Stop preview.
  const [previewTrail, setPreviewTrail] = useState<string | null>(null);
  const [equippedFig1, setEquippedFig1] = useState<string>("none");
  const [equippedFig2, setEquippedFig2] = useState<string>("none");
  const [showFocusFig1, setShowFocusFig1] = useState<boolean>(true);
  const [showFocusFig2, setShowFocusFig2] = useState<boolean>(true);

  // Load equipped customizations when the space changes
  useEffect(() => {
    if (!space) return;
    const shipKey = `brain.hangar.ship.${space.id}`;
    const trailKey = `brain.hangar.trail.${space.id}`;
    const fig1Key = `brain.hangar.fig1.${space.id}`;
    const fig2Key = `brain.hangar.fig2.${space.id}`;
    const focusFig1Key = `brain.hangar.focusFig1.${space.id}`;
    const focusFig2Key = `brain.hangar.focusFig2.${space.id}`;

    setEquippedShip(localStorage.getItem(shipKey) || "default");
    setEquippedTrail(localStorage.getItem(trailKey) || "blue");
    setPreviewTrail(null); // a preview never survives a space change
    setEquippedFig1(localStorage.getItem(fig1Key) || "none");
    setEquippedFig2(localStorage.getItem(fig2Key) || "none");
    setShowFocusFig1(localStorage.getItem(focusFig1Key) !== "false");
    setShowFocusFig2(localStorage.getItem(focusFig2Key) !== "false");

    // Clean up expired notifications on space load
    cleanupNotifications(space.id);
  }, [space]);

  // Poll fuel for the main-HUD gauge while signed in.
  useEffect(() => {
    if (!space) return;
    let alive = true;
    const load = () => {
      void getFuel().then((f) => {
        if (alive) {
          setFuel(f);
          setFuelError(false);
        }
      }).catch(() => {
        // Retain the last known gauge value while offline — but if fuel
        // has never arrived, the gauge must say the load failed (REG-067).
        if (alive) setFuelError(true);
      });
      void getStreak().then((s) => {
        if (alive) setStreak(s);
      }).catch(() => {
        /* retain the last known streak while offline */
      });
    };
    load();
    const iv = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [space]);

  // Fuel tracking for visual pops
  useEffect(() => {
    if (fuel === null) {
      prevFuelRef.current = null;
      return;
    }
    if (prevFuelRef.current !== null) {
      const diff = fuel.fuel - prevFuelRef.current;
      // Spends pop too — an economy the player never sees going DOWN reads as a
      // meter, not a resource. (Passive regen trickles under the threshold.)
      if (Math.abs(diff) > 0.05) {
        const rounded = Math.round(diff * 10) / 10;
        const text = `${rounded > 0 ? "+" : ""}${rounded}`;
        const id = Date.now() + Math.random();
        setFuelPops((prev) => [...prev, { id, text, spend: rounded < 0 }]);
        window.setTimeout(() => {
          setFuelPops((prev) => prev.filter((p) => p.id !== id));
        }, 1600);
      }
    }
    prevFuelRef.current = fuel.fuel;
  }, [fuel?.fuel]);

  const [panel, setPanel] = useState<Panel>(null);
  const [loaded, setLoaded] = useState(false);
  // IM-142: ⌘K command palette visibility (global keydown effect below).
  const [showPalette, setShowPalette] = useState(false);
  // IM-141: one-shot Ingest prefill from a PWA share-target landing. `nonce`
  // keys the panel so a share arriving while capture is already open still
  // remounts it with the shared text; cleared when the panel closes.
  const [ingestSeed, setIngestSeed] = useState<{ text: string; nonce: number } | null>(null);
  // REG-187 (SP-04): the search session, held above the panel switch so a
  // search survives choosing a hit (which unmounts Search) and returning.
  const [searchSession, setSearchSession] = useState<SearchSession | null>(null);
  // REG-188 (SP-05): a seed question carried in from a zero-results escape
  // hatch — the exact text already typed, prefilled in ChatDock instead of
  // making the user retype it. Cleared when Chat closes.
  const [chatSeed, setChatSeed] = useState<{ text: string; nonce: number } | null>(null);
  // Startup recovery: set when initialization fails/stalls so we show a recovery
  // screen (Retry / Performance Mode / Diagnostics) instead of freezing on the sun.
  const [initError, setInitError] = useState<null | "timeout" | "error">(null);
  // LITE MODE: run the whole app WITHOUT the 3D galaxy. An escape hatch for when the
  // WebGL scene can't render on a device/brain (it must never hold the app hostage).
  // Reachable instantly via ?lite=1, and remembered. This is opt-in, not a global
  // downgrade — everyone else still gets the full galaxy.
  const [lite, setLite] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.has("lite")) {
        const on = q.get("lite") !== "0";
        localStorage.setItem("brain.lite", on ? "1" : "0");
        return on;
      }
      return localStorage.getItem("brain.lite") === "1";
    } catch {
      return false;
    }
  });
  const [showDiag, setShowDiag] = useState(false);
  const [perfSuggest, setPerfSuggest] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [aiBusy, setAiBusy] = useState(0);
  const [music, setMusic] = useState(false);
  const [musicTrack, setMusicTrack] = useState<{ title: string; index: number; total: number } | null>(null);
  const [nowPlayingVisible, setNowPlayingVisible] = useState(false); // the name popup fades out
  const [songMenuOpen, setSongMenuOpen] = useState(false); // radial song dots around the FAB
  const musicClickTimer = useRef<number | null>(null);
  const musicLongPress = useRef<number | null>(null);
  const musicSuppressClick = useRef(false);
  // Unlockables gate for the music callbacks below (IM-133): the callbacks are
  // stable useCallbacks defined before unlockStats is computed, so they read
  // the current gate through this ref (assigned during render, like flybyDataRef).
  const unlockGateRef = useRef<{ stats: UnlockStats | null; devUnlockAll: boolean }>({
    stats: null,
    devUnlockAll: false,
  });
  const nowPlayingTimer = useRef<number | null>(null);
  const [followShip, setFollowShip] = useState(false);
  const [followStation, setFollowStation] = useState(false);
  const [followSatellite, setFollowSatellite] = useState(false);
  const [satelliteCount, setSatelliteCount] = useState(0);
  const [visitorCount, setVisitorCount] = useState(0);
  const [followVisitor, setFollowVisitor] = useState(false);
  const [followFleet, setFollowFleet] = useState(false);
  const [followFig1, setFollowFig1] = useState(false);
  const [followFig2, setFollowFig2] = useState(false);
  // CL-1b shell HUD (IM-19/20/21): live scene identity + beacon readout +
  // audio state, polled from the Graph3D handle — the data already exists in
  // the scene; these overlays surface it where the scene is seen.
  const [fleetStatusHud, setFleetStatusHud] = useState<FleetStatus | null>(null);
  const [sceneIdentity, setSceneIdentity] = useState<SceneIdentity | null>(null);
  const [activeVisitors, setActiveVisitors] = useState<
    { variantName: string; targetId: number | null; targetLabel: string | null }[]
  >([]);
  const [sceneCardDismissed, setSceneCardDismissed] = useState(false);
  const [sfxOnHud, setSfxOnHud] = useState(sfxEnabled());
  const [voiceOnHud, setVoiceOnHud] = useState(isVoiceEnabled());
  const [settingsFocusAudio, setSettingsFocusAudio] = useState(false);
  const hudJsonRef = useRef("");
  useEffect(() => {
    if (!loaded) return;
    const poll = () => {
      const g = graphRef.current;
      if (!g) return;
      const next = {
        fleet: g.getFleetStatus(),
        identity: g.getSceneIdentity(),
        visitors: g.getActiveVisitors(),
        sfx: sfxEnabled(),
        voice: isVoiceEnabled(),
      };
      const json = JSON.stringify(next);
      if (json === hudJsonRef.current) return; // no visible change — skip the re-render
      hudJsonRef.current = json;
      setFleetStatusHud(next.fleet);
      setSceneIdentity(next.identity);
      setActiveVisitors(next.visitors);
      setSfxOnHud(next.sfx);
      setVoiceOnHud(next.voice);
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [loaded]);
  // A fresh follow (visitor/fleet) re-arms its identity card after a dismiss.
  useEffect(() => {
    if (followVisitor || followFleet) setSceneCardDismissed(false);
  }, [followVisitor, followFleet]);
  // Money urgency → a clickable notification (bills with due dates + risk). Once per bill per
  // day; taps open the Money tab. Re-checked whenever finances change.
  useEffect(() => {
    if (!space) return;
    const check = async () => {
      const stars = await getMoneySky();
      if (!stars) return;
      const urgent = stars.filter((s) => s.state === "overdue" || s.state === "cooling").slice(0, 2);
      for (const s of urgent) {
        const key = billNotificationKey(s.id, new Date(), spaceTimeZone);
        try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, "1"); } catch { /* ignore */ }
        const word = s.state === "overdue" ? `${s.label} is overdue` : `${s.label} needs attention — you can't cover it yet`;
        pushToast(`${word}`, "💸", 9000, "high", { kind: "tab", value: "money" });
      }
    };
    void check();
    const on = () => void check();
    window.addEventListener("brain-finance-changed", on);
    return () => window.removeEventListener("brain-finance-changed", on);
  }, [space, spaceTimeZone]);

  // Make dream cycles VISIBLE: on return, if Soumaya consolidated a new belief while you were
  // away, surface a gentle clickable notification → tap to fly to the belief. (She used to do
  // this silently, so it felt like nothing was happening.)
  useEffect(() => {
    if (!space) return;
    getAgentLogs().then((logs) => {
      const dream = logs.find((l) => l.action === "dream"); // newest first
      if (!dream) return;
      let lastId = 0;
      try { lastId = parseInt(localStorage.getItem("notif.lastDreamLogId") || "0", 10) || 0; } catch { /* ignore */ }
      if (dream.id <= lastId) return;
      try { localStorage.setItem("notif.lastDreamLogId", String(dream.id)); } catch { /* ignore */ }
      let beliefId: number | undefined;
      try { const t = JSON.parse(dream.targets); if (Array.isArray(t)) beliefId = Number(t[0]); } catch { /* ignore */ }
      pushToast(`🌙 ${dream.description}`, "🌙", 10000, "normal", beliefId ? { kind: "focus", value: beliefId } : undefined);
    }).catch(() => {});
  }, [space]);

  // Following any other target clears the fleet button's highlight (its own button clears theirs).
  useEffect(() => {
    if (followShip || followStation || followSatellite || followVisitor || followFig1 || followFig2)
      setFollowFleet(false);
  }, [followShip, followStation, followSatellite, followVisitor, followFig1, followFig2]);
  // Lore card dismissed independently of the camera follow (× closes the card but
  // keeps focus). Reset to false whenever a new focus target is chosen.
  const [loreDismissed, setLoreDismissed] = useState(false);
  // Show Soumaya's current task on a floating label above her ship. Persisted
  // PER BRAIN like every other preference (the old global "ship.task" key leaked
  // the choice across spaces; it's kept as a one-time fallback).
  const [showShipTask, setShowShipTaskState] = useState(() => localStorage.getItem("ship.task") !== "0");
  useEffect(() => {
    if (!space) return;
    try {
      const v = localStorage.getItem(`ship.task.${space.id}`) ?? localStorage.getItem("ship.task");
      setShowShipTaskState(v !== "0");
    } catch {
      /* private mode */
    }
  }, [space?.id]);
  const setShowShipTask = useCallback(
    (v: boolean) => {
      setShowShipTaskState(v);
      try {
        localStorage.setItem(space ? `ship.task.${space.id}` : "ship.task", v ? "1" : "0");
      } catch {
        /* private mode */
      }
    },
    [space?.id],
  );
  // HUD round 3: the ship-status stack is SUMMONABLE — collapsed to a
  // one-line mini-bar until he brings it up, so the galaxy's centre is
  // his again. Open state persisted PER BRAIN (ship.status.<id>, the
  // useShipStatusOpen hook in GalaxyHud); the phone default is collapsed
  // after a one-time first-run expanded reveal, desktop starts expanded.
  const [shipStatusOpen, setShipStatusOpen] = useShipStatusOpen(space?.id ?? null);
  // Camera mode persists PER BRAIN like the ship-task label beside it
  // (REG-171/SF-06 — it used to be a plain useState, so a locked cockpit
  // camera silently returned to orbit on every reload). Same pattern as
  // showShipTask above: the old global "ship.view" key is the one-time
  // fallback for brains that predate the per-brain key.
  const [shipViewMode, setShipViewModeState] = useState<"orbit" | "cockpit">(() => {
    try {
      return localStorage.getItem("ship.view") === "cockpit" ? "cockpit" : "orbit";
    } catch {
      return "orbit";
    }
  });
  useEffect(() => {
    if (!space) return;
    try {
      const v = localStorage.getItem(`ship.view.${space.id}`) ?? localStorage.getItem("ship.view");
      setShipViewModeState(v === "cockpit" ? "cockpit" : "orbit");
    } catch {
      /* private mode */
    }
  }, [space?.id]);
  const setShipViewMode = useCallback(
    (v: "orbit" | "cockpit") => {
      setShipViewModeState(v);
      try {
        localStorage.setItem(space ? `ship.view.${space.id}` : "ship.view", v);
      } catch {
        /* private mode */
      }
    },
    [space?.id],
  );
  const [tasks, setTasks] = useState<any[]>([]);
  const handleReorderTasks = useCallback((newOrder: any[]) => {
    graphRef.current?.reorderTasks(newOrder);
    setTasks(newOrder);
  }, []);
  // Transient glow on the focus button when a NEW beacon launches (not constant).
  const [beaconPulse, setBeaconPulse] = useState(false);
  const prevSatRef = useRef(0);
  const [focusMenuOpen, setFocusMenuOpen] = useState(false);
  // Which page of focus targets the fan shows when it folds on a short
  // phone-portrait screen (Mobile HUD pass, S3) — always 0 (the only
  // page) whenever the fan fits unfolded.
  const [fanPage, setFanPage] = useState(0);
  // PR #89 follow-up: the fan cluster's CSS anchor rides
  // env(safe-area-inset-bottom) (index.css .focus-cluster) while
  // window.innerHeight — the height the fan model is fed — already
  // includes the gesture strip (viewport-fit=cover). The model's
  // header-clearance math is only true if it counts the REAL inset, so
  // it is measured (hidden env() probe, App.helpers) once per resize
  // and passed to fanLayout below. 0 on inset-free devices.
  const [safeBottomInset, setSafeBottomInset] = useState(0);
  useEffect(() => {
    const apply = () => setSafeBottomInset(measureSafeBottomInset());
    apply();
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);
  const [help, setHelp] = useState(false);
  // The visual legend (🗺️) — auto-shows ONCE per brain so new users learn the
  // galaxy's language, then it's a tap away whenever they forget.
  const [showLegend, setShowLegend] = useState(false);
  const [showLenses, setShowLenses] = useState(false);
  // True while the "Soumaya noticed" card is open — the object-lore card (same slot)
  // hides so the two never stack on top of each other.
  const [noticingOpen, setNoticingOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setNoticingOpen(!!(e as CustomEvent).detail);
    window.addEventListener("brain-noticing-open", on);
    return () => window.removeEventListener("brain-noticing-open", on);
  }, []);
  // The active Smart Lens (its name), shown as a dismissable banner while the galaxy is
  // isolated to it. Clearing it exits the isolated view.
  const [activeLens, setActiveLens] = useState<string | null>(null);
  // Batch H (REG-207/208 / CN-08/09): the banner states the lens's TRUE match
  // total, and how many the isolate actually shows when the match list itself
  // was capped. Null = no count known (e.g. an overlay layer).
  const [activeLensCount, setActiveLensCount] = useState<number | null>(null);
  const [activeLensShown, setActiveLensShown] = useState<number | null>(null);
  // Ambient Level-2 read on you (foresight or newest belief) shown as a HUD pill.
  const [selfInsight, setSelfInsight] = useState<{ kind: "foresight" | "belief"; text: string; inDays?: number } | null>(null);
  const [clustered, setClustered] = useState(false);
  const audioRef = useRef<AmbientAudio | null>(null);
  const graphRef = useRef<Graph3DHandle>(null);

  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const triggerInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  useEffect(() => onAiActivity(setAiBusy), []);

  // Living Galaxy (IM-140a): a completed task becomes a satellite in the
  // galaxy (spawned at its last position, before its node disappears).
  useEffect(() => {
    const onTaskCompleted = (e: Event) => {
      const id = (e as CustomEvent<{ id?: number }>).detail?.id;
      if (typeof id === "number") graphRef.current?.spawnTaskSatellite(id);
    };
    window.addEventListener("brain-task-completed", onTaskCompleted);
    return () => window.removeEventListener("brain-task-completed", onTaskCompleted);
  }, []);

  // Create the ambient audio on mount so the loop preloads/buffers before the
  // first 🔈 toggle (otherwise it lags on slow/mobile connections).
  useEffect(() => {
    if (!audioRef.current) audioRef.current = makeAmbientAudio();
  }, []);

  // Adaptive ambience (IM-135): the bed ducks with galaxy density and its
  // filter brightens/darkens with the galaxy's emotional state + cooling
  // share; while the music plays, sparse randomized radio chirps (20–60s)
  // keep the soundscape feeling alive. All parameter-driven from real graph
  // data — no fabricated state.
  const chirpSchedulerRef = useRef<ReturnType<typeof createChirpScheduler> | null>(null);
  useEffect(() => {
    if (!audioRef.current) audioRef.current = makeAmbientAudio();
    const nodes = data.nodes as GraphNode[];
    const memories = nodes.filter((n) => n.kind !== "action");
    const meanEmotion = memories.length
      ? memories.reduce((a, n) => a + (n.emotionalWeight ?? 0), 0) / memories.length
      : 0;
    const coolingFrac = memories.length
      ? memories.filter((n) => (n.entropy ?? 0) >= COOLING_ENTROPY).length / memories.length
      : 0;
    audioRef.current.setAdaptive({
      nodeCount: nodes.length,
      linkCount: data.links.length,
      meanEmotion,
      coolingFrac,
    });
    if (!chirpSchedulerRef.current) {
      chirpSchedulerRef.current = createChirpScheduler(() => playRadioChirp(Math.random() * 1.6 - 0.8));
    }
    if (music) chirpSchedulerRef.current.start();
    else chirpSchedulerRef.current.stop();
  }, [data.nodes, data.links, music]);

  // "While you were away" — on return, fetch what changed since the last visit. Show
  // the welcome-back card only after a real absence (≥1h) with something to say;
  // otherwise silently advance the window so a quick refresh never nags.
  useEffect(() => {
    if (!space) return;
    let alive = true;
    getAwayDigest()
      .then((d) => {
        if (!alive) return;
        if (d && !d.isEmpty && d.awayMs >= 3_600_000) setAwayDigest(d);
        else void markAwaySeen();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [space]);

  // UI sound kit: a soft "tap" on any button press, app-wide, from one delegated
  // listener (covers FABs, dock tabs, panels, mini buttons) — the AudioContext also
  // wakes here on the first gesture. Specific richer cues (toasts, save, delete,
  // welcome-back) are wired at their sources. All no-ops when SFX is disabled.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("button")) playSfx("tap");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Awareness: surface Soumaya's consequential decisions (research, merge, chart a
  // sector, write the log) as a toast + inbox entry, so you always know what she chose
  // to do — not just see it after the fact in her activity log.
  useEffect(() => {
    const onDecision = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; text?: string } | undefined;
      if (!d?.text) return;
      const icon =
        d.type === "research" ? "🔬" : d.type === "merging" ? "🧬" : d.type === "daily_log" ? "📖" : "🌌";
      pushToast(`Soumaya · ${d.text}`, icon, 6500);
    };
    window.addEventListener("brain-agent-decision", onDecision);
    return () => window.removeEventListener("brain-agent-decision", onDecision);
  }, []);

  const toggleMusic = useCallback(() => {
    if (!audioRef.current) audioRef.current = makeAmbientAudio();
    const a = audioRef.current;
    // Unlockables gate (IM-133): if the remembered track has since been
    // locked (or was never earned), start from the first unlocked track
    // instead of playing a locked loop. Deep Space is always unlocked.
    // Batch I (REG-065 / GH-07): while stats are still in flight, only
    // an `always` track may start — a possibly-locked remembered track
    // must not play before the gate has been evaluated.
    if (!a.playing) {
      const { stats, devUnlockAll: dev } = unlockGateRef.current;
      const ids = TRACKS.map((t) => t.id);
      if (stats) {
        if (!isTrackUnlocked(ids[a.index]!, stats, { devUnlockAll: dev })) {
          const first = firstUnlockedTrackIndex(ids, stats, { devUnlockAll: dev });
          if (first >= 0 && first !== a.index) {
            a.playTrack(first);
            setMusic(a.playing);
            return;
          }
        }
      } else if (!dev && !isTrackAlwaysUnlocked(ids[a.index]!)) {
        const first = firstAlwaysUnlockedTrackIndex(ids);
        if (first >= 0 && first !== a.index) {
          a.playTrack(first);
          setMusic(a.playing);
          return;
        }
      }
    }
    setMusic(a.toggle());
  }, []);
  const nextMusic = useCallback(() => {
    if (!audioRef.current) audioRef.current = makeAmbientAudio();
    const a = audioRef.current;
    // Unlockables gate (IM-133): skip advances only across UNLOCKED tracks.
    // Batch I (REG-065 / GH-07): while stats are in flight, only `always`
    // tracks are playable — the skip stays on Deep Space rather than
    // landing on a possibly-locked loop.
    const { stats, devUnlockAll: dev } = unlockGateRef.current;
    const ids = TRACKS.map((t) => t.id);
    if (stats) {
      const nxt = nextUnlockedTrackIndex(a.index, ids, stats, { devUnlockAll: dev });
      if (nxt !== a.index) {
        a.playTrack(nxt);
      } else if (!a.playing) {
        a.toggle(); // the current track is the only playable one — just start it
      }
      setMusic(a.playing);
      return;
    }
    if (dev) {
      a.next();
      setMusic(a.playing);
      return;
    }
    const nxt = nextAlwaysUnlockedTrackIndex(a.index, ids);
    if (nxt !== a.index) {
      a.playTrack(nxt);
    } else if (!a.playing) {
      a.toggle(); // the current track is the only playable one — just start it
    }
    setMusic(a.playing);
  }, []);
  const playSong = useCallback((i: number) => {
    // Unlockables gate (IM-133): a locked track never plays; say why instead.
    const track = TRACKS[i];
    const { stats, devUnlockAll: dev } = unlockGateRef.current;
    // Batch I (REG-065 / GH-07): while stats are still in flight, only
    // an `always` track may play — anything else waits for the gate.
    if (track && !dev && !stats && !isTrackAlwaysUnlocked(track.id)) {
      pushToast("Still checking what's unlocked — try again in a moment.", "⏳", 4000);
      setSongMenuOpen(false);
      return;
    }
    if (track && stats && !isTrackUnlocked(track.id, stats, { devUnlockAll: dev })) {
      const item = unlockableForTrack(track.id);
      pushToast(
        `🔒 ${track.title} is locked — ${item?.requirementText ?? "keep growing your galaxy to unlock it."}`,
        "🔒",
        6000,
      );
      setSongMenuOpen(false);
      return;
    }
    if (!audioRef.current) audioRef.current = makeAmbientAudio();
    audioRef.current.playTrack(i);
    setMusic(audioRef.current.playing);
    setSongMenuOpen(false);
  }, []);
  // Hangar "View in galaxy" (IM-96): close the dock and focus the ship /
  // station / figurine in the scene, reusing the focus cluster's own
  // follow toggles (forcing the ship on; the others toggle only when not
  // already followed, so a view request never unfocuses its target).
  const handleViewInGalaxy = useCallback(
    (target: "ship" | "station" | "fig1" | "fig2") => {
      setPanel(null);
      setLoreDismissed(false);
      setFollowSatellite(false);
      setFollowVisitor(false);
      if (target === "ship") {
        setFollowStation(false);
        setFollowFig1(false);
        setFollowFig2(false);
        setFollowShip(graphRef.current?.toggleFollowShip(true) ?? true);
      } else if (target === "station") {
        setFollowShip(false);
        setFollowFig1(false);
        setFollowFig2(false);
        setFollowStation(followStation ? true : (graphRef.current?.toggleFollowStation() ?? true));
      } else if (target === "fig1") {
        setFollowShip(false);
        setFollowStation(false);
        setFollowFig2(false);
        setFollowFig1(followFig1 ? true : (graphRef.current?.toggleFollowFig1() ?? true));
      } else {
        setFollowShip(false);
        setFollowStation(false);
        setFollowFig1(false);
        setFollowFig2(followFig2 ? true : (graphRef.current?.toggleFollowFig2() ?? true));
      }
    },
    [followStation, followFig1, followFig2],
  );
  // Hangar trail preview (REG-181/HN-07): apply the trail transiently
  // (never written to localStorage) and focus the ship so the trail is
  // seen in the galaxy. The dock closes, as with any View in galaxy —
  // the preview banner in the Hangar (on reopen) names the preview and
  // offers Stop preview / Equip to keep it.
  const handlePreviewTrail = useCallback(
    (value: string | null) => {
      setPreviewTrail(value);
      if (value) handleViewInGalaxy("ship");
    },
    [handleViewInGalaxy],
  );
  // Single click = play/pause; double click = next track (a short timer lets a
  // second click cancel the toggle so a double-click cleanly skips the song).
  // Long-press opens the radial song menu (handled by pointer handlers below).
  const onMusicClick = useCallback(() => {
    if (musicSuppressClick.current) {
      musicSuppressClick.current = false; // this click was the end of a long-press
      return;
    }
    if (musicClickTimer.current != null) {
      window.clearTimeout(musicClickTimer.current);
      musicClickTimer.current = null;
      nextMusic();
      return;
    }
    musicClickTimer.current = window.setTimeout(() => {
      musicClickTimer.current = null;
      toggleMusic();
    }, 240);
  }, [toggleMusic, nextMusic]);
  // Press-and-hold (~450ms) reveals the song dots circling the button.
  const onMusicPointerDown = useCallback(() => {
    musicLongPress.current = window.setTimeout(() => {
      musicLongPress.current = null;
      musicSuppressClick.current = true;
      setSongMenuOpen((v) => !v);
      playSfx("tap");
    }, 450);
  }, []);
  const onMusicPointerUp = useCallback(() => {
    if (musicLongPress.current != null) {
      window.clearTimeout(musicLongPress.current);
      musicLongPress.current = null;
    }
  }, []);

  // Now-playing cue: when the track changes, reveal the title chip, then FADE it out
  // after a few seconds (it used to sit on screen the whole time).
  useEffect(() => {
    const onTrack = (e: Event) => {
      const d = (e as CustomEvent<{ playing: boolean; index: number; title: string; total: number }>).detail;
      setMusicTrack({ title: d.title, index: d.index, total: d.total });
      if (d.playing) {
        setNowPlayingVisible(true);
        if (nowPlayingTimer.current != null) window.clearTimeout(nowPlayingTimer.current);
        nowPlayingTimer.current = window.setTimeout(() => setNowPlayingVisible(false), 4200);
      } else {
        setNowPlayingVisible(false);
      }
    };
    window.addEventListener("brain-music-track", onTrack);
    return () => {
      window.removeEventListener("brain-music-track", onTrack);
      if (nowPlayingTimer.current != null) window.clearTimeout(nowPlayingTimer.current);
    };
  }, []);

  // A banked nebula shield just forgave a missed day — celebrate the save gently so the
  // forgiving-streak mechanic is actually FELT (a broken streak is data, not punishment).
  useEffect(() => {
    // Batch I (REG-070 / GH-13): the toast explains what a shield
    // forgives — the StreakEmber's hover text is not the explanation.
    const onShield = () =>
      pushToast(shieldSavedToastText(), "🛡️", 7000, "normal", { kind: "tab", value: "awards" });
    window.addEventListener("brain-shield-saved", onShield);
    return () => window.removeEventListener("brain-shield-saved", onShield);
  }, []);

  const view = data;
  // Tweened HUD counters — ease instead of snapping (honors reduced-motion).
  const memCountShown = useCountUp(view.nodes.length);
  const streakShown = useCountUp(streak?.current ?? 0);

  // Streak stakes: is the streak alive but unfed TODAY? (drives the "at risk" ember)
  // "Today" is the SPACE's configured local day (owner rule 2026-10-21;
  // audit-2 item 2): a memory's createdAt is a stored instant, so
  // membership is derived from the instant in the space's timezone —
  // never its raw UTC string prefix, never the device zone.
  const loggedToday = useMemo(
    () => hasLoggedToday(data.nodes as GraphNode[], new Date(), spaceTimeZone),
    [data.nodes, spaceTimeZone],
  );
  const streakAtRisk = (streak?.current ?? 0) > 0 && !loggedToday;

  // Soumaya's flight speed grows as you use the brain: more memories + a live
  // streak make her a faster, more seasoned pilot (1.0 → ~1.9×). Distance-aware
  // cruising + her per-task speeds are handled in graph/soumaya.ts.
  const pilotSpeed = useMemo(() => {
    const mem = (view.nodes as GraphNode[]).filter((n) => n.kind !== "action" && n.kind !== "moc").length;
    const lvl = 1 + Math.min(0.7, mem / 200) + Math.min(0.2, (streak?.current ?? 0) / 20);
    return Math.round(lvl * 100) / 100;
  }, [view.nodes, streak]);

  const refresh = useCallback(async (newIds?: number[], fuelEarned?: number, linkCount?: number) => {
    const sequence = ++graphRefreshSequenceRef.current;
    try {
      console.info("[BOOT] loading graph");
      // D3: when ingest returns new ids, fetch them explicitly (chunked at the
      // server's per-request cap) and complete the edge set with a single
      // id-ordered cursor stream — new memories and their links always appear.
      // Default boot path is unchanged.
      const g = newIds && newIds.length > 0 ? await getGraphWithCompletion(newIds) : await getGraph();
      if (sequence !== graphRefreshSequenceRef.current) return;
      console.info(`[BOOT] graph received (${g.nodes.length} nodes)`);
      // Merge by node id instead of replacing wholesale (Galaxy render-stall root-cause
      // fix — see App.helpers.ts's mergeGraphData doc comment): three-forcegraph's own
      // node object cache keys nodes by raw object identity, so a fresh array of fresh
      // node objects on every refresh made every node look "new" and disposed/rebuilt
      // its entire Object3D + shared geometry/texture caches on every single refresh.
      setData((prev) => mergeGraphData(prev, g));
      setLoaded(true);
      logDiagnosticEvent('state', 'App.loaded', { loaded: true });
      setInitError(null);
      getFuel().then((f) => f && setFuel(f)).catch(() => {});
      // Let the proactive "she noticed…" card re-check (a fresh memory can form a
      // new structural connection worth a question, generated server-side on ingest).
      if (newIds && newIds.length > 0) window.dispatchEvent(new Event("brain-memory-added"));
      if (newIds && newIds.length > 0) {
        // Critical moment (audio audit): a memory was saved — pair it with a
        // haptic tap on mobile (IM-134; gated inside haptics.ts).
        triggerHaptic("memorySaved");
        // Give the graph a moment to render the new nodes before rippling them.
        setTimeout(() => {
          for (const id of newIds) graphRef.current?.spawnBurst(id, "user");
          // A warm amber sparkle on the new memory celebrates the fuel it earned.
          if (fuelEarned && fuelEarned > 0)
            for (const id of newIds) graphRef.current?.spawnBurst(id, "fuel");
        }, 150);
        // Gamification: celebrate the fuel earned with a toast (Wave 1).
        if (fuelEarned && fuelEarned > 0)
          pushToast(`+${Math.round(fuelEarned * 10) / 10} fuel earned`, "⛽");
        // Soumaya reacts to new connections in her own voice (Wave 3).
        // IM-139: she now speaks it in-world too — the speech bubble anchored
        // to her ship complements the toast.
        if (linkCount && linkCount > 0) {
          const reaction = connectionReaction(linkCount);
          if (reaction) {
            graphRef.current?.sayAsSoumaya(reaction);
            pushToast(`Soumaya: ${reaction.charAt(0).toLowerCase()}${reaction.slice(1)}`, "🛰️", 7000);
          }
        }
        // Then fly the camera to the new memory so you can SEE where it populated.
        setTimeout(() => {
          graphRef.current?.focusNode(newIds[0]!);
          setSelected(g.nodes.find((n) => n.id === newIds[0]) ?? null);
        }, 550);
      }
    } catch (err) {
      if (sequence !== graphRefreshSequenceRef.current) return;
      // A stalled/failed graph load no longer freezes the app — surface a recovery
      // screen. AbortError = our boot timeout tripped.
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      console.error(`[BOOT] graph load ${timedOut ? "timed out" : "failed"}:`, err);
      setInitError(timedOut ? "timeout" : "error");
      setLoaded(true);
    } finally {
      console.info("[BOOT] loaded complete");
    }
    getHealth()
      .then(setHealth)
      .catch(() => {});
  }, []);

  // If every beacon fades (its memory got tended) while we're watching one, the
  // beacon button vanishes — so release the follow + close its lore card too.
  useEffect(() => {
    if (followSatellite && satelliteCount === 0) {
      graphRef.current?.recenter();
      setFollowSatellite(false);
    }
  }, [satelliteCount, followSatellite]);

  // Pulse the focus button briefly only when a NEW beacon launches, then stop.
  useEffect(() => {
    if (satelliteCount > prevSatRef.current) {
      setBeaconPulse(true);
      const t = window.setTimeout(() => setBeaconPulse(false), 3600);
      prevSatRef.current = satelliteCount;
      return () => window.clearTimeout(t);
    }
    prevSatRef.current = satelliteCount;
  }, [satelliteCount]);

  // Release the visitor follow when the craft we're watching leaves.
  useEffect(() => {
    if (followVisitor && visitorCount === 0) {
      graphRef.current?.recenter();
      setFollowVisitor(false);
    }
  }, [visitorCount, followVisitor]);

  // Tell the index.html boot-failsafe we booted OK, so it stands down. "Booted" =
  // React mounted and the auth check finished (login screen OR the app is rendering).
  // NOT gated on the galaxy loading — that's a slower, separate step handled by the
  // in-app watchdog; gating the failsafe on it caused a spurious auto-reset loop on
  // slow galaxy loads.
  useEffect(() => {
    if (authChecked) {
      (window as unknown as { __brainBooted?: () => void }).__brainBooted?.();
    }
  }, [authChecked]);

  // FPS monitor: after a warm-up, sample the frame rate; if it stays rough and the
  // pilot isn't already in Performance Mode, OFFER (never force) a downgrade. Auto
  // Mode already picks a sane tier — this catches devices that still struggle.
  useEffect(() => {
    let frames = 0, t0 = performance.now(), lowStreak = 0, raf = 0, stopped = false;
    const sample = () => {
      frames++;
      const now = performance.now();
      if (now - t0 >= 2000) {
        const fps = (frames * 1000) / (now - t0);
        frames = 0;
        t0 = now;
        lowStreak = fps < 24 ? lowStreak + 1 : 0;
        if (lowStreak >= 3 && getGraphics().mode !== "performance") {
          setPerfSuggest(true);
          stopped = true;
          return;
        }
      }
      if (!stopped) raf = requestAnimationFrame(sample);
    };
    const warm = window.setTimeout(() => { raf = requestAnimationFrame(sample); }, 8000);
    return () => { window.clearTimeout(warm); cancelAnimationFrame(raf); };
  }, []);

  // Resolve the stored brain (if any) on first load.
  useEffect(() => {
    console.info("[BOOT] auth started");
    currentSpace()
      .then((sp) => {
        console.info(`[BOOT] auth finished (${sp ? "brain open" : "no brain"})`);
        logDiagnosticEvent('state', 'App.space', { action: 'load', spaceId: sp?.id });
        setSpace(sp);
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  // Load the galaxy once a brain is open.
  useEffect(() => {
    if (space) refresh();
  }, [space]);

  // Whether the 3D galaxy is about to mount this render (mirrors the JSX gate below).
  const galaxyWillMount = loaded && !lite;
  console.log("[App] galaxyWillMount:", galaxyWillMount, { loaded, lite });
  // Heal any stale "galaxy stuck" flag left by the earlier crash-loop breaker. That
  // safeguard existed only to survive the achievement-DFS freeze (now fixed at the
  // source); with the freeze gone it was misfiring on ordinary lag and hiding a
  // perfectly good galaxy behind a "try again" banner. Clear it on every load so no
  // one is stuck without their galaxy.
  const clearGalaxyStuck = useCallback(() => {
    try {
      localStorage.removeItem("brain.galaxyStuck");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    clearGalaxyStuck();
  }, [clearGalaxyStuck]);

  // Badge polls (via usePolledCount): the 🔗 Suggested-Connections count (refreshed on
  // ingest + when the panel closes) and the 🧠 due-recall count. Behaviour unchanged.
  const candCount = usePolledCount(() => getCandidates().then((d) => d.count), !!space, 60_000, {
    refreshEvent: "brain-memory-added",
    refreshKey: showConnections,
  });
  const dueCount = usePolledCount(() => getDueReviews().then((d) => d.length), !!space, 120_000, {
    refreshKey: showReview,
  });

  // Gamification (Wave 1): greet the pilot once per session when their galaxy
  // first loads — by name, with what changed while they were away.
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current || !space || !loaded) return;
    greetedRef.current = true;
    const memories = (data.nodes as GraphNode[]).filter((n) => n.kind !== "action");
    if (memories.length === 0) {
      pushToast(`Welcome, ${space.name}. Drop your first thought to begin.`, "🛰️", 10000);
      return;
    }
    const cooling = memories.filter((n) => (n.entropy ?? 0) >= COOLING_ENTROPY).length;
    const tail = cooling > 0 ? ` · ${cooling} cooling` : "";
    const word = memories.length === 1 ? "memory" : "memories";
    pushToast(`Welcome back, ${space.name} — ${memories.length} ${word}${tail}`, "🛰️", 10000);
  }, [space, loaded, data.nodes]);

  // Mass-cooling concern (IM-139): when a real crowd of memories is cooling
  // (deriveCoolingConcern — real entropy data only), Soumaya says so in her
  // in-world speech bubble, with a toast alongside. Once per distinct count
  // per session, so tending memories (or more cooling) can re-arm it, but a
  // steady state never nags.
  const coolingSpokenRef = useRef<number>(0);
  useEffect(() => {
    if (!loaded) return;
    const concern = deriveCoolingConcern(data.nodes as GraphNode[]);
    if (!concern.massCooling || !concern.message) return;
    if (coolingSpokenRef.current === concern.coolingCount) return;
    coolingSpokenRef.current = concern.coolingCount;
    graphRef.current?.sayAsSoumaya(concern.message);
    pushToast(`Soumaya: ${concern.message}`, "❄️", 9000);
  }, [loaded, data.nodes]);

  // (The old memory-count milestone toast is gone: Pilot Rank is the single
  // count ladder now — one celebration per threshold, not three.)

  // Gamification (Wave 3): pilot rank level-up — celebrate climbing a rank once
  // each, per brain. Same progression that speeds Soumaya up (real memory count).
  useEffect(() => {
    if (!space || !loaded) return;
    const real = (data.nodes as GraphNode[]).filter((n) => n.kind !== "action" && n.kind !== "moc").length;
    const rank = pilotRank(real);
    const key = `brain.rank.${space.id}`;
    let last = 0;
    try {
      last = parseInt(localStorage.getItem(key) || "0", 10) || 0;
    } catch {
      /* storage unavailable */
    }
    if (rank.level <= last) return;
    try {
      localStorage.setItem(key, String(rank.level));
    } catch {
      /* ignore */
    }
    // First eval on a device with an established brain shouldn't fire retroactively.
    if (last > 0) {
      playSfx("achievement");
      setRankUp({ title: rank.title, level: rank.level });
      graphRef.current?.celebrate(); // burst salvo around the Sun
      window.setTimeout(() => setRankUp(null), 4600);
    }
  }, [space, loaded, data.nodes]);

  // Gamification (Wave 1): celebrate when a memory GROWS a tier (asteroid→…→star)
  // as it earns mass over time — the payoff of the slow-growth model. The first
  // snapshot is silent (baseline); only later promotions toast (capped, planet+).
  const tierRef = useRef<Map<number, number>>(new Map());
  const tierInitedRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const idx = (c?: string) => Math.max(0, CELESTIAL_CLASSES.indexOf((c ?? "asteroid") as never));
    const planetIdx = CELESTIAL_CLASSES.indexOf("planet");
    const prev = tierRef.current;
    const next = new Map<number, number>();
    const ups: GraphNode[] = [];
    for (const n of data.nodes as GraphNode[]) {
      if (n.kind === "action") continue;
      const t = idx(n.celestial);
      next.set(n.id, t);
      const p = prev.get(n.id);
      if (tierInitedRef.current && p != null && t > p && t >= planetIdx) ups.push(n);
    }
    tierRef.current = next;
    tierInitedRef.current = true;
    for (const n of ups.slice(0, 2)) {
      const label = n.label.length > 30 ? `${n.label.slice(0, 30)}…` : n.label;
      pushToast(`"${label}" grew into a ${CELESTIAL_LABEL[n.celestial ?? "planet"]}`, "✦", 10000);
    }
  }, [data.nodes, loaded]);

  // Gamification (Wave 2): achievements — qualitative feats unlocked once each,
  // per brain, remembered on this device. Offline-safe (pure over loaded state).
  // The first pass after sign-in is silent (seeds already-earned ones) so we
  // don't spam a returning user with a backlog of toasts on every launch.
  const achvInitedRef = useRef(false);
  useEffect(() => {
    if (!space || !loaded) return;

    const memories = (data.nodes as GraphNode[]).filter((n) => n.kind !== "action");
    const linksCount = data.links.length;
    const linkObjects = data.links;
    // Seed "types seen" from the types actually IN your galaxy, so Galaxy Reader is
    // earnable by logging across kinds (normal use), not only by manually clicking each.
    try {
      const tk = `stat.types_seen.${space.id}`;
      const seenT = new Set<string>(JSON.parse(localStorage.getItem(tk) || "[]"));
      let changed = false;
      for (const m of memories) if (m.type && !seenT.has(m.type)) { seenT.add(m.type); changed = true; }
      if (changed) localStorage.setItem(tk, JSON.stringify([...seenT]));
    } catch { /* storage unavailable */ }

    const now = unlockedIds({ memories, links: linksCount, fuel, linkObjects, streak });
    const seen = loadUnlocked(space.id);
    const fresh = now.filter((id) => !seen.has(id));
    if (fresh.length === 0) return;
    // IM-92: persist the earned set WITH each fresh unlock's timestamp, so the
    // Awards tab can show a real "earned on" date. Unlocks recorded before
    // timestamps existed keep no date — never an invented one.
    recordUnlocked(space.id, fresh, new Date().toISOString());
    // Seed silently the first time we ever evaluate this brain on this device.
    if (!achvInitedRef.current && seen.size === 0) {
      achvInitedRef.current = true;
      return;
    }
    achvInitedRef.current = true;
    // Critical moment (audio audit): an achievement unlocked — haptic pair (IM-134).
    triggerHaptic("achievement");
    for (const id of fresh.slice(0, 3)) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) pushToast(`Achievement: ${a.name} — ${a.desc}`, a.icon ?? "🏆", 12000, "high");
    }
  }, [data.nodes, data.links, fuel, streak, space, loaded]);

  // Unlockables (IM-133): the shared catalog's stats, assembled from the same
  // live state the achievements effect above reads — earned achievements are
  // the persisted set ∪ currently satisfied, Codex completion is computed
  // live the way achievements.ts codexPctFrom does it. The dev-unlock-all
  // flag is dev-only (docs/UNLOCKABLES.md); nothing in the normal UI sets it.
  const devUnlockAll = useMemo(() => readDevUnlockAll(), [space?.id]);
  const unlockStats = useMemo<UnlockStats | null>(() => {
    if (!space || !loaded) return null;
    const allNodes = data.nodes as GraphNode[];
    const memories = allNodes.filter((n) => n.kind !== "action");
    const earned = new Set<string>(loadUnlocked(space.id));
    for (const id of unlockedIds({ memories, links: data.links.length, fuel, linkObjects: data.links, streak })) {
      earned.add(id);
    }
    const codex = buildCodex({
      memories: allNodes.filter((n) => n.kind !== "moc" && n.kind !== "action"),
      constellations: allNodes.filter((n) => n.kind === "moc"),
      links: data.links.length,
    });
    return buildUnlockStats({
      nodes: allNodes,
      linksCount: data.links.length,
      streak,
      achievementIds: earned,
      codexPct: codexProgress(codex).pct,
    });
  }, [space, loaded, data.nodes, data.links, fuel, streak]);
  unlockGateRef.current = { stats: unlockStats, devUnlockAll };
  // "🔓 Unlocked!" celebrations: fires once per newly unlocked catalog item
  // (music included — a new loop unlocking celebrates AND becomes playable).
  useUnlockWatcher({
    stats: unlockStats,
    spaceId: space?.id ?? null,
    devUnlockAll,
    onUnlock: (item) => {
      playSfx("achievement");
      enqueueUnlockMoment(item);
      pushToast(`🔓 Unlocked! ${item.label} — ${item.description}`, "🔓", 9000, "high");
    },
  });

  // REG-047 (PG-04): Soumaya's autonomously-charted field notes, fetched at App
  // level so the global Codex claim hook covers them too — not just the
  // graph-derived entries. The Codex panel fetches the same endpoint for
  // display; this is the claim-side copy (a failed fetch here is silent —
  // the panel surfaces it visibly, IM-91 — and the entries are re-claimed
  // when the panel opens).
  const [codexDiscoveries, setCodexDiscoveries] = useState<AgentDiscovery[]>([]);
  useEffect(() => {
    if (!space) return;
    let alive = true;
    void getCodexDiscoveries()
      .then((d) => {
        if (alive) setCodexDiscoveries(d);
      })
      .catch(() => {
        /* panel surfaces the failure visibly (IM-91) */
      });
    return () => {
      alive = false;
    };
  }, [space]);

  // REG-047: the full Codex entry list at App level (graph-derived + field
  // notes), so a discovery is announced and its reward claimed at the moment
  // it first becomes true, on any surface — not only when the Codex panel
  // opens. A claim refreshes the fuel gauge immediately; the 30s poll would
  // pick it up anyway, this just names the moment.
  const codexEntries = useMemo(() => {
    if (!space || !loaded) return [];
    const allNodes = data.nodes as GraphNode[];
    return [
      ...buildCodex({
        memories: allNodes.filter((n) => n.kind !== "moc" && n.kind !== "action"),
        constellations: allNodes.filter((n) => n.kind === "moc"),
        links: data.links.length,
      }),
      ...fieldNoteEntries(codexDiscoveries),
    ];
  }, [space, loaded, data.nodes, data.links, codexDiscoveries]);
  useCodexDiscoveryClaims(codexEntries, space?.id ?? null, () => {
    void getFuel()
      .then((f) => {
        if (f) setFuel(f);
      })
      .catch(() => {});
  });

  // Random idle FLY-BY: when you're just watching the galaxy (nothing open or focused),
  // Soumaya occasionally swings into view, drops a determined line pulled from your
  // memory wealth + streak + rank, and darts off (reuses her autonomous hail). Rare +
  // cooldowned so it always feels like a special, unscripted moment — never spam.
  const flybyIdleRef = useRef(false);
  flybyIdleRef.current =
    loaded && !!space && panel === null && !showChat && !selected && obsSettled && !showObs &&
    !followShip && !followStation && !followSatellite && !followVisitor && !followFig1 && !followFig2;
  const flybyDataRef = useRef<{ nodes: GraphNode[]; streak: number }>({ nodes: [], streak: 0 });
  flybyDataRef.current = { nodes: data.nodes as GraphNode[], streak: streak?.current ?? 0 };
  const lastFlybyRef = useRef(0);
  useEffect(() => {
    const composeLine = (): string => {
      const mems = flybyDataRef.current.nodes.filter((n) => n.kind !== "action" && n.kind !== "moc");
      const count = mems.length;
      const rank = pilotRank(count);
      const s = flybyDataRef.current.streak;
      const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
      const pool: string[] = [
        `${count} memories. You're becoming someone.`,
        `A ${rank.title} now. I can feel the weight of it.`,
        `Every star in here is a piece of you. Keep going.`,
        `You built a whole world in your head. Don't stop.`,
        `I'm still here, flying your thoughts. Always.`,
      ];
      if (s >= 2) pool.push(`${s} days straight. This is who you are now.`);
      if (count > 0) {
        const m = pick(mems);
        pool.push(`Still carrying "${(m.label || "that one").slice(0, 30)}", I see.`);
      }
      return pick(pool);
    };
    const iv = window.setInterval(() => {
      if (!flybyIdleRef.current) return;
      const now = performance.now();
      if (now - lastFlybyRef.current < 150_000) return; // ≥2.5 min apart
      if (Math.random() > 0.3) return; // ~1 in 3 eligible ticks → unpredictable
      lastFlybyRef.current = now;
      graphRef.current?.hailSoumaya(composeLine());
    }, 45_000);
    return () => window.clearInterval(iv);
  }, []);

  // Phase M: first-launch framing, once per space ever (not per app open, like Observatory
  // below) — checked immediately so it appears BEFORE the Observatory/Legend reveals rather
  // than stacking with them. A returning space (key already set) never sees this again.
  useEffect(() => {
    if (!space || !loaded) return;
    const key = `brain.introSeen.${space.id}`;
    try {
      if (localStorage.getItem(key)) return;
      setShowIntro(true);
    } catch {
      /* private mode — skip the one-time framing rather than error */
    }
  }, [space?.id, loaded]);

  const dismissIntro = () => {
    setShowIntro(false);
    if (space) {
      try {
        localStorage.setItem(`brain.introSeen.${space.id}`, "1");
      } catch {
        /* private mode */
      }
    }
  };

  // Reveal the Observatory home once per app open, AFTER the cinematic fly-in
  // has settled — never touches the intro itself, and won't pop over a panel
  // the user already opened during the swoop. Also waits out the first-launch
  // framing card above so a brand-new space never sees two "welcome" surfaces
  // stacked at once — its 3.2s countdown starts once that card is dismissed.
  useEffect(() => {
    if (obsShownRef.current || !space || !loaded || showIntro) return;

    // The intro animation takes ~3.2s from the point of triggering in Graph3D.
    // Triggering now ensures it follows the intro, regardless of load time.
    const t = window.setTimeout(() => {
      obsShownRef.current = true;
      if (panel === null) setShowObs(true);
      else setObsSettled(true); // a panel's already open → Observatory won't show; release toasts
    }, 3400);
    return () => window.clearTimeout(t);
  }, [space, loaded, panel, showIntro]);

  // Buffer celebratory toasts until the Observatory gate resolves (so they don't
  // pop behind the cards). Signed-out never gates. Flushes on settle.
  useEffect(() => {
    setToastsPaused(!!space && (showObs || !obsSettled));
  }, [space, showObs, obsSettled]);

  // Autonomous hail: once per app open, if Soumaya has surfaced something worth
  // seeing (a latent insight), she flies into view with a message and the 💬 FAB
  // pulses — tap to talk. Fires after the Observatory settles so it never stacks.
  useEffect(() => {
    if (hailedRef.current || !space || !loaded) return;
    const t = window.setTimeout(async () => {
      hailedRef.current = true;
      try {
        const insights = await getDigest();
        if (insights && insights.length > 0 && !showChat) {
          graphRef.current?.hailSoumaya("I found a connection worth seeing — tap to talk ✦");
          setChatPulse(true);
        }
      } catch {
        /* best-effort */
      }
    }, 7000);
    return () => window.clearTimeout(t);
  }, [space, loaded]);

  // Ambient self-insight pill: foresight (time-sensitive) wins, else her newest
  // belief. Fetched once when the brain loads; purely glanceable.
  useEffect(() => {
    if (!space || !loaded) return;
    let alive = true;
    (async () => {
      const [contact, beliefs] = await Promise.all([getDailyContact(), getBeliefs()]);
      if (!alive) return;
      // IM-03: render the server's ACTUAL foresight text + inDays — the chip
      // used to discard both and show a constant "She sees a pattern coming".
      if (contact?.foresight) setSelfInsight({ kind: "foresight", text: contact.foresight.text, inDays: contact.foresight.inDays });
      else if (beliefs[0]) setSelfInsight({ kind: "belief", text: beliefs[0].content });
      else setSelfInsight(null);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [space?.id, loaded]);

  // First-run: show the visual legend ONCE per brain (after data loads) so a new
  // user learns the galaxy's language up front; thereafter it's the 🗺️ FAB. Also waits
  // out the first-launch framing card (same reasoning as the Observatory effect above).
  useEffect(() => {
    if (!space || !loaded || showIntro) return;
    const key = `brain.legendSeen.${space.id}`;
    try {
      if (localStorage.getItem(key)) return;
      const t = window.setTimeout(() => {
        setShowLegend(true);
        localStorage.setItem(key, "1");
      }, 5200); // after the fly-in + Observatory have settled
      return () => window.clearTimeout(t);
    } catch {
      /* private mode */
    }
  }, [space?.id, loaded, showIntro]);

  // Close the Observatory and release any buffered toasts. The 🔭 FAB reopens it.
  const dismissObs = useCallback(() => {
    setShowObs(false);
    setObsSettled(true);
    setAwayDigest(null); // the away report rode the Observatory — it's been seen
  }, []);

  // The away report renders INSIDE the Observatory now (one arrival screen, not
  // two stacked "welcome back" pop-ups). Once it has actually been shown, advance
  // the server's away window.
  useEffect(() => {
    if (showObs && awayDigest) void markAwaySeen();
  }, [showObs, awayDigest]);

  // ── Night Replay + live event bridge ──────────────────────────────────────
  // The 24/7 server loop does real work (research, fusions, sector charting)
  // that used to land invisibly in agent_logs. On arrival she RE-ENACTS what
  // happened since your last visit (flies to each memory and performs it), and
  // while you stay, new server-side events surface as toasts in her voice.
  const replayDoneRef = useRef(false);
  // Live mirror of the node list: the effect below runs a 60s interval for the
  // whole session, so closing over the mount-time `data.nodes` silently dropped
  // events about any memory logged AFTER load (exactly the likeliest events).
  const nodesRef = useRef<GraphNode[]>([]);
  useEffect(() => {
    nodesRef.current = data.nodes as GraphNode[];
  }, [data.nodes]);
  useEffect(() => {
    if (!space || !loaded) return;
    const key = `brain.replay.lastLog.${space.id}`;
    const VERBS: Record<string, { replay: string; live: string }> = {
      research: { replay: "researched", live: "just researched" },
      merging: { replay: "fused a duplicate into", live: "just fused a duplicate into" },
      sector_vibe: { replay: "charted the sector around", live: "just charted the sector around" },
      synthesis: { replay: "connected a thread to", live: "just connected a thread to" },
    };
    const labelOf = (id: number) => nodesRef.current.find((n) => n.id === id)?.label ?? null;
    let disposed = false;

    const check = async (arrival: boolean) => {
      const logs = await getAgentLogs(); // newest first
      if (disposed || logs.length === 0) return;
      const newest = logs[0]!.id;
      const lastSeen = parseInt(localStorage.getItem(key) || "0", 10) || 0;
      try {
        localStorage.setItem(key, String(newest));
      } catch {
        /* storage unavailable */
      }
      if (!lastSeen) return; // first visit ever — set the baseline silently

      // Every autonomous tool (fire_reminder, create_task, surface_orphan, review_nudge,
      // check_in, web_lookup, weekly_review, chart_discovery, bill_risk) logs its exact
      // user-facing text as `description` (router.ts's logAction — a tool's `message`
      // when it set one). Most have no galaxy body to fly to (a bill, a reminder, a
      // digest), so they don't fit the VERBS/replay pattern below — surface ANY tool:*
      // action as a direct toast instead, so a user with no Telegram linked (every
      // tool's only other delivery channel) still sees it, not just bill_risk (the
      // first instance of this exact bug that got fixed, generalized here to the rest).
      const toolLogs = logs.filter((l) => l.id > lastSeen && l.action.startsWith("tool:")).reverse();
      for (const l of toolLogs.slice(-2)) {
        const icon = l.description.match(/^\p{Extended_Pictographic}+/u)?.[0] ?? "🛰️";
        // Phase Y/Z: a proactive tool's toast carries a structured Chat handoff — the
        // target id it already writes to `targets` (Phase X/Z) — so tapping it opens
        // Chat already knowing WHY, instead of the user having to explain the trigger
        // back to her. Any tool:* action not in this map is completely unaffected;
        // adding a third source is exactly this one-line map entry, nothing more.
        const source: ProactiveContextSource | undefined = PROACTIVE_TOAST_SOURCE[l.action];
        let action: ToastAction | undefined;
        if (source) {
          try {
            const targetId = (JSON.parse(l.targets) as unknown[])[0];
            if (typeof targetId === "number") action = { kind: "chat", value: `${source}:${targetId}` };
          } catch {
            /* malformed targets — falls back to a plain toast, no handoff */
          }
        }
        pushToast(l.description, icon, 9000, l.action === "tool:bill_risk" ? "high" : "normal", action);
      }

      // Mind-tab lifecycle transitions the autonomy loop makes on its own (a goal
      // finished, an intention came true or expired, a future event arrived) used to
      // just vanish from the panel on next refresh with zero acknowledgement — every
      // USER-triggered transition in the Mind tab gets a toast, these silent ones
      // didn't. Same direct-description pattern as tool:* above.
      const MIND_ICON: Record<string, string> = {
        goal_completed: "🏁",
        intention_fulfilled: "🌠",
        intention_expired: "💨",
        event_passed: "⏳",
      };
      const mindLogs = logs.filter((l) => l.id > lastSeen && MIND_ICON[l.action]).reverse();
      for (const l of mindLogs.slice(-2)) {
        pushToast(l.description, MIND_ICON[l.action]!, 8000);
      }

      const fresh = logs
        .filter((l) => l.id > lastSeen && VERBS[l.action])
        .reverse(); // oldest first, so the story reads forward
      if (fresh.length === 0) return;

      if (arrival && !replayDoneRef.current) {
        replayDoneRef.current = true;
        const items = fresh
          .map((l) => {
            let target: number | undefined;
            try {
              target = (JSON.parse(l.targets || "[]") as number[])[0];
            } catch {
              /* unparseable targets */
            }
            const label = target != null ? labelOf(target) : null;
            return target != null && label
              ? { id: target, label: `Last night: ${VERBS[l.action]!.replay} "${label}"` }
              : null;
          })
          .filter((x): x is { id: number; label: string } => x !== null)
          .slice(-3);
        if (items.length > 0) {
          // Give the cinematic fly-in room to settle, then she retraces her work.
          window.setTimeout(() => graphRef.current?.replayEvents(items), 4500);
        }
      } else if (!arrival) {
        for (const l of fresh.slice(-2)) {
          let target: number | undefined;
          try {
            target = (JSON.parse(l.targets || "[]") as number[])[0];
          } catch {
            /* unparseable targets */
          }
          const label = target != null ? labelOf(target) : null;
          if (label) pushToast(`Soumaya ${VERBS[l.action]!.live} "${label}".`, "🛰️", 7000);
        }
      }
    };

    void check(true);
    const iv = window.setInterval(() => void check(false), 60_000);
    return () => {
      disposed = true;
      window.clearInterval(iv);
    };
  }, [space, loaded]);

  // Offline ingest queue: flush anything captured offline once signed in / back
  // online, then refresh the galaxy + celebrate what synced.
  useEffect(() => {
    if (!space) return;
    void flushIngestQueue();
    const onSynced = (e: Event) => {
      const detail = (e as CustomEvent).detail as { newIds?: number[]; synced?: number };
      void refresh(detail?.newIds);
      if (detail?.synced) pushToast(`Synced ${detail.synced} memor${detail.synced === 1 ? "y" : "ies"} you saved offline.`, "📡", 6000);
    };
    window.addEventListener("brain-ingest-synced", onSynced);
    return () => window.removeEventListener("brain-ingest-synced", onSynced);
  }, [space, refresh]);

  // Navigate to a memory, recording where we came from so Back works.
  // Returns true when the jump landed, false when it could not — every
  // door (Search, palette, Recall, Observatory, NoticingCard chips) funnels
  // through here, so a false lets the caller say so instead of mimicking
  // success.
  const goTo = useCallback(
    async (id: number, record = true, ripple = false): Promise<boolean> => {
      // SP-01 / REG-184: the loaded galaxy is only the top-300 nodes by
      // degree, but Search, the palette, Recall, Observatory, and
      // NoticingCard chips all present ids from the FULL node set. A
      // presented hit outside the cut used to die here in a silent
      // `return` — force-include it through the existing
      // getGraph(limit, includeIds) machinery instead. When the node
      // genuinely cannot be loaded (deleted / archived / foreign space),
      // or the fetch itself fails, say so visibly: no silent no-op may
      // remain on this path.
      let resolved: { node: GraphNode | null; fetched: GraphData | null };
      try {
        resolved = await resolveFocusNode(view.nodes, id, (ids) => getGraphWithCompletion(ids));
      } catch {
        pushToast("Couldn't open that memory — the galaxy didn't load. Try again.", "⚠️", 8000);
        return false;
      }
      const n = resolved.node;
      if (!n) {
        pushToast("Couldn't open that memory — it may have been deleted or archived.", "⚠️", 8000);
        return false;
      }
      if (resolved.fetched) {
        // Merge exactly like refresh() does, then fly once the node has
        // reached the renderer (the same 550ms settle refresh() uses).
        const fetched = resolved.fetched;
        setData((prev) => mergeGraphData(prev, fetched));
        window.setTimeout(() => graphRef.current?.focusNode(id), 550);
      }
      setHistory((h) => (record && selected && selected.id !== id ? [...h, selected.id] : h));
      setSelected(n);
      setTab("details");
      setPanel("dock");
      if (!resolved.fetched) graphRef.current?.focusNode(id);
      if (ripple) graphRef.current?.spawnBurst(id, "user");
      if (space) {
        void tendNode(id); // revisiting a memory warms it back up (entropy)
        // Only a GENUINE restore counts toward Grand Restorer / the Codex's
        // "The Gardener" — the memory had actually gone cold before this visit.
        // (Counting every click made them "tap any 10 nodes".)
        if ((n.entropy ?? 0) >= COOLING_ENTROPY) {
          const tendKey = `stat.memories_tended.${space.id}`;
          localStorage.setItem(tendKey, String(parseInt(localStorage.getItem(tendKey) || "0", 10) + 1));
        }
        // Visual fluency: record which memory TYPES you've opened — you learn the
        // colour language by navigating it, and it earns "Galaxy Reader".
        try {
          const tk = `stat.types_seen.${space.id}`;
          const seen = new Set<string>(JSON.parse(localStorage.getItem(tk) || "[]"));
          if (n.type && !seen.has(n.type)) {
            seen.add(n.type);
            localStorage.setItem(tk, JSON.stringify([...seen]));
          }
        } catch {
          /* storage unavailable */
        }
        // Optimistic warm-up: the server reset entropy, but the client copy only
        // refreshed on the next full graph fetch — so a beacon's beam never cut
        // out when you tended its memory mid-session (verified). Mutating the
        // live node object is what the 3D loop + satellites actually read.
        (n as GraphNode).entropy = 0;
        (n as GraphNode).lastTendedAt = new Date().toISOString();
        // Force evaluation of achievements
        setTimeout(() => handleChanged(-1), 100);
      }
      return true;
    },
    [view, selected, space],
  );

  const focus = useCallback((id: number) => goTo(id, true, true), [goTo]);

  // Clickable notifications: a toast with an action routes here when tapped (focus a memory,
  // open a tab/panel, or open chat) — so every notification can take you to the thing.
  useEffect(() => {
    const onAction = (e: Event) => {
      const a = (e as CustomEvent).detail as { kind: string; value?: string | number; text?: string } | undefined;
      if (!a) return;
      if (a.kind === "focus" && a.value != null) { focus(Number(a.value)); }
      else if (a.kind === "tab" && a.value != null) { dismissObs(); setTab(String(a.value) as any); setPanel("dock"); }
      // Verb 1 (Tend a plot): the Help card's "Travel to Growing Place"
      // Try-It — the same travel-focus mechanism the world map uses.
      else if (a.kind === "travel" && a.value != null) { openTravel(String(a.value)); }
      else if (a.kind === "panel" && a.value != null) {
        // REG-188: a panel-kind action may carry the text the user already
        // typed (SearchBox's "Add as memory" hatch) — seed the capture box
        // with it instead of opening an empty one.
        if (String(a.value) === "ingest" && typeof a.text === "string" && a.text.trim()) {
          setIngestSeed({ text: a.text.trim(), nonce: Date.now() });
        }
        setPanel(String(a.value) as any);
      }
      else if (a.kind === "chat") {
        // Phase Y/Z: a proactive toast's "chat" action carries "<source>:<targetId>"
        // (goal_trend or bill_risk) — any other chat-kind action (there are none today,
        // but any future one) falls through to opening Chat with no proactive context.
        const m = typeof a.value === "string" ? /^(goal_trend|bill_risk):(\d+)$/.exec(a.value) : null;
        if (m) setPendingProactiveContext({ source: m[1] as ProactiveContextSource, targetId: Number(m[2]) });
        // REG-188: a chat-kind action carrying plain text (not a proactive
        // "<source>:<id>") is a seed question from an escape hatch —
        // prefill the chat input with the text already typed.
        else if (typeof a.value === "string" && a.value) setChatSeed({ text: a.value, nonce: Date.now() });
        setShowChat(true);
      }
    };
    window.addEventListener("brain-toast-action", onAction);
    return () => window.removeEventListener("brain-toast-action", onAction);
  }, [focus]);

  // IM-141/IM-142 — global keyboard shortcuts, active anywhere in the app once
  // signed in: ⌘K / Ctrl+K toggles the command palette; a bare "c" opens
  // quick-capture — but never while typing (the predicate + text-entry-target
  // guard in lib/quickCapture.ts are what keep "c" in a textarea inert).
  useEffect(() => {
    if (!space) return;
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if (isCaptureShortcut(e) && !isTextEntryTarget(e.target)) {
        e.preventDefault();
        setPanel("ingest");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [space]);

  // IM-141 — PWA share-target / capture-shortcut landing: the manifest sends
  // shares to /share?title=&text=&url= (and the home-screen shortcut to
  // /share?capture=1); the server SPA-fallback serves this app for that path.
  // Once the brain is open and loaded, open Ingest prefilled with the shared
  // text, then rewrite the URL to "/" so a reload doesn't re-capture the same
  // share and the shared text doesn't linger in the address bar/history.
  const shareHandledRef = useRef(false);
  useEffect(() => {
    if (!space || !loaded || shareHandledRef.current) return;
    shareHandledRef.current = true;
    const landing = parseShareLanding(window.location.pathname, window.location.search);
    if (!landing) return;
    setIngestSeed({ text: landing.text, nonce: Date.now() });
    setPanel("ingest");
    window.history.replaceState(null, "", "/");
  }, [space, loaded]);

  // IM-142 — palette commands execute against the app's existing navigation
  // state (the same setters the FABs, toasts and dock already use).
  const runPaletteCommand = useCallback(
    (cmd: PaletteCommand) => {
      setShowPalette(false);
      switch (cmd.id) {
        case "capture":
          setPanel("ingest");
          break;
        case "chat":
          setShowChat(true);
          break;
        case "search":
          setPanel("search");
          break;
        case "observatory":
          setShowObs(true);
          break;
        case "timeline":
          setShowTimeline(true);
          break;
        case "review":
          setShowReview(true);
          break;
        case "connections":
          setShowConnections(true);
          break;
        case "settings":
          setShowSettings(true);
          break;
        default:
          if (cmd.id.startsWith("tab:")) {
            dismissObs();
            setTab(cmd.id.slice(4) as DockTab);
            setPanel("dock");
          }
      }
    },
    [dismissObs],
  );

  // Wealth's "⛶ Expand" affordance (docs/specs/wealth-goals-allocation.md §13) — a dedicated
  // event rather than overloading brain-toast-action's `panel` kind, since that's tied to the
  // narrow `Panel` union (search/ingest/dock) and this is a direct click, not a toast route.
  useEffect(() => {
    const onExpand = () => setShowWealthFullscreen(true);
    window.addEventListener("brain-open-wealth-fullscreen", onExpand);
    return () => window.removeEventListener("brain-open-wealth-fullscreen", onExpand);
  }, []);

  // IM-131 (remainder): Help's per-card "Try it" targets for the three overlay
  // surfaces the toast-action bridge can't reach (their open state lives here,
  // not in the Panel union or the dock tabs) — same dedicated-event pattern as
  // the Wealth expand above.
  useEffect(() => {
    const onConnections = () => setShowConnections(true);
    const onLenses = () => setShowLenses(true);
    const onSettings = () => setShowSettings(true);
    window.addEventListener("brain-open-connections", onConnections);
    window.addEventListener("brain-open-lenses", onLenses);
    window.addEventListener("brain-open-settings", onSettings);
    return () => {
      window.removeEventListener("brain-open-connections", onConnections);
      window.removeEventListener("brain-open-lenses", onLenses);
      window.removeEventListener("brain-open-settings", onSettings);
    };
  }, []);

  // Money's "⛶ Expand" affordance (docs/specs/paystub-ingestion.md §7) — same dedicated-event
  // pattern as Wealth's, above.
  useEffect(() => {
    const onExpand = () => setShowFinanceFullscreen(true);
    window.addEventListener("brain-open-finance-fullscreen", onExpand);
    return () => window.removeEventListener("brain-open-finance-fullscreen", onExpand);
  }, []);

  // Smart Lens open/exit — shared by the Lenses panel and the on-galaxy pinned chips.
  // Lens/Views and the "system view" isolate (below) share ONE underlying cluster state
  // in Graph3D (isolateSet/isolateLayer/isolateSystem all call the same setCluster), so
  // each entry point must clear the OTHER's exit-UI flag or both exit controls (the
  // "⧉ Lens" banner and "✕ Exit system view" button) can show at once.
  // Batch H (REG-207 / CN-08): a lens evaluates over the FULL node set, but the
  // galaxy only renders the loaded payload — opening one used to isolate to the
  // payload's intersection with its matches, silently showing a subset as the
  // whole lens. Force-include the missing bodies first via the existing
  // includeIds machinery (getGraphWithCompletion), then isolate; the banner
  // states the true match total, and the shown subset when the match list
  // itself was capped (REG-208). A failed force-include is disclosed, and the
  // isolate still runs over what is loaded.
  const openLens = useCallback(async (ids: number[], name: string, total?: number) => {
    const shown = ids.length;
    const matchTotal = total ?? shown;
    const loaded = new Set(data.nodes.map((n) => n.id));
    const missing = ids.filter((id) => !loaded.has(id));
    if (missing.length > 0) {
      try {
        const g = await getGraphWithCompletion(missing);
        setData((prev) => mergeGraphData(prev, g));
      } catch {
        pushToast("Couldn't load every match — showing the ones already here.", "⚠️", 4000);
      }
    }
    graphRef.current?.isolateSet(ids);
    setActiveLens(name);
    setActiveLensCount(matchTotal);
    setActiveLensShown(shown);
    setClustered(false);
    setSelected(null);
  }, [data.nodes]);
  const exitLens = useCallback(() => {
    graphRef.current?.exitCluster();
    setActiveLens(null);
    setActiveLensCount(null);
    setActiveLensShown(null);
    setClustered(false);
  }, []);
  // View only an overlay layer (money-sky / journey hubs) — their own category view.
  const openLayer = useCallback((layer: "money" | "journeys", name: string) => {
    graphRef.current?.isolateLayer(layer);
    setActiveLens(name);
    setActiveLensCount(null);
    setActiveLensShown(null);
    setClustered(false);
    setSelected(null);
  }, []);

  // Shared age computation so the flashback's narration toast (below) and the
  // 7-day candidate filter agree on what "N days ago" means for the same node.
  const ageDaysOf = (n: GraphNode): number => {
    if (!n.createdAt) return NaN;
    const rawDate = n.createdAt;
    const isoDate = rawDate.includes("Z") ? rawDate : rawDate.replace(" ", "T") + "Z";
    return (Date.now() - Date.parse(isoDate)) / (1000 * 60 * 60 * 24);
  };

  const triggerFlashback = useCallback(() => {
    // Find an old, high-mass memory (Serendipity hook)
    const candidates = view.nodes.filter(n => {
      if (!n.createdAt || !n.mass) return false;
      const ageDays = ageDaysOf(n);
      return ageDays > 7 && n.mass > 0.3;
    });

    if (candidates.length > 0) {
      // Pick a random candidate
      const target = candidates[Math.floor(Math.random() * candidates.length)]!;
      goTo(target.id, true);
      // Spawn a special calibration/synthesis burst to draw attention
      graphRef.current?.spawnBurst(target.id, "calibration");
      // A flashback used to fly you somewhere with zero explanation of WHY this
      // particular memory — the whole point of a flashback is the "you wrote
      // this a while ago" reveal, which was missing entirely.
      const days = Math.round(ageDaysOf(target));
      // IM-14: lore line + a tappable toast (action flies back to the memory).
      pushToast(flashbackLoreLine(target, days), "☄️", 6000, "normal", { kind: "focus", value: target.id });
    } else {
      // Fallback if the brain is too young
      const all = view.nodes.filter(n => n.mass && n.mass > 0.2);
      if (all.length > 0) {
        const target = all[Math.floor(Math.random() * all.length)]!;
        goTo(target.id, true);
        graphRef.current?.spawnBurst(target.id, "calibration");
        const days = Math.round(ageDaysOf(target));
        pushToast(flashbackLoreLine(target, days), "☄️", 6000, "normal", { kind: "focus", value: target.id });
      } else {
        // A brand-new brain has nothing old/heavy enough for either tier —
        // this used to just do nothing, with zero feedback for the tap.
        pushToast("Not enough history yet for a flashback — keep logging memories.", "☄️", 3500);
      }
    }
  }, [view, goTo]);

  const back = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const id = h[h.length - 1]!;
      const n = view.nodes.find((x) => x.id === id);
      if (n) {
        setSelected(n);
        setTab("details");
        setPanel("dock");
        graphRef.current?.focusNode(id);
      }
      return h.slice(0, -1);
    });
  }, [view]);

  // After a weight edit: re-pull the graph (mass/celestial recompute), keep
  // the node selected, no camera move.
  const handleChanged = useCallback(async (id: number) => {
    if (id === -1) {
      if (space) {
        const shipKey = `brain.hangar.ship.${space.id}`;
        const trailKey = `brain.hangar.trail.${space.id}`;
        const fig1Key = `brain.hangar.fig1.${space.id}`;
        const fig2Key = `brain.hangar.fig2.${space.id}`;
        const focusFig1Key = `brain.hangar.focusFig1.${space.id}`;
        const focusFig2Key = `brain.hangar.focusFig2.${space.id}`;

        setEquippedShip(localStorage.getItem(shipKey) || "default");
        setEquippedTrail(localStorage.getItem(trailKey) || "blue");
        setPreviewTrail(null); // equipping ends any preview — the real pick now shows
        setEquippedFig1(localStorage.getItem(fig1Key) || "none");
        setEquippedFig2(localStorage.getItem(fig2Key) || "none");
        setShowFocusFig1(localStorage.getItem(focusFig1Key) !== "false");
        setShowFocusFig2(localStorage.getItem(focusFig2Key) !== "false");
      }
      return;
    }
    const g = await getGraph();
    // Merge by node id (see App.helpers.ts's mergeGraphData doc comment) — same fix as
    // refresh(), applied here since this is a second, independent setData(freshFetch) site.
    const merged = mergeGraphData(data, g);
    setData(merged);
    getFuel().then((f) => f && setFuel(f)).catch(() => {});
    const n = merged.nodes.find((x) => x.id === id);
    if (n) {
      setSelected(n);
      graphRef.current?.spawnBurst(id, "user");
    }
  }, [space, data]);

  const handleDeleted = useCallback(() => {
    setSelected(null);
    setPanel(null);
    setHistory([]);
    void refresh();
  }, [refresh]);

  const toggle = (p: Exclude<Panel, null>) => {
    setPanel((cur) => {
      const next = cur === p ? null : p;
      logDiagnosticEvent('state', 'App.panel', { action: 'toggle', panel: p, visible: !!next });
      return next;
    });
  };

  const llmStatus = health
    ? health.llm.available
      ? health.llm.model
      : health.llm.degraded
        ? `${health.llm.model} · offline mode`
        : "heuristic mode"
    : "";

  // Gate: wait for the auth check, then require an open brain.
  if (!authChecked) {
    return (
      <div className="loading">
        <div className="loader-orb" />
        <p>Aligning the stars…</p>
      </div>
    );
  }
  if (!space) {
    return <LoginScreen onAuthed={setSpace} />;
  }

  return (
    <div className={`app${focusMode ? " focus-mode" : ""}${focusMenuOpen ? " focus-menu-open" : ""}`}>
      <Toasts />
      {/* Performance readout (Stage 0 instrument). Renders nothing unless enabled via
          Settings or ?perf=1, and polls at 2Hz rather than reading anything per frame. */}
      <PerfHUD nodeCount={view.nodes.length} />
      {/* Left-edge HUD (fuel + streak) — hidden whenever a panel/chat/Observatory is up
          so it never overlaps their content. Batch I (REG-068 / GH-15):
          one shared hide rule with the stack and the empty-galaxy cue. */}
      {!hudChromeHidden({ panel, showChat, showObs, showSettings, showConnections, showTimeline }) && (
        <>
          <FuelGauge fuel={fuel} pops={fuelPops} busy={aiBusy > 0} onClick={() => setShowFuelWays(true)} loadState={fuel ? "ready" : fuelError ? "error" : "loading"} onRetry={retryFuel} />
          <StreakEmber streak={streak?.current ?? 0} best={streak?.best} atRisk={streakAtRisk} shields={streak?.shields ?? 0} onClick={() => { setTab("awards"); setPanel("dock"); }} />
        </>
      )}
      {rankUp && (
        <div className="rankup-moment" role="alert" onClick={() => setRankUp(null)}>
          <div className="rankup-card">
            <span className="rankup-ring" aria-hidden />
            <span className="rankup-kicker">RANK UP</span>
            <span className="rankup-star">★</span>
            <span className="rankup-title">{rankUp.title}</span>
            <span className="rankup-lvl">Level {rankUp.level}</span>
          </div>
        </div>
      )}
      <UnlockCelebration item={unlockMoment} onDismiss={dismissUnlockMoment} />
      {/* Lite mode: a calm static backdrop instead of the WebGL galaxy, so the app is
          fully usable (Mind, chat, memories, tabs) even when the 3D can't render. */}
      {lite && <div className="lite-backdrop" aria-hidden />}

      {/* When the galaxy is intentionally off (Lite mode), SAY SO — otherwise a missing
          galaxy just looks broken. One tap turns it back on. */}
      {lite && space && (
        <div className="galaxy-off-note" role="status">
          <span>🌌 3D galaxy is off (Lite mode)</span>
          <button
            onClick={() => {
              try { localStorage.setItem("brain.lite", "0"); } catch { /* ignore */ }
              window.location.href = window.location.pathname; // drop any ?lite= param
            }}
          >
            Turn it on
          </button>
        </div>
      )}

      {/* Mount the 3D galaxy only AFTER boot completes AND not in lite mode. Its
          WebGL/scene setup is the heaviest synchronous work in the app; mounting it
          during loading could stall a phone's main thread so the loading logic +
          recovery watchdog never got to run. */}
      {galaxyWillMount && (
      <ErrorBoundary
        label="galaxy"
        fallback={
          <>
            <div className="lite-backdrop" aria-hidden />
            {/* Batch I (REG-060 / GH-01): the error card offers the Lite
                escape, not only Reload — a device that cannot render
                WebGL loops on Reload otherwise. */}
            <GalaxyErrorCard onReload={() => window.location.reload()} />
          </>
        }
      >
      <Suspense fallback={null}>
      <Graph3D
        ref={graphRef}
        data={view}
        onFirstFrame={() => {
          clearGalaxyStuck();
          setLoaded(true);
          console.info("[BOOT] Galaxy rendered — loading complete");
        }}
        onFuelBurn={(amount) => {
          // Optimistic: drop the gauge now (fires the −pop), then confirm with the server.
          setFuel((f) => (f ? { ...f, fuel: Math.max(0, f.fuel - amount) } : f));
          void burnFuel(amount).then((nf) => nf && setFuel(nf));
        }}
        onSelect={(node) => {
          playSfx("select");
          focus(node.id);
        }}
        onSoumayaClick={() => {
          setTab("soumaya"); // tapping her ship opens her ops console (chat is the 💬 FAB)
          setPanel("dock");
          setFollowShip(true);
          setFollowStation(false);
          setFollowSatellite(false);
          setFollowVisitor(false);
          setFollowFig1(false);
          setFollowFig2(false);
          graphRef.current?.toggleFollowShip(true);
        }}
        onGalaxyEntityClick={(kind, id) => {
          // Journey hubs / Money-sky stars (Maya Intelligence Part I3): "what's that
          // star?" resolved on click, then a bounded, EXPLAINED fly-to (never decorative
          // navigation — the toast always states the real reason, straight from the
          // server's own descriptor, never invented client-side).
          void galaxyEntity(kind, id).then((r) => {
            if (!r) return;
            const flew = graphRef.current?.flyToGalaxyEntity(kind, id) ?? false;
            // Batch I (REG-111): the toast must not say the same thing
            // whether the flight happened or not.
            pushToast(
              galaxyEntityToastText(
                kind,
                r.descriptor.ref.label ?? (kind === "journey" ? "this journey" : "this item"),
                r.navigation.reason,
                flew,
              ),
              kind === "journey" ? "🧭" : "💵",
              flew ? 7000 : 5000,
            );
            // Galaxy entity detail focus (Phase O, docs/specs/galaxy-entity-citizenship-audit.md
            // §14/§18): the fly-to above already proved "that's a real thing" — this additionally
            // opens the SAME domain panel/card that already shows its full detail (JourneysPanel/
            // WealthPanel), instead of leaving the user with only a toast. Bill has no such panel
            // focus target yet (out of scope for this phase) and keeps today's toast+fly-to only.
            if (kind === "journey") {
              setTab("journeys");
              setPanel("dock");
              setFocusJourney({ id, nonce: ++focusNonceRef.current });
            } else if (kind === "goal") {
              setTab("money");
              setPanel("dock");
              setFocusGoal({ id, nonce: ++focusNonceRef.current });
            } else if (kind === "bill") {
              // Phase AC.1: closes the one remaining Galaxy click-through gap — a Bill
              // now gets the same panel-focus treatment Journey/Goal already had.
              setTab("money");
              setPanel("dock");
              setFocusBill({ id, nonce: ++focusNonceRef.current });
            }
          });
        }}
        onSatelliteCount={setSatelliteCount}
        onVisitorCount={setVisitorCount}
        selectedId={selected?.id ?? null}
        bottomInset={panel === "dock"}
        showShipTask={showShipTask}
        pilotSpeed={pilotSpeed}
        loaded={loaded}
        onTasksChange={setTasks}
        shipViewMode={shipViewMode}
        fuel={fuel}
        equippedShip={equippedShip}
        equippedTrail={previewTrail ?? equippedTrail}
        equippedFig1={equippedFig1}
        equippedFig2={equippedFig2}
        spaceId={space?.id ?? ""}
      />
      </Suspense>
      </ErrorBoundary>
      )}

      {!loaded && !initError && (
        <div className="loading">
          <div className="loader-orb" />
          <p>Mapping your galaxy…</p>
          <button
            className="lite-escape"
            onClick={() => { try { localStorage.setItem("brain.lite", "1"); } catch { /* */ } window.location.href = "/?lite=1"; }}
          >
            Taking too long? Open without the 3D galaxy →
          </button>
        </div>
      )}

      {initError && (
        <div className="loading recovery">
          <div className="recovery-card">
            <h2>Soumaya couldn't finish loading</h2>
            <p>
              {initError === "timeout"
                ? "The connection stalled. Your brain is safe — let's try again."
                : "Something interrupted startup. Your brain is safe — let's try again."}
            </p>
            <div className="recovery-actions">
              <button
                className="recovery-primary"
                onClick={() => {
                  setInitError(null);
                  setLoaded(false);
                  setTimeout(() => void refresh(), 0);
                }}
              >
                ↻ Retry
              </button>
              <button
                onClick={() => {
                  setGraphicsMode("performance");
                  setInitError(null);
                  setLoaded(false);
                  setTimeout(() => void refresh(), 0);
                }}
                title="Lighter rendering for weaker phones"
              >
                ⚡ Performance Mode
              </button>
              <button
                className="recovery-primary"
                onClick={async () => {
                  // The real fix for a stale installed PWA: drop the service worker
                  // + every cache, then hard-reload fresh code from the server.
                  try {
                    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
                    if (navigator.serviceWorker) {
                      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
                    }
                  } catch {
                    /* fall through to reload regardless */
                  }
                  window.location.replace(`${window.location.pathname}?fresh=${Date.now()}`);
                }}
                title="Clears the cached app + service worker, then reloads fresh"
              >
                ↻ Reset app (clear cache)
              </button>
              <button onClick={() => window.location.reload()}>⟳ Just reload</button>
            </div>
            <button className="recovery-diag-toggle" onClick={() => setShowDiag((d) => !d)}>
              {showDiag ? "▾ Hide diagnostics" : "▸ View diagnostics"}
            </button>
            {showDiag && (
              <pre className="recovery-diag">
                {(() => {
                  const g = resolveGraphics();
                  const nav = navigator as unknown as { deviceMemory?: number };
                  return [
                    `cause: ${initError}`,
                    `tier: ${g.tier}`,
                    `deviceMemory: ${nav.deviceMemory ?? "?"} GB`,
                    `cores: ${navigator.hardwareConcurrency ?? "?"}`,
                    `dpr: ${window.devicePixelRatio || 1} → render ${g.pixelRatio.toFixed(2)}`,
                    `bloom: ${g.bloom} · stars: ${g.starCount} · fps: ${g.fpsCap}`,
                    `online: ${navigator.onLine}`,
                  ].join("\n");
                })()}
              </pre>
            )}
          </div>
        </div>
      )}

      {aiBusy > 0 && (
        <div className="ai-busy">
          <span className="ai-dot" /> {space?.name ?? "Soumaya"} is thinking…
        </div>
      )}

      {perfSuggest && (
        <div className="perf-suggest">
          <span>Soumaya noticed some lag — switch to Performance Mode?</span>
          <button
            className="perf-yes"
            onClick={() => {
              setGraphicsMode("performance");
              setPerfSuggest(false);
              pushToast("Performance Mode on — smoother now. Reload for the full effect.", "⚡", 5000);
            }}
          >
            Switch
          </button>
          <button onClick={() => setPerfSuggest(false)}>Not now</button>
        </div>
      )}

      <header className="brand">
        <h1>
          {space?.name ?? "Soumaya"} <span className="sep">·</span> Second Brain
        </h1>
        <div className="brand-row">
          {health && (
            <span className="status">
              {memCountShown} memories · {llmStatus}
            </span>
          )}
          {/* Fuel now lives in the always-visible <FuelGauge> on the left edge (below),
              so an installed PWA's notch can never hide it. */}
          {streak && streak.current > 0 && (
            <span
              className="status streak-chip"
              title={`🔥 ${streak.current}-day streak — consecutive days you've fed your brain a memory${
                streak.best > streak.current ? ` (best: ${streak.best})` : ""
              }. Keep it alive: log at least one memory a day.`}
            >
              🔥 {streakShown}
            </span>
          )}
          {/* Ambient Level-2 presence: her live read on you (foresight or a fresh
              belief) glanceable from the galaxy, tap to open Insights. */}
          {selfInsight && (
            <button
              className={`status self-insight-chip ${selfInsight.kind}`}
              title={`${selfInsight.text} — tap to open Insights`}
              onClick={() => {
                setTab("insights");
                setPanel("dock");
              }}
            >
              {selfInsight.kind === "foresight" ? "🔮" : "🖤"} {(() => { const full = selfInsight.kind === "foresight" && selfInsight.inDays != null ? foresightChipText({ text: selfInsight.text, inDays: selfInsight.inDays }) : selfInsight.text; return full.length > 42 ? `${full.slice(0, 42)}…` : full; })()}
            </button>
          )}
          {installPrompt && (
            <button
              className="chip-btn install-btn"
              title="Install app to your home screen"
              onClick={triggerInstall}
            >
              📲 Install App
            </button>
          )}
          <button
            className="chip-btn"
            title={`Signed in as "${space.name}" — switch brain`}
            onClick={() => {
              logoutSpace();
              setSpace(null);
              setData({ nodes: [], links: [] });
              setSelected(null);
              setPanel(null);
              // REG-159 (JN-01): disarm the chat too — without setShowChat(false)
              // the dock unmounts with showChat still true, and on the next login
              // it remounts with the old journey armed, its stale id resolving
              // in the NEW space. The showChat-false effect clears the pending
              // journey as well; clear it explicitly so the disarm does not
              // depend on effect timing.
              setShowChat(false);
              setPendingJourneyId(null);
              setPendingJourneyTitle(null);
            }}
          >
            {space.name} ⏏
          </button>
        </div>
      </header>

      {space && (
        <NotificationsBar
          fuel={fuel}
          nodes={view.nodes as GraphNode[]}
          health={health}
          spaceId={space?.id}
          onFocusNode={goTo}
          onOpenTab={(t) => {
            setTab(t);
            setPanel("dock");
          }}
          onEarnFuel={() => setShowFuelWays(true)}
        />
      )}

      {help && (
        <HelpPanel
          onClose={() => setHelp(false)}
          installPrompt={installPrompt}
          onInstall={triggerInstall}
        />
      )}

      {showLegend && <Legend onClose={() => setShowLegend(false)} />}
      {showIntro && space && (
        <WelcomeIntro
          companionName={space.name || "Soumaya"}
          onClose={dismissIntro}
          onSeeHelp={() => {
            // Phase AC.1: Help discoverability — a new user can reach the existing
            // Help manual in one tap from the very first screen they see, instead of
            // needing to already know the 🧰 Tools menu exists.
            dismissIntro();
            setHelp(true);
          }}
        />
      )}

      {showLenses && space && (
        <LensesPanel
          onClose={() => setShowLenses(false)}
          presetLinkedTo={selected ? { id: selected.id, label: selected.label } : null}
          onOpen={openLens}
        />
      )}

      {/* Galaxy category views — render one category at a time (lighter on a cheap phone).
          Pinned-lens quick-switching (formerly its own floating <LensChips> here) now
          renders INSIDE this dropdown — see GalaxyViews.tsx and .lens-list's CSS comment
          for why: two independently-floating overlays could visually collide on some
          devices, confirmed by a real on-device screenshot. */}
      {space && (
        <GalaxyViews
          nodes={view.nodes as GraphNode[]}
          activeView={activeLens}
          onOpen={openLens}
          onLayer={openLayer}
          onExit={exitLens}
          hidden={panel !== null || showChat || showObs}
        />
      )}

      {/* The worlds panels live in ONE positioned sheet (Tools → Travel,
          or a map / Try-It handoff). Mounted loose in .app they laid out
          in flow below the screen's bottom edge and were unreachable. The
          sheet stays mounted while closed so the panels keep their state;
          each panel still ships dark on its own while the worlds flag is
          off (renders nothing, fetches nothing). */}
      {space && (
        <TravelSheet open={showTravel} onClose={() => setShowTravel(false)}>
          {/* Worlds travel (Phase 2, P2-3). */}
          <ErrorBoundary label="travel" fallback={null}>
            <TravelPanel focusWorld={travelFocus} onTransit={() => setShowTravel(false)} />
          </ErrorBoundary>

          {/* Guided tours (Wave 2, N7) — saved Chronicle routes with a voice. */}
          <ErrorBoundary label="tours" fallback={null}>
            <ToursPanel />
          </ErrorBoundary>

          {/* World changes (Phase 4, §17 M1/M6) — the rail's two doors over
              one log: the approvals inbox (the calm batched review moment)
              and the browsable World Changes view. */}
          <ErrorBoundary label="approvals-inbox" fallback={null}>
            <ApprovalsInbox />
          </ErrorBoundary>
          <ErrorBoundary label="world-changes-view" fallback={null}>
            <WorldChangesView />
          </ErrorBoundary>
        </TravelSheet>
      )}

      {/* World map (Rev 116) — the full-screen star map from the Tools
          popup menu. Travelling still happens in the travel panel: the
          map hands over with a focus world, closes, and opens the sheet. */}
      {space && showWorldMap && (
        <ErrorBoundary label="world-map" fallback={null}>
          <WorldMap
            onClose={() => setShowWorldMap(false)}
            onTravelTo={(world) => {
              setShowWorldMap(false);
              openTravel(world);
            }}
          />
        </ErrorBoundary>
      )}

      {/* Worlds surface (Phase 2, P2-4 — the F-01 mount; P3-1 adds the
          garden): the scene for the world travel state places the brain
          in appears here. Same dark contract, same flag. The graph the
          app already holds is the garden's only data source — one
          source of truth, shared with the home galaxy. Verb 1: a tend
          in the garden re-pulls the graph (a line tend plants a new
          node) so the garden's own warm glow refreshes from the same
          source — no fuel toast here, the tend sheet already says it. */}
      {space && (
        <ErrorBoundary label="worlds-surface" fallback={null}>
          <WorldsSurface
            graph={data}
            onChanged={(result) => void refresh(result.newNodeId ? [result.newNodeId] : undefined)}
            getFleetStatus={() => graphRef.current?.getFleetStatus()}
            onFocus={focus}
            onHangarEquipChanged={() => void handleChanged(-1)}
            onGardenChanged={(ids) => void refresh(ids)}
          />
        </ErrorBoundary>
      )}

      {/* Active-lens banner — mirrors "Exit system view"; ✕ restores the full galaxy.
          Batch H (REG-207/208): states the true match total, and the shown subset
          when the match list itself was capped — the view never silently passes
          for the whole lens. */}
      {activeLens && panel === null && (
        <button className="lens-banner" onClick={exitLens} title="Exit this lens">
          ⧉ Lens: {activeLens}
          {activeLensCount != null ? ` · ${activeLensCount.toLocaleString()} match${activeLensCount === 1 ? "" : "es"}` : ""}
          {activeLensCount != null && activeLensShown != null && activeLensShown < activeLensCount ? ` — showing first ${activeLensShown.toLocaleString()}` : ""}
          &nbsp;✕
        </button>
      )}

      {/* Ambient Mind Space: live working-memory thoughts drifting over the galaxy
          (toggled from the 🧠 Mind tab; self-contained + pointer-events:none). */}
      <ErrorBoundary label="mindspace" fallback={null}>
        <MindSpace
          hidden={panel !== null || showChat || showObs}
          onOpenThought={() => {
            setTab("mind");
            setPanel("dock");
          }}
          onOpenMind={() => {
            setTab("mind");
            setPanel("dock");
          }}
        />
      </ErrorBoundary>

      {/* Proactive intelligence: "Soumaya noticed…" — a grounded question about a
          connection she spotted. Hidden while a panel is open so it never covers it.
          Isolated: a fault in the noticing surface must never freeze/blank the app. */}
      <ErrorBoundary label="noticing" fallback={null}>
        {/* Never surface before the cinematic fly-in + Observatory have had their moment:
            gate on obsSettled (true only once the Observatory was shown+closed, or was
            skipped) and hide it while the Observatory is open. */}
        <NoticingCard
          onFocus={focus}
          onAnswered={() => refresh()}
          hidden={panel !== null || showObs || !obsSettled}
          spaceId={space?.id}
        />
      </ErrorBoundary>

      {/* Evolving lore for the focused object (station / ship / beacon). Hidden while a
          panel is open or when dismissed — dismissing keeps the camera focus. */}
      {(followStation || followShip || followSatellite) && panel === null && !loreDismissed && !noticingOpen && (
        <ObjectLoreCard
          kind={followShip ? "ship" : followSatellite ? "satellite" : "station"}
          graph={view}
          onFocus={(id) => focus(id)}
          onClose={() => setLoreDismissed(true)}
        />
      )}

      {/* CL-1b (IM-19): the followed visitor / fleet craft gets its own named
          identity card in-scene — variant/roster name + lore + live status —
          instead of an anonymous craft. Same slot discipline as the lore
          card above (hidden while a panel is open or dismissed). */}
      {sceneIdentity && (followVisitor || followFleet) && panel === null && !sceneCardDismissed && !noticingOpen && (
        <SceneIdentityCard identity={sceneIdentity} onClose={() => setSceneCardDismissed(true)} />
      )}

      {/* CL-1b (IM-19/20/21): shell readouts — who is visiting, what the
          beacon beam is warming, and the audio state — where the scene is
          seen, not only inside panels. Package B (finding #6): the three
          readouts now live in ONE ship-status stack (Drifter chip = header,
          beacon box = body, sounds pill = footer) with a single negotiated
          anchor + height cap, instead of three independently-fixed boxes
          that grew through each other. While the noticed card is up, the
          stack docks in its low slot (§6.5.5). Batch I (REG-068 / GH-15):
          the stack hides under the same shared rule as the Fuel/Streak
          block — it used to stay up over chat/settings/connections. */}
      {!hudChromeHidden({ panel, showChat, showObs, showSettings, showConnections, showTimeline }) && (
        <ShipStatusStack
          belowNoticing={noticingOpen}
          collapsed={!shipStatusOpen}
          onToggle={() => setShipStatusOpen(!shipStatusOpen)}
        >
          {!followVisitor && activeVisitors.length > 0 && (
            <VisitorChip
              visitors={activeVisitors}
              onFollow={() => {
                const on = graphRef.current?.cycleFollowVisitor() ?? false;
                setFollowVisitor(on);
              }}
            />
          )}
          <BeaconReadout status={fleetStatusHud} onFocus={(id) => focus(id)} />
          <AudioStateChip
            sfx={sfxOnHud}
            voice={voiceOnHud}
            music={music}
            onOpenAudioSettings={() => {
              setSettingsFocusAudio(true);
              setShowSettings(true);
            }}
          />
        </ShipStatusStack>
      )}

      {/* CL-1b (IM-23): an empty galaxy names where the first star goes,
          in-scene — the Observatory hero covers arrival, this covers the
          galaxy itself once you're standing in it. Batch I (REG-068 /
          GH-15): same shared hide rule — the cue used to stay up over
          Connections and the Timeline. */}
      {loaded && data.nodes.length === 0 && !hudChromeHidden({ panel, showChat, showObs, showSettings, showConnections, showTimeline }) && (
        <EmptyGalaxyCue onAdd={() => toggle("ingest")} />
      )}

      {/* Right-side-up: a clearly-visible pill (not a buried FAB) whenever you're following
          the ship, since banking + free orbit can leave you looking at her sideways. */}
      {followShip && panel === null && (
        <button
          className="level-pill"
          onClick={() => graphRef.current?.levelShipView()}
          aria-label="Level camera on the ship"
          title="Right-side up — wide, level view of the ship"
        >
          ⭯ Level view
        </button>
      )}

      {clustered && (
        <button
          className="exit-cluster"
          onClick={() => {
            graphRef.current?.exitCluster();
            setClustered(false);
            setActiveLens(null);
          }}
        >
          ✕ Exit system view
        </button>
      )}

      {/* Floating controls — hidden while a panel is open so they never cover it */}
      {panel === null && (
        <>
          <ToolsMenu
            onSearch={() => toggle("search")}
            onLenses={() => setShowLenses(true)}
            onConnections={() => setShowConnections(true)}
            candCount={candCount}
            onReview={() => setShowReview(true)}
            dueCount={dueCount}
            onTimeline={() => setShowTimeline(true)}
            onLegend={() => setShowLegend(true)}
            onWorldMap={() => setShowWorldMap(true)}
            onTravel={WORLDS_TRAVEL_ENABLED ? () => openTravel() : undefined}
            onFlashback={triggerFlashback}
            onFocusMode={() => setFocusMode((v) => !v)}
            focusMode={focusMode}
            onHelp={() => setHelp(true)}
          />
          <NavRail
            onDock={() => toggle("dock")}
            onRecenter={() => {
              graphRef.current?.recenter();
              setFollowShip(false);
              setFollowStation(false);
              setFollowSatellite(false);
              setFollowVisitor(false);
              setFollowFleet(false);
              setFollowFig1(false);
              setFollowFig2(false);
              setFocusMenuOpen(false);
              setClustered(false);
              setActiveLens(null);
            }}
            onZoomIn={() => graphRef.current?.zoomBy(0.8)}
            onZoomOut={() => graphRef.current?.zoomBy(1.25)}
          />
          {/* Package B (finding #6, §6.4): the deep-space focus-mode toggle
              is a real button again, in the camera cluster's bottom slot
              (🎯 → Views circle → this toggle). Its CSS class survived in
              index.css after the button itself was folded into the Tools
              menu, and the orphan slot sat buried under the Views pill and
              faded out whenever the target fan opened. Here it stays
              visible in both states (the fan travels UP from the 🎯; this
              slot is below it) and toggles the same focusMode state as the
              Tools menu entry — two doors to the same room, neither hidden. */}
          <button
            className={`fab fab-focus-toggle ${focusMode ? "on" : ""}`}
            onClick={() => setFocusMode((v) => !v)}
            aria-label={focusMode ? "Exit calm" : "Calm mode"}
            aria-pressed={focusMode}
            title={focusMode ? "Exit deep-space calm mode" : "Deep-space calm mode — dim the chrome for a calm read"}
          >
            {focusMode ? "🌐" : "🌌"}
            <span className="fab-cap">Calm</span>
          </button>
          {/* Game-style focus cluster: one button that pops up the camera targets. */}
          {(() => {
            // Mobile HUD pass (round 2, S3): the fan's targets are a list
            // now so the fan can FOLD on short phone-portrait screens —
            // fanLayout compresses the step and, when all targets still
            // can't fit under the brand-header band, pages them behind a
            // "more" item. Desktop and tall phones render every target in
            // one page, exactly as before. Order is unchanged: ship,
            // station, fleet, then the conditional beacon/visitor/figs.
            const fanVw = typeof window !== "undefined" ? window.innerWidth : 1440;
            const fanVh = typeof window !== "undefined" ? window.innerHeight : 900;
            type FanTarget = {
              key: string;
              className: string;
              ariaLabel: string;
              title: string;
              icon: string;
              /** HUD round 3: the in-button caption (fanTargetCaption —
               *  the ship's is the space's own name, dynamically). */
              caption: string;
              onClick: () => void;
            };
            const targets: FanTarget[] = [
              {
                key: "ship",
                className: `fab focus-item ${followShip ? "on" : ""}`,
                ariaLabel: `Focus ${space?.name ?? "Soumaya"}`,
                title: `Focus ${space?.name ?? "Soumaya"}'s ship`,
                icon: "🛸",
                caption: fanTargetCaption("ship", space?.name),
                onClick: () => {
                  setLoreDismissed(false);
                  setFollowShip(graphRef.current?.toggleFollowShip() ?? false);
                  setFollowStation(false);
                  setFollowSatellite(false);
                  setFollowVisitor(false);
                  setFollowFig1(false);
                  setFollowFig2(false);
                  setFocusMenuOpen(false);
                  setFanPage(0);
                },
              },
              {
                key: "station",
                className: `fab focus-item ${followStation ? "on" : ""}`,
                ariaLabel: "Focus space station",
                title: "Focus the space station",
                icon: "🌐",
                caption: fanTargetCaption("station"),
                onClick: () => {
                  setLoreDismissed(false);
                  setFollowStation(graphRef.current?.toggleFollowStation() ?? false);
                  setFollowShip(false);
                  setFollowSatellite(false);
                  setFollowVisitor(false);
                  setFollowFig1(false);
                  setFollowFig2(false);
                  setFocusMenuOpen(false);
                  setFanPage(0);
                },
              },
              {
                key: "fleet",
                className: `fab focus-item ${followFleet ? "on" : ""}`,
                ariaLabel: "Focus the fleet",
                title: "Jump to her fleet (Escort · Scout · Defender · Tenders)",
                icon: "🛩️",
                caption: fanTargetCaption("fleet"),
                onClick: () => {
                  setLoreDismissed(false);
                  const on = graphRef.current?.cycleFollowFleet() ?? false;
                  setFollowFleet(on);
                  setFollowShip(false);
                  setFollowStation(false);
                  setFollowSatellite(false);
                  setFollowVisitor(false);
                  setFollowFig1(false);
                  setFollowFig2(false);
                },
              },
            ];
            if (satelliteCount > 0) {
              targets.push({
                key: "satellite",
                className: `fab focus-item beacon-item ${followSatellite ? "on" : ""}`,
                ariaLabel: "Jump to an Aura beacon",
                title: `Jump to a beacon (${satelliteCount} deployed over cooling memories)`,
                icon: "🛰️",
                caption: fanTargetCaption("satellite"),
                onClick: () => {
                  const on = graphRef.current?.cycleFollowSatellite() ?? false;
                  setFollowSatellite(on);
                  setFollowShip(false);
                  setFollowStation(false);
                  setFollowVisitor(false);
                  setFollowFig1(false);
                  setFollowFig2(false);
                },
              });
            }
            if (visitorCount > 0) {
              targets.push({
                key: "visitor",
                className: `fab focus-item visitor-item ${followVisitor ? "on" : ""}`,
                ariaLabel: "Jump to a visitor",
                title: `Jump to a visitor (${visitorCount} drifting in)`,
                icon: "👽",
                caption: fanTargetCaption("visitor"),
                onClick: () => {
                  const on = graphRef.current?.cycleFollowVisitor() ?? false;
                  setFollowVisitor(on);
                  setFollowShip(false);
                  setFollowStation(false);
                  setFollowSatellite(false);
                  setFollowFig1(false);
                  setFollowFig2(false);
                },
              });
            }
            if (showFocusFig1 && equippedFig1 !== "none") {
              targets.push({
                key: "fig1",
                className: `fab focus-item ${followFig1 ? "on" : ""}`,
                ariaLabel: `Focus ${getFigurineLabel(equippedFig1)}`,
                title: `Focus ${getFigurineLabel(equippedFig1)}`,
                icon: getFigurineIcon(equippedFig1),
                caption: fanTargetCaption("fig1", undefined, equippedFig1),
                onClick: () => {
                  setLoreDismissed(false);
                  const on = graphRef.current?.toggleFollowFig1() ?? false;
                  setFollowFig1(on);
                  setFollowShip(false);
                  setFollowStation(false);
                  setFollowSatellite(false);
                  setFollowVisitor(false);
                  setFollowFig2(false);
                  setFocusMenuOpen(false);
                  setFanPage(0);
                },
              });
            }
            if (showFocusFig2 && equippedFig2 !== "none") {
              targets.push({
                key: "fig2",
                className: `fab focus-item ${followFig2 ? "on" : ""}`,
                ariaLabel: `Focus ${getFigurineLabel(equippedFig2)}`,
                title: `Focus ${getFigurineLabel(equippedFig2)}`,
                icon: getFigurineIcon(equippedFig2),
                caption: fanTargetCaption("fig2", undefined, equippedFig2),
                onClick: () => {
                  setLoreDismissed(false);
                  const on = graphRef.current?.toggleFollowFig2() ?? false;
                  setFollowFig2(on);
                  setFollowShip(false);
                  setFollowStation(false);
                  setFollowSatellite(false);
                  setFollowVisitor(false);
                  setFollowFig1(false);
                  setFocusMenuOpen(false);
                  setFanPage(0);
                },
              });
            }
            const layout = fanLayout(fanVw, fanVh, targets.length, safeBottomInset);
            const win = fanWindow(targets.length, layout, fanPage);
            const visible = targets.slice(win.start, win.start + win.count);
            return (
              <div className={`focus-cluster ${focusMenuOpen ? "open" : ""}`}>
                {visible.map((t, i) => (
                  <button
                    key={t.key}
                    className={t.className}
                    style={focusItemStyle(i, focusMenuOpen, layout.step, layout.direction)}
                    onClick={t.onClick}
                    aria-label={t.ariaLabel}
                    title={t.title}
                  >
                    {t.icon}
                    <span className="fab-cap">{t.caption}</span>
                  </button>
                ))}
                {layout.folded && (
                  <button
                    className="fab focus-item fan-more"
                    style={focusItemStyle(visible.length, focusMenuOpen, layout.step, layout.direction)}
                    onClick={() => setFanPage((p) => (p + 1) % layout.pageCount)}
                    aria-label={`More focus targets (page ${win.page + 1} of ${layout.pageCount})`}
                    title="More focus targets"
                  >
                    ⋯
                    <span className="fab-cap">{fanTargetCaption("more")}</span>
                  </button>
                )}
                <button
                  className={`fab focus-main ${focusMenuOpen ? "active" : ""} ${
                    (followShip || followStation || followSatellite || followVisitor || followFig1 || followFig2) && !focusMenuOpen ? "on" : ""
                  } ${beaconPulse ? "pulse" : ""}`}
                  onClick={() => {
                    setFocusMenuOpen((o) => !o);
                    setFanPage(0);
                  }}
                  aria-label="Camera focus targets"
                  title="Focus targets (ship · station · beacons · figurines)"
                >
                  {focusMenuOpen ? "✕" : "🎯"}
                  <span className="fab-cap">Focus</span>
                </button>
              </div>
            );
          })()}
          <button
            className={`fab fab-music ${music ? "on" : ""} ${songMenuOpen ? "menu-open" : ""}`}
            onClick={onMusicClick}
            onPointerDown={onMusicPointerDown}
            onPointerUp={onMusicPointerUp}
            onPointerLeave={onMusicPointerUp}
            aria-label="Ambient music: click to play/pause, double-click to skip, hold for the song list"
            title="Click = play/pause · double-click = next · hold = song list"
          >
            {music ? "🔊" : "🔈"}
            <span className="fab-cap">Music</span>
          </button>
          {/* Radial song menu — dots circling the music button (press-and-hold to open).
              Unlockables gate (IM-133): locked tracks render locked with their
              requirement and cannot be picked (playSong also guards). Batch I
              (REG-065 / GH-07): the dots gate on trackLocked, which fails
              CLOSED while stats are in flight — they used to render unlocked
              until the stats arrived. Batch I (REG-066 / GH-08): the gesture
              hint and the locked-track requirements are visible text, not
              hover-only. */}
          {songMenuOpen && (
            <>
            {TRACKS.map((t, i) => {
              const gateItem = unlockableForTrack(t.id);
              const locked = trackLocked(t.id, unlockStats, { devUnlockAll });
              return (
                <button
                  key={t.id}
                  className={`song-dot ${musicTrack?.index === i ? "current" : ""} ${locked ? "locked" : ""}`}
                  style={songDotStyle(i, TRACKS.length)}
                  onClick={() => playSong(i)}
                  disabled={locked}
                  aria-disabled={locked}
                  title={locked ? `🔒 ${t.title} — ${gateItem?.requirementText ?? "Locked"}` : t.title}
                >
                  <span className="song-dot-n">{locked ? "🔒" : i + 1}</span>
                  <span className="song-dot-name">{t.title}</span>
                </button>
              );
            })}
            <div className="song-menu-notes">
              <div className="song-menu-hint" role="note">
                Tap play/pause · double-tap skip · hold for songs
              </div>
              {lockedTrackNotes(TRACKS.map((t) => t.id), unlockStats, { devUnlockAll }).map((n) => (
                <div key={n.id} className="song-lock-notes" role="note">
                  🔒 {TRACKS.find((t) => t.id === n.id)?.title ?? n.id} — unlocks at {n.requirement}
                </div>
              ))}
            </div>
            </>
          )}
          {music && musicTrack && nowPlayingVisible && (
            <button
              className="now-playing"
              onClick={nextMusic}
              title="Skip to the next track"
              aria-label={`Now playing ${musicTrack.title}, track ${musicTrack.index + 1} of ${musicTrack.total}. Click to skip.`}
            >
              <span className="np-eq"><i /><i /><i /></span>
              <span className="np-title">{musicTrack.title}</span>
              <span className="np-count">{musicTrack.index + 1}/{musicTrack.total}</span>
              {/* Batch I (REG-066 / GH-08): the skip is labelled in visible
                  text — the ⏭ glyph alone said nothing on touch. */}
              <span className="np-skip">⏭ Skip</span>
            </button>
          )}
          <ActionRail
            onIngest={() => toggle("ingest")}
            onObservatory={() => setShowObs(true)}
            onChat={() => {
              setShowChat((v) => !v);
              setChatPulse(false);
            }}
            chatActive={showChat}
            chatPulse={chatPulse}
            spaceName={space?.name ?? ""}
            onSettings={() => setShowSettings(true)}
          />
        </>
      )}

      {showSettings && space && (
        <SettingsPanel
          onClose={() => {
            setShowSettings(false);
            setSettingsFocusAudio(false);
          }}
          onProfileUpdated={(name) => setSpace((s) => (s ? { ...s, name } : s))}
          onBrainDeleted={() => {
            // The brain is deleted server-side and AccountSettings already
            // cleared the local credential via logoutSpace(); mirror the
            // switch-brain handler above so the app returns to the login
            // screen with no stale in-memory state — including the armed
            // journey (REG-159/JN-01): the dock must not remount on the next
            // login with the old journey armed in the new space.
            logoutSpace();
            setSpace(null);
            setData({ nodes: [], links: [] });
            setSelected(null);
            setPanel(null);
            setShowChat(false);
            setPendingJourneyId(null);
            setPendingJourneyTitle(null);
            setShowSettings(false);
          }}
          focusAudio={settingsFocusAudio}
        />
      )}

      {showConnections && space && (
        <ConnectionsPanel
          onClose={() => setShowConnections(false)}
          onChanged={() => void refresh()}
          onFocus={(id) => { setShowConnections(false); focus(id); }}
        />
      )}

      {showTimeline && space && (
        <TimelineView
          spaceName={space.name}
          nodes={data.nodes as GraphNode[]}
          onClose={() => setShowTimeline(false)}
          onFocus={(id) => { setShowTimeline(false); focus(id); }}
        />
      )}

      {showReview && space && (
        <ReviewPanel
          onClose={() => setShowReview(false)}
          onFocus={(id) => { setShowReview(false); focus(id); }}
        />
      )}

      {showFuelWays && space && (
        <FuelEarnSheet
          fuel={fuel}
          onClose={() => setShowFuelWays(false)}
          onAction={(kind: EarnKind) => {
            setShowFuelWays(false);
            if (kind === "memory") {
              setPanel("ingest");
            } else if (kind === "action") {
              setTab("actions");
              setPanel("dock");
            } else if (kind === "recall") {
              setShowReview(true);
            } else if (kind === "codex") {
              setTab("awards");
              setPanel("dock");
            } else {
              // "mind" + "thought" both live in the Mind tab (thought capture is at its top).
              setTab("mind");
              setPanel("dock");
            }
          }}
        />
      )}

      {showChat && space && (
        <ChatDock
          spaceName={space.name}
          hasMemories={data.nodes.length > 0}
          onClose={() => { setShowChat(false); setChatSeed(null); }}
          seedQuestion={chatSeed}
          onFocus={(id) => focus(id)}
          onRecall={(ids) => graphRef.current?.fireRecall(ids)}
          onCreated={(ids) => void refresh(ids)}
          proactiveContext={pendingProactiveContext}
          onConsumeProactiveContext={() => setPendingProactiveContext(null)}
          journeyId={pendingJourneyId}
          journeyTitle={pendingJourneyTitle}
          onConsumeJourneyContext={() => { setPendingJourneyId(null); setPendingJourneyTitle(null); }}
          onNavigate={(nav) => {
            // Maya Chat → Galaxy Navigation: user clicked the chip — this is the ONLY
            // trigger, never automatic. Same imperative path + safety as a direct click
            // on a Journey hub/Money-sky star (Graph3D's flyToGalaxyEntity, I3) — never
            // followRef, never a second camera implementation.
            const kind = galaxyEntityKindFromRef(nav.target);
            if (!kind) return;
            const flew = graphRef.current?.flyToGalaxyEntity(kind, nav.target.id) ?? false;
            const icon = kind === "journey" ? "🧭" : "💵";
            // CH-02: a failed flight must not wear the success wording —
            // the old toast read identically whether she flew or not.
            if (flew) {
              pushToast(`${icon} ${nav.target.label ?? "Navigating"} — ${nav.reason}`, icon, 7000);
            } else {
              pushToast(`${icon} Couldn't fly to ${nav.target.label ?? "that"} — she couldn't find it in your galaxy.`, "⚠️", 5000);
            }
          }}
        />
      )}

      {showWealthFullscreen && space && <WealthFullscreen onClose={() => setShowWealthFullscreen(false)} />}
      {showFinanceFullscreen && space && <FinanceFullscreen onClose={() => setShowFinanceFullscreen(false)} />}

      {showObs && space && (
        <Observatory
          spaceName={space.name}
          spaceId={space.id}
          memories={(data.nodes as GraphNode[]).filter((n) => n.kind !== "action")}
          actionCount={(data.nodes as GraphNode[]).filter((n) => n.kind === "action").length}
          streak={streak?.current ?? 0}
          fedToday={!!streak?.today}
          away={awayDigest}
          onCapture={() => {
            dismissObs();
            setPanel("ingest");
          }}
          onFocus={(id) => {
            dismissObs();
            focus(id);
          }}
          onOpenInsights={() => {
            dismissObs();
            setTab("insights");
            setPanel("dock");
          }}
          onEnter={dismissObs}
          onOpenTab={(t) => {
            dismissObs();
            setTab(t as any);
            setPanel("dock");
          }}
          onSearch={() => {
            dismissObs();
            setPanel("search");
          }}
          onAnswered={() => {
            // OB-06: the answer changed graph + streak state — refresh
            // both through the existing paths (refresh() for the graph/
            // fuel, the same getStreak the 30s poll uses) so the quests
            // card, header streak and "Jump back in" agree with the
            // answer's toast immediately, not at the next poll/close.
            void refresh();
            void getStreak().then((s) => { if (s) setStreak(s); }).catch(() => {});
          }}
        />
      )}

      {panel === "search" && <SearchBox onFocus={focus} onClose={() => setPanel(null)} initialSession={searchSession} onSessionChange={setSearchSession} />}
      {panel === "ingest" && (
        <IngestPanel
          key={ingestSeed ? `share-${ingestSeed.nonce}` : "capture"}
          initialText={ingestSeed?.text}
          onIngested={refresh}
          onClose={() => {
            setPanel(null);
            setIngestSeed(null);
          }}
        />
      )}
      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onCommand={runPaletteCommand}
          onFocusNode={(id) => {
            // SP-01: only close once the jump actually landed — closing
            // first mimicked a successful jump when focus silently no-opped.
            void focus(id).then((ok) => {
              if (ok) setShowPalette(false);
            });
          }}
        />
      )}
      {panel === "dock" && (
        // Isolated like the galaxy/mindspace/noticing surfaces: a render throw in
        // ANY dock panel (e.g. the Mind tab) degrades the dock to a contained note
        // instead of unmounting the whole app.
        <ErrorBoundary
          label="dock"
          fallback={
            <div className="galaxy-off-note galaxy-err" role="alert">
              <span>⚠️ This panel hit an error</span>
              <button onClick={() => setPanel(null)}>Close panel</button>
            </div>
          }
        >
        <RightDock
          spaceName={space?.name ?? "Soumaya"}
          tab={tab}
          setTab={setTab}
          selected={selected}
          graph={view}
          onFocus={focus}
          onChanged={handleChanged}
          onDeleted={handleDeleted}
          onIsolate={(id) => {
            graphRef.current?.isolateSystem(id);
            setClustered(true);
            setActiveLens(null);
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
          onBack={back}
          canBack={history.length > 0}
          getFleetStatus={() => graphRef.current?.getFleetStatus()}
          showShipTask={showShipTask}
          setShowShipTask={setShowShipTask}
          shipViewMode={shipViewMode}
          setShipViewMode={setShipViewMode}
          tasks={tasks}
          onReorderTasks={handleReorderTasks}
          fuel={fuel}
          streak={streak}
          spaceId={space?.id ?? ""}
          onPromoted={() => void refresh()}
          focusJourney={focusJourney}
          focusGoal={focusGoal}
          focusBill={focusBill}
          onCapture={() => setPanel("ingest")}
          unlockStats={unlockStats}
          devUnlockAll={devUnlockAll}
          onViewInGalaxy={handleViewInGalaxy}
          onPlayTrack={playSong}
          currentTrackIndex={musicTrack?.index ?? null}
          musicPlaying={music}
          previewTrail={previewTrail}
          onPreviewTrail={handlePreviewTrail}
          onAskJourney={(j) => {
            // Phase AC.1 — Journey → Chat: reuses the exact one-shot handoff pattern
            // Phase Y/Z already established for proactiveContext, just keyed by a
            // Journey id instead of a proactive source. No new scoping system.
            setPendingJourneyId(j.id);
            setPendingJourneyTitle(j.title);
            setShowChat(true);
            pushToast(`🧭 Opening chat about "${j.title}"`, "🧭", 3500);
          }}
        />
        </ErrorBoundary>
      )}
    </div>
  );
}
