import { useEffect, useRef, useState } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { currentSpace, updateProfile } from "../api/client.js";
import { AccountSettings } from "./AccountSettings.js";
import { isVoiceEnabled, setVoiceEnabled, isVoiceSupported } from "../voice.js";
import { sfxEnabled, setSfxEnabled } from "../graph/sfx.js";
import { isColorblind, setColorblind } from "../graph/theme.js";
import { prefersReducedMotion, setReducedMotionOverride } from "../graph/motion.js";
import {
  isDiagnosticsEnabled,
  setDiagnosticsEnabled,
} from "../diagnostics/config.js";
import {
  clearDiagnosticEvents,
  getDiagnosticSnapshot,
} from "../diagnostics/buffer.js";
import {
  getGraphics,
  setGraphicsMode,
  setGraphicsField,
  resolveGraphics,
  GRAPHICS_MODES,
  type GraphicsSettings,
  type Level,
} from "../graph/graphicsConfig.js";
import { perfHudEnabled, setPerfHudEnabled } from "./PerfHUD.js";
import { PushToggle } from "./PushToggle.js";
import { getModelFallbacks } from "../graph/gltf.js";
import { ModelFallbackNote } from "./GalaxyHud.js";
import {
  isBoundedLinksEnabled,
  setBoundedLinksEnabled,
  getDetailedLinkBudget,
  setDetailedLinkBudget,
  DEFAULT_DETAILED_LINK_BUDGET,
} from "../graph/renderModel.js";
import { pushToast } from "./Toasts.js";
import { getUsage, getToolHealth, getSettings, updateSetting, type Usage, type ToolHealth } from "../api/ops.js";
import { getSpacePreferences, updateSpacePreferences, getGraphExport, type SpacePreferences } from "../api/preferences.js";
import { setSpaceTimeZone, deviceTimeZone } from "../utils/spaceTimezone.js";
import { loadPersistedRung, RUNG_TABLE, ADAPTIVE_MODEL_VERSION } from "../graph/adaptiveController.js";
import {
  startSweep,
  isSweepActive,
  getSweepProgressLabel,
  getSweepReport,
  clearSweepReport,
  type SweepResult,
} from "../graph/galaxySweep.js";
import { isComposerBypassEnabled, setComposerBypassEnabled } from "../graph/composerBypassDiag.js";
import {
  runAutoDiag,
  isAutoDiagAvailable,
  setAutoDiagProgressListener,
  formatReportText,
  type AutoDiagReport,
} from "../graph/autoRenderDiag.js";
import {
  captureGalaxySnapshot,
  isSnapshotCaptureAvailable,
  diffSnapshots,
  formatComparisonText,
  formatFullSnapshotText,
  type GalaxyDiagSnapshot,
} from "../graph/galaxyStateSnapshot.js";

/** Common IANA zones for the IM-129 timezone picker; a space already set to
 *  any other valid zone gets its own value prepended in the <select>.
 *  REG-216: "UTC" is NOT offered — the TIMEZONE RULE (no UTC in anything
 *  user-facing, ever) is broken by this one control otherwise. The server
 *  still accepts UTC as a stored fallback; a space already stored as UTC
 *  shows the device zone here instead (see tzValue below). */
const TZ_CHOICES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
  "America/Toronto", "America/Mexico_City", "America/Sao_Paulo",
  "Europe/London", "Europe/Paris", "Europe/Moscow",
  "Africa/Lagos", "Africa/Johannesburg", "Asia/Dubai", "Asia/Karachi",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
  "Pacific/Auckland",
];

/** Was defined INSIDE SettingsPanel's render body — a fresh function identity on
 *  every render, which React treats as a brand-new component type. This panel
 *  re-renders ~2x/sec while open (the live FPS sampler below), so all 6 `<Seg>`
 *  usages were fully unmounting and remounting their DOM twice a second. */
function Seg<T extends string>({ value, options, onPick }: { value: T; options: T[]; onPick: (v: T) => void }) {
  return (
    <span className="seg">
      {options.map((o) => (
        <button key={o} className={value === o ? "on" : ""} onClick={() => onPick(o)}>
          {o[0]!.toUpperCase() + o.slice(1)}
        </button>
      ))}
    </span>
  );
}

/**
 * Copy text to the clipboard with an honest success/failure toast — never silently
 * "succeeds." The pre-existing single "Copy comparison" button (still present below)
 * only ever wrapped `navigator.clipboard.writeText(...)` in a `.then()/.catch()` chain,
 * which only catches an ASYNC rejection (e.g. a permission prompt the user dismissed) —
 * on a browser/webview where `navigator.clipboard` itself is unavailable (older Android
 * WebViews, some embedded/PWA contexts, non-HTTPS origins), merely accessing
 * `.writeText` throws SYNCHRONOUSLY, before any promise chain even exists, which an
 * onClick handler with no surrounding try/catch swallows with zero feedback — matching
 * exactly the reported "did not reliably put the data into my Android clipboard," with
 * no error shown either. This wraps the whole call in try/catch and treats a missing
 * `navigator.clipboard` as its own explicit failure case, so every copy action here
 * (BAD/GOOD/comparison) either genuinely succeeds or says so.
 */
function copyTextWithFeedback(text: string, successMessage: string): void {
  try {
    const promise = navigator.clipboard?.writeText(text);
    if (!promise) {
      pushToast("Clipboard isn't available in this browser — couldn't copy.", "⚠️", 4000);
      return;
    }
    promise
      .then(() => pushToast(successMessage, "📋", 3000))
      .catch(() => pushToast("Couldn't copy — your browser blocked clipboard access.", "⚠️", 4000));
  } catch {
    pushToast("Couldn't copy — clipboard access isn't available here.", "⚠️", 4000);
  }
}

/**
 * Settings overlay (⚙️). Account (display name + unique gamer tag) plus app
 * preferences. Opened from a FAB; floats over the galaxy like the Observatory.
 * IM-128: Research Mode lives HERE too now — the same server setting the
 * Soumaya tab flips (one store, two surfaces, no duplicate state) — alongside
 * a usage/budget summary (incl. the token counts nothing used to display) and
 * a tool-health summary with a deep-link to her tab's full views.
 * IM-129: "Your time & notifications" writes the space's real timezone +
 * proactive-notification preferences, and "Your data" downloads a graph-JSON
 * export. IM-127: every render-diagnostics apparatus sits behind the
 * Developer/Advanced disclosure at the bottom, closed by default.
 */
export function SettingsPanel({
  onClose,
  onProfileUpdated,
  onBrainDeleted,
  focusAudio,
}: {
  onClose: () => void;
  /** Push the new display name back to the app header. */
  onProfileUpdated?: (name: string) => void;
  /** Called after this brain was deleted from the danger zone (and the local
   *  credential cleared), so the app can return to the login screen. */
  onBrainDeleted?: () => void;
  /** IM-21: opened from the shell's audio chip — scroll the audio
   *  (Preferences) section into view once mounted. */
  focusAudio?: boolean;
}) {
  const [name, setName] = useState("");
  const [gamerTag, setGamerTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [profileDirty, setProfileDirty] = useState(false);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (msgTimer.current) clearTimeout(msgTimer.current);
  }, []);
  const [voice, setVoice] = useState(isVoiceEnabled());
  const [sfx, setSfx] = useState(sfxEnabled());
  const [gfx, setGfx] = useState<GraphicsSettings>(getGraphics());
  const [liteOn, setLiteOn] = useState(() => {
    try { return localStorage.getItem("brain.lite") === "1"; } catch { return false; }
  });
  const [colorblind, setCb] = useState(isColorblind());
  const [reduceMotion, setRm] = useState(prefersReducedMotion());
  const [diagnosticsOn, setDiagnosticsOn] = useState(isDiagnosticsEnabled());
  // IM-24: glTF models that failed to load (procedural stand-ins are shown
  // instead) — surfaced here in diagnostics instead of console-only.
  const [modelFallbacks, setModelFallbacks] = useState<string[]>(() => getModelFallbacks());
  useEffect(() => {
    const sync = () => setModelFallbacks(getModelFallbacks());
    window.addEventListener("brain-model-fallback", sync);
    return () => window.removeEventListener("brain-model-fallback", sync);
  }, []);
  // IM-21 deep-link: bring the audio section into view when asked.
  useEffect(() => {
    if (!focusAudio) return;
    const t = setTimeout(() => {
      document.getElementById("settings-audio")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [focusAudio]);
  const [perfHudOn, setPerfHudOn] = useState(perfHudEnabled());
  // Phase 2.1 real-device A/B (soumaya-galaxy-bounded-render-architecture.md) — was
  // URL-param-only (?boundedLinks=1&linkBudget=NNN), which is unusable for anyone who
  // can't edit the address bar (an installed PWA, a phone browser without a visible
  // URL field). Both toggles reload immediately after writing, matching this file's own
  // "lite mode" toggle convention — Graph3D reads these once at mount, not live.
  const [boundedLinksOn, setBoundedLinksOnState] = useState(isBoundedLinksEnabled());
  const [linkBudget, setLinkBudgetState] = useState(String(getDetailedLinkBudget()));
  const [diagReport, setDiagReport] = useState<string | null>(null);
  // Render-isolation sweep (galaxySweep.ts) — the no-URL-typing alternative to
  // perfDiag.ts's `?galaxyDiag=1&category=0` params. `sweepActive`/`sweepReport` are
  // read once at mount: a sweep step reloads the page between measurements, so this
  // panel only ever needs to reflect "the state as of THIS load" rather than track a
  // live in-page transition.
  const [sweepActive] = useState(isSweepActive());
  const [sweepProgress] = useState(getSweepProgressLabel());
  const [sweepReport, setSweepReport] = useState<SweepResult[] | null>(getSweepReport());
  // Diagnostic-only (composerBypassDiag.ts) — off by default; see that file's doc
  // comment. Same reload-after-toggle convention as boundedLinksOn just below.
  const [composerBypassOn, setComposerBypassOnState] = useState(isComposerBypassEnabled());
  // Automated in-session diagnostic (autoRenderDiag.ts) — runs entirely within THIS
  // page load (no reload between conditions, see that file's doc comment for why).
  const [autoDiagRunning, setAutoDiagRunning] = useState(false);
  const [autoDiagProgress, setAutoDiagProgressState] = useState<string | null>(null);
  const [autoDiagReport, setAutoDiagReport] = useState<AutoDiagReport | null>(null);
  // If this panel closes mid-run, stop pushing progress updates into now-unmounted
  // state — the harness itself keeps running to completion regardless (it doesn't
  // depend on this panel staying open) and safely restores state either way.
  useEffect(() => () => setAutoDiagProgressListener(null), []);
  // BAD-vs-GOOD state snapshot (galaxyStateSnapshot.ts) — no automation, no toggling:
  // the user captures whatever state the Galaxy is ALREADY in, twice, once while it's
  // bad and once after it's gone fast (e.g. opening a View/Lens). Kept in this panel's
  // own state (not persisted) — a fresh comparison each time this panel is opened.
  const [badSnapshot, setBadSnapshot] = useState<GalaxyDiagSnapshot | null>(null);
  const [goodSnapshot, setGoodSnapshot] = useState<GalaxyDiagSnapshot | null>(null);
  const voiceSupported = isVoiceSupported();
  // Stage 6: reflect the adaptive controller's last-persisted rung (auto mode only —
  // resolveGraphics ignores it otherwise) so this label shows what's actually
  // rendering, not just the one-shot detectTier() guess. Re-read on every render; the
  // FPS sampler below already re-renders this panel ~2x/sec while it's open, so this
  // stays reasonably live without any extra event wiring.
  const persistedRung = loadPersistedRung(ADAPTIVE_MODEL_VERSION);
  const resolved = resolveGraphics(gfx, persistedRung ? RUNG_TABLE[persistedRung.rung] : undefined);

  // Live FPS while this panel is open, so a graphics change visibly bites (the galaxy
  // keeps rendering behind the overlay). Sampled every 500ms.
  const [fps, setFps] = useState<number | null>(null);
  const fpsRef = useRef({ frames: 0, t0: 0, raf: 0 });
  useEffect(() => {
    const st = fpsRef.current;
    st.t0 = performance.now();
    const tick = () => {
      st.frames++;
      const now = performance.now();
      if (now - st.t0 >= 500) {
        setFps(Math.round((st.frames * 1000) / (now - st.t0)));
        st.frames = 0;
        st.t0 = now;
      }
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(st.raf);
  }, []);
  const fpsClass = fps == null ? "" : fps >= 45 ? "good" : fps >= 25 ? "ok" : "bad";

  // IM-127: the whole render-diagnostics apparatus (diagnostic recording,
  // isolation sweep, composer bypass, automated diag, BAD/GOOD snapshots) is
  // fenced behind this disclosure — closed by default, nothing deleted.
  const [devOpen, setDevOpen] = useState(false);
  // IM-128: ops data (usage incl. token counts, budget, tool health) +
  // Research Mode — read from the same api/ops.ts store the Soumaya tab uses.
  const [usage, setUsage] = useState<Usage | null>(null);
  const [toolHealth, setToolHealth] = useState<ToolHealth[]>([]);
  const [researchOn, setResearchOn] = useState(false);
  // IM-129: space timezone + notification preferences (server store) and export.
  const [prefs, setPrefs] = useState<SpacePreferences | null>(null);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  // REG-216: the timezone the picker shows — a space stored as UTC (server
  // fallback only) displays the device zone, never a UTC option.
  const tzValue = prefs == null ? "" : (prefs.timezone === "UTC" ? deviceTimeZone() : prefs.timezone);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [u, th, st, p] = await Promise.all([
        getUsage().catch(() => null),
        getToolHealth().catch(() => [] as ToolHealth[]),
        getSettings().catch(() => ({}) as Record<string, string>),
        getSpacePreferences().catch(() => null),
      ]);
      if (cancelled) return;
      if (u) setUsage(u);
      setToolHealth(th);
      setResearchOn(st.research_enabled === "true");
      if (p) {
        setPrefs(p);
        // Audit-2 item 2: refresh the shared space-timezone cache from
        // the store we just read, so every day derivation follows it.
        setSpaceTimeZone(p.timezone);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Same write path + honesty contract as the Soumaya tab's toggle (CL-7):
  // flip optimistically, roll back and toast if the server doesn't confirm.
  const toggleResearch = async () => {
    const prev = researchOn;
    const next = !prev;
    setResearchOn(next);
    try {
      const r = await updateSetting("research_enabled", String(next));
      if (!r || r.ok !== true) throw new Error("setting rejected");
    } catch {
      setResearchOn(prev);
      pushToast("Couldn't save Research Mode — it's still " + (prev ? "on." : "off."), "⚠️", 4000);
    }
  };

  const openSoumayaTab = () => {
    // REG-217: this button closes the panel like the × does — a dirty
    // profile or notification prefs must ask first, same as every other
    // close path, or the edit is lost silently.
    if (!confirmDiscardUnsaved()) return;
    try { window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "tab", value: "soumaya" } })); } catch { /* no window */ }
    onClose();
  };

  const savePrefs = async () => {
    if (!prefs) return;
    setPrefsBusy(true);
    setPrefsMsg("");
    try {
      const saved = await updateSpacePreferences(prefs);
      setPrefs(saved);
      // Audit-2 item 2: a Settings timezone change refreshes the shared
      // cache immediately — derivations app-wide follow the new zone
      // without a reload.
      setSpaceTimeZone(saved.timezone);
      setPrefsDirty(false);
      setPrefsMsg("Saved ✓");
    } catch (err) {
      setPrefsMsg((err as Error).message);
    } finally {
      setPrefsBusy(false);
    }
  };

  const downloadExport = async () => {
    setExporting(true);
    try {
      const data = await getGraphExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "brain-export.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      pushToast(`Exported ${data.nodes.length} memories and ${data.edges.length} connections.`, "💾", 4000);
    } catch {
      pushToast("Couldn't export — please try again.", "⚠️", 4000);
    } finally {
      setExporting(false);
    }
  };

  const pickMode = (m: GraphicsSettings["mode"]) => setGfx(setGraphicsMode(m));
  const setField = <K extends keyof GraphicsSettings>(k: K, v: GraphicsSettings[K]) => setGfx(setGraphicsField(k, v));

  useEffect(() => {
    let cancelled = false;
    currentSpace()
      .then((s) => {
        if (cancelled || !s) return;
        setName(s.name ?? "");
        setGamerTag(s.gamerTag ?? "");
      })
      .catch(() => { /* profile fields just stay blank — nothing to save yet */ });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProfile = async () => {
    setBusy(true);
    setMsg("");
    try {
      const updated = await updateProfile({ name: name.trim(), gamerTag: gamerTag.trim() });
      setName(updated.name);
      setGamerTag(updated.gamerTag);
      setProfileDirty(false);
      onProfileUpdated?.(updated.name);
      setMsg("Saved ✓");
      if (msgTimer.current) clearTimeout(msgTimer.current);
      msgTimer.current = setTimeout(() => setMsg(""), 2000);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    setVoiceEnabled(next);
  };

  const cardRef = useRef<HTMLDivElement>(null);
  /** REG-217: the unsaved-edit guard covers notification prefs as well as
   *  the profile — closing (or reloading) with either dirty asks first,
   *  naming what would be lost. */
  const confirmDiscardUnsaved = (): boolean => {
    if (profileDirty && prefsDirty) return confirm("You have unsaved profile and notification changes that will be lost. Continue?");
    if (profileDirty) return confirm("You have an unsaved profile change that will be lost. Continue?");
    if (prefsDirty) return confirm("You have unsaved notification settings that will be lost. Continue?");
    return true;
  };
  const closeWithConfirm = () => {
    // Backdrop-click and Escape are new (this dialog had neither before) —
    // must not bypass the unsaved-edit guard the × button already respects.
    if (!confirmDiscardUnsaved()) return;
    onClose();
  };
  useDialogA11y(cardRef, closeWithConfirm);

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings" onClick={closeWithConfirm}>
      <div className="settings-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <h2>⚙️ Settings</h2>
          <button className="settings-close" onClick={closeWithConfirm} aria-label="Close">×</button>
        </header>

        <section className="settings-section">
          <h3>Account</h3>
          <label className="settings-field">
            <span>Display name</span>
            <input
              value={name}
              maxLength={40}
              disabled={busy}
              onChange={(e) => { setName(e.target.value); setProfileDirty(true); }}
              placeholder="Your name (anything)"
            />
          </label>
          <label className="settings-field">
            <span>Gamer tag <em>(unique)</em></span>
            <input
              value={gamerTag}
              maxLength={40}
              disabled={busy}
              onChange={(e) => { setGamerTag(e.target.value); setProfileDirty(true); }}
              placeholder="A unique handle"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
          <div className="row">
            <button onClick={saveProfile} disabled={busy || gamerTag.trim().length < 2 || name.trim().length < 1}>
              {busy ? "Saving…" : "Save profile"}
            </button>
            <span className="msg">{msg}</span>
          </div>
        </section>

        {/* Account security (IM-129): passcode change + brain deletion. Self-
            contained in AccountSettings; it confirms against the gamer tag
            loaded above (the same value the server checks). */}
        <AccountSettings gamerTag={gamerTag} onBrainDeleted={onBrainDeleted} />

        <section className="settings-section" id="settings-audio">
          <h3>Preferences</h3>
          {/* IM-128: Research Mode's toggle lives here too — the SAME
              per-space server setting the Soumaya tab flips (api/ops.ts
              updateSetting), so the two surfaces can never drift: each reads
              and writes the one store. Her floating task label stays hers. */}
          <label className="settings-toggle">
            <span>
              Research Mode
              <em>She spends fuel to research memories in Research Mode and forge new links. Same switch as in the 🛰️ Soumaya tab — one setting, both places.</em>
            </span>
            <button className={`switch ${researchOn ? "on" : ""}`} onClick={() => void toggleResearch()} aria-pressed={researchOn}>
              <span className="knob" />
            </button>
          </label>
          {voiceSupported && (
            <label className="settings-toggle">
              <span>
                Voice replies
                <em>She reads chat answers aloud.</em>
              </span>
              <button className={`switch ${voice ? "on" : ""}`} onClick={toggleVoice} aria-pressed={voice}>
                <span className="knob" />
              </button>
            </label>
          )}
          <label className="settings-toggle">
            <span>
              Interface sounds
              <em>Soft taps &amp; cues for clicks, saves, and notifications.</em>
            </span>
            <button
              className={`switch ${sfx ? "on" : ""}`}
              onClick={() => {
                const next = !sfx;
                setSfx(next);
                setSfxEnabled(next);
              }}
              aria-pressed={sfx}
            >
              <span className="knob" />
            </button>
          </label>
        </section>

        {/* Web push (CL3): self-contained — renders its own section only when
            the browser supports push AND the server has VAPID configured;
            otherwise it renders nothing at all. */}
        <PushToggle />

        <section className="settings-section">
          <h3>♿ Accessibility</h3>
          <label className="settings-toggle">
            <span>
              Colorblind-safe colours
              <em>Swaps the link/emotion palette to blue · orange · grey (the Legend follows).</em>
            </span>
            <button
              className={`switch ${colorblind ? "on" : ""}`}
              onClick={() => {
                const next = !colorblind;
                setCb(next);
                setColorblind(next);
              }}
              aria-pressed={colorblind}
            >
              <span className="knob" />
            </button>
          </label>
          <label className="settings-toggle">
            <span>
              Reduce motion
              <em>Calms the galaxy — slows orbital drift, ribbon flow &amp; glow pulsing; skips link sparks.</em>
            </span>
            <button
              className={`switch ${reduceMotion ? "on" : ""}`}
              onClick={() => {
                const next = !reduceMotion;
                setRm(next);
                setReducedMotionOverride(next);
              }}
              aria-pressed={reduceMotion}
            >
              <span className="knob" />
            </button>
          </label>
        </section>

        <section className="settings-section">
          <h3>🕐 Your time &amp; notifications</h3>
          <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "0 0 10px" }}>
            Your timezone drives her sense of "today" — the daily digest, streaks and reminders.
            Quiet hours, the digest time and the daily cap are enforced by the server: they decide
            when Soumaya may reach out proactively. Your Inbox keeps the digests, insights,
            discoveries, and bill-risk warnings she sends — other messages, like reminders and
            check-ins, live only in the chat where they arrived.
          </p>
          {prefs ? (
            <>
              <label className="settings-field">
                <span>Timezone</span>
                <select
                  value={tzValue}
                  disabled={prefsBusy}
                  onChange={(e) => { setPrefs({ ...prefs, timezone: e.target.value }); setPrefsDirty(true); }}
                >
                  {(TZ_CHOICES.includes(tzValue) ? TZ_CHOICES : [tzValue, ...TZ_CHOICES]).map((tz) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>Quiet hours start</span>
                <input type="time" value={prefs.quietStart} disabled={prefsBusy}
                  onChange={(e) => { setPrefs({ ...prefs, quietStart: e.target.value }); setPrefsDirty(true); }} />
              </label>
              <label className="settings-field">
                <span>Quiet hours end</span>
                <input type="time" value={prefs.quietEnd} disabled={prefsBusy}
                  onChange={(e) => { setPrefs({ ...prefs, quietEnd: e.target.value }); setPrefsDirty(true); }} />
              </label>
              <label className="settings-field">
                <span>Daily digest time</span>
                <input type="time" value={prefs.digestTime} disabled={prefsBusy}
                  onChange={(e) => { setPrefs({ ...prefs, digestTime: e.target.value }); setPrefsDirty(true); }} />
              </label>
              <label className="settings-field">
                <span>Max proactive messages per day</span>
                <input type="number" min={0} max={100} value={prefs.dailyProactiveCap} disabled={prefsBusy}
                  onChange={(e) => { setPrefs({ ...prefs, dailyProactiveCap: Number(e.target.value) }); setPrefsDirty(true); }} />
              </label>
              <div className="row">
                <button onClick={() => void savePrefs()} disabled={!prefsDirty || prefsBusy}>
                  {prefsBusy ? "Saving…" : "Save time & notifications"}
                </button>
                <span className="msg">{prefsMsg}</span>
              </div>
            </>
          ) : (
            <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Couldn't load these settings — reopen Settings to retry.</p>
          )}
        </section>

        <section className="settings-section">
          <h3>📊 Usage &amp; operations</h3>
          {usage ? (
            <>
              <div className="gfx-row"><span>Estimated cloud-AI spend</span><span>${usage.estCostUsd.toFixed(3)} / ${usage.budgetUsd.toFixed(2)}</span></div>
              <div className="gfx-row"><span>Budget remaining</span><span>${usage.remainingUsd.toFixed(2)}</span></div>
              <div className="gfx-row"><span>Tokens in</span><span>{usage.inputTokens.toLocaleString()}</span></div>
              <div className="gfx-row"><span>Tokens out</span><span>{usage.outputTokens.toLocaleString()}</span></div>
            </>
          ) : (
            <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Usage data isn't available right now.</p>
          )}
          <div className="gfx-row">
            <span>Background tools</span>
            <span>{toolHealth.length > 0 ? `${toolHealth.length} tracked · ${toolHealth.filter((t) => t.lastRanAt).length} have run` : "none recorded yet"}</span>
          </div>
          <div className="row" style={{ marginTop: "10px" }}>
            <button className="mini" onClick={openSoumayaTab}>🛰️ Open the Soumaya tab for full logs &amp; budget controls</button>
          </div>
        </section>

        <section className="settings-section">
          <h3>💾 Your data</h3>
          <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "0 0 10px" }}>
            Download your whole brain as a JSON file — every memory and connection, in a format other
            tools can read. (For reading instead, the Browse tab exports Markdown.)
          </p>
          <button onClick={() => void downloadExport()} disabled={exporting}>
            {exporting ? "Preparing…" : "⬇ Download brain export (JSON)"}
          </button>
        </section>

        <section className="settings-section">
          <h3>🛠 Developer / Advanced</h3>
          <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "0 0 10px" }}>
            Render diagnostics for troubleshooting a slow or broken galaxy — recording,
            isolation sweeps, and state snapshots. Not part of everyday use; hidden unless you open it.
          </p>
          <button className="mini" aria-expanded={devOpen} onClick={() => setDevOpen(!devOpen)}>
            {devOpen ? "Hide developer tools" : "Show developer tools"}
          </button>
        </section>

        {devOpen && (
          <>
        <section className="settings-section">
          <h3>🔬 Diagnostics</h3>
          <ModelFallbackNote assets={modelFallbacks} />
          <label className="settings-toggle">
            <span>
              Diagnostic recording
              <em>{diagnosticsOn ? "ON - Events are being logged." : "OFF - Zero overhead."}</em>
            </span>
            <button
              className={`switch ${diagnosticsOn ? "on" : ""}`}
              onClick={() => {
                const next = !diagnosticsOn;
                setDiagnosticsOn(next);
                setDiagnosticsEnabled(next);
              }}
              aria-pressed={diagnosticsOn}
            >
              <span className="knob" />
            </button>
          </label>
          <div className="row" style={{ marginTop: "10px", gap: "8px", display: "flex", flexWrap: "wrap" }}>
            <button onClick={() => { if (confirm("Clear all recorded diagnostic events?")) clearDiagnosticEvents(); }}>Clear Events</button>
            <button onClick={() => setDiagReport(JSON.stringify(getDiagnosticSnapshot(), null, 2))}>View Report</button>
            {diagReport && (
              <button
                onClick={() => {
                  // Was fire-and-forget with an unconditional "it worked" alert right
                  // after — on a denied clipboard permission or an insecure context
                  // this claimed success while doing nothing, and blocked the UI with
                  // alert() instead of this panel's own toast system.
                  navigator.clipboard
                    .writeText(diagReport)
                    .then(() => pushToast("Report copied to clipboard.", "📋", 3000))
                    .catch(() => pushToast("Couldn't copy — your browser blocked clipboard access.", "⚠️", 4000));
                }}
              >
                Copy Report
              </button>
            )}
          </div>
          {diagReport && (
            <div style={{ marginTop: "10px", padding: "8px", background: "#222", color: "#fff", fontSize: "10px", maxHeight: "150px", overflow: "auto", whiteSpace: "pre-wrap", border: "1px solid #444", borderRadius: "4px" }}>
              {/* The visible clipping above is CSS-only — a large event buffer still
                  put the FULL string in the DOM. "Copy Report" still copies the
                  complete, untruncated `diagReport`; only this rendered preview caps. */}
              {diagReport.length > 20000 ? `${diagReport.slice(0, 20000)}\n… (truncated in this preview — Copy Report still copies everything)` : diagReport}
            </div>
          )}
        </section>

        <section className="settings-section">
          <h3>🌌 Galaxy render isolation sweep</h3>
          <p style={{ fontSize: "12px", opacity: 0.8, margin: "0 0 10px" }}>
            Automatically finds which part of the galaxy's rendering is slow, without
            needing to type anything into the address bar. One button; the page reloads
            itself a few times (~35 seconds total) as it measures the galaxy with links,
            node bodies, labels, glow/corona/bloom, and Journeys/Money/agents each
            switched off in turn, then shows a comparison table.
          </p>
          {sweepActive ? (
            <p style={{ fontSize: "13px" }}>
              ⏳ {sweepProgress ?? "Sweep running…"} — the page will reload on its own for
              each step. Leave this tab open.
            </p>
          ) : (
            <div className="row" style={{ gap: "8px", display: "flex", flexWrap: "wrap" }}>
              <button onClick={() => startSweep()}>Run performance diagnostic sweep</button>
              {sweepReport && (
                <>
                  <button
                    onClick={() => {
                      const text = sweepReport
                        .map(
                          (r) =>
                            `${r.label}: present p50 ${r.presentP50.toFixed(1)}ms, render p50 ${r.renderP50.toFixed(1)}ms, tick p50 ${r.tickP50.toFixed(1)}ms, draw calls ${r.drawCalls ?? "?"}, programs ${r.programs ?? "?"} (churn ${r.programsChurnCount ?? "?"}), transparent objects ${r.transparentObjects ?? "?"}`,
                        )
                        .join("\n");
                      navigator.clipboard
                        .writeText(text)
                        .then(() => pushToast("Sweep results copied to clipboard.", "📋", 3000))
                        .catch(() => pushToast("Couldn't copy — your browser blocked clipboard access.", "⚠️", 4000));
                    }}
                  >
                    Copy results
                  </button>
                  <button
                    onClick={() => {
                      clearSweepReport();
                      setSweepReport(null);
                    }}
                  >
                    Clear results
                  </button>
                </>
              )}
            </div>
          )}
          {sweepReport && (
            <div style={{ marginTop: "10px", overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px" }}>Category</th>
                    <th style={{ textAlign: "right", padding: "4px" }}>Present p50</th>
                    <th style={{ textAlign: "right", padding: "4px" }}>Render p50</th>
                    <th style={{ textAlign: "right", padding: "4px" }}>Tick p50</th>
                    <th style={{ textAlign: "right", padding: "4px" }}>Draw calls</th>
                    <th style={{ textAlign: "right", padding: "4px" }}>Programs</th>
                    <th style={{ textAlign: "right", padding: "4px" }}>Churn</th>
                    <th style={{ textAlign: "right", padding: "4px" }}>Transparent</th>
                  </tr>
                </thead>
                <tbody>
                  {sweepReport.map((r) => (
                    <tr key={r.key} style={{ borderTop: "1px solid #444" }}>
                      <td style={{ padding: "4px" }}>{r.label}</td>
                      <td style={{ textAlign: "right", padding: "4px" }}>{r.presentP50.toFixed(1)}ms</td>
                      <td style={{ textAlign: "right", padding: "4px" }}>{r.renderP50.toFixed(1)}ms</td>
                      <td style={{ textAlign: "right", padding: "4px" }}>{r.tickP50.toFixed(1)}ms</td>
                      <td style={{ textAlign: "right", padding: "4px" }}>{r.drawCalls ?? "?"}</td>
                      <td style={{ textAlign: "right", padding: "4px" }}>{r.programs ?? "?"}</td>
                      <td style={{ textAlign: "right", padding: "4px" }}>{r.programsChurnCount ?? "?"}</td>
                      <td style={{ textAlign: "right", padding: "4px" }}>{r.transparentObjects ?? "?"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="settings-toggle" style={{ marginTop: "14px" }}>
            <span>
              ⚠ Bypass post-processing composer <em>(diagnostic — render-stall investigation)</em>
              <em>
                {composerBypassOn
                  ? "ON — renderer.render(scene, camera) is called directly, skipping EffectComposer entirely."
                  : "OFF — normal path (composer.render() → RenderPass → renderer.render())."}
              </em>
            </span>
            <span className="gfx-when reload">reload</span>
            <button
              className={`switch ${composerBypassOn ? "on" : ""}`}
              onClick={() => {
                if (!confirmDiscardUnsaved()) return;
                const next = !composerBypassOn;
                setComposerBypassOnState(next);
                setComposerBypassEnabled(next);
                setTimeout(() => window.location.reload(), 150);
              }}
              aria-pressed={composerBypassOn}
            >
              <span className="knob" />
            </button>
          </label>
          <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #444" }}>
            <p style={{ fontSize: "12px", opacity: 0.8, margin: "0 0 8px" }}>
              <b>▶ Automated diagnostic</b> — runs a full render-category comparison
              entirely in THIS page load (no reloads, same camera the whole time), so a
              real culprit shows up as a clear, repeatable timing drop instead of the
              noisy readings a reload-based test can produce. Takes about a minute; just
              press the button and wait — no other steps needed.
            </p>
            <div className="row" style={{ gap: "8px", display: "flex", flexWrap: "wrap", alignItems: "center" }}>
              <button
                disabled={autoDiagRunning}
                onClick={async () => {
                  if (!isAutoDiagAvailable()) {
                    pushToast("Open the Galaxy view first, then run this from Settings.", "⚠️", 4000);
                    return;
                  }
                  setAutoDiagRunning(true);
                  setAutoDiagReport(null);
                  setAutoDiagProgressListener((label, step, total) => setAutoDiagProgressState(`Step ${step}/${total}: ${label}`));
                  try {
                    const report = await runAutoDiag();
                    if (report) setAutoDiagReport(report);
                    else pushToast("Diagnostic couldn't run — open the Galaxy view first.", "⚠️", 4000);
                  } finally {
                    setAutoDiagProgressListener(null);
                    setAutoDiagProgressState(null);
                    setAutoDiagRunning(false);
                  }
                }}
              >
                {autoDiagRunning ? "Running…" : "Run automated diagnostic (~1 min)"}
              </button>
              {autoDiagReport && !autoDiagRunning && (
                <button
                  onClick={() => {
                    const text = formatReportText(autoDiagReport.steps, autoDiagReport.verdict);
                    navigator.clipboard
                      .writeText(text)
                      .then(() => pushToast("Diagnostic report copied to clipboard.", "📋", 3000))
                      .catch(() => pushToast("Couldn't copy — your browser blocked clipboard access.", "⚠️", 4000));
                  }}
                >
                  Copy report
                </button>
              )}
            </div>
            {autoDiagRunning && autoDiagProgress && (
              <p style={{ fontSize: "12px", marginTop: "8px" }}>⏳ {autoDiagProgress}</p>
            )}
            {autoDiagReport && !autoDiagRunning && (
              <div style={{ marginTop: "10px" }}>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>
                  {autoDiagReport.verdict.primaryCause
                    ? `ROOT CAUSE CANDIDATE: ${autoDiagReport.verdict.primaryCause.label} (${autoDiagReport.verdict.primaryCause.conditionRenderP50.toFixed(1)}ms vs. its own local baseline ${autoDiagReport.verdict.primaryCause.localBaselineRenderP50.toFixed(1)}ms — ratio ${autoDiagReport.verdict.primaryCause.ratio.toFixed(2)})`
                    : "INCONCLUSIVE — no single condition collapsed render time relative to its own local baseline."}
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "4px" }}>Condition</th>
                        <th style={{ textAlign: "right", padding: "4px" }}>Render p50</th>
                        <th style={{ textAlign: "right", padding: "4px" }}>Local baseline</th>
                        <th style={{ textAlign: "right", padding: "4px" }}>Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autoDiagReport.verdict.ranked.map((r) => (
                        <tr key={r.key} style={{ borderTop: "1px solid #444" }}>
                          <td style={{ padding: "4px" }}>{r.label}</td>
                          <td style={{ textAlign: "right", padding: "4px" }}>{r.conditionRenderP50.toFixed(1)}ms</td>
                          <td style={{ textAlign: "right", padding: "4px" }}>{r.localBaselineRenderP50.toFixed(1)}ms</td>
                          <td style={{ textAlign: "right", padding: "4px" }}>{r.ratio.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #444" }}>
            <p style={{ fontSize: "12px", opacity: 0.8, margin: "0 0 8px" }}>
              <b>📸 BAD-vs-GOOD state snapshot</b> — captures whatever state the Galaxy is
              already in, right now, with zero effect on the scene. Press "Capture BAD"
              while the Galaxy is slow, then open a View/Lens (or do whatever normally
              makes it fast) and press "Capture GOOD" — the two get compared field by
              field below, so the real difference between the two states is visible
              directly instead of guessed at.
            </p>
            <div className="row" style={{ gap: "8px", display: "flex", flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={() => {
                  if (!isSnapshotCaptureAvailable()) {
                    pushToast("Open the Galaxy view first, then capture from Settings.", "⚠️", 4000);
                    return;
                  }
                  const snap = captureGalaxySnapshot("BAD");
                  if (snap) setBadSnapshot(snap);
                }}
              >
                📸 Capture BAD state
              </button>
              <button
                onClick={() => {
                  if (!isSnapshotCaptureAvailable()) {
                    pushToast("Open the Galaxy view first, then capture from Settings.", "⚠️", 4000);
                    return;
                  }
                  const snap = captureGalaxySnapshot("GOOD");
                  if (snap) setGoodSnapshot(snap);
                }}
              >
                📸 Capture GOOD state
              </button>
              {badSnapshot && (
                <button
                  onClick={() => copyTextWithFeedback(formatFullSnapshotText(badSnapshot), "BAD snapshot copied to clipboard.")}
                >
                  📋 Copy BAD
                </button>
              )}
              {goodSnapshot && (
                <button
                  onClick={() => copyTextWithFeedback(formatFullSnapshotText(goodSnapshot), "GOOD snapshot copied to clipboard.")}
                >
                  📋 Copy GOOD
                </button>
              )}
              {badSnapshot && goodSnapshot && (
                <button
                  onClick={() => copyTextWithFeedback(formatComparisonText(badSnapshot, goodSnapshot), "Comparison copied to clipboard.")}
                >
                  Copy comparison
                </button>
              )}
              {(badSnapshot || goodSnapshot) && (
                <button
                  onClick={() => {
                    setBadSnapshot(null);
                    setGoodSnapshot(null);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            {badSnapshot && !goodSnapshot && (
              <p style={{ fontSize: "12px", marginTop: "8px" }}>
                ✓ BAD state captured. Now reach the fast state (e.g. open a View/Lens) and capture GOOD.
              </p>
            )}
            {!badSnapshot && goodSnapshot && (
              <p style={{ fontSize: "12px", marginTop: "8px" }}>
                ✓ GOOD state captured. Now reach the slow state and capture BAD.
              </p>
            )}
            {badSnapshot && goodSnapshot && (
              <div style={{ overflowX: "auto", marginTop: "10px" }}>
                <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px" }}>Field</th>
                      <th style={{ textAlign: "right", padding: "4px" }}>BAD</th>
                      <th style={{ textAlign: "right", padding: "4px" }}>GOOD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffSnapshots(badSnapshot, goodSnapshot).map((r) => (
                      <tr key={r.field} style={{ borderTop: "1px solid #444", fontWeight: r.notable ? 700 : 400 }}>
                        <td style={{ padding: "4px" }}>{r.notable ? "≠ " : ""}{r.field}</td>
                        <td style={{ textAlign: "right", padding: "4px" }}>{r.bad}</td>
                        <td style={{ textAlign: "right", padding: "4px" }}>{r.good}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

          </>
        )}

        <section className="settings-section">
          <h3>🎨 Graphics &amp; performance</h3>
          <label className="settings-toggle">
            <span>
              Lite mode <em>Turn OFF the 3D galaxy. The app stays fully usable if your device can't render it. Applies by reloading the page.</em>
            </span>
            <span className="gfx-when reload">reload</span>
            <button
              className={`switch ${liteOn ? "on" : ""}`}
              onClick={() => {
                // A reload wipes any unsaved Display name/Gamer tag or
                // notification-settings edit sitting in the fields above
                // with no warning — this used to fire regardless.
                if (!confirmDiscardUnsaved()) return;
                const next = !liteOn;
                setLiteOn(next);
                try { localStorage.setItem("brain.lite", next ? "1" : "0"); } catch { /* ignore */ }
                setTimeout(() => window.location.reload(), 150); // remount without/with the galaxy
              }}
              aria-pressed={liteOn}
            >
              <span className="knob" />
            </button>
          </label>
          <div className="gfx-live">
            <span className={`gfx-fps ${fpsClass}`}>{fps == null ? "…" : fps} FPS</span>
            <span className="gfx-tier">
              tier: <b>{resolved.tier}</b>
              {resolved.detailTier !== resolved.tier && (
                <> → <b>{resolved.detailTier}</b> (learned)</>
              )}
            </span>
            <span className="gfx-live-hint">live — watch it change as you tune below</span>
          </div>
          <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "0 0 10px" }}>
            One galaxy, tuned to your device. Weaker phones get the full experience, optimized —
            never fewer features.
          </p>
          <div className="gfx-modes">
            {GRAPHICS_MODES.map((m) => (
              <button
                key={m.id}
                className={`gfx-mode ${gfx.mode === m.id ? "on" : ""}`}
                onClick={() => pickMode(m.id)}
                title={m.hint}
              >
                <b>{m.label}</b>
                <em>{m.hint}</em>
              </button>
            ))}
          </div>

          <label className="settings-toggle">
            <span>Bloom glow <em>Cinematic light bloom (costly on weak GPUs).</em></span>
            <span className="gfx-when reload">reload</span>
            <button className={`switch ${gfx.bloom ? "on" : ""}`} onClick={() => setField("bloom", !gfx.bloom)} aria-pressed={gfx.bloom}>
              <span className="knob" />
            </button>
          </label>
          <div className="gfx-row"><span>Star density <em className="gfx-when reload">reload</em></span><Seg value={gfx.starDensity} options={["low", "medium", "high"] as Level[]} onPick={(v) => setField("starDensity", v)} /></div>
          <div className="gfx-row"><span>Particle effects <em className="gfx-when reload">reload</em></span><Seg value={gfx.particles} options={["low", "medium", "high"] as Level[]} onPick={(v) => setField("particles", v)} /></div>
          <div className="gfx-row"><span>Animation quality <em className="gfx-when instant">instant</em></span><Seg value={gfx.animationQuality} options={["low", "medium", "high"] as Level[]} onPick={(v) => setField("animationQuality", v)} /></div>
          <div className="gfx-row"><span>Render quality <em className="gfx-when instant">instant</em></span><Seg value={gfx.renderQuality} options={["auto", "low", "medium", "high"]} onPick={(v) => setField("renderQuality", v as GraphicsSettings["renderQuality"])} /></div>
          <div className="gfx-row"><span>FPS cap <em className="gfx-when instant">instant</em></span><Seg value={String(gfx.fpsCap)} options={["30", "45", "60"]} onPick={(v) => setField("fpsCap", Number(v) as GraphicsSettings["fpsCap"])} /></div>
          <div className="gfx-row"><span>Background scenery <em className="gfx-when reload">reload</em></span><Seg value={gfx.sceneryOverride ?? "auto"} options={["auto", "on", "off"]} onPick={(v) => setField("sceneryOverride", v as NonNullable<GraphicsSettings["sceneryOverride"]>)} /></div>
          <label className="settings-toggle">
            <span>Battery saver <em>Caps FPS, drops bloom + resolution to save power.</em></span>
            <span className="gfx-when instant">instant</span>
            <button className={`switch ${gfx.batterySaver ? "on" : ""}`} onClick={() => setField("batterySaver", !gfx.batterySaver)} aria-pressed={gfx.batterySaver}>
              <span className="knob" />
            </button>
          </label>
          <label className="settings-toggle">
            <span>
              Performance readout
              <em>{perfHudOn ? "ON — a small overlay showing real frame-time/GPU numbers." : "OFF — the on-screen diagnostic HUD for tuning performance."}</em>
            </span>
            <span className="gfx-when instant">instant</span>
            <button
              className={`switch ${perfHudOn ? "on" : ""}`}
              onClick={() => {
                const next = !perfHudOn;
                setPerfHudOn(next);
                setPerfHudEnabled(next);
              }}
              aria-pressed={perfHudOn}
            >
              <span className="knob" />
            </button>
          </label>
          <label className="settings-toggle">
            <span>
              Bounded detailed links <em>(experimental)</em>
              <em>
                {boundedLinksOn
                  ? `ON — caps the Galaxy to ${linkBudget} fully-detailed connections; the rest are hidden for now.`
                  : "OFF — every connection renders in full detail, even on a very large brain."}
              </em>
            </span>
            <span className="gfx-when reload">reload</span>
            <button
              className={`switch ${boundedLinksOn ? "on" : ""}`}
              onClick={() => {
                // Same guard as Lite mode below — a reload wipes an unsaved Display
                // name/Gamer tag or notification-settings edit with no warning otherwise.
                if (!confirmDiscardUnsaved()) return;
                const next = !boundedLinksOn;
                setBoundedLinksOnState(next);
                setBoundedLinksEnabled(next);
                setTimeout(() => window.location.reload(), 150);
              }}
              aria-pressed={boundedLinksOn}
            >
              <span className="knob" />
            </button>
          </label>
          {boundedLinksOn && (
            <div className="gfx-row">
              <span>Detailed-link budget <em className="gfx-when reload">reload</em></span>
              <Seg
                value={linkBudget}
                options={["200", "300", String(DEFAULT_DETAILED_LINK_BUDGET)]}
                onPick={(v) => {
                  if (!confirmDiscardUnsaved()) return;
                  setLinkBudgetState(v);
                  setDetailedLinkBudget(Number(v));
                  setTimeout(() => window.location.reload(), 150);
                }}
              />
            </div>
          )}
          <p className="settings-note" style={{ fontSize: "11px", opacity: 0.6, margin: "8px 0 0" }}>
            <b>instant</b> changes apply right away (watch the FPS above); <b>reload</b> ones take effect next open.
          </p>
        </section>
      </div>
    </div>
  );
}
