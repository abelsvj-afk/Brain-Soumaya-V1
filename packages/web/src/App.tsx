import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@brain/shared";
import { Graph3D, type Graph3DHandle } from "./graph/Graph3D.js";
import { IngestPanel } from "./components/IngestPanel.js";
import { SearchBox } from "./components/SearchBox.js";
import { RightDock, type DockTab } from "./components/RightDock.js";
import { getGraph, getHealth, type Health } from "./api/client.js";

export default function App() {
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<DockTab>("details");
  const graphRef = useRef<Graph3DHandle>(null);

  const refresh = useCallback(async () => {
    setData(await getGraph());
    getHealth()
      .then(setHealth)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const select = useCallback((node: GraphNode) => {
    setSelected(node);
    setTab("details");
  }, []);

  const focus = useCallback(
    (id: number) => {
      graphRef.current?.focusNode(id);
      const n = data.nodes.find((x) => x.id === id);
      if (n) setSelected(n);
    },
    [data],
  );

  return (
    <div className="app">
      <Graph3D ref={graphRef} data={data} onSelect={select} />

      <header className="brand">
        <h1>
          Soumaya <span className="sep">·</span> Second Brain
        </h1>
        {health && (
          <span className="status">
            {health.nodes} memories · {health.llm.available ? health.llm.model : "heuristic mode"}
          </span>
        )}
      </header>

      <SearchBox onFocus={focus} />
      <IngestPanel onIngested={refresh} />
      <RightDock tab={tab} setTab={setTab} selected={selected} onFocus={focus} />
    </div>
  );
}
