import { useEffect, useState } from "react";
import { snapshot, reset, getGpuInfo, getRendererPixelRatio, type PerfSnapshot } from "../graph/perfStats.js";
import { isComposerBypassEnabled } from "../graph/composerBypassDiag.js";
import { logDiagnosticEvent } from "../diagnostics/buffer";

/**
 * The performance HUD (Performance Program, Stage 0) — the instrument every later stage
 * is verified against.
 *
 * It exists because the galaxy can only be profiled on a REAL phone: the dev sandbox
 * can't reach the deployed site and the secondary agent has no headless Chrome on
 * Android. So the numbers have to be readable on-device and copyable back out.
 *
 * Reads NOTHING per frame — it polls the perfStats singleton twice a second. The whole
 * point is that the instrument must not perturb what it measures.
 *
 * Self-contained in the same style as MindSpace: it owns its own localStorage flag and
 * re-reads on a `perfhud-toggle` window event, so nothing has to be prop-drilled.
 */

const KEY = "perf.hud";

export function perfHudEnabled(): boolean {
  try {
    // ?perf=1 turns it on for a one-off check without digging through Settings, and
    // sticks so a reload (very common while chasing a stutter) keeps it on.
    const q = new URLSearchParams(window.location.search);
    if (q.has("perf")) {
      const on = q.get("perf") !== "0";
      localStorage.setItem(KEY, on ? "1" : "0");
      return on;
    }
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setPerfHudEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("perfhud-toggle"));
}

const ms = (n: number) => n.toFixed(1);
const n0 = (n: number) => Math.round(n).toLocaleString();

/** Rough MB of JS heap, where the browser exposes it (Chromium only). */
function heapMb(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize / 1048576 : null;
}

export function PerfHUD({ nodeCount }: { nodeCount?: number }) {
  const [on, setOn] = useState(perfHudEnabled());
  const [s, setS] = useState<PerfSnapshot | null>(null);
  // Heap DELTA per second is the metric that proves the allocation work — absolute heap
  // says almost nothing, but the size of the GC sawtooth says everything.
  const [heapRate, setHeapRate] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => setOn(perfHudEnabled());
    window.addEventListener("perfhud-toggle", sync);
    return () => window.removeEventListener("perfhud-toggle", sync);
  }, []);

  useEffect(() => {
    if (!on) return;
    let lastHeap = heapMb();
    let lastAt = performance.now();
    const poll = () => {
      setS(snapshot());
      const h = heapMb();
      const now = performance.now();
      if (h != null && lastHeap != null) {
        const dt = (now - lastAt) / 1000;
        // Only report growth; a drop just means a collection happened.
        if (dt > 0) setHeapRate(Math.max(0, (h - lastHeap) / dt));
      }
      lastHeap = h;
      lastAt = now;
    };
    poll();
    const iv = window.setInterval(poll, 500);
    return () => window.clearInterval(iv);
  }, [on]);

  // Leave a summary in the diagnostics flight recorder when the HUD is closed or the tab
  // is hidden, so a session's numbers survive into the copyable diagnostics dump.
  useEffect(() => {
    if (!on) return;
    const dump = () => {
      const cur = snapshot();
      logDiagnosticEvent("event", "perf.summary", {
        tickP50: cur.tick.p50, tickP95: cur.tick.p95, tickP99: cur.tick.p99,
        renderP50: cur.render.p50, renderP95: cur.render.p95,
        presentP50: cur.present.p50, gapMs: cur.gapMs, fps: cur.fps,
        droppedPct: cur.droppedPct, calls: cur.drawInfo?.calls, textures: cur.memory?.textures,
        trackedNodes: cur.galaxyCounts?.trackedNodes, trackedLinks: cur.galaxyCounts?.trackedLinks,
        visibleNodes: cur.galaxyCounts?.visibleNodes, visibleLinks: cur.galaxyCounts?.visibleLinks,
        detailedLinks: cur.galaxyCounts?.detailedLinks, detailedLinkBudget: cur.galaxyCounts?.detailedLinkBudget,
        boundedLinksEnabled: cur.galaxyCounts?.boundedLinksEnabled,
      });
    };
    const onHide = () => { if (document.visibilityState === "hidden") dump(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      dump();
    };
  }, [on]);

  if (!on || !s) return null;

  // The headline diagnosis. This is the single most useful thing the HUD says: it tells
  // us WHICH bottleneck a given device actually has, instead of us guessing. The key is
  // kept separate from the label so the CSS class never depends on display text.
  // `gapMs` (present vs. render, same sampling site — see perfStats.ts) points at the
  // GPU/fill-rate; `tick.p95` (our own per-frame scene-mutation cost) points at the CPU.
  const ready = s.presentSamples >= 30;
  // `s.gpu` (EXT_disjoint_timer_query_webgl2, when supported) is the decisive tie-
  // breaker `gapMs` alone can't provide: a slow `render()` call with a SMALL real GPU
  // time means the synchronous JS call itself is blocked (driver/queue back-pressure,
  // e.g. ANGLE's Vulkan backend under load) — not the GPU doing genuine fragment/
  // vertex work, however large `gapMs` looks. Only trust this once there's a real GPU
  // sample AND render is actually slow enough for the distinction to matter.
  const gpuP95 = s.gpu?.p95 ?? null;
  const looksLikeDriverStall = gpuP95 != null && s.render.p95 > 30 && gpuP95 < s.render.p95 * 0.3;
  const boundKey: "sampling" | "stall" | "gpu" | "cpu" | "healthy" =
    !ready ? "sampling"
      : looksLikeDriverStall ? "stall"
        : s.gapMs > 8 ? "gpu"
          : s.tick.p95 > 12 ? "cpu"
            : "healthy";
  const bound = {
    sampling: "sampling…",
    stall: "CPU/driver stall (GPU itself is idle)",
    gpu: "GPU / fill-rate",
    cpu: "CPU bound",
    healthy: "healthy",
  }[boundKey];

  const copy = () => {
    const text = [
      `tick   p50 ${ms(s.tick.p50)}ms  p95 ${ms(s.tick.p95)}ms  p99 ${ms(s.tick.p99)}ms  max ${ms(s.tick.max)}ms  (n=${s.tickSamples})`,
      `render p50 ${ms(s.render.p50)}ms  p95 ${ms(s.render.p95)}ms`,
      `present p50 ${ms(s.present.p50)}ms  p95 ${ms(s.present.p95)}ms  → ${s.fps.toFixed(0)} fps  (n=${s.presentSamples})`,
      `gap ${ms(s.gapMs)}ms  → ${bound}`,
      s.gpuTimingSupported
        ? `gpu p50 ${ms(s.gpu?.p50 ?? 0)}ms  p95 ${ms(s.gpu?.p95 ?? 0)}ms  (real GPU execution time per render() call)`
        : `gpu timing: unsupported (no EXT_disjoint_timer_query_webgl2)`,
      `dropped ${s.droppedPct.toFixed(1)}%`,
      `draw calls ${n0(s.drawInfo?.calls ?? 0)}  tris ${n0(s.drawInfo?.triangles ?? 0)}  lines ${n0(s.drawInfo?.lines ?? 0)}  points ${n0(s.drawInfo?.points ?? 0)}`,
      `geometries ${n0(s.memory?.geometries ?? 0)}  textures ${n0(s.memory?.textures ?? 0)}  programs ${s.programs ?? "?"}  churn ${s.programsChurnCount}`,
      heapRate != null ? `heap +${heapRate.toFixed(2)} MB/s` : `heap n/a`,
      s.galaxyCounts?.transparentObjects != null
        ? `transparent objects ${n0(s.galaxyCounts.transparentObjects)}`
        : `transparent objects: N/A`,
      s.galaxyCounts?.composerBuffers
        ? `composer buffers ${s.galaxyCounts.composerBuffers.width}x${s.galaxyCounts.composerBuffers.height} × ${s.galaxyCounts.composerBuffers.pixelRatio}dpr  ${s.galaxyCounts.composerBuffers.halfFloat ? "HalfFloat" : "UnsignedByte"}  (×2, always allocated — see forensic trace item 3)`
        : `composer buffers: N/A`,
      `composer bypass: ${isComposerBypassEnabled() ? "ON (diagnostic — direct renderer.render, no EffectComposer)" : "off (normal composer path)"}`,
      s.galaxyCounts
        ? `tracked ${n0(s.galaxyCounts.trackedNodes)} nodes / ${n0(s.galaxyCounts.trackedLinks)} links  visible ${n0(s.galaxyCounts.visibleNodes)} nodes / ${n0(s.galaxyCounts.visibleLinks)} links`
        : `tracked/visible nodes+links: N/A`,
      s.galaxyCounts
        ? `labels ${n0(s.galaxyCounts.visibleLabels)}  lights ${n0(s.galaxyCounts.lightPoolSize)}  journey ${n0(s.galaxyCounts.journeyObjects)}  money ${n0(s.galaxyCounts.moneyObjects)}`
        : `labels/lights/journey/money: N/A`,
      s.galaxyCounts?.detailedLinkBudget != null
        ? `detailed links ${n0(s.galaxyCounts.detailedLinks ?? 0)} / budget ${n0(s.galaxyCounts.detailedLinkBudget)}  bounded:${s.galaxyCounts.boundedLinksEnabled ? "ON" : "OFF"}`
        : `detailed links: N/A`,
      `nodes ${n0(nodeCount ?? 0)}  browser dpr ${window.devicePixelRatio}  renderer dpr ${getRendererPixelRatio()?.toFixed(3) ?? "?"}`,
      `gpu ${getGpuInfo() ?? "unavailable (masked or no WEBGL_debug_renderer_info)"}`,
      navigator.userAgent,
    ].join("\n");
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); },
      () => { /* clipboard blocked — the numbers are still on screen to read */ },
    );
  };

  const Row = ({ k, v, hint }: { k: string; v: string; hint?: string }) => (
    <div className="ph-row" title={hint}>
      <span className="ph-k">{k}</span>
      <span className="ph-v">{v}</span>
    </div>
  );

  return (
    <div className="perf-hud" role="status" aria-label="Performance readout">
      <div className="ph-head">
        <strong>PERF</strong>
        {/* Never colour alone — the state is spelled out in words too. */}
        <span className={`ph-bound ph-${boundKey}`}>{bound}</span>
      </div>
      <p className="ph-human">In plain terms: this shows how smoothly your galaxy is running and what is slowing it down, if anything.</p>
      <p className="ph-offramp">
        On because a link (?perf=1) or Settings turned it on — and it sticks on this device. Tap × below to hide it,
        or remove <code>perf</code> from the address-bar link. Nothing else about your galaxy changes.
      </p>
      {isComposerBypassEnabled() && (
        <Row
          k="⚠ bypass"
          v="composer OFF — direct render"
          hint="DIAGNOSTIC MODE: EffectComposer is bypassed entirely; renderer.render(scene, camera) is called directly. Not the normal path — for the render-stall investigation only. Turn off in Settings when done."
        />
      )}
      <Row k="tick" v={`${ms(s.tick.p50)} / ${ms(s.tick.p95)} / ${ms(s.tick.p99)}`} hint="Our own per-frame scene-mutation cost (p50 / p95 / p99 ms). Only sampled on frames that weren't skipped by the FPS cap." />
      <Row k="render" v={`${ms(s.render.p50)} / ${ms(s.render.p95)}`} hint="Draw-call submission cost (p50 / p95 ms), sampled on every real render — independent of our tick loop." />
      <Row k="frame" v={`${ms(s.present.p50)}ms · ${s.fps.toFixed(0)}fps`} hint="Wall-clock gap between rendered frames — the true presentation cadence." />
      <Row k="gap" v={`${ms(s.gapMs)}ms`} hint="present p95 minus render p95. Unreliable under GPU back-pressure — see 'gpu' below for the direct measurement." />
      <Row
        k="gpu"
        v={s.gpuTimingSupported ? `${ms(s.gpu?.p50 ?? 0)} / ${ms(s.gpu?.p95 ?? 0)}` : "n/a"}
        hint="Real GPU execution time per render() call (EXT_disjoint_timer_query_webgl2), p50/p95 ms. A small number here next to a huge 'render' means the CPU call is blocked on driver/queue back-pressure, not real GPU work."
      />
      <Row k="dropped" v={`${s.droppedPct.toFixed(1)}%`} hint="Frames that took over 25ms to arrive — visible hitches." />
      <Row k="calls" v={n0(s.drawInfo?.calls ?? 0)} hint="Draw calls per frame — one per Object3D submitted to the GPU (no instancing/batching exists in this renderer today, so this scales directly with tracked node+link+aux object count)." />
      <Row k="tris" v={`${n0(s.drawInfo?.triangles ?? 0)} · ln ${n0(s.drawInfo?.lines ?? 0)} · pt ${n0(s.drawInfo?.points ?? 0)}`} hint="Triangles / lines / points submitted per frame." />
      <Row k="tex" v={`${n0(s.memory?.textures ?? 0)} · geo ${n0(s.memory?.geometries ?? 0)}`} hint="Live GPU textures / geometries. Should plateau, not climb." />
      <Row
        k="programs"
        v={`${s.programs ?? "?"}${s.programsChurnCount > 0 ? ` (churn ${s.programsChurnCount})` : ""}`}
        hint="Shader programs, plus how many times that count changed between polls since the last reset. Non-zero churn means real recompilation is happening, not just that some number of programs currently exist."
      />
      <Row
        k="transparent"
        v={s.galaxyCounts?.transparentObjects != null ? String(s.galaxyCounts.transparentObjects) : "?"}
        hint="Currently-tracked scene objects with a transparent material — these skip early-Z rejection and force back-to-front sorting."
      />
      {heapRate != null && <Row k="heap" v={`+${heapRate.toFixed(2)} MB/s`} hint="Allocation rate. This is what the per-frame allocation work drives down." />}
      <Row k="nodes" v={n0(nodeCount ?? 0)} />
      {s.galaxyCounts ? (
        <>
          <Row
            k="tracked"
            v={`${n0(s.galaxyCounts.trackedNodes)}n / ${n0(s.galaxyCounts.trackedLinks)}l`}
            hint="Total nodes/links currently fetched, before any cluster-isolate (small View) filter."
          />
          <Row
            k="visible"
            v={`${n0(s.galaxyCounts.visibleNodes)}n / ${n0(s.galaxyCounts.visibleLinks)}l`}
            hint="After the current cluster-isolate filter (if any) — what's actually tracked by three-forcegraph right now. Compare this against 'tracked' when switching between a large and a small/cluster View."
          />
          <Row
            k="aux"
            v={`${n0(s.galaxyCounts.visibleLabels)} labels · ${n0(s.galaxyCounts.lightPoolSize)} lights · ${n0(s.galaxyCounts.journeyObjects)} journey · ${n0(s.galaxyCounts.moneyObjects)} money`}
            hint="Visible label sprites (already capped), the fixed star-light pool size, and Journey-hub / Money-sky sprite counts."
          />
          {s.galaxyCounts.detailedLinkBudget != null && (
            <Row
              k="detailed"
              v={`${n0(s.galaxyCounts.detailedLinks ?? 0)}l / budget ${n0(s.galaxyCounts.detailedLinkBudget)} (bounded ${s.galaxyCounts.boundedLinksEnabled ? "ON" : "OFF"})`}
              hint="Phase 2.1: links currently allowed the expensive curved-tube Detailed representation vs. the configured ?linkBudget cap. 'bounded OFF' means ?boundedLinks=1 isn't set — every visible link still gets Detailed treatment exactly as before this phase."
            />
          )}
        </>
      ) : (
        <Row k="tracked/visible" v="N/A" hint="Galaxy counts provider not registered (Graph3D not mounted?)." />
      )}
      <div className="ph-actions">
        <button onClick={copy}>{copied ? "copied ✓" : "copy"}</button>
        <button onClick={() => { reset(); setS(snapshot()); }} title="Clear the rolling window — do this after changing a setting.">reset</button>
        <button onClick={() => setPerfHudEnabled(false)} aria-label="Hide performance readout">×</button>
      </div>
    </div>
  );
}
