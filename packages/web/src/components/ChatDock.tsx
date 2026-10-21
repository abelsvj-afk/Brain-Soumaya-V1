import { useEffect, useRef, useState } from "react";
import type { ChatMood, NodeRef, NavigationIntent } from "@brain/shared";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { askChat, getSpaceId, ingestText, distillChat, type ProactiveContext } from "../api/client.js";
import { colorForType } from "../graph/theme.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { isVoiceSupported, isVoiceEnabled, setVoiceEnabled, speak, stopSpeaking } from "../voice.js";
import { SoumayaEye } from "./SoumayaEye.js";
import { CompanionPanel } from "./CompanionPanel.js";
import { MarkdownView } from "./MarkdownView.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { extractFileText } from "../lib/extractFileText.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Pairs the mood border-color with a real icon+shape, not colour alone. */
const MOOD_ICON: Record<ChatMood, string> = {
  happy: "😊",
  excited: "✨",
  warm: "🤗",
  thoughtful: "🤔",
  neutral: "💬",
  concerned: "😟",
  sad: "💙",
};

interface ChatMessage {
  role: "you" | "soumaya";
  text: string;
  citations?: NodeRef[];
  /** Maya Chat → Galaxy Navigation: a server-VALIDATED navigation target (never the model's
   *  raw proposal) — rendered as one click-to-navigate chip, same philosophy as citations. */
  navigation?: NavigationIntent;
  mood?: ChatMood;
  /** Her interview instinct: a clarifying question rendered as its own bubble. */
  ask?: boolean;
  /** Which Companion config shaped the reply ("🎭 Coach", "📚 resume.pdf"). */
  applied?: string[];
  /** Already ingested as a real memory — lives on the message (not a separate
   *  index-keyed Set) so it survives a reload; an index-keyed flag forgot every
   *  save on refresh and let the ＋ button re-ingest the same line as a duplicate. */
  saved?: boolean;
  /** When this message was sent/received (epoch ms, IM-105). Absent on
   *  history persisted before timestamps existed — those render without a
   *  time rather than with an invented one. */
  at?: number;
  /** Names of files attached to this (user) message (IM-106) — names only;
   *  the extracted text is one-turn context and is never persisted here. */
  attachments?: string[];
  /** The subgraph she actually consulted for this reply (IM-107) — powers
   *  the "drew on N memories" galaxy-highlight chip. */
  contextIds?: number[];
}

/** Local time for a message (IM-105): time-of-day today, date + time before
 *  that — enough for a resumed conversation to read as resumed. */
function fmtMsgTime(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

/** Human copy for an empty reply (IM-108) — never the old "(no answer)"
 *  plumbing literal in her voice. */
const EMPTY_ANSWER_COPY = "I don't have an answer for that one yet — ask me another way and I'll dig in.";

/** Per-file cap for in-chat attachments — mirrors the chat route's zod bound
 *  (routes/chat.ts). Longer documents belong in 🎭 Knowledge. */
const ATTACH_TEXT_CAP = 20000;

/** Browser SpeechRecognition (Chrome/Safari prefix it). Null if unsupported. */
function getRecognition(): any {
  const w = window as any;
  const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
  return Rec ? new Rec() : null;
}

const chatKey = (): string => `brain.chat.${getSpaceId() ?? "default"}`;

/** A few tools people don't discover on their own — surfaced as one-tap chips on a
 *  fresh chat rather than requiring the user to already know the dock exists. Reuses
 *  the same window-event navigation a toast action button already uses (App.tsx's
 *  "brain-toast-action" listener), so no new plumbing/props are needed here. */
const QUICK_TOOLS: { tab: string; icon: string; label: string }[] = [
  { tab: "mind", icon: "🧠", label: "Mind" },
  { tab: "money", icon: "💵", label: "Money" },
  { tab: "journeys", icon: "🧭", label: "Journeys" },
  { tab: "actions", icon: "✅", label: "Agenda" },
  { tab: "insights", icon: "✨", label: "Insights" },
  { tab: "awards", icon: "🏆", label: "Progress" },
  { tab: "hangar", icon: "🛠️", label: "Hangar" },
];
function openQuickTool(tab: string): void {
  window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "tab", value: tab } }));
}

/** How long she waits after you stop talking before sending (ms). The browser's
 *  own end-of-speech was cutting people off mid-thought. */
const MIC_SILENCE_MS = 2800;

/**
 * Floating chat with Soumaya — a real conversation card (full back-and-forth
 * history that SHE ALSO SEES, citations you can fly to, hands-free mic with a
 * patient silence window, optional voice readback, her living eye avatar, and
 * her persona controls via 🎭). Opened by the 💬 FAB. History persists
 * per-brain in localStorage.
 */
export function ChatDock({
  spaceName = "Soumaya",
  onClose,
  onFocus,
  onRecall,
  onCreated,
  onNavigate,
  proactiveContext,
  onConsumeProactiveContext,
  journeyId,
  onConsumeJourneyContext,
}: {
  spaceName?: string;
  onClose: () => void;
  onFocus: (id: number) => void;
  onRecall?: (ids: number[]) => void;
  /** Called with the new node ids after a message is saved as a memory. */
  onCreated?: (newIds: number[]) => void;
  /** Maya Chat → Galaxy Navigation: called ONLY when the user clicks a navigation chip —
   *  never automatically on receiving a response, and never on reload of persisted history
   *  (this component never re-fires it from stored `messages`, only from the click handler). */
  onNavigate?: (nav: NavigationIntent) => void;
  /**
   * Proactive → Chat handoff (Phase Y; Phase Z adds "bill_risk"). Set ONLY when the user
   * opened this dock from a real proactive toast (e.g. a goal_trend or bill_risk nudge) —
   * a one-shot value, consumed by the very next message the user actually sends (see
   * `onConsumeProactiveContext`), never replayed on later turns.
   */
  proactiveContext?: ProactiveContext | null;
  /** Called once this dock has used `proactiveContext` for a send, so the caller can
   *  clear it — guarantees it's attached to exactly one outgoing message. */
  onConsumeProactiveContext?: () => void;
  /**
   * Journey-scoped Chat (Phase AC.1, docs/specs/soumaya-connective-tissue-onboarding.md).
   * Set ONLY when the user chose "Ask Soumaya about this" from a specific Journey — a
   * one-shot value, same contract as `proactiveContext` above: consumed by the very next
   * message actually sent (see `onConsumeJourneyContext`), never replayed on later turns.
   */
  journeyId?: number | null;
  /** Called once this dock has used `journeyId` for a send, so the caller can clear it. */
  onConsumeJourneyContext?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(chatKey()) || "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(isVoiceEnabled());
  // Her persona controls (About Me / roles / knowledge) — a view inside the chat,
  // since they configure WHO you're talking to right here.
  const [showPersona, setShowPersona] = useState(false);
  // QUICK_TOOLS — the main cross-feature discovery surface in chat — used to be
  // shown only in the empty-conversation state, vanishing for good the moment a
  // single message existed (even after a reload, since history persists).
  const [showQuickTools, setShowQuickTools] = useState(false);
  // End-of-conversation: notes Soumaya proposes to save (null = none shown yet).
  const [proposals, setProposals] = useState<string[] | null>(null);
  const [distilling, setDistilling] = useState(false);
  // IM-103: how long the in-flight reply has been running (drives the staged
  // typing presence + elapsed cue in the busy bubble).
  const [elapsedMs, setElapsedMs] = useState(0);
  // IM-108: failures live OUTSIDE her voice — a bar above the input with the
  // raw detail in small print and a Retry that re-sends the same turn.
  const [notice, setNotice] = useState<{
    text: string;
    detail?: string;
    retry?: { q: string; history: { role: "you" | "soumaya"; text: string }[]; atts: { name: string; text: string }[] };
  } | null>(null);
  // IM-106: files staged for the NEXT message (extracted text rides along as
  // one-turn context; cleared the moment that message is sent).
  const [pendingAttachments, setPendingAttachments] = useState<{ name: string; text: string }[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  // IM-108: clear-conversation confirmation via the shared ConfirmDialog
  // (was native confirm()).
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const distilledRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);
  const micTimerRef = useRef<number | null>(null);
  const micRestartTimerRef = useRef<number | null>(null);
  const micRestartCountRef = useRef(0); // consecutive engine-restarts with no real speech in between
  const wantMicRef = useRef(false); // user intent — survives engine auto-restarts
  const voiceSupported = isVoiceSupported();
  const micSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // The eye mirrors the conversation: her last mood, and what she's doing now.
  const lastMood: ChatMood =
    [...messages].reverse().find((m) => m.role === "soumaya" && m.mood)?.mood ?? "neutral";
  const eyeState = busy ? "thinking" : listening ? "listening" : "idle";

  // Persist + autoscroll on every change.
  useEffect(() => {
    try {
      // Deliberately bounded — an unbounded chat log growing forever in
      // localStorage is its own problem; older turns just age out.
      localStorage.setItem(chatKey(), JSON.stringify(messages.slice(-60)));
    } catch {
      /* storage unavailable */
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // IM-103: elapsed ticker for the in-flight reply's presence cue.
  useEffect(() => {
    if (!busy) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const t = window.setInterval(() => setElapsedMs(Date.now() - start), 250);
    return () => window.clearInterval(t);
  }, [busy]);

  useEffect(
    () => () => {
      stopSpeaking();
      abortRef.current?.abort();
      wantMicRef.current = false;
      recRef.current?.stop?.();
      if (micTimerRef.current) window.clearTimeout(micTimerRef.current);
      if (micRestartTimerRef.current) window.clearTimeout(micRestartTimerRef.current);
    },
    [],
  );

  /**
   * One request/response turn. Split from `send` so the IM-108 error bar's
   * Retry can re-run the EXACT same turn (same question, history, attachments)
   * without duplicating the user's bubble.
   */
  const performSend = async (
    q: string,
    history: { role: "you" | "soumaya"; text: string }[],
    atts: { name: string; text: string }[],
    journeyForThisSend?: number,
    ctxForThisSend?: ProactiveContext,
  ) => {
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await askChat(
        q,
        history,
        journeyForThisSend,
        ctxForThisSend,
        atts.length > 0 ? atts : undefined,
        controller.signal,
      );
      const citations = r.citations ?? [];
      // Visibility: which of your Companion roles/docs actually shaped this reply.
      const applied = [
        ...(r.appliedRoles ?? []).map((n) => `🎭 ${n}`),
        ...(r.appliedDocs ?? []).map((n) => `📚 ${n}`),
      ];
      const hasAnswer = typeof r.answer === "string" && r.answer.trim().length > 0;
      setMessages((m) => {
        const next: ChatMessage[] = [
          ...m,
          {
            role: "soumaya",
            text: hasAnswer ? r.answer : EMPTY_ANSWER_COPY,
            citations,
            navigation: r.navigation,
            mood: r.mood,
            applied,
            at: Date.now(),
            contextIds: r.contextIds && r.contextIds.length > 0 ? r.contextIds : undefined,
          },
        ];
        // Interview instinct: her clarifying question gets its own bubble so it
        // reads as HER asking, not a footnote.
        if (r.askBack) next.push({ role: "soumaya", text: r.askBack, mood: r.mood, ask: true, at: Date.now() });
        return next;
      });
      // IM-107: light up the subgraph she actually consulted (contextIds is a
      // superset of the citations). RESTRAINT: this reuses fireRecall — a
      // particles-only visual along existing synapses. It never moves the
      // camera, never isolates/filters the graph, and changes no state, so it
      // is safe even while the user is mid-interaction with the galaxy.
      const consulted = r.contextIds && r.contextIds.length > 0 ? r.contextIds : citations.map((c) => c.id);
      if (consulted.length > 0) onRecall?.(consulted);
      if (speakOn && hasAnswer) speak(r.askBack ? `${r.answer} ${r.askBack}` : r.answer, r.tone);
    } catch (err) {
      // IM-108: the failure is shown OUTSIDE her voice (the notice bar above
      // the input), never as a Soumaya bubble — and it carries a Retry.
      if (controller.signal.aborted) {
        setNotice({ text: "Stopped — she didn't get to finish that reply.", retry: { q, history, atts } });
      } else {
        setNotice({
          text: "Couldn't reach Soumaya just now — your message is still here, try again.",
          detail: (err as Error).message,
          retry: { q, history, atts },
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  /** IM-103: cancel the in-flight reply (AbortController through askChat). */
  const cancelSend = () => abortRef.current?.abort();

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setNotice(null);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    // She sees the recent thread too — this is what makes it a conversation
    // instead of a series of amnesiac one-shots. Fold an ask-back bubble back
    // INTO its answer turn so the model reads one coherent Soumaya turn (a bare
    // trailing "?" made it re-ask); the server still detects "just asked".
    const history: { role: "you" | "soumaya"; text: string }[] = [];
    for (const m of messages.slice(-32)) {
      const prev = history[history.length - 1];
      if (m.ask && prev && prev.role === "soumaya") prev.text = `${prev.text} ${m.text}`;
      else history.push({ role: m.role, text: m.text });
    }
    const trimmed = history.slice(-32);
    // IM-106: staged attachments ride with exactly this message, then clear —
    // the user bubble keeps only their names.
    const atts = pendingAttachments;
    setPendingAttachments([]);
    setMessages((m) => [
      ...m,
      { role: "you", text: q, at: Date.now(), ...(atts.length > 0 ? { attachments: atts.map((a) => a.name) } : {}) },
    ]);
    // One-shot: attach to exactly this send, then tell the caller to clear it — a
    // later message in the same session must never silently carry stale proactive
    // framing (or Journey scoping) forward.
    const journeyForThisSend = journeyId ?? undefined;
    if (journeyForThisSend) onConsumeJourneyContext?.();
    const ctxForThisSend = proactiveContext ?? undefined;
    if (ctxForThisSend) onConsumeProactiveContext?.();
    await performSend(q, trimmed, atts, journeyForThisSend, ctxForThisSend);
  };

  const retryNotice = () => {
    const r = notice?.retry;
    if (!r || busy) return;
    setNotice(null);
    void performSend(r.q, r.history, r.atts);
  };

  /** IM-106: extract a picked file's text client-side (same pipeline as
   *  🎭 Knowledge upload) and stage it for the next message. */
  const onAttachFile = async (file: File) => {
    setAttachBusy(true);
    try {
      const { text } = await extractFileText(file);
      const truncated = text.length > ATTACH_TEXT_CAP;
      setPendingAttachments((p) => [
        ...p.slice(-2),
        { name: file.name, text: text.slice(0, ATTACH_TEXT_CAP) },
      ]);
      if (truncated) {
        pushToast(
          `"${file.name}" is long — she'll read the first ${ATTACH_TEXT_CAP.toLocaleString()} characters with your message. For the whole document, add it under 🎭 Knowledge.`,
          "📎",
          6000,
        );
      }
    } catch (err) {
      pushToast((err as Error).message || "Couldn't read that file.", "⚠️", 4500);
    } finally {
      setAttachBusy(false);
      if (attachFileRef.current) attachFileRef.current.value = "";
    }
  };

  // Save a line of the conversation into the galaxy as a real memory.
  const saveMemory = async (text: string, idx: number) => {
    if (messages[idx]?.saved) return;
    try {
      const r = await ingestText(text);
      const ids = (r.nodes ?? []).map((n) => n.id);
      setMessages((m) => m.map((msg, i) => (i === idx ? { ...msg, saved: true } : msg)));
      playSfx("chime");
      pushToast(`Soumaya is charting it into your galaxy ✦`, "🛰️", 4500);
      if (ids.length) onCreated?.(ids);
    } catch (err) {
      pushToast((err as Error).message || "Couldn't save that.", "⚠️", 4500);
    }
  };

  /**
   * Mic: hands-free speak-to-send that does NOT cut you off. The browser engine
   * loves to end after a short pause, so we run it in continuous mode, restart it
   * whenever it self-terminates while the mic is still "on", and only send after
   * a real silence window (MIC_SILENCE_MS) — or when you tap the mic off.
   */
  const stopMic = (sendNow: boolean, textOverride?: string) => {
    wantMicRef.current = false;
    if (micTimerRef.current) window.clearTimeout(micTimerRef.current);
    micTimerRef.current = null;
    if (micRestartTimerRef.current) window.clearTimeout(micRestartTimerRef.current);
    micRestartTimerRef.current = null;
    micRestartCountRef.current = 0;
    try {
      recRef.current?.stop?.();
    } catch {
      /* already stopped */
    }
    setListening(false);
    const said = (textOverride ?? "").trim();
    if (sendNow && said) void send(said);
  };

  const toggleMic = () => {
    if (listening) {
      // Tap-off sends whatever's transcribed so far.
      stopMic(true, input);
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true; // don't let the engine decide when you're done
    let finalText = "";
    let latest = "";
    const armSilenceTimer = () => {
      if (micTimerRef.current) window.clearTimeout(micTimerRef.current);
      micTimerRef.current = window.setTimeout(() => {
        if (wantMicRef.current) stopMic(true, latest);
      }, MIC_SILENCE_MS);
    };
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      latest = (finalText + interim).trim();
      setInput(latest);
      micRestartCountRef.current = 0; // real speech came through — the engine is behaving
      armSilenceTimer(); // every bit of speech pushes the send window out
    };
    rec.onerror = (e: any) => {
      // "no-speech" just means a quiet stretch — the restart below handles it.
      if (e?.error && e.error !== "no-speech" && e.error !== "aborted") {
        stopMic(false);
      }
    };
    rec.onend = () => {
      // The engine self-terminated (it always does eventually). If the user
      // hasn't tapped off and the silence window hasn't fired, keep listening —
      // but back off and eventually give up if it keeps bouncing with no real
      // speech in between (a bare immediate restart loop can spin indefinitely
      // on some browsers/devices).
      if (wantMicRef.current) {
        micRestartCountRef.current += 1;
        if (micRestartCountRef.current > 6) {
          stopMic(false);
          pushToast("The mic kept dropping — try again.", "⚠️", 4000);
          return;
        }
        const delay = Math.min(150 * micRestartCountRef.current, 1000);
        micRestartTimerRef.current = window.setTimeout(() => {
          try {
            rec.start();
          } catch {
            stopMic(true, latest);
          }
        }, delay);
      }
    };
    wantMicRef.current = true;
    micRestartCountRef.current = 0;
    setListening(true);
    armSilenceTimer();
    rec.start();
  };

  // At the END of a conversation she proposes a few memory-worthy notes to keep
  // (never mid-chat). Runs on close when there's enough exchange; also manual.
  const runDistill = async (): Promise<boolean> => {
    if (distilling) return false;
    setDistilling(true);
    try {
      const notes = await distillChat(messages.map((m) => ({ role: m.role, text: m.text })));
      distilledRef.current = true;
      if (notes.length > 0) {
        setProposals(notes);
        return true;
      }
      return false;
    } catch (err) {
      // A rejection here used to propagate straight out of handleClose, so the
      // × button would just stop responding, and out of the bare `void
      // runDistill()` on the ✨ button as an unhandled rejection. Treat it the
      // same as "nothing to propose" so closing still works either way.
      distilledRef.current = true;
      pushToast((err as Error).message || "Couldn't wrap up that chat — closing anyway.", "⚠️", 4000);
      return false;
    } finally {
      setDistilling(false);
    }
  };

  const userTurns = messages.filter((m) => m.role === "you").length;

  // Close, but first offer end-of-chat notes once (if the convo had substance).
  const handleClose = async () => {
    if (proposals === null && !distilledRef.current && userTurns >= 2) {
      const proposed = await runDistill();
      if (proposed) return; // keep open so the user can approve/skip
    }
    onClose();
  };

  const dockRef = useRef<HTMLDivElement>(null);
  useDialogA11y(dockRef, () => void handleClose());

  // Phase M (docs/specs/soumaya-product-audit.md, "mobile chat input/keyboard behavior") —
  // `.chatdock` is `position: fixed` with a hardcoded `bottom` offset, so on iOS/Android the
  // on-screen keyboard can cover or clip it (the layout viewport doesn't shrink the way
  // `100vh`/`dvh` assumes). `window.visualViewport` reports the ACTUAL visible area once the
  // keyboard opens; we lift the dock by exactly however much space the keyboard has taken,
  // via one CSS custom property the existing `bottom: calc(...)` rule already understands
  // (no new positioning system, no framework — this is a no-op with the keyboard closed).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const el = dockRef.current;
      if (!el) return;
      el.style.setProperty("--keyboard-inset", `${covered}px`);
      // Also caps the dock's own height to the ACTUAL visible area (see the height rule
      // below) — lifting the dock above a tall keyboard is only half the fix; without this
      // a short visible area (small phone + a tall keyboard) could still push the dock's
      // top edge off-screen instead of the dock simply getting shorter.
      el.style.setProperty("--vv-height", `${vv.height}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  const approveProposal = async (text: string, i: number) => {
    try {
      const r = await ingestText(text);
      const ids = (r.nodes ?? []).map((n) => n.id);
      if (ids.length) onCreated?.(ids);
      playSfx("chime");
      pushToast("Soumaya is charting it into your galaxy ✦", "🛰️", 4000);
    } catch (err) {
      pushToast((err as Error).message || "Couldn't save that.", "⚠️", 4000);
    }
    setProposals((p) => (p ? p.filter((_, idx) => idx !== i) : p));
  };

  const toggleSpeak = () => {
    const next = !speakOn;
    setSpeakOn(next);
    setVoiceEnabled(next);
    if (!next) stopSpeaking();
  };

  const doClearChat = () => {
    stopSpeaking();
    setMessages([]);
    // Reset per-conversation state too — a stale distill flag would otherwise
    // suppress the next conversation's wrap-up offer.
    setProposals(null);
    distilledRef.current = false;
    setNotice(null);
    setPendingAttachments([]);
    setShowClearConfirm(false);
  };

  // IM-103 staged presence: what she appears to be doing shifts as the wait
  // grows, so a long reply never reads as a hung request.
  const typingStage =
    elapsedMs < 2500 ? "Reading your galaxy…" : elapsedMs < 9000 ? "Thinking it through…" : "Still working on it — the deep ones take a moment…";

  return (
    <div className="chatdock" role="dialog" aria-label={`Chat with ${spaceName}`} ref={dockRef}>
      <header className="chatdock-head">
        <span className="chatdock-title">
          <SoumayaEye state={eyeState} mood={lastMood} size={30} /> {spaceName}
        </span>
        <div className="chatdock-tools">
          <button
            className={`chatdock-tool ${showPersona ? "on" : ""}`}
            onClick={() => setShowPersona((v) => !v)}
            title="Who she is to you — About Me, custom roles, knowledge"
          >
            🎭
          </button>
          {voiceSupported && (
            <button
              className={`chatdock-tool ${speakOn ? "on" : ""}`}
              onClick={toggleSpeak}
              title={speakOn ? "Voice replies on" : "Voice replies off"}
            >
              {speakOn ? "🔊" : "🔈"}
            </button>
          )}
          {userTurns >= 2 && !showPersona && (
            <button
              className="chatdock-tool"
              onClick={() => void runDistill()}
              disabled={distilling}
              title="Wrap up — let Soumaya pick out anything worth saving"
            >
              ✨
            </button>
          )}
          {messages.length > 0 && !showPersona && (
            <button
              className={`chatdock-tool ${showQuickTools ? "on" : ""}`}
              onClick={() => setShowQuickTools((v) => !v)}
              title="Explore Soumaya's other tools"
              aria-pressed={showQuickTools}
            >
              🧭
            </button>
          )}
          {messages.length > 0 && !showPersona && (
            <button className="chatdock-tool" onClick={() => setShowClearConfirm(true)} title="Clear conversation">
              🗑
            </button>
          )}
          <button className="chatdock-tool" onClick={() => void handleClose()} title="Close" aria-label="Close">
            ×
          </button>
        </div>
      </header>

      {showPersona ? (
        <div className="chatdock-msgs chatdock-persona">
          <CompanionPanel spaceName={spaceName} />
        </div>
      ) : (
        <div className="chatdock-msgs" ref={listRef}>
          {messages.length === 0 && (
            <>
              <p className="chatdock-empty">
                {spaceName} has read your whole galaxy. Think out loud with her — "help me decide…",
                "what am I missing about…", "what have you noticed lately?" — and she'll connect it to
                what you've logged, name patterns, and push back when it helps. Tap ＋ to keep anything
                worth saving. (🎭 shapes who she is to you.)
              </p>
              <div className="chatdock-quick-tools" role="list" aria-label="Explore Soumaya's tools">
                {QUICK_TOOLS.map((t) => (
                  <button
                    key={t.tab}
                    className="pill chatdock-tool-chip"
                    role="listitem"
                    onClick={() => openQuickTool(t.tab)}
                    title={`Open ${t.label}`}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {messages.length > 0 && showQuickTools && (
            <div className="chatdock-quick-tools" role="list" aria-label="Explore Soumaya's tools">
              {QUICK_TOOLS.map((t) => (
                <button
                  key={t.tab}
                  className="pill chatdock-tool-chip"
                  role="listitem"
                  onClick={() => { setShowQuickTools(false); openQuickTool(t.tab); }}
                  title={`Open ${t.label}`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chatdock-msg ${m.role}`}>
              <div
                className={`chatdock-bubble ${m.ask ? "ask" : ""} ${m.role === "soumaya" && m.mood ? `mood-${m.mood}` : ""}`}
              >
                {m.ask && <span className="chatdock-ask-tag">she wants to understand</span>}
                {/* The mood border-left color used to be the ONLY signal of her tone —
                    invisible to a colorblind reader, and the colorblind toggle doesn't
                    touch these hardcoded mood colors. A small icon pairs it with shape. */}
                {m.role === "soumaya" && m.mood && (
                  <span className="chatdock-mood-ic" title={`feeling ${m.mood}`} aria-hidden>
                    {MOOD_ICON[m.mood]}
                  </span>
                )}
                {/* IM-104: her replies are Markdown (lists/bold from the model) —
                    render them via the shared MarkdownView instead of raw text.
                    The user's own words stay verbatim plain text. */}
                {m.role === "soumaya" ? <MarkdownView text={m.text} /> : m.text}
                <button
                  className={`chatdock-save ${m.saved ? "done" : ""}`}
                  onClick={() => saveMemory(m.text, i)}
                  disabled={m.saved}
                  title={m.saved ? "Saved as a memory" : "Save this as a memory"}
                  aria-label="Save as memory"
                >
                  {m.saved ? "✓" : "＋"}
                </button>
              </div>
              {/* IM-105: when this message happened (local time). Messages
                  persisted before timestamps existed render without one. */}
              {m.at != null && (
                <time className="chatdock-time" dateTime={new Date(m.at).toISOString()}>
                  {fmtMsgTime(m.at)}
                </time>
              )}
              {m.attachments && m.attachments.length > 0 && (
                <div className="chatdock-cites">
                  {m.attachments.map((n) => (
                    <span key={n} className="chatdock-att-chip" title="Attached to this message — she read it as context for her reply">
                      📎 {n}
                    </span>
                  ))}
                </div>
              )}
              {m.citations && m.citations.length > 0 && (
                <div className="chatdock-cites">
                  {m.citations.map((c) => (
                    <button
                      key={c.id}
                      className="pill"
                      style={{ borderColor: colorForType(c.type) }}
                      onClick={() => onFocus(c.id)}
                      title="Fly to this memory"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {/* IM-107: the subgraph she actually consulted for this reply —
                  re-light it in the galaxy on demand (same fireRecall path the
                  reply itself used; visual only, never moves the camera). */}
              {m.contextIds && m.contextIds.length > 0 && (
                <div className="chatdock-cites">
                  <button
                    className="pill"
                    onClick={() => onRecall?.(m.contextIds!)}
                    title="Light up the memories she consulted for this reply in the galaxy"
                  >
                    ✦ drew on {m.contextIds.length} {m.contextIds.length === 1 ? "memory" : "memories"}
                  </button>
                </div>
              )}
              {m.navigation && (
                <div className="chatdock-cites">
                  <button
                    className="pill nav"
                    onClick={() => onNavigate?.(m.navigation!)}
                    title={m.navigation.reason}
                  >
                    {m.navigation.target.domain === "journey" ? "🧭" : "💵"} Go to {m.navigation.target.label ?? "this"}
                  </button>
                </div>
              )}
              {m.applied && m.applied.length > 0 && (
                <div className="chatdock-applied" title="The role(s) she adopted for THIS reply (she picks what fits — edit via 🎭)">
                  {m.applied.map((a) => (
                    <span key={a} className="chatdock-applied-chip">
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="chatdock-msg soumaya">
              {/* IM-103: staged typing presence — animated dots, a stage label
                  that changes as the wait grows, an elapsed-seconds cue, and a
                  working Stop (AbortController). A 3s wait and a hung request
                  no longer look the same. */}
              <div className="chatdock-bubble typing" role="status" aria-live="polite">
                <SoumayaEye state="thinking" mood={lastMood} size={24} />
                <span className="chatdock-typing-stage">{typingStage}</span>
                <span className="chatdock-typing-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {elapsedMs >= 1000 && <span className="chatdock-typing-elapsed">{Math.floor(elapsedMs / 1000)}s</span>}
                <button className="chatdock-stop" onClick={cancelSend} title="Stop this reply">
                  Stop
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {proposals && proposals.length > 0 && !showPersona && (
        <div className="chatdock-proposals">
          <div className="chatdock-prop-head">✨ Worth keeping from this chat?</div>
          {proposals.map((p, i) => (
            <div key={i} className="chatdock-prop">
              <span className="chatdock-prop-text">{p}</span>
              <button className="chatdock-prop-add" onClick={() => void approveProposal(p, i)} title="Save as a memory">
                ＋
              </button>
              <button
                className="chatdock-prop-skip"
                onClick={() => setProposals((ps) => (ps ? ps.filter((_, idx) => idx !== i) : ps))}
                title="Skip"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* IM-108: failures surface HERE — outside her voice, with retry —
          never as a Soumaya bubble carrying a raw network/HTTP string. */}
      {notice && !showPersona && (
        <div className="chatdock-notice" role="alert">
          <span className="chatdock-notice-text">
            ⚠️ {notice.text}
            {notice.detail && <span className="chatdock-notice-detail"> ({notice.detail})</span>}
          </span>
          {notice.retry && (
            <button className="mini" onClick={retryNotice} disabled={busy}>
              Retry
            </button>
          )}
          <button className="mini ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {pendingAttachments.length > 0 && !showPersona && (
        <div className="chatdock-pending-att">
          {pendingAttachments.map((a, i) => (
            <span
              key={`${a.name}-${i}`}
              className="chatdock-att-chip"
              title={`${a.text.length.toLocaleString()} characters — she'll read this with your next message`}
            >
              📎 {a.name}
              <button
                className="chatdock-att-x"
                aria-label={`Remove ${a.name}`}
                onClick={() => setPendingAttachments((p) => p.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {!showPersona && (
        <div className="chatdock-input">
          <input
            ref={attachFileRef}
            type="file"
            hidden
            accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onAttachFile(f);
            }}
          />
          <button
            className="chatdock-mic"
            onClick={() => attachFileRef.current?.click()}
            disabled={attachBusy}
            title={attachBusy ? "Reading file…" : "Attach a file — she'll read it with your next message"}
            aria-label="Attach a file"
          >
            {attachBusy ? "⏳" : "📎"}
          </button>
          {micSupported && (
            <button
              className={`chatdock-mic ${listening ? "live" : ""}`}
              onClick={toggleMic}
              title={listening ? "Listening — take your time; tap to send" : "Speak instead of type"}
              aria-label="Microphone"
            >
              {listening ? "🔴" : "🎤"}
            </button>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 120) + "px";
            }}
            placeholder={listening ? "Listening — take your time…" : `Message ${spaceName}…`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).style.height = "auto";
                void send(input);
              }
            }}
          />
          <button className="chatdock-send" onClick={() => void send(input)} disabled={busy || !input.trim()}>
            ➤
          </button>
        </div>
      )}

      {showClearConfirm && (
        <ConfirmDialog
          title="Clear this conversation?"
          message="Every message in this chat will be removed. This can't be undone."
          confirmLabel="Clear"
          onConfirm={doClearChat}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}
