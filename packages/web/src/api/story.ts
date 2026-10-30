import type { FlavorKey } from "@brain/shared";
import { API, afetch } from "./http.js";

/** The player's private progress through the story (docs/specs/lore-storage-2026-10-30.md): ids only. Lists only — the server never returns a total. */
export interface StoryFindRow {
  entryId: string;
  foundAt: string;
  source: string;
  lastRecalledAt: string | null;
  recallCount: number;
}
export interface StoryLinkRow {
  a: string;
  b: string;
  linkedAt: string;
  lit: boolean;
}
export interface StoryNoteRow {
  entryId: string;
  note: string;
  updatedAt: string;
}
export interface StoryBookData {
  finds: StoryFindRow[];
  links: StoryLinkRow[];
  notes: StoryNoteRow[];
}

const json = { "Content-Type": "application/json" };

async function send<T>(path: string, method: string, body?: unknown): Promise<T | null> {
  try {
    const res = await afetch(`${API}/story${path}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getStoryBook(): Promise<StoryBookData | null> {
  const d = await send<StoryBookData>("/book", "GET");
  return d && Array.isArray(d.finds) ? d : null;
}
/** The server decides: it checks the id against canon and, for a world find, the travel ledger. Null = refused or unreachable. */
export const postStoryFind = (entryId: string, source: string) => send<{ entryId: string; foundAt: string; isNew: boolean }>("/find", "POST", { entryId, source });
export const putStoryLink = (a: string, b: string) => send<StoryLinkRow>("/link", "PUT", { a, b });
export const deleteStoryLink = (a: string, b: string) => send<{ ok: true }>("/link", "DELETE", { a, b });
export const putStoryNote = (entryId: string, note: string) => send<{ ok: true }>("/note", "PUT", { entryId, note });
export const postStoryRecall = (entryId: string) => send<{ ok: true }>("/recall", "POST", { entryId });

/** How the locked story is voiced for this brain: coarse labels only (never a number about the player, never memory text). */
export interface StoryFlavorReading {
  on: boolean;
  key: FlavorKey;
}
export async function getStoryFlavor(): Promise<StoryFlavorReading | null> {
  const d = await send<StoryFlavorReading>("/flavor", "GET");
  return d?.key ? d : null;
}
export const putStoryFlavor = (on: boolean) => send<StoryFlavorReading>("/flavor", "PUT", { on });

/** Is the studio narrator on, and if not, why — names of settings, never their values. */
export async function getNarrationStatus(): Promise<{ on: boolean; issue: string | null } | null> {
  const d = await send<{ on: boolean; issue: string | null }>("/narration-status", "GET");
  return d && typeof d.on === "boolean" ? d : null;
}

/** The owner's Voices console (server refuses anyone else): the account's voices, who is assigned to what, and a spoken test. */
export interface AccountVoice {
  id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview: string | null;
}
export interface VoiceConsoleData {
  available: AccountVoice[] | null;
  assigned: Record<string, string>;
  roles: string[];
  status: { on: boolean; issue: string | null };
}
export const getVoiceConsole = () => send<VoiceConsoleData>("/narration/voices", "GET");
export const putVoiceChoice = (role: string, voiceId: string | null, label = "") => send<{ assigned: Record<string, string>; status: { on: boolean; issue: string | null } }>("/narration/voice", "PUT", { role, voiceId, label });
/** Speak the test line in a role's voice. Returns an object URL to play, or the server's plain reason it could not. */
export async function testVoice(role: string): Promise<{ url: string } | { error: string }> {
  try {
    const res = await afetch(`${API}/story/narration/test`, { method: "POST", headers: json, body: JSON.stringify({ role }) });
    if (!res.ok) return { error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The test failed (${res.status}).` };
    return { url: URL.createObjectURL(await res.blob()) };
  } catch {
    return { error: "Could not reach the server." };
  }
}
