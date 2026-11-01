import { useState } from "react";
import type { RelicStirringView } from "@brain/shared";
import { scanRelic } from "../api/relics.js";
import { stirringLine } from "./RelicCodexLayers.js";

/**
 * Relics I-7: the hunt surface for one glimmer, in the worlds. The
 * scan ("Feel for it") reads back exactly what the server offers —
 * a strength band and a bearing phrase, never coordinates, never a
 * distance, never a pin. A quiet answer reads as the trail gone
 * quiet (an ending), not as a failure. Claim refusals arrive as the
 * server's plain sentences (the `notice` prop): a wrong-anchor
 * refusal names the promise and leaves the stirring visibly open.
 */
export function RelicHuntControls({
  relicId,
  glimmer,
  settling,
  onLookCloser,
  scanPosition,
  stirring,
  notice,
}: {
  relicId: string;
  relicName: string;
  glimmer: string;
  settling: boolean;
  onLookCloser: () => void;
  scanPosition: readonly number[];
  stirring: RelicStirringView | null;
  notice?: string | null;
}) {
  const [scan, setScan] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const feel = async () => {
    if (scanning) return;
    setScanning(true);
    const out = await scanRelic(relicId, scanPosition);
    setScanning(false);
    if (!out.ok) { setScan(out.error ?? "The pulse didn't go through — try again when you're ready."); return; }
    if (out.quiet) { setScan("The trail has gone quiet here."); return; }
    setScan(out.band && out.bearing ? `${out.band} — toward ${out.bearing}.` : "The pulse came back without a direction — try again when you're ready.");
  };

  return (
    <p className="worlds-surface-fallback">
      Something glimmers {glimmer}.{" "}
      <button type="button" onClick={onLookCloser} disabled={settling}>
        {settling ? "Settling beside it…" : "Look closer"}
      </button>{" "}
      <button type="button" onClick={() => void feel()} disabled={scanning}>
        {scanning ? "Feeling…" : "Feel for it"}
      </button>
      {stirring && <span style={{ display: "block", marginTop: "0.3rem" }}>{stirringLine(stirring)}</span>}
      {scan && <span style={{ display: "block", marginTop: "0.3rem" }}>{scan}</span>}
      {notice && <span style={{ display: "block", marginTop: "0.3rem" }} role="alert">{notice}</span>}
    </p>
  );
}
