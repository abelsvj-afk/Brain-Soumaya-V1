import {
  audioSummary,
  beaconReadout,
  fleetCard,
  modelFallbackLine,
  visitorCard,
  type BeaconStatusLike,
  type SceneIdentity,
} from "../graph/sceneIdentity.js";

/**
 * CL-1b — the galaxy shell's identity & ambience readouts (IM-19..IM-23).
 *
 * Small glass overlays that live where the scene is seen: who the visitors
 * and fleet craft are, which memories the Aura beacon beam is warming, the
 * shell's audio state, and the empty-galaxy cue. All data is derived by
 * Graph3D/App from live scene state — nothing here invents scene facts.
 */

export function BeaconReadout({
  status,
  onFocus,
}: {
  status: Record<string, BeaconStatusLike> | null | undefined;
  onFocus?: (id: number) => void;
}) {
  const r = beaconReadout(status);
  if (!r) return null;
  return (
    <div className="beacon-readout" role="status" aria-label="Aura beacon status">
      <span className="beacon-readout-head">
        📡 {r.detail}
        {r.pending > 0 ? ` · dispatching ${r.pending}…` : ""}
      </span>
      {r.targets.length > 0 && (
        <span className="beacon-readout-targets">
          Warming:{" "}
          {r.targets.map((t, i) => (
            <span key={t.id}>
              {i > 0 ? " · " : ""}
              {onFocus ? (
                <button className="beacon-target" onClick={() => onFocus(t.id)} title="Fly to this memory">
                  “{t.label}”
                </button>
              ) : (
                <>“{t.label}”</>
              )}
            </span>
          ))}
        </span>
      )}
      <span className="beacon-readout-hint">Visit a beamed memory to warm it — the beacon moves on.</span>
    </div>
  );
}

export function VisitorChip({
  visitors,
  onFollow,
}: {
  visitors: { variantName: string; targetLabel: string | null }[];
  onFollow?: () => void;
}) {
  const first = visitors[0];
  if (!first) return null;
  const card = visitorCard(first.variantName, first.targetLabel);
  const text = `${card.icon} ${card.title} — ${card.line.charAt(0).toLowerCase()}${card.line.slice(1)}${
    visitors.length > 1 ? ` · +${visitors.length - 1} more` : ""
  }`;
  return onFollow ? (
    <button className="visitor-chip" onClick={onFollow} title="Jump to the visitor">
      {text}
    </button>
  ) : (
    <div className="visitor-chip">{text}</div>
  );
}

/** Identity card for the visitor / fleet craft the camera is following. */
export function SceneIdentityCard({
  identity,
  onClose,
}: {
  identity: SceneIdentity;
  onClose: () => void;
}) {
  const card =
    identity.kind === "visitor"
      ? visitorCard(identity.variantName, identity.targetLabel)
      : fleetCard(identity.unitId, identity.detail, identity.targetLabel);
  return (
    <div className="object-lore scene-id-card">
      <div className="object-lore-head">
        <span className="object-lore-title">
          {card.icon} {card.title}
        </span>
        <button className="object-lore-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="scene-id-line">{card.line}</p>
      {card.lore && <p className="object-lore-log">✦ {card.lore}</p>}
    </div>
  );
}

/**
 * IM-21 — a visible audio state in the shell. SFX/engine/voice otherwise
 * live only in Settings, so a silently-muted galaxy had no explanation.
 * The chip shows all three channels and deep-links to the Settings audio
 * section (the Preferences section holding the voice + sounds toggles).
 */
export function AudioStateChip({
  sfx,
  voice,
  music,
  onOpenAudioSettings,
}: {
  sfx: boolean;
  voice: boolean;
  music: boolean;
  onOpenAudioSettings: () => void;
}) {
  const s = audioSummary({ sfx, voice, music });
  return (
    <button
      className={`audio-state-chip ${s.allOff ? "all-off" : ""}`}
      onClick={onOpenAudioSettings}
      aria-label={`Audio: ${s.text}. Open sound settings.`}
      title={s.allOff ? "Everything is muted — tap for sound settings" : "Sound settings"}
    >
      {s.allOff ? "🔇" : "🔊"} {s.text}
    </button>
  );
}

/** IM-23 — the empty galaxy's in-scene cue: where the first star goes. */
export function EmptyGalaxyCue({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-galaxy-cue" role="status">
      <p className="empty-galaxy-title">✦ Your first star goes here</p>
      <p className="empty-galaxy-sub">
        This sky is empty for now — every memory you add lights a new star in it.
      </p>
      <button className="empty-galaxy-add" onClick={onAdd}>
        ＋ Add your first memory
      </button>
    </div>
  );
}

/** IM-24 — user-visible note (Settings → diagnostics) for glTF models that
 *  failed to load and were swapped for procedural stand-ins. */
export function ModelFallbackNote({ assets }: { assets: string[] }) {
  if (assets.length === 0) return null;
  return (
    <div className="model-fallback-note" role="status">
      {assets.map((a) => (
        <p key={a}>⚠ {modelFallbackLine(a)}</p>
      ))}
    </div>
  );
}
