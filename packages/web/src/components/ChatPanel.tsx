import { useState, type FormEvent } from "react";
import type { ChatResponse } from "@brain/shared";
import { askChat } from "../api/client.js";
import { TYPE_COLORS } from "../graph/theme.js";

export function ChatPanel({ onFocus }: { onFocus: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<ChatResponse | null>(null);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResp(await askChat(q));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dock-body">
      <h3>Chat with your brain</h3>
      <form onSubmit={ask} className="chat-form">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask your memories…"
        />
        <button disabled={busy}>{busy ? "…" : "Ask"}</button>
      </form>
      {resp && (
        <div className="chat-answer">
          <p>{resp.answer}</p>
          {resp.citations.length > 0 && (
            <div className="pills">
              {resp.citations.map((c) => (
                <button
                  key={c.id}
                  className="pill"
                  style={{ borderColor: TYPE_COLORS[c.type] }}
                  onClick={() => onFocus(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
