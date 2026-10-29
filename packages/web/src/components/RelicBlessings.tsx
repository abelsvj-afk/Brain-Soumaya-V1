import { useState } from "react";
import { RELIC_BY_ID, eternityGateOpen } from "@brain/shared";
import { useRelicBuffs } from "../hooks/useRelicBuffs.js";
import { getRelicPreview, setRelicScarcity, type RelicPreview } from "../api/relics.js";
import { RelicComet } from "./RelicComet.js";

/**
 * "Relic blessings" — extends the shipped Codex panel (design note v2 §4/§10/§11).
 * Found relics, their gifts and trade-offs in plain words, hold/unhold with a
 * preview before confirming, two-step release with the gate warning, recent
 * departures, and the owner-only scarcity switch (shown only when the server
 * says this space is an owner space). All numbers are the server's.
 */
export function RelicBlessings({ spaceId }: { spaceId?: string }) {
  const { state, error, refresh, hold, unhold, release, comet, showComet, dismissComet } = useRelicBuffs(!!spaceId);
  const [preview, setPreview] = useState<RelicPreview | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!spaceId) return null;
  return (
    <section aria-label="Relic blessings" style={{ marginBottom: "1rem" }}>
      <h4 style={{ margin: "0 0 0.4rem 0" }}>✦ Relic blessings</h4>
      {error && !state && (
        <p style={{ fontSize: "0.8rem" }}>{error} <button className="mini" onClick={() => void refresh()}>Retry</button></p>
      )}
      {state && (
        <>
          <p style={{ fontSize: "0.8rem", opacity: 0.85 }}>{state.gate.missingPlain}</p>
          {state.buffs.riseWindowSetBy && (
            <p style={{ fontSize: "0.8rem", opacity: 0.85 }}>
              Deep Past window: {state.buffs.riseWindowDays} days, set by {RELIC_BY_ID.get(state.buffs.riseWindowSetBy)?.name ?? state.buffs.riseWindowSetBy}
              {state.buffs.riseWindowOverruled.length > 0 && ` — ${state.buffs.riseWindowOverruled.map((id) => RELIC_BY_ID.get(id)?.name ?? id).join(", ")} ${state.buffs.riseWindowOverruled.length === 1 ? "is" : "are"} overruled while it is held.`}
            </p>
          )}
          {state.holdings.length === 0 && <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>No relics found yet — look for a glimmer while you travel.</p>}
          {state.held.length >= 3 && <p style={{ fontSize: "0.8rem" }}>You can hold 3 relics at once. Set one down first to take up another.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {state.holdings.map((h) => {
              const isGatePiece = !state.gate.open && eternityGateOpen(new Set(state.found)) && !eternityGateOpen(new Set(state.found.filter((id) => id !== h.relicId)));
              return (
                <li key={h.relicId} style={{ border: "1px solid rgba(122,200,255,0.2)", borderRadius: 10, padding: "0.6rem 0.7rem" }}>
                  <strong>{h.name}</strong>{h.held ? " — held" : ""}
                  {h.blessing.status === "cut" ? (
                    <p style={{ fontSize: "0.8rem", margin: "0.3rem 0" }}>{h.blessing.cutReason ?? "It lends no blessing yet."}</p>
                  ) : (
                    <>
                      <p style={{ fontSize: "0.8rem", margin: "0.3rem 0" }}>{h.blessing.giftPlain}</p>
                      <p style={{ fontSize: "0.8rem", margin: "0.3rem 0", opacity: 0.8 }}>{h.blessing.costPlain}</p>
                    </>
                  )}
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    {h.held ? (
                      <button className="mini" aria-label={`Set down the ${h.name}`} onClick={() => void unhold(h.relicId)}>Set it down</button>
                    ) : preview?.previewFor === h.relicId ? (
                      <>
                        <span style={{ fontSize: "0.78rem" }}>
                          {preview.refused ?? `If held: fuel tank ${preview.buffs.fuelCap}, review pays ${preview.buffs.reviewEarn}, Deep Past window ${preview.buffs.riseWindowDays} days${preview.buffs.riseWindowOverruled.length ? ` — ${preview.buffs.riseWindowOverruled.map((id) => RELIC_BY_ID.get(id)?.name ?? id).join(", ")} overruled` : ""}.`}
                        </span>
                        {!preview.refused && <button className="mini" onClick={async () => { if (await hold(h.relicId)) setPreview(null); }}>Confirm hold</button>}
                        <button className="mini" onClick={() => setPreview(null)}>Not now</button>
                      </>
                    ) : (
                      <button className="mini" aria-label={`Hold the ${h.name}`} onClick={async () => setPreview(await getRelicPreview(h.relicId))}>Hold it</button>
                    )}
                    {confirmRelease === h.relicId ? (
                      <>
                        <span style={{ fontSize: "0.78rem" }}>
                          Let {h.name} fly back to the worlds? Its copy will rest somewhere new.
                          {isGatePiece ? " You have not crossed to Eternity's world yet, and this relic is part of your gate set — the gate will ask for it again." : ""}
                        </span>
                        <button className="mini" onClick={async () => { setConfirmRelease(null); await release(h.relicId); }}>Yes, let it fly</button>
                        <button className="mini" onClick={() => setConfirmRelease(null)}>Keep it</button>
                      </>
                    ) : (
                      <button className="mini" aria-label={`Let the ${h.name} fly`} onClick={() => setConfirmRelease(h.relicId)}>Let it fly</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {state.recentDepartures.length > 0 && (
            <div style={{ marginTop: "0.7rem" }}>
              <p style={{ fontSize: "0.8rem", margin: "0 0 0.3rem 0" }}>Recent departures</p>
              {state.recentDepartures.map((d, i) => (
                <p key={i} style={{ fontSize: "0.8rem", margin: "0.2rem 0" }}>
                  {d.name} flew back to the worlds.{" "}
                  <button className="mini" onClick={() => showComet({ relicId: d.relicId, name: d.name })}>Watch it fly again</button>
                </p>
              ))}
            </div>
          )}
          {state.isOwnerSpace && (
            <div style={{ marginTop: "0.7rem", fontSize: "0.8rem" }}>
              <p style={{ margin: "0 0 0.3rem 0" }}>Testing switch (only your space can see this): scarcity is {state.scarcityOff ? "off — your finds are test copies and never touch the shared pool" : "on"}.</p>
              <button className="mini" onClick={async () => { const out = await setRelicScarcity(!state.scarcityOff); if (out.ok) { setNotice(null); void refresh(); } else setNotice(out.error ?? "That didn't go through."); }}>
                {state.scarcityOff ? "Turn scarcity back on" : "Turn scarcity off for testing"}
              </button>
            </div>
          )}
          {notice && <p style={{ fontSize: "0.8rem" }}>{notice}</p>}
        </>
      )}
      {comet && <RelicComet relicName={comet.name} onDismiss={dismissComet} />}
    </section>
  );
}
