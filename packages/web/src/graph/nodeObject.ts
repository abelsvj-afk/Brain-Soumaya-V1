import * as THREE from "three";
import type { GraphNode, NodeType } from "@brain/shared";
import { TYPE_COLORS } from "./theme.js";

/** Distinct geometry per thought type — the celestial bestiary. */
function geometryForType(type: NodeType, size: number): THREE.BufferGeometry {
  switch (type) {
    case "random_thought":
      return new THREE.IcosahedronGeometry(size, 0);
    case "business_idea":
      return new THREE.SphereGeometry(size * 1.2, 24, 24);
    case "concept":
      return new THREE.OctahedronGeometry(size, 0);
    case "person":
      return new THREE.DodecahedronGeometry(size, 0);
    case "relationship_reflection":
      return new THREE.TorusKnotGeometry(size * 0.7, size * 0.25, 64, 8);
    default:
      return new THREE.SphereGeometry(size * 0.9, 16, 16);
  }
}

/** Build a floating CSS-styled text label as a lightweight sprite (no polygons). */
function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontSize = 48;
  const font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.font = font;
  const padding = 16;
  const textWidth = ctx.measureText(text).width;
  canvas.width = Math.ceil(textWidth) + padding * 2;
  canvas.height = fontSize + padding * 2;

  // Re-apply after resize (resizing clears the context).
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.fillText(text, padding, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const scale = 0.16;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.position.set(0, 9, 0);
  return sprite;
}

/**
 * Build the THREE.Object3D for a node: a glowing, type-specific celestial body
 * plus a floating label. `val` (degree, injected by the API/force-graph) scales
 * the body so hubs read as larger stars. userData carries the node id so hover
 * highlighting can find and dim/brighten it.
 */
export function makeNodeObject(node: GraphNode & { val?: number }): THREE.Object3D {
  const color = TYPE_COLORS[node.type] ?? TYPE_COLORS.other;
  const size = 4 + Math.min((node.val ?? 0) * 0.6, 6);
  const group = new THREE.Group();

  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.45,
  });
  const mesh = new THREE.Mesh(geometryForType(node.type, size), material);
  // Erratic thoughts and concepts spin; foundational bodies sit calm.
  if (node.type === "random_thought" || node.type === "concept") {
    mesh.userData.spin = true;
  }
  group.add(mesh);
  group.add(makeLabel(node.label));

  group.userData.nodeId = node.id;
  return group;
}
