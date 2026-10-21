import { useCallback, useEffect, useState } from "react";
import {
  getThoughts,
  reinforceThought,
  promoteThought,
  dismissThought,
  type Thought,
} from "../api/client.js";
import { THOUGHT_SOURCE_COLOR } from "@brain/shared";
import { thoughtSourceLabel } from "../graph/sceneIdentity.js";
import { pushToast } from "./Toasts.js";

/**
 * The Mind Space (Cognitive Layer Phase 2) — an ambient overlay that floats your
 * live working-memory thoughts as glowing motes drifting at the edges of the
 * galaxy, so "what you're thinking now" is present around you, not buried in a tab.
 * Motes brighten with a thought's strength and fade as it decays.
 *
 * IM-25 (CL-1b): the motes used to be pure wallpaper (`pointer-events: none`,
 * `aria-hidden`) over live data the server can act on. Now a mote is a real
 * button: tap it for the thought's actions (open / keep / make memory /
 * let go — the same working-memory APIs the Mind panel uses), its source is
 * named in a legend (not colour-only), reinforceCount/createdAt are shown,
 * thoughts past the mote cap are counted honestly ("+N more"), and an
 * enabled-but-empty MindSpace says so instead of looking identical to off.
 * (The 3D-sphere rebuild from the COGNITIVE_LAYER spec is a held owner
 * question — Q6 — and is NOT this change; the 2D ring stays.)
 *
 * Self-contained: it reads its own on/off flag from localStorage and re-reads on a
 * `mindspace-toggle` window event (dispatched by the Mind panel), and polls the
 * working-memory API directly — no prop-drilling through the app tree.
 */

const KEY = "mindspace.ambient";
export function mindSpaceEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setMindSpaceEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("mindspace-toggle"));
}

export const MOTE_CAP = 12;

/**
 * Deterministic placement out on the PERIMETER of the view (never the centre — that's
 * where the focused body sits). Motes ring the edge, faded + shimmering so they read as
 * fleeting real-time thoughts, not fixed labels. Clamped so they stay on-screen and off
 * the very top (header). Two animations run in parallel: a slow wander + a light shimmer.
 */
function motePos(t: Thought, idx: number): { cx: number; cy: number } {
  const golden = 137.508; // even angular spread
  const angle = ((t.id * golden + idx * 47) % 360) * (Math.PI / 180);
  const radius = 33 + ((t.id * 7) % 9); // 33%..41% out — on a ring, pulled slightly in from the edge
  let cx = 50 + Math.cos(angle) * radius;
  let cy = 50 + Math.sin(angle) * radius * 0.86;
  cx = Math.min(87, Math.max(8, cx)); // keep on-screen
  cy = Math.min(85, Math.max(15, cy)); // clear the header
  return { cx, cy };
}

function moteStyle(t: Thought, idx: number): React.CSSProperties {
  const { cx, cy } = motePos(t, idx);
  return {
    left: `${cx}%`,
    top: `${cy}%`,
    // Faded / ephemeral; strength only nudges it a little.
    opacity: 0.2 + t.strength * 0.32,
    // Two animations: [wander, shimmer].
    animationDelay: `${((t.id * 7 + idx * 3) % 20) * -1}s, ${((t.id * 3) % 5) * -0.6}s`,
    animationDuration: `${16 + ((t.id * 5) % 10)}s, ${2.3 + ((t.id % 7) * 0.3)}s`,
    "--mote-glow": `${6 + t.strength * 16}px`,
    "--mote-color": THOUGHT_SOURCE_COLOR[t.source] ?? THOUGHT_SOURCE_COLOR.manual,
  } as React.CSSProperties;
}

/** Local, human "held since" for a thought's createdAt (Mind tab dates are
 *  local too — never the raw stored string). */
function heldSince(createdAt: string): string {
  const ms = Date.parse(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T") + "Z");
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MindSpace({
  hidden,
  onOpenThought,
  onOpenMind,
}: {
  hidden?: boolean;
  /** "Open" a thought — the shell routes this to the Mind tab. */
  onOpenThought?: (t: Thought) => void;
  /** Open the Mind tab itself (the "+N more" / empty-state affordance). */
  onOpenMind?: () => void;
}) {
  const [on, setOn] = useState(mindSpaceEnabled());
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setOn(mindSpaceEnabled());
    window.addEventListener("mindspace-toggle", sync);
    return () => window.removeEventListener("mindspace-toggle", sync);
  }, []);

  const load = useCallback(() => {
    getThoughts()
      .then((ts) => {
        setThoughts(ts);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!on) {
      setThoughts([]);
      setLoaded(false);
      setSelectedId(null);
      return;
    }
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [on, load]);

  // Vanish while a menu/panel is open so drifting motes never sit over what you're reading.
  if (!on || hidden) return null;

  // Enabled-with-zero-thoughts must NOT look identical to disabled: say so.
  if (loaded && thoughts.length === 0) {
    return (
      <div className="mindspace-layer">
        <button
          className="mindspace-empty"
          onClick={onOpenMind}
          title={onOpenMind ? "Open the Mind tab" : undefined}
        >
          💭 MindSpace is on — no live thoughts right now. Hold one in the Mind tab and it will drift here.
        </button>
      </div>
    );
  }
  if (thoughts.length === 0) return null; // first poll still in flight

  const shown = thoughts.slice(0, MOTE_CAP);
  const extra = thoughts.length - shown.length;
  const selected = selectedId != null ? thoughts.find((t) => t.id === selectedId) ?? null : null;
  const selectedIdx = selected ? shown.findIndex((t) => t.id === selected.id) : -1;
  const sources = [...new Set(thoughts.map((t) => t.source))];

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <div className="mindspace-layer">
      {shown.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className={`mindspace-mote ${selectedId === t.id ? "selected" : ""}`}
          style={moteStyle(t, i)}
          onClick={() => setSelectedId((cur) => (cur === t.id ? null : t.id))}
          aria-label={`Thought: ${t.text} (${thoughtSourceLabel(t.source)})`}
          aria-pressed={selectedId === t.id}
          title={`${thoughtSourceLabel(t.source)} · kept ${t.reinforceCount}× — tap for actions`}
        >
          <span className="mindspace-dot" />
          <span className="mindspace-text">{t.text}</span>
        </button>
      ))}

      {/* IM-25: the cut past the mote cap is stated, never silent. */}
      {extra > 0 &&
        (onOpenMind ? (
          <button type="button" className="mindspace-more" onClick={onOpenMind}>
            +{extra} more thought{extra === 1 ? "" : "s"} in Mind →
          </button>
        ) : (
          <span className="mindspace-more">+{extra} more thought{extra === 1 ? "" : "s"} in Mind</span>
        ))}

      {/* IM-25: source is named, not colour-only. */}
      <div className="mindspace-legend" aria-label="Thought sources">
        {sources.map((s) => (
          <span key={s} className="mindspace-legend-item">
            <span
              className="mindspace-legend-dot"
              style={{ background: `rgb(${THOUGHT_SOURCE_COLOR[s] ?? THOUGHT_SOURCE_COLOR.manual})` }}
            />
            {thoughtSourceLabel(s)}
          </span>
        ))}
      </div>

      {selected && (
        <div
          className="mindspace-card"
          style={
            selectedIdx >= 0
              ? (() => {
                  const { cx, cy } = motePos(selected, selectedIdx);
                  return {
                    left: `${Math.min(78, Math.max(22, cx))}%`,
                    top: `${cy}%`,
                    transform: cy > 62 ? "translate(-50%, calc(-100% - 16px))" : "translate(-50%, 16px)",
                  } as React.CSSProperties;
                })()
              : undefined
          }
          role="group"
          aria-label={`Actions for thought: ${selected.text}`}
        >
          <div className="mindspace-card-head">
            <span
              className="mindspace-legend-dot"
              style={{
                background: `rgb(${THOUGHT_SOURCE_COLOR[selected.source] ?? THOUGHT_SOURCE_COLOR.manual})`,
              }}
            />
            <span className="mindspace-card-source">{thoughtSourceLabel(selected.source)}</span>
            <button
              type="button"
              className="mindspace-card-close"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <p className="mindspace-card-text">{selected.text}</p>
          <p className="mindspace-card-meta">
            Kept {selected.reinforceCount}× · Strength {Math.round(selected.strength * 100)}%
            {heldSince(selected.createdAt) ? ` · Held since ${heldSince(selected.createdAt)}` : ""}
          </p>
          <div className="mindspace-card-actions">
            {onOpenThought && (
              <button type="button" className="mini" disabled={busy} onClick={() => onOpenThought(selected)}>
                Open in Mind
              </button>
            )}
            <button
              type="button"
              className="mini"
              disabled={busy}
              title="Keep it — resets the fade timer (3 keeps → becomes a memory)"
              onClick={() =>
                void act(async () => {
                  const r = await reinforceThought(selected.id);
                  if (r?.promotedNodeId != null) {
                    pushToast("💭 A recurring thought settled into memory", "🧠", 4500);
                    setSelectedId(null);
                  }
                })
              }
            >
              ↑ Keep
            </button>
            <button
              type="button"
              className="mini"
              disabled={busy}
              title="Make it a permanent memory now"
              onClick={() =>
                void act(async () => {
                  const r = await promoteThought(selected.id);
                  if (r?.nodeId != null) {
                    pushToast("💭 Thought became a memory", "🧠", 4500);
                    setSelectedId(null);
                  } else {
                    pushToast("Couldn't make that a memory — try again.", "⚠️", 3500);
                  }
                })
              }
            >
              ★ Make memory
            </button>
            <button
              type="button"
              className="mini ghost"
              disabled={busy}
              title="Let it go"
              onClick={() =>
                void act(async () => {
                  await dismissThought(selected.id);
                  setSelectedId(null);
                })
              }
            >
              Let go
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
