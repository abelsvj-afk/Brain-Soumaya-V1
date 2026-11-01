import type { RelicCodexView, RelicLayerView, RelicStirringView } from "@brain/shared";

/**
 * Relics I-7 (§5.8): the layered Codex. Every entry renders from the
 * SERVER's read model — a layer's text appears only when the server
 * sent it (locked text is never serialized, §8.1 #12), a layer with
 * no canon text yet says so plainly ("unwritten"), and the three
 * discovery records stay distinct: the first-in-world line, the
 * viewer's own discovery, and — on the Hold cards — the copy's
 * provenance. Stirring endings use the design's honest vocabulary:
 * a quiet trail is an ending, never an error.
 */
function LayerLine({ label, layer, closedLine }: { label: string; layer: RelicLayerView; closedLine: string }) {
  return (
    <p style={{ fontSize: "0.8rem", margin: "0.25rem 0", lineHeight: 1.45 }}>
      <strong>{label}:</strong>{" "}
      {layer.state === "unlocked" && layer.text ? layer.text
        : layer.state === "unwritten" ? closedLine
        : "This layer is still closed to you."}
    </p>
  );
}

export function stirringLine(s: RelicStirringView): string {
  switch (s.state) {
    case "open": return `A stirring is open — something of ${s.name} is astir in ${s.worldName}, and the trail is live.`;
    case "claimed": return `The stirring for ${s.name} has been claimed.`;
    case "quiet": return `The trail has gone quiet for ${s.name}.`;
    case "expired": return `The stirring for ${s.name} has ended — its window closed.`;
  }
}

export function RelicCodexLayers({ codex }: { codex: RelicCodexView[] }) {
  if (!codex || codex.length === 0) return null;
  return (
    <section aria-label="Relic Codex layers" style={{ marginBottom: "1rem" }}>
      <h4 style={{ margin: "0 0 0.4rem 0" }}>✦ The relic Codex — layer by layer</h4>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {codex.map((c) => (
          <li key={c.relicId} style={{ border: "1px solid rgba(122,200,255,0.16)", borderRadius: 10, padding: "0.6rem 0.7rem" }}>
            <strong>{c.name}</strong> <span style={{ fontSize: "0.78rem", opacity: 0.75 }}>— {c.worldName}</span>
            <p style={{ fontSize: "0.8rem", margin: "0.3rem 0" }}>
              {c.discovered ? "You have found this relic — it is yours in the Codex for good." : "You have not found this relic yet."}
            </p>
            {c.firstDiscovery && (
              <p style={{ fontSize: "0.8rem", margin: "0.25rem 0" }}>
                First found by {c.firstDiscovery.discovererName}{c.firstDiscovery.placeName ? ` — ${c.firstDiscovery.placeName}` : ""}.
              </p>
            )}
            <LayerLine label="Stirring" layer={c.layers.stirring} closedLine="No stirring words have been written for this relic yet." />
            <LayerLine label="Place" layer={c.layers.place} closedLine="No place words have been written for this relic yet." />
            <LayerLine label="Description" layer={c.layers.description} closedLine="No description has been written for this relic yet." />
            {c.layers.threads.state === "unwritten" ? (
              <p style={{ fontSize: "0.8rem", margin: "0.25rem 0" }}><strong>Threads:</strong> No threads have been written for this relic yet.</p>
            ) : (
              c.layers.threads.entries.map((t) => (
                <p key={t.threadId} style={{ fontSize: "0.8rem", margin: "0.25rem 0", lineHeight: 1.45 }}>
                  <strong>Thread:</strong>{" "}
                  {t.unlocked && t.text ? t.text : `A thread joins this relic with ${t.otherName} — its words are still dark.`}
                </p>
              ))
            )}
            {c.stirrings.map((s, i) => (
              <p key={i} style={{ fontSize: "0.8rem", margin: "0.25rem 0" }}>{stirringLine(s)}</p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
