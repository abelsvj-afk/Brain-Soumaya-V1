import { API, afetch } from "./http.js";
import { setNodeProcessing } from "./processing.js";

/**
 * Ops / admin client calls — maintenance jobs, agent + daily logs, usage/budget
 * (admin-token gated), and settings. Split out of client.ts in the Post-MVP D4
 * refactor; re-exported from client.ts so call sites are untouched.
 */

export interface JobRationale {
  objective: string;
  why: string;
  benefit: string;
}

export interface MaintenanceJob {
  type: "synthesis" | "calibration" | "patrol" | "pruning" | "harmonization" | "research" | "merging" | "sector_vibe" | "daily_log" | "replay";
  targets: number[];
  description: string;
  rationale?: JobRationale;
}

export async function getNextMaintenanceJob(): Promise<MaintenanceJob> {
  const res = await afetch(`${API}/maintenance/next-job`);
  if (!res.ok) throw new Error("No maintenance jobs available");
  return res.json() as Promise<MaintenanceJob>;
}

export async function completeMaintenanceJob(type: string, targets: number[]): Promise<{ ok: boolean }> {
  setNodeProcessing(targets, true);
  try {
    const res = await afetch(`${API}/maintenance/complete-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, targets }),
    });
    return await res.json() as Promise<{ ok: boolean }>;
  } finally {
    setNodeProcessing(targets, false);
  }
}

export interface AgentLog {
  id: number;
  agent: string;
  action: string;
  description: string;
  targets: string;
  /** JSON-encoded JobRationale (objective/why/benefit) — her decision breakdown. */
  result?: string | null;
  createdAt: string;
}

export async function getAgentLogs(): Promise<AgentLog[]> {
  try {
    const res = await afetch(`${API}/maintenance/logs`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/**
 * IM-66: same feed as getAgentLogs but failures THROW instead of collapsing to
 * [] — the Soumaya tab must distinguish "couldn't load" from a legitimately
 * empty brain. (App.tsx's away-digest callers keep the fail-soft variant.)
 */
export async function getAgentLogsStrict(): Promise<AgentLog[]> {
  const res = await afetch(`${API}/maintenance/logs`);
  if (!res.ok) throw new Error(`logs request failed (${res.status})`);
  const d = await res.json().catch(() => null);
  if (!Array.isArray(d)) throw new Error("logs response was not a list");
  return d as AgentLog[];
}

export interface ToolHealth {
  tool: string;
  lastRanAt: string | null;
}

export async function getToolHealth(): Promise<ToolHealth[]> {
  try {
    const res = await afetch(`${API}/maintenance/tool-health`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export interface DailyLog {
  id: number;
  content: string;
  date: string;
}

/** Most recent Captain's Log for this brain (space-scoped). null if none yet. */
export async function getDailyLog(): Promise<DailyLog | null> {
  try {
    const res = await afetch(`${API}/maintenance/daily-log`);
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return d && typeof d === "object" && typeof d.content === "string" ? (d as DailyLog) : null;
  } catch {
    return null;
  }
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  fractionUsed: number;
  overBudget: boolean;
  low: boolean;
}

export async function getUsage(): Promise<Usage | null> {
  try {
    const res = await afetch(`${API}/usage`);
    return res.ok ? ((await res.json()) as Usage) : null;
  } catch {
    return null;
  }
}

// Budget mutations are deployment-admin actions (the cap is shared by every brain),
// so the server fail-closes on them without the ADMIN_TOKEN secret. The token is
// remembered locally after the first successful use.
const ADMIN_TOKEN_KEY = "brain.adminToken";
export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* private-mode etc. */
  }
}

async function adminPost(path: string, body?: unknown): Promise<Usage | null> {
  try {
    const token = getAdminToken();
    const res = await afetch(`${API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-admin-token": token } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return res.ok ? ((await res.json()) as Usage) : null;
  } catch {
    return null;
  }
}

export async function setBudget(budget: number): Promise<Usage | null> {
  return adminPost("/usage", { budget });
}

export async function resetUsage(): Promise<Usage | null> {
  return adminPost("/usage/reset");
}

export async function getSettings(): Promise<Record<string, string>> {
  try {
    const res = await afetch(`${API}/maintenance/settings`);
    const d = await res.json().catch(() => ({}));
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

export async function updateSetting(key: string, value: string): Promise<{ ok: boolean }> {
  const res = await afetch(`${API}/maintenance/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  return res.json() as Promise<{ ok: boolean }>;
}
