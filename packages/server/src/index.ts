import { buildContext } from "./context.js";
import { createApp } from "./api/server.js";

const PORT = Number(process.env.PORT ?? 3001);

const ctx = await buildContext();
const app = createApp(ctx);

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] embeddings: ${ctx.embeddings.model} (${ctx.embeddings.dim}d)`);
  console.log(
    `[server] llm: ${ctx.llm.model} ${ctx.llm.available ? "(active)" : "(heuristic fallback — set GEMINI_API_KEY)"}`,
  );
});
