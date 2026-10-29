import {
  NODE_TYPES,
  NODE_TYPE_LABEL,
  CELESTIAL_CLASSES,
  CELESTIAL_ICON,
  CELESTIAL_LABEL,
  CELESTIAL_MEANING,
  SPECIAL_COLORS,
  COGNITIVE_KINDS,
  COGNITIVE_META,
  type NodeType,
} from "@brain/shared";
import { useEffect, useState } from "react";
import { TYPE_COLORS, emotionHex, isColorblind } from "../graph/theme.js";
import { FLEET } from "../graph/fleet.js";
import { THOUGHT_SOURCE_COLOR } from "@brain/shared";

/**
 * The Living Legend — a glanceable visual key to the galaxy's language, so you
 * can READ your brain intuitively instead of memorizing the Help menu. Every row
 * is DERIVED from the same runtime constants the galaxy actually draws from
 * (theme colors, celestial classes, the emotion palette, the fleet roster), so
 * it can never drift out of sync — add a memory type or a celestial class and it
 * appears here automatically.
 */

function Swatch({ color, ring }: { color: string; ring?: boolean }) {
  return (
    <span
      className="legend-swatch"
      style={{ background: color, boxShadow: ring ? `0 0 8px ${color}` : undefined }}
    />
  );
}

const TYPE_MEANING: Record<NodeType, string> = {
  person: "someone in your life",
  project: "an effort with an outcome",
  decision: "a choice + its rationale",
  company: "an org, team, or institution",
  meeting: "a conversation at a point in time",
  daily: "a journal note or fleeting thought",
  knowledge: "a fact or learning worth keeping",
  concept: "an abstract idea or theme",
  other: "anything that fits nowhere else",
  moc: "a constellation hub (Map of Content)",
};

export function Legend({ onClose }: { onClose: () => void }) {
  // Re-render when the colorblind palette is toggled so swatches + names stay honest.
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("brain-palette-change", on);
    return () => window.removeEventListener("brain-palette-change", on);
  }, []);
  const cb = isColorblind();
  const emo = {
    neutral: { color: emotionHex("neutral"), name: cb ? "Grey" : "Green" },
    positive: { color: emotionHex("positive"), name: cb ? "Blue" : "Gold" },
    heavy: { color: emotionHex("heavy"), name: cb ? "Orange" : "Indigo" },
  };
  return (
    <div className="legend-overlay" role="dialog" aria-label="Galaxy legend" onClick={onClose}>
      <div className="legend-card" onClick={(e) => e.stopPropagation()}>
        <header className="legend-head">
          <h2>🗺️ Reading your galaxy</h2>
          <button className="legend-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="legend-scroll">
          <section>
            <h3>Memory types (colour)</h3>
            <ul className="legend-list">
              {NODE_TYPES.filter((t) => t !== "moc").map((t) => (
                <li key={t}>
                  <Swatch color={TYPE_COLORS[t]} />
                  <span className="legend-name">{NODE_TYPE_LABEL[t]}</span>
                  <span className="legend-meaning">{TYPE_MEANING[t]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Body size = how much a memory matters</h3>
            <p className="legend-note">
              A memory grows as it gains importance, connections, and age. Bigger = weightier.
            </p>
            <ul className="legend-list">
              {CELESTIAL_CLASSES.map((c) => (
                <li key={c}>
                  <span className="legend-glyph">{CELESTIAL_ICON[c]}</span>
                  <span className="legend-name">{CELESTIAL_LABEL[c]}</span>
                  <span className="legend-meaning">{CELESTIAL_MEANING[c]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Special bodies</h3>
            <ul className="legend-list">
              <li>
                <Swatch color={SPECIAL_COLORS.constellation} ring />
                <span className="legend-name">Constellation</span>
                <span className="legend-meaning">a named hub summarizing a body of work</span>
              </li>
              <li>
                <Swatch color={SPECIAL_COLORS.belief} ring />
                <span className="legend-name">Belief</span>
                <span className="legend-meaning">something she's concluded about you</span>
              </li>
              <li>
                <Swatch color={SPECIAL_COLORS.sun} ring />
                <span className="legend-name">The Sun</span>
                <span className="legend-meaning">the core your whole galaxy orbits</span>
              </li>
            </ul>
          </section>

          <section>
            <h3>Your mind (the cognitive layer)</h3>
            <p className="legend-note">
              Beyond what you remember — what you're pursuing and becoming. Map these in the 🧠 Mind
              tab; your memories drift into their orbit over time.
            </p>
            <ul className="legend-list">
              {COGNITIVE_KINDS.map((k) => (
                <li key={k}>
                  <Swatch color={COGNITIVE_META[k].color} ring={COGNITIVE_META[k].durable} />
                  <span className="legend-name">
                    {COGNITIVE_META[k].icon} {COGNITIVE_META[k].label}
                  </span>
                  <span className="legend-meaning">{COGNITIVE_META[k].blurb}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Connections (the glowing lines)</h3>
            <ul className="legend-list">
              <li>
                <Swatch color={emo.neutral.color} />
                <span className="legend-name">{emo.neutral.name}</span>
                <span className="legend-meaning">a neutral link — the resting colour</span>
              </li>
              <li>
                <Swatch color={emo.positive.color} />
                <span className="legend-name">{emo.positive.name}</span>
                <span className="legend-meaning">joins two joyful memories</span>
              </li>
              <li>
                <Swatch color={emo.heavy.color} />
                <span className="legend-name">{emo.heavy.name}</span>
                <span className="legend-meaning">joins two heavy memories</span>
              </li>
              <li>
                <span className="legend-glyph">✦</span>
                <span className="legend-name">Bright flare</span>
                <span className="legend-meaning">Soumaya just tended it — fades over ~3 days</span>
              </li>
              <li>
                <span className="legend-glyph">•••</span>
                <span className="legend-name">Travelling dots</span>
                <span className="legend-meaning">real info flowing between memories</span>
              </li>
            </ul>
          </section>

          <section>
            <h3>The fleet</h3>
            <ul className="legend-list">
              {FLEET.map((u) => (
                <li key={u.id}>
                  <span className="legend-glyph">{u.icon}</span>
                  <span className="legend-name">{u.name}</span>
                  <span className="legend-meaning">{u.role}</span>
                </li>
              ))}
              <li>
                <span className="legend-glyph">👽</span>
                <span className="legend-name">Visitors</span>
                <span className="legend-meaning">drifters drawn to your most interesting memories</span>
              </li>
            </ul>
          </section>

          <section>
            <h3>Living galaxy</h3>
            <ul className="legend-list">
              <li><span className="legend-glyph">🧭</span><span className="legend-name">Journey hubs</span><span className="legend-meaning">your life chapters, ringed high above</span></li>
              <li><span className="legend-glyph">✦</span><span className="legend-name">Brightening</span><span className="legend-meaning">a journey glows brighter as it progresses</span></li>
              <li><span className="legend-glyph">◦</span><span className="legend-name">Cold</span><span className="legend-meaning">a paused journey dims + cools to slate</span></li>
            </ul>
          </section>

          <section>
            <h3>Your money sky</h3>
            <ul className="legend-list">
              <li><span className="legend-glyph">◐</span><span className="legend-name">Approaching</span><span className="legend-meaning">a bill due soon — pulses red as it nears</span></li>
              <li><span className="legend-glyph">!</span><span className="legend-name">Overdue</span><span className="legend-meaning">past due + unpaid — red, urgent pulse</span></li>
              <li><span className="legend-glyph">❄</span><span className="legend-name">Cooling</span><span className="legend-meaning">you can't cover it yet — turns blue</span></li>
              <li><span className="legend-glyph">•</span><span className="legend-name">Calm</span><span className="legend-meaning">funded, not due soon — soft gold</span></li>
              <li><span className="legend-glyph">✓</span><span className="legend-name">Paid</span><span className="legend-meaning">settled — calm green</span></li>
            </ul>
          </section>

          <section>
            <h3>Fuel, streaks & shields</h3>
            <ul className="legend-list">
              <li><span className="legend-glyph">⛽</span><span className="legend-name">Fuel</span><span className="legend-meaning">energy for her deep jobs — the gauge shows Fuel / capacity and the cost per job</span></li>
              <li><span className="legend-glyph">🔥</span><span className="legend-name">Streak</span><span className="legend-meaning">days in a row you've fed your brain; the ember also shows your best streak</span></li>
              <li><span className="legend-glyph">🛡️</span><span className="legend-name">Nebula shields ×N</span><span className="legend-meaning">each shield forgives one missed day — the number is the true count banked</span></li>
            </ul>
          </section>

          <section>
            <h3>MindSpace motes (drifting thoughts)</h3>
            <ul className="legend-list">
              {Object.entries(THOUGHT_SOURCE_COLOR).map(([source, rgb]) => (
                <li key={source}>
                  <Swatch color={`rgb(${rgb})`} />
                  <span className="legend-name">{source === "manual" ? "Spontaneous" : source === "chat" ? "From chat" : source === "goal" ? "Goal pull" : source === "priority" ? "Urgent drive" : "Feeling"}</span>
                  <span className="legend-meaning">a thought from {source === "manual" ? "you, captured directly" : source}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Her ship & the beacon beam</h3>
            <ul className="legend-list">
              <li><span className="legend-glyph">🏷️</span><span className="legend-name">Ship task label</span><span className="legend-meaning">the floating label over her ship names the job she's running, in plain words</span></li>
              <li><span className="legend-glyph">📡</span><span className="legend-name">Beacon beam</span><span className="legend-meaning">takes on the emotional colour of the cold memory it guards — gold warm, green calm, indigo heavy</span></li>
              <li><span className="legend-glyph">🛡️</span><span className="legend-name">Guard</span><span className="legend-meaning">the Defender holds station over your heaviest hub and intercepts hostile drifters</span></li>
            </ul>
          </section>

          <section>
            <h3>Moments & modes</h3>
            <ul className="legend-list">
              <li><span className="legend-glyph">☄️</span><span className="legend-name">Flashback</span><span className="legend-meaning">a flight back to an old, weighty memory — tap its toast to fly there</span></li>
              <li><span className="legend-glyph">🌌</span><span className="legend-name">Calm mode</span><span className="legend-meaning">dims the chrome — header, alerts, chips, HUD — for a calm reading session; entry and exit are announced</span></li>
              <li><span className="legend-glyph">🌌</span><span className="legend-name">Views vs Lens</span><span className="legend-meaning">a View is a fixed, instant category glance; a Lens is your own saved filter that keeps matching new memories</span></li>
            </ul>
          </section>

          <section>
            <h3>Credits</h3>
            <ul className="legend-list">
              <li>
                <span className="legend-glyph">🌌</span>
                <span className="legend-name">Milky Way panorama</span>
                <span className="legend-meaning">
                  ESO/S. Brunier —{" "}
                  <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
                    CC BY 4.0
                  </a>
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
