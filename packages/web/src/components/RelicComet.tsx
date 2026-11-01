import { useState } from "react";

/**
 * The comet departure (Worlds — design note §4, B-03 return as a comet).
 * After a relic is used and its blessing received, the copy eventually
 * flies off like a comet and disappears from the brain galaxy — a
 * visible, watchable event, never a silent removal. This overlay plays
 * that departure: a streak of light crossing the sky, pausable mid-flight
 * so the player can watch it go, replayable, and dismissible.
 *
 * The comet is a light effect, not a picture of the relic: the relic's
 * own model arrives with the Relics increment, and no stand-in is drawn
 * in its place (§8). Reduced motion shows the departure as a still frame
 * with the same words — the meaning never depends on the movement.
 */

const FLIGHT_SECONDS = 6;

export function RelicComet({
  relicName,
  onDismiss,
}: {
  relicName: string;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [flown, setFlown] = useState(false);
  const [replay, setReplay] = useState(0);

  const playState = paused ? "paused" : "running";

  const watchAgain = () => {
    setFlown(false);
    setPaused(false);
    setReplay((n) => n + 1);
  };

  return (
    <div
      role="dialog"
      aria-label={`${relicName} flying back to the worlds`}
      className="relic-comet-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(4, 6, 18, 0.82)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "1.5rem",
        textAlign: "center",
      }}
    >
      <style>{`
        @keyframes relic-comet-fly {
          0% { transform: translate(-12vw, 62vh) rotate(-32deg); opacity: 0; }
          8% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translate(72vw, -22vh) rotate(-32deg); opacity: 0; }
        }
        @keyframes relic-comet-progress {
          from { width: 0%; }
          to { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .relic-comet-track { animation: none !important; transform: translate(30vw, 20vh) rotate(-32deg) !important; opacity: 1 !important; }
          .relic-comet-progress { animation: none !important; width: 100% !important; }
        }
      `}</style>

      <div
        aria-hidden="true"
        style={{ position: "relative", width: "min(72vw, 560px)", height: "38vh", overflow: "hidden" }}
      >
        <div
          key={replay}
          className="relic-comet-track"
          onAnimationEnd={() => setFlown(true)}
          style={{
            position: "absolute",
            left: "8%",
            top: "18%",
            width: "220px",
            height: "10px",
            animation: `relic-comet-fly ${FLIGHT_SECONDS}s linear forwards`,
            animationPlayState: playState,
          }}
        >
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "50%",
              width: "16px",
              height: "16px",
              marginTop: "-8px",
              borderRadius: "50%",
              background: "radial-gradient(circle, #ffffff 0%, #ffe9a8 45%, rgba(255, 190, 80, 0) 75%)",
              boxShadow: "0 0 24px 8px rgba(255, 210, 120, 0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: "12px",
              top: "50%",
              height: "3px",
              marginTop: "-1px",
              background: "linear-gradient(90deg, rgba(255, 210, 120, 0), rgba(255, 210, 120, 0.85))",
              borderRadius: "2px",
            }}
          />
        </div>
      </div>

      <div style={{ maxWidth: "26rem" }}>
        <h3 style={{ margin: "0 0 0.4rem 0", fontSize: "1.15rem" }}>
          {flown ? `${relicName} has flown on` : `${relicName} is flying on`}
        </h3>
        <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.85, lineHeight: 1.5 }}>
          Back to the worlds, to be found again somewhere new — never the same place twice.
          {paused ? " Paused — take as long as you like." : ""}
        </p>
      </div>

      <div
        aria-hidden="true"
        style={{ width: "min(72vw, 560px)", height: "4px", background: "rgba(255,255,255,0.12)", borderRadius: "2px", overflow: "hidden" }}
      >
        <div
          key={`p-${replay}`}
          className="relic-comet-progress"
          style={{
            height: "100%",
            background: "linear-gradient(90deg,#7af9ff,#c9a0ff)",
            animation: `relic-comet-progress ${FLIGHT_SECONDS}s linear forwards`,
            animationPlayState: playState,
          }}
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
        <button className="mini" onClick={() => setPaused((p) => !p)}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button className="mini" onClick={watchAgain}>
          ↻ Watch again
        </button>
        <button className="mini" onClick={onDismiss}>
          Let it go
        </button>
      </div>
    </div>
  );
}
