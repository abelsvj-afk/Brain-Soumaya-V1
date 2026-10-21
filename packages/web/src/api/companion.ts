import { API, afetch } from "./http.js";
import { tracked } from "./activity.js";

/**
 * AI Companion client calls — persona ("About Me"), instruction profiles (roles), and
 * knowledge documents. Split out of client.ts in the Post-MVP D4 refactor (behaviour
 * unchanged); re-exported from client.ts so call sites are untouched.
 */

// --- AI Companion: persona ("About Me"), instruction profiles, knowledge docs ---

// "About Me" is auto-derived by Soumaya (not user-editable). GET returns the
// current (re-derived if stale); refresh forces a regeneration.
export async function getPersona(): Promise<string> {
  try {
    const res = await afetch(`${API}/persona`);
    const d = (await res.json().catch(() => ({}))) as { body?: string };
    return d.body ?? "";
  } catch {
    return "";
  }
}

export async function refreshPersona(): Promise<string> {
  try {
    const res = await afetch(`${API}/persona/refresh`, { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { body?: string };
    return d.body ?? "";
  } catch {
    return "";
  }
}

/**
 * Strict variants (IM-110, same pattern as listAttachmentsStrict IM-29/31):
 * THROW on network/HTTP failure so the Companion sections can tell "load
 * failed" apart from "genuinely empty". The fail-soft originals above keep
 * their contract for any other caller.
 */
export async function getPersonaStrict(): Promise<string> {
  const res = await afetch(`${API}/persona`);
  if (!res.ok) throw new Error(`About Me failed (${res.status})`);
  const d = (await res.json().catch(() => ({}))) as { body?: string };
  return d.body ?? "";
}

export async function refreshPersonaStrict(): Promise<string> {
  const res = await afetch(`${API}/persona/refresh`, { method: "POST" });
  if (!res.ok) throw new Error(`About Me refresh failed (${res.status})`);
  const d = (await res.json().catch(() => ({}))) as { body?: string };
  return d.body ?? "";
}

export async function getInstructionsStrict(): Promise<InstructionProfile[]> {
  const res = await afetch(`${API}/instructions`);
  if (!res.ok) throw new Error(`Instructions failed (${res.status})`);
  const d = await res.json().catch(() => []);
  return Array.isArray(d) ? (d as InstructionProfile[]) : [];
}

export async function getDocumentsStrict(): Promise<KnowledgeDoc[]> {
  const res = await afetch(`${API}/documents`);
  if (!res.ok) throw new Error(`Knowledge failed (${res.status})`);
  const d = await res.json().catch(() => []);
  return Array.isArray(d) ? (d as KnowledgeDoc[]) : [];
}

export async function getSoulStrict(): Promise<string> {
  const res = await afetch(`${API}/persona/soul`);
  if (!res.ok) throw new Error(`Soul failed (${res.status})`);
  const d = (await res.json().catch(() => ({}))) as { body?: string };
  return d.body ?? "";
}

export async function getGroundedInsightStrict(): Promise<boolean> {
  const res = await afetch(`${API}/persona/grounded-insight`);
  if (!res.ok) throw new Error(`Grounded insight failed (${res.status})`);
  const d = (await res.json().catch(() => ({}))) as { enabled?: boolean };
  return d.enabled !== false; // default ON
}

export interface InstructionProfile {
  id: number;
  name: string;
  body: string;
  enabled: boolean;
  mode: "always" | "auto";
  priority: number;
  createdAt: string;
}

export async function getInstructions(): Promise<InstructionProfile[]> {
  try {
    const res = await afetch(`${API}/instructions`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? (d as InstructionProfile[]) : [];
  } catch {
    return [];
  }
}

export async function createInstruction(input: {
  name: string;
  body: string;
  mode?: "always" | "auto";
  priority?: number;
}): Promise<InstructionProfile> {
  const res = await afetch(`${API}/instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `Create failed (${res.status})`);
  }
  return res.json() as Promise<InstructionProfile>;
}

export async function updateInstruction(
  id: number,
  patch: Partial<Pick<InstructionProfile, "name" | "body" | "enabled" | "mode" | "priority">>,
): Promise<InstructionProfile> {
  const res = await afetch(`${API}/instructions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `Update failed (${res.status})`);
  }
  return res.json() as Promise<InstructionProfile>;
}

export async function deleteInstruction(id: number): Promise<void> {
  await afetch(`${API}/instructions/${id}`, { method: "DELETE" });
}

export interface KnowledgeDoc {
  id: number;
  name: string;
  mime: string;
  charCount: number;
  chunks?: number;
  createdAt: string;
}

export async function getDocuments(): Promise<KnowledgeDoc[]> {
  try {
    const res = await afetch(`${API}/documents`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? (d as KnowledgeDoc[]) : [];
  } catch {
    return [];
  }
}

export async function uploadDocument(name: string, text: string, mime?: string): Promise<KnowledgeDoc> {
  return tracked(
    (async () => {
      const res = await afetch(`${API}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, text, mime }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Upload failed (${res.status})`);
      }
      return res.json() as Promise<KnowledgeDoc>;
    })(),
  );
}

export async function renameDocument(id: number, name: string): Promise<void> {
  await afetch(`${API}/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function deleteDocument(id: number): Promise<void> {
  await afetch(`${API}/documents/${id}`, { method: "DELETE" });
}

// --- Soumaya's soul (per-brain deeper character; empty = use the shared default) ---
export async function getSoul(): Promise<string> {
  try {
    const res = await afetch(`${API}/persona/soul`);
    const d = (await res.json().catch(() => ({}))) as { body?: string };
    return d.body ?? "";
  } catch {
    return "";
  }
}
export async function setSoul(body: string): Promise<boolean> {
  try {
    const res = await afetch(`${API}/persona/soul`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Grounded-insight chat mode: ON = specific/evidence-grounded reflections (anti-horoscope). */
export async function getGroundedInsight(): Promise<boolean> {
  try {
    const res = await afetch(`${API}/persona/grounded-insight`);
    const d = (await res.json().catch(() => ({}))) as { enabled?: boolean };
    return d.enabled !== false; // default ON
  } catch {
    return true;
  }
}
export async function setGroundedInsight(enabled: boolean): Promise<boolean> {
  try {
    const res = await afetch(`${API}/persona/grounded-insight`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
