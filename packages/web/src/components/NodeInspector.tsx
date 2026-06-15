import { useEffect, useState } from "react";
import type { GraphData, GraphNode } from "@brain/shared";
import { getNeighbors } from "../api/client.js";
import { TYPE_COLORS } from "../graph/theme.js";

interface Props {
  node: GraphNode | null;
  onFocus: (id: number) => void;
  onClose: () => void;
}

export function NodeInspector({ node, onFocus, onClose }: Props) {
  const [neighborhood, setNeighborhood] = useState<GraphData | null>(null);

  useEffect(() => {
    if (!node) {
      setNeighborhood(null);
      return;
    }
    let active = true;
    getNeighbors(node.id, 2)
      .then((g) => active && setNeighborhood(g))
      .catch(() => active && setNeighborhood(null));
    return () => {
      active = false;
    };
  }, [node]);

  if (!node) return null;
  const neighbors = neighborhood ? neighborhood.nodes.filter((n) => n.id !== node.id) : [];

  return (
    <div className="panel inspector">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <span className="chip" style={{ background: TYPE_COLORS[node.type] }}>
        {node.type.replace(/_/g, " ")}
      </span>
      <h2>{node.label}</h2>
      <p className="content">{node.content}</p>
      <h3>Connected ({neighbors.length})</h3>
      <ul className="neighbors">
        {neighbors.map((n) => (
          <li key={n.id}>
            <button onClick={() => onFocus(n.id)}>
              <span className="dot" style={{ background: TYPE_COLORS[n.type] }} />
              {n.label}
            </button>
          </li>
        ))}
        {neighbors.length === 0 && <li className="empty">No connections yet.</li>}
      </ul>
    </div>
  );
}
