import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
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
 * and fleet craft are, which memories the Aura beacon beam is warming,
 * and the empty-galaxy cue. All data is derived by
 * Graph3D/App from live scene state — nothing here invents scene facts.
 */

/**
 * The Drifter chip's one line of text — shared by VisitorChip itself and
 * by the collapsed stack's mini-bar (below), so the summary line and the
 * full chip can never drift apart.
 */
export function visitorLineText(
  visitors: { variantName: string; targetLabel: string | null }[],
): string {
  const first = visitors[0];
  if (!first) return "";
  const card = visitorCard(first.variantName, first.targetLabel);
  return `${card.icon} ${card.title} — ${card.line.charAt(0).toLowerCase()}${card.line.slice(1)}${
    visitors.length > 1 ? ` · +${visitors.length - 1} more` : ""
  }`;
}

/** The beacon readout's HEAD line — the stack body's highest-priority
 *  status — composed once here and shared by BeaconReadout and the
 *  mini-bar. (Finding #6 small print: Graph3D's beacon detail already
 *  reads "Dispatching 1…" when a dispatch is in flight, so the pending
 *  count is appended only when the detail doesn't already carry the
 *  dispatching fact — the same fact is never said twice.) */
export function beaconHeadLine(r: NonNullable<ReturnType<typeof beaconReadout>>): string {
  const showPending = r.pending > 0 && !/dispatch/i.test(r.detail);
  return `📡 ${r.detail}${showPending ? ` · dispatching ${r.pending}…` : ""}`;
}

/** The beacon head line for a raw status map, or null when no beacon
 *  readout would render at all. */
export function beaconHeadText(
  status: Record<string, BeaconStatusLike> | null | undefined,
): string | null {
  const r = beaconReadout(status);
  return r ? beaconHeadLine(r) : null;
}

interface StackLine {
  key: "visitor" | "beacon";
  text: string;
}

/**
 * The stack's present lines, in its own header → body → footer
 * precedence, derived from the children App rendered (their props carry
 * the same data the full lines render from). The collapsed mini-bar
 * shows the FIRST of these; the rest are the hidden count.
 */
function stackLines(children: ReactNode): StackLine[] {
  const els = Children.toArray(children).filter(isValidElement) as ReactElement[];
  const lines: StackLine[] = [];
  const visitorEl = els.find((el) => el.type === VisitorChip);
  if (visitorEl) {
    const visitors =
      (visitorEl.props as { visitors?: { variantName: string; targetLabel: string | null }[] })
        .visitors ?? [];
    if (visitors.length > 0) lines.push({ key: "visitor", text: visitorLineText(visitors) });
  }
  const beaconEl = els.find((el) => el.type === BeaconReadout);
  if (beaconEl) {
    const head = beaconHeadText(
      (beaconEl.props as { status?: Record<string, BeaconStatusLike> | null }).status,
    );
    if (head) lines.push({ key: "beacon", text: head });
  }
  return lines;
}

/**
 * Package B (HUD reorganization, finding #6) — the ONE container for the
 * left-edge ship-status readouts. The Drifter chip renders as its header
 * line, the beacon box as its body, and the sounds pill as its footer line
 * (App renders them in that order as children). The stack is a single
 * anchored object: its height is negotiated once in CSS (capped, with the
 * beacon body shrinking/clipping first) so the beacon box can never again
 * grow up through the Drifter chip. `belowNoticing` applies the one
 * coordination rule with the "Soumaya noticed" card: while that card is up,
 * the stack docks in its low slot instead of the mid-screen slot.
 *
 * HUD round 3 — the stack is SUMMONABLE. With `onToggle` wired (App owns
 * the state, see useShipStatusOpen), the collapsed form is a one-line
 * mini-bar on the SAME anchor and width: it shows the first present line
 * in the stack's precedence (Drifter → beacon head), a ＋N count
 * of the lines it folds away, and a ▸ — the whole pill is the tap target
 * that brings the full stack up. The expanded form is the stack verbatim
 * plus a corner ▾ that folds it back (the header line's own tap already
 * means "follow the visitor", so collapse gets its own target). Nothing
 * is removed in either state. While collapsed, a NEW status (the line
 * signature changes) pulses the mini-bar once and swaps its line — it
 * never auto-expands (the noticing 💭 precedent: glow, wait, don't open).
 * Without `onToggle` the stack renders exactly as it always has.
 */
/** How long the expanded ship-status stack stays open before folding back to its pill. */
export const SHIP_STATUS_AUTO_COLLAPSE_MS = 8000;

export function ShipStatusStack({
  belowNoticing,
  collapsed,
  onToggle,
  children,
}: {
  belowNoticing?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const lines = stackLines(children);
  const signature = lines.map((l) => l.text).join("\n");
  const [pulsing, setPulsing] = useState(false);
  const prevSignature = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSignature.current;
    prevSignature.current = signature;
    if (!collapsed || prev === null || prev === signature) return;
    // A new dispatch / warming / visitor event landed while collapsed:
    // pulse once and let the re-rendered line speak — never auto-expand.
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 1900);
    return () => clearTimeout(t);
  }, [collapsed, signature]);

  // Owner request (t38u): the expanded stack folds itself away after a few
  // seconds so it never parks over the galaxy. Hovering or focusing inside
  // it pauses the timer; leaving restarts it.
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const [held, setHeld] = useState(false);
  const expanded = !collapsed && !!onToggle;
  useEffect(() => {
    if (!expanded || held) return;
    const t = setTimeout(() => onToggleRef.current?.(), SHIP_STATUS_AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [expanded, held]);
  useEffect(() => {
    if (!expanded) setHeld(false);
  }, [expanded]);

  if (collapsed && onToggle) {
    // Nothing to report (no visitor, beacon idle): no pill at all.
    if (lines.length === 0) return null;
    const shown = lines[0];
    const hidden = Math.max(0, lines.length - 1);
    return (
      <button
        type="button"
        className={`ship-status-mini${belowNoticing ? " below-noticing" : ""}${pulsing ? " pulse" : ""}`}
        onClick={onToggle}
        aria-expanded={false}
        aria-label={shown ? `Ship status: ${shown.text}. Show full ship status.` : "Show ship status"}
        title="Show ship status"
      >
        <span className="ship-status-mini-line">{shown?.text ?? "Ship status"}</span>
        {hidden > 0 && <span className="ship-status-mini-count">＋{hidden}</span>}
        <span className="ship-status-mini-chev" aria-hidden="true">
          ▸
        </span>
      </button>
    );
  }
  return (
    <div
      className={`ship-status-stack${belowNoticing ? " below-noticing" : ""}`}
      role="group"
      aria-label="Ship status"
      onPointerEnter={expanded ? () => setHeld(true) : undefined}
      onPointerLeave={expanded ? () => setHeld(false) : undefined}
      onFocus={
        expanded
          ? (e) => {
              // Reviewer r5: only KEYBOARD focus holds it open. A tap also
              // focuses the button it lands on, which kept the card open on
              // phones; :focus-visible is true only for keyboard-style focus.
              const t = e.target as HTMLElement;
              let kb = false;
              try {
                kb = t.matches(":focus-visible");
              } catch {
                kb = false;
              }
              if (kb) setHeld(true);
            }
          : undefined
      }
      onBlur={
        expanded
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
            }
          : undefined
      }
    >
      {children}
      {onToggle && (
        <button
          type="button"
          className="ship-status-collapse"
          onClick={onToggle}
          aria-expanded={true}
          aria-label="Hide ship status"
          title="Hide ship status"
        >
          ▾
        </button>
      )}
    </div>
  );
}

/**
 * Owner request (t38u): the stack ALWAYS starts as the compact pill — on
 * desktop it used to start expanded (a big box over the stars and labels)
 * and phones had a first-run expanded reveal. It now opens only on tap and
 * folds itself away (SHIP_STATUS_AUTO_COLLAPSE_MS), so there is no open
 * preference to persist; old `ship.status.<id>` values are ignored.
 * Kept as a function so callers/tests have one place that states the default.
 */
export function resolveShipStatusOpen(
  _spaceId: string,
  _viewW: number,
  _viewH: number,
): { open: boolean; reveal: boolean } {
  return { open: false, reveal: false };
}

/**
 * The stack's open state: collapsed on first paint for every brain and
 * viewport; the toggle opens/closes it for the current brain only, and a
 * brain switch starts collapsed again.
 */
export function useShipStatusOpen(spaceId: string | null): [boolean, (v: boolean) => void] {
  const [override, setOverride] = useState<{ id: string | null; open: boolean } | null>(null);
  const setShipStatusOpen = useCallback(
    (v: boolean) => setOverride({ id: spaceId, open: v }),
    [spaceId],
  );
  const open = override && override.id === spaceId ? override.open : false;
  return [open, setShipStatusOpen];
}

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
      <span className="beacon-readout-head">{beaconHeadLine(r)}</span>
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
  const text = visitorLineText(visitors);
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

/** IM-23 — the empty galaxy's in-scene cue: where the first star goes. */
export function EmptyGalaxyCue({ onAdd, hasWelcomeStar = false }: { onAdd: () => void; hasWelcomeStar?: boolean }) {
  return (
    <div className="empty-galaxy-cue" role="status">
      <p className="empty-galaxy-title">✦ Your first star goes here</p>
      <p className="empty-galaxy-sub">
        {/* UX review #3: don't call the sky "empty" while Soumaya's welcome star shines in it. */}
        {hasWelcomeStar
          ? "Soumaya lit up your sky to welcome you — every memory you add lights a star of your own."
          : "This sky is empty for now — every memory you add lights a new star in it."}
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
