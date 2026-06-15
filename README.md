# Soumaya Second Brain

An AI-powered **3D knowledge-graph "second brain"**. Dump unstructured thoughts;
the system extracts typed entities + relationships with an LLM, embeds each
thought, stores both in an embedded SQLite database, auto-discovers associative
links to older memories (cosine KNN + LLM validation), and renders the whole
memory as an explorable, glowing 3D "galaxy".

## Monorepo layout

```
packages/
  shared/   Shared TS types + Zod schemas (the FE/BE/LLM contract)
  server/   Node 22 + better-sqlite3 + sqlite-vec data layer & (later) API
  web/      React + react-force-graph-3d galaxy UI (later phase)
```

## Stack

- **DB**: better-sqlite3 + [sqlite-vec](https://github.com/asg017/sqlite-vec)
  (`vec0` virtual table, cosine distance). Relational tables via Drizzle; all raw
  vector + recursive-CTE SQL isolated in `packages/server/src/db/vec.ts` and
  `graph/traversal.ts` (keeps a libsql/ANN migration path open).
- **Embeddings**: `@huggingface/transformers` (gte/MiniLM), server-side, local.
- **LLM**: `@google/genai` (Gemini) for structured extraction, behind an adapter.
- **Frontend**: React + Vite + `react-force-graph-3d` (Three.js + d3-force-3d).

## Develop

```bash
npm install          # install all workspaces
npm test             # run the test suite (server data layer)
npm run typecheck    # typecheck all workspaces
npm run seed         # seed a sample graph into ./brain.db
```

Copy `.env.example` to `.env` and add `GEMINI_API_KEY` to enable LLM extraction.
Everything up to and including the 3D galaxy renders **without any API key**.

## Status

- [x] **Phase I** — data foundation: schema, sqlite-vec KNN, recursive-CTE
      multi-hop traversal, tests.
- [ ] Phase II — AI pipeline (embeddings + Gemini extraction + associative linking)
- [ ] Phase III — REST API + graph wiring
- [ ] Phase IV — celestial 3D UI + fluidity
- [ ] Phase V — synthesis digest + chat-with-your-brain
