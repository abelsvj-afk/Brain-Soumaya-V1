import { useState, type FormEvent } from "react";
import { search, type SearchHit } from "../api/client.js";

export function SearchBox({ onFocus }: { onFocus: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setHits(await search(q));
    setOpen(true);
  }

  return (
    <div className="panel search">
      <form onSubmit={run}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your mind…"
        />
      </form>
      {open && (
        <ul className="results">
          {hits.length === 0 && <li className="empty">No matches.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => {
                  onFocus(h.id);
                  setOpen(false);
                }}
              >
                {h.label}
                <em>{(h.similarity * 100).toFixed(0)}%</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
