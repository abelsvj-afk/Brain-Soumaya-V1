import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import type { GraphData, GraphNode } from "@brain/shared";
import { makeNodeObject } from "./nodeObject.js";
import { makeStarfield } from "./starfield.js";
import { addBloom } from "./bloom.js";
import { BG } from "./theme.js";

export interface Graph3DHandle {
  focusNode: (id: number) => void;
}

interface Props {
  data: GraphData;
  onSelect: (node: GraphNode) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const linkEnd = (v: any): number => (typeof v === "object" && v !== null ? v.id : v);

export const Graph3D = forwardRef<Graph3DHandle, Props>(function Graph3D({ data, onSelect }, ref) {
  const fgRef = useRef<any>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);

  // Undirected adjacency for neighbor highlighting.
  const adjacency = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const l of data.links) {
      const s = linkEnd(l.source);
      const t = linkEnd(l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [data]);

  const isLit = (id: number): boolean =>
    hoverId === null || id === hoverId || (adjacency.get(hoverId)?.has(id) ?? false);

  // One-time imperative scene setup: lights, starfield, bloom, spin loop.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || fg.__brainInited) return;
    fg.__brainInited = true;

    const scene: THREE.Scene = fg.scene();
    scene.add(new THREE.AmbientLight(0x8888aa, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(1, 1, 1);
    scene.add(dir);
    scene.add(makeStarfield());

    addBloom(fg, {});

    // Gentle repulsion + relationship-strength-driven link distance ("breathing").
    fg.d3Force("charge")?.strength(-130);
    fg.d3Force("link")?.distance((l: any) => 36 + (1 - (l.weight ?? 0.5)) * 70);

    let raf = 0;
    const tick = () => {
      scene.traverse((o: any) => {
        if (o.userData?.spin) {
          o.rotation.y += 0.02;
          o.rotation.x += 0.012;
        }
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Hover highlighting: dim node groups that aren't the focus or its neighbors.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg?.scene) return;
    fg.scene().traverse((o: any) => {
      const id = o.userData?.nodeId;
      if (id == null) return;
      const lit = isLit(id);
      o.traverse((child: any) => {
        const mat = child.material;
        if (!mat) return;
        mat.transparent = true;
        mat.opacity = lit ? 1 : 0.12;
        if (mat.emissiveIntensity != null) mat.emissiveIntensity = lit ? 0.85 : 0.08;
      });
    });
  }, [hoverId, adjacency]);

  const flyTo = (n: any) => {
    if (!n || n.x == null) return;
    const dist = 140;
    const r = 1 + dist / Math.hypot(n.x, n.y, n.z || 1);
    fgRef.current?.cameraPosition(
      { x: n.x * r, y: n.y * r, z: (n.z || 0) * r },
      n,
      1100,
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      focusNode: (id: number) => flyTo((data.nodes as any[]).find((x) => x.id === id)),
    }),
    [data],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data as any}
      backgroundColor={BG}
      showNavInfo={false}
      nodeThreeObject={(node: any) => makeNodeObject(node)}
      nodeLabel={(n: any) => `${n.label} · ${String(n.type).replace(/_/g, " ")}`}
      onNodeClick={(n: any) => {
        onSelect(n);
        flyTo(n);
      }}
      onNodeHover={(n: any) => setHoverId(n ? n.id : null)}
      linkColor={(l: any) => {
        const lit = hoverId === null || (isLit(linkEnd(l.source)) && isLit(linkEnd(l.target)));
        return lit ? "rgba(150,180,255,0.55)" : "rgba(120,120,150,0.05)";
      }}
      linkWidth={(l: any) => 0.3 + (l.weight ?? 0.4) * 1.4}
      linkCurvature={0.2}
      linkDirectionalParticles={(l: any) => Math.max(1, Math.round((l.weight ?? 0.4) * 4))}
      linkDirectionalParticleSpeed={(l: any) => 0.004 + (l.weight ?? 0.4) * 0.012}
      linkDirectionalParticleWidth={1.4}
    />
  );
});
