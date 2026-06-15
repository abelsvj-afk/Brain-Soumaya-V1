import { useEffect, useState } from "react";
import type { GraphData, GraphNode } from "@brain/shared";
import { getNeighbors } from "../api/client.js";
import { TYPE_COLORS } from "../graph/theme.js";

interface Props {
  node: GraphNode | null;
  onFocus: (id: number) => void;
}

export function NodeInspector({ node, onFocus }: Props) {
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

  if (!node) {
    return <p className="empty">Click a star to inspect a memory and its connections.</p>;
  }

  const neighbors = neighborhood ? neighborhood.nodes.filter((n) => n.id !== node.id) : [];

  return (
    <div className="dock-body">
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
