import { useEffect, useState } from "react";
import type { Insight } from "@brain/shared";
import { getDigest, runDigest } from "../api/client.js";
import { TYPE_COLORS } from "../graph/theme.js";

export function DigestPanel({ onFocus }: { onFocus: (id: number) => void }) {
  const [items, setItems] = useState<Insight[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDigest()
      .then(setItems)
      .catch(() => {});
  }, []);

  async function run() {
    setBusy(true);
    try {
      await runDigest();
      setItems(await getDigest());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dock-body">
      <div className="dock-head">
        <h3>Latent connections</h3>
        <button className="mini" onClick={run} disabled={busy}>
          {busy ? "Synthesizing…" : "✨ Synthesize"}
        </button>
      </div>
      {items.length === 0 && (
        <p className="empty">
          No insights yet. Dump a few related thoughts, then hit Synthesize to surface connections
          you haven&apos;t drawn.
        </p>
      )}
      <ul className="insights">
        {items.map((it) => (
          <li key={it.id}>
            <p className="insight-text">{it.text}</p>
            <div className="pills">
              {it.nodes.map((n) => (
                <button
                  key={n.id}
                  className="pill"
                  style={{ borderColor: TYPE_COLORS[n.type] }}
                  onClick={() => onFocus(n.id)}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
