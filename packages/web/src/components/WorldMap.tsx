import { useMemo, useRef, useState, type PointerEvent } from "react";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import { useTravel, readTraversedRoutes } from "../hooks/useTravel.js";
import {
  chainTo,
  deriveMapData,
  WORLD_MAP_VIEWBOX,
  type MapData,
} from "../lib/worldMap.js";

/**
 * The world map (Rev 116) — a full-screen star map over a transparent
 * background: the live galaxy shows through, and the map is drawn over
 * it. Nodes are discovered worlds, edges are discovered routes; the
 * current or most recent journey's leg draws bright, the rest faint.
 * Every edge carries its fuel cost, always. Selecting a world shows the
 * whole chain's price; travelling still happens in the travel panel, on
 * the server's word — the map invents no shortcut and departs nowhere.
 *
 * What it never shows: undiscovered worlds (hidden entirely — no
 * "unknown" markers), Eternity's world and route (absent until
 * discovered), and anything that counts what you have not found. The
 * one hint is a faint, unnamed, unclickable shimmer in a far region —
 * no label, no route, no distance, no interaction.
 *
 * Performance (Q7): this is a UI overlay, not a scene. It renders once
 * on open and on interaction only — there is no animation loop, no
 * per-frame work, nothing that runs while it sits still. Panning and
 * zooming redraw only while you are interacting. Reduced motion gets the
 * identical map (nothing here moves on its own), same information, same
 * controls.
 *
 * Dark contract, same as the panel's: while the flag is off this renders
 * nothing and fetches nothing.
 */

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

const HOME_VIEW: ViewTransform = { x: 0, y: 0, k: 1 };

function edgeMid(e: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number } {
  return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
}

export default function WorldMap({
  enabled = WORLDS_TRAVEL_ENABLED,
  onClose,
  onTravelTo,
}: {
  enabled?: boolean;
  onClose: () => void;
  onTravelTo: (worldKey: string) => void;
}) {
  const travel = useTravel(enabled);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<ViewTransform>(HOME_VIEW);
  const dragRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  // The map derives from the server's travel state plus the client's
  // traversed-routes record — the same record the skip rule reads. It
  // fetches nothing of its own.
  const data: MapData | null = useMemo(() => {
    if (!travel.state) return null;
    return deriveMapData({
      currentWorld: travel.state.currentWorld,
      activeJourney: travel.state.activeJourney,
      traversed: readTraversedRoutes(),
    });
  }, [travel.state]);

  if (!enabled) return null;

  const state = travel.state;
  const fuel = state?.fuel;
  const activeJourney = state?.activeJourney ?? null;
  const selectedNode = selected ? (data?.nodes.find((n) => n.key === selected) ?? null) : null;
  const selectedChain = selectedNode && data ? chainTo(selectedNode.key, data) : null;
  const nodeByKey = new Map((data?.nodes ?? []).map((n) => [n.key, n]));

  const zoomBy = (factor: number) =>
    setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.6, v.k * factor)) }));

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element) e.target.setPointerCapture?.(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setView((v) => ({ ...v, x: drag.vx + (e.clientX - drag.px) / v.k, y: drag.vy + (e.clientY - drag.py) / v.k }));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <section className="world-map" role="dialog" aria-label="World map">
      <header className="world-map-bar">
        <h3>World map</h3>
        {fuel && (
          <span className="world-map-fuel">
            Fuel {Math.floor(fuel.fuel)} / {fuel.capacity}
          </span>
        )}
        <button type="button" onClick={onClose}>
          Back to your galaxy
        </button>
      </header>

      {travel.error && (
        <p role="alert" className="world-map-fallback">
          {travel.error}
        </p>
      )}
      {!state && !travel.error && (
        <p className="world-map-fallback">Checking the chart…</p>
      )}

      {state && data && (
        <>
          <svg
            className="world-map-canvas"
            viewBox={`0 0 ${WORLD_MAP_VIEWBOX.width} ${WORLD_MAP_VIEWBOX.height}`}
            role="group"
            aria-label="World map — the worlds you have discovered and the routes between them"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
          >
            <defs>
              <radialGradient id="world-map-shimmer">
                <stop offset="0%" stopColor="#cfe0ff" stopOpacity="0.5" />
                <stop offset="60%" stopColor="#cfe0ff" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
              </radialGradient>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {data.stars.map((s, i) => (
                <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#e8ecff" opacity={s.opacity} />
              ))}
              {/* The shimmer (Q6): faint, unnamed, unclickable. It is not a
                  button, has no label and no handler, and never takes a
                  pointer event — it says something is out there, nothing more.
                  Once Eternity's world is discovered the node itself is on
                  the map and the shimmer retires (data.shimmer is null). */}
              {data.shimmer && (
                <circle
                  cx={data.shimmer.x}
                  cy={data.shimmer.y}
                  r={30}
                  fill="url(#world-map-shimmer)"
                  pointerEvents="none"
                  aria-hidden="true"
                />
              )}
              {data.edges.map((e) => {
                const a = nodeByKey.get(e.from);
                const b = nodeByKey.get(e.to);
                if (!a || !b) return null;
                const mid = edgeMid({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
                return (
                  <g key={`${e.from}>${e.to}`}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={`world-map-edge${e.bright ? " bright" : ""}${e.traveled ? " traveled" : ""}`}
                    />
                    <text
                      x={mid.x}
                      y={mid.y - 8}
                      textAnchor="middle"
                      className="world-map-edge-label"
                    >
                      {e.costLabel}
                    </text>
                  </g>
                );
              })}
              {data.nodes.map((n) => (
                <g
                  key={n.key}
                  role="button"
                  tabIndex={0}
                  aria-label={n.isCurrent ? `${n.name} — you are here` : n.name}
                  aria-pressed={selected === n.key}
                  className={`world-map-node${n.isCurrent ? " current" : ""}${selected === n.key ? " selected" : ""}`}
                  onClick={() => setSelected(n.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(n.key);
                    }
                  }}
                >
                  <circle cx={n.x} cy={n.y} r={26} fill="transparent" />
                  {n.isCurrent && <circle cx={n.x} cy={n.y} r={22} className="world-map-ring" />}
                  {selected === n.key && <circle cx={n.x} cy={n.y} r={22} className="world-map-ring selected" />}
                  <circle cx={n.x} cy={n.y} r={14} fill={n.color} stroke="#05070f" strokeWidth={2} />
                  <text x={n.x} y={n.y + 34} textAnchor="middle" className="world-map-node-label">
                    {n.name}
                  </text>
                  {n.isCurrent && (
                    <text x={n.x} y={n.y + 50} textAnchor="middle" className="world-map-here-label">
                      You are here
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>

          <div className="world-map-controls">
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={() => setView(HOME_VIEW)}>
              Reset view
            </button>
          </div>

          {selectedNode && (
            <div className="world-map-detail">
              <strong>{selectedNode.name}</strong>
              <span> {selectedNode.blurb}</span>
              {selectedNode.isCurrent ? (
                <span className="world-map-here">You are here.</span>
              ) : selectedNode.key === "eternity" ? (
                <>
                  {/* Eternity's world: the map never states a one-leg price
                      for it — the way there is a three-leg chain through
                      two other worlds, and the server settles the chain
                      at departure. The button focuses the travel panel;
                      the panel and the server enforce the rest. */}
                  <span className="world-map-chain">
                    Warp there · 10 fuel a leg — the way runs through two other worlds first, so travel step by step.
                  </span>
                  {activeJourney ? (
                    <span className="world-map-note">
                      You&rsquo;re already travelling — finish this trip first.
                    </span>
                  ) : (
                    <button type="button" onClick={() => onTravelTo(selectedNode.key)}>
                      Travel to {selectedNode.name}
                    </button>
                  )}
                </>
              ) : selectedChain ? (
                <>
                  <span className="world-map-chain">
                    Warp there · {selectedChain.totalWarp} fuel for the whole trip
                    {selectedChain.totalWarp === 0 ? " — free" : ""} · Drift there · free
                  </span>
                  {activeJourney ? (
                    <span className="world-map-note">
                      You&rsquo;re already travelling — finish this trip first.
                    </span>
                  ) : (
                    <button type="button" onClick={() => onTravelTo(selectedNode.key)}>
                      Travel to {selectedNode.name}
                    </button>
                  )}
                </>
              ) : (
                <span className="world-map-note">No route on the map reaches here yet.</span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
