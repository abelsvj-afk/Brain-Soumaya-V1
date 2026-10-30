import type { SocietyDay } from "@brain/shared";
import { API, afetch } from "./http.js";

/** The society's reading of this brain: numbers and words only (never memory text). Null when the brain is unreachable — callers fall back to a neutral society. */
export interface SocietyReading {
  reflect: boolean;
  society: SocietyDay;
}

export async function getSociety(): Promise<SocietyReading | null> {
  try {
    const res = await afetch(`${API}/society`);
    if (!res.ok) return null;
    const d = (await res.json()) as SocietyReading;
    return d?.society ? d : null;
  } catch {
    return null;
  }
}

export async function setSocietyReflect(reflect: boolean): Promise<SocietyReading | null> {
  try {
    const res = await afetch(`${API}/society/reflect`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reflect }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as SocietyReading;
    return d?.society ? d : null;
  } catch {
    return null;
  }
}
