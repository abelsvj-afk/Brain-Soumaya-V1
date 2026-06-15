import type { ChatResponse, GraphData, GraphNode, Insight } from "@brain/shared";

const API = "/api";

export interface IngestResult {
  nodes: GraphNode[];
  extractedEdges: unknown[];
  associativeEdges: unknown[];
}

export interface SearchHit extends GraphNode {
  similarity: number;
}

export interface Health {
  ok: boolean;
  embeddings: { model: string; dim: number };
  llm: { model: string; available: boolean };
  nodes: number;
}

export async function getGraph(limit = 300): Promise<GraphData> {
  const res = await fetch(`${API}/graph?limit=${limit}`);
  return res.json() as Promise<GraphData>;
}

export async function ingestText(text: string): Promise<IngestResult> {
  const res = await fetch(`${API}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Ingest failed (${res.status})`);
  }
  return res.json() as Promise<IngestResult>;
}

export async function search(q: string): Promise<SearchHit[]> {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
  return res.json() as Promise<SearchHit[]>;
}

export async function getNeighbors(id: number, depth = 2): Promise<GraphData> {
  const res = await fetch(`${API}/nodes/${id}/neighbors?depth=${depth}`);
  return res.json() as Promise<GraphData>;
}

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${API}/health`);
  return res.json() as Promise<Health>;
}

export async function getDigest(): Promise<Insight[]> {
  const res = await fetch(`${API}/digest`);
  return res.json() as Promise<Insight[]>;
}

export async function runDigest(): Promise<Insight[]> {
  const res = await fetch(`${API}/digest/run`, { method: "POST" });
  return res.json() as Promise<Insight[]>;
}

export async function askChat(question: string): Promise<ChatResponse> {
  const res = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return res.json() as Promise<ChatResponse>;
}
