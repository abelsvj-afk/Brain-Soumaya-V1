import { useState } from "react";
import { RELIC_BY_ID, eternityGateOpen, type RelicProvenanceEventView } from "@brain/shared";
import { useRelicBuffs } from "../hooks/useRelicBuffs.js";
import { getRelicPreview, setRelicScarcity, type RelicPreview } from "../api/relics.js";
import { RelicComet } from "./RelicComet.js";
import { RelicCodexLayers } from "./RelicCodexLayers.js";

/** Relics I-7: one step of a copy's journey, in plain words. */
function provenanceLabel(e: RelicProvenanceEventView): string {
  switch (e.kind) {
    case "genesis": return `Came into the worlds${e.placeName ? ` — ${e.placeName}` : ""}.`;
    case "placed": return `Rested${e.placeName ? ` at ${e.placeName}` : " in the worlds"}.`;
    case "claimed": return "Claimed by a traveller.";
    case "returned": return e.reason === "exchange" ? "Flew back to the worlds after an exchange." : "Flew back to the worlds.";
    case "exchanged": return "Given in exchange.";
    case "consumed": return "Consumed — a Seed's way of leaving.";
    case "brain-deleted": return "Its holder's brain was let go; the copy returned to the worlds.";
    default: return e.kind;
  }
}

/**
 * "Relic blessings" — extends the shipped Codex panel (design note v2 §4/§10/§11).
 * Found relics, their gifts and trade-offs in plain words, hold/unhold with a
 * preview before confirming, two-step release with the gate warning, recent
 * departures, and the owner-only scarcity switch (shown only when the server
 * says this space is an owner space). All numbers are the server's.
 */
export function RelicBlessings({ spaceId }: { spaceId?: string }) {
  const { state, error, refresh, hold, unhold, release, store, carry, exchange, comet, showComet, dismissComet } = useRelicBuffs(!!spaceId);
  const [preview, setPreview] = useState<RelicPreview | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chartTargets, setChartTargets] = useState<Record<string, string>>({});
  // Relics I-7 (O-R7): the server says where the traveller stands; when
  // that is known and is not the Great Station, change controls say so
  // up front instead of failing after the tap. Reads are never gated.
  const offStation = !!state && state.currentWorld !== undefined && state.currentWorld !== "great-station";

  if (!spaceId) return null;
  return (
    <section aria-label="Relic blessings" style={{ marginBottom: "1rem" }}>
      <h4 style={{ margin: "0 0 0.4rem 0" }}>✦ Relic blessings</h4>
      {error && !state && (
        <p style={{ fontSize: "0.8rem" }}>{error} <button className="mini" onClick={() => void refresh()}>Retry</button></p>
      )}
      {/* Relics I-7 (review P2-2): a refused action's plain reason shows
          even when state exists — the server's sentence is never
          swallowed by a panel that otherwise renders fine. */}
      {error && state && (
        <p style={{ fontSize: "0.8rem" }} role="alert">{error}</p>
      )}
      {state && (
        <>
          <p style={{ fontSize: "0.8rem", opacity: 0.85 }}>{state.gate.missingPlain}</p>
          {offStation && (
            <p style={{ fontSize: "0.8rem", opacity: 0.85 }}>
              Hold changes happen at the Great Station — you can look everything over from here, and make changes there.
            </p>
          )}
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
                  {/* Relics I-7: the relic card — class, resting state,
                      copy context, provenance, and the exchange menu,
                      all from the server's state view. */}
                  <p style={{ fontSize: "0.8rem", margin: "0.3rem 0" }}>
                    Class: {h.tierClass ? h.tierClass.charAt(0).toUpperCase() + h.tierClass.slice(1) : "Unclassed yet"} ·{" "}
                    {h.location === "station" ? "Stored at the Great Station" : "Carried with you"}
                  </p>
                  {h.copyContext && <p style={{ fontSize: "0.8rem", margin: "0.3rem 0", opacity: 0.85 }}>{h.copyContext}</p>}
                  {h.provenance && h.provenance.length > 0 && (
                    <details style={{ fontSize: "0.8rem", margin: "0.3rem 0" }}>
                      <summary>Its copy&apos;s journey</summary>
                      <ol style={{ margin: "0.3rem 0 0.3rem 1.1rem", padding: 0 }}>
                        {h.provenance.map((e, i) => <li key={i}>{provenanceLabel(e)}</li>)}
                      </ol>
                    </details>
                  )}
                  {h.exchange?.eligible && (
                    <div style={{ margin: "0.4rem 0", borderTop: "1px dashed rgba(122,200,255,0.18)", paddingTop: "0.4rem" }}>
                      <p style={{ fontSize: "0.8rem", margin: "0.2rem 0" }}><strong>Exchange</strong> — a Legacy can leave this way, at the Great Station.</p>
                      {h.exchange.loreThreadIds.length > 0 ? (
                        <button className="mini" disabled={offStation} onClick={async () => { const out = await exchange(h.relicId, "lore"); if (out.ok) showComet({ relicId: h.relicId, name: h.name }); }}>Exchange for a revealed thread</button>
                      ) : (
                        <p style={{ fontSize: "0.8rem", margin: "0.2rem 0" }}>A lore exchange is not possible yet — no thread can be revealed.</p>
                      )}
                      {(state.chartTargets ?? []).length > 0 && (
                        <p style={{ fontSize: "0.8rem", margin: "0.2rem 0", display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                          <label>
                            Chart a course to{" "}
                            <select aria-label="Chart a course to" value={chartTargets[h.relicId] ?? ""} onChange={(e) => setChartTargets((m) => ({ ...m, [h.relicId]: e.target.value }))}>
                              <option value="">Choose a relic…</option>
                              {(state.chartTargets ?? []).map((id) => <option key={id} value={id}>{RELIC_BY_ID.get(id)?.name ?? id}</option>)}
                            </select>
                          </label>
                          <button className="mini" disabled={offStation || !chartTargets[h.relicId]} onClick={async () => { const out = await exchange(h.relicId, "chart", chartTargets[h.relicId] ?? null); if (out.ok) showComet({ relicId: h.relicId, name: h.name }); }}>Exchange for a chart</button>
                        </p>
                      )}
                      <p style={{ fontSize: "0.8rem", margin: "0.2rem 0" }}>
                        {h.exchange.creditsOffered
                          ? `Credits are offered for this exchange${h.exchange.creditsValue != null ? `: ${h.exchange.creditsValue}` : ""}.`
                          : "Credits are not offered for exchanges."}
                      </p>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    {h.location === "station" ? (
                      <button className="mini" disabled={offStation} onClick={() => void carry(h.relicId)}>Carry it with you</button>
                    ) : (
                      <button className="mini" disabled={offStation} onClick={() => void store(h.relicId)}>Store it at the Station</button>
                    )}
                    {h.held ? (
                      <button className="mini" disabled={offStation} aria-label={`Set down the ${h.name}`} onClick={() => void unhold(h.relicId)}>Set it down</button>
                    ) : preview?.previewFor === h.relicId ? (
                      <>
                        <span style={{ fontSize: "0.78rem" }}>
                          {preview.refused ?? `If held: fuel tank ${preview.buffs.fuelCap}, review pays ${preview.buffs.reviewEarn}, Deep Past window ${preview.buffs.riseWindowDays} days${preview.buffs.riseWindowOverruled.length ? ` — ${preview.buffs.riseWindowOverruled.map((id) => RELIC_BY_ID.get(id)?.name ?? id).join(", ")} overruled` : ""}.`}
                        </span>
                        {!preview.refused && <button className="mini" disabled={offStation} onClick={async () => { if (await hold(h.relicId)) setPreview(null); }}>Confirm hold</button>}
                        <button className="mini" onClick={() => setPreview(null)}>Not now</button>
                      </>
                    ) : (
                      <button className="mini" disabled={offStation} aria-label={`Hold the ${h.name}`} onClick={async () => setPreview(await getRelicPreview(h.relicId))}>Hold it</button>
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
                  {d.reason === "exchange"
                    ? `${d.name} was exchanged — its copy flew back to the worlds.`
                    : d.reason === "brain-deleted"
                      ? `${d.name} flew back to the worlds when its brain was let go.`
                      : `${d.name} flew back to the worlds.`}{" "}
                  <button className="mini" onClick={() => showComet({ relicId: d.relicId, name: d.name })}>Watch it fly again</button>
                </p>
              ))}
            </div>
          )}
          <RelicCodexLayers codex={state.codex ?? []} />
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
