import { useState } from "react";
import { ingestText } from "../api/client.js";

export function IngestPanel({ onIngested }: { onIngested: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await ingestText(text);
      const n = r.nodes.length;
      const e = r.extractedEdges.length + r.associativeEdges.length;
      setMsg(`+${n} node${n !== 1 ? "s" : ""}, ${e} connection${e !== 1 ? "s" : ""}`);
      setText("");
      onIngested();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel ingest">
      <h2>Dump a thought</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A business idea, a reflection, a random thought…"
        rows={4}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <div className="row">
        <button onClick={submit} disabled={busy}>
          {busy ? "Thinking…" : "Add to brain"}
        </button>
        <span className="msg">{msg}</span>
      </div>
    </div>
  );
}
