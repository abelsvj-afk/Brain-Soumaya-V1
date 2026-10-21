import { Router } from "express";
import type { AppContext } from "../../context.js";
import { NotificationsRepo } from "../../repositories/notifications.repo.js";
import { spaceOf } from "../middleware.js";

/**
 * Server-backed Inbox (IM-74): the notifications Soumaya recorded while the
 * user was away (digest delivered, insight created, discovery charted,
 * bill-risk warning). Reads/writes are space-scoped via the repo; producers
 * live at the events' creation points, not here — this router never creates
 * notifications.
 */
export function notificationRoutes(ctx: AppContext): Router {
  const r = Router();
  const repo = (res: Parameters<typeof spaceOf>[0]) => new NotificationsRepo(ctx.handle, spaceOf(res));

  // GET /api/notifications -> newest first (includes snoozed; panel filters)
  r.get("/", (_req, res) => {
    res.json(repo(res).list());
  });

  // POST /api/notifications/seen-all -> mark every unseen notification seen
  r.post("/seen-all", (_req, res) => {
    res.json({ ok: true, marked: repo(res).markAllSeen() });
  });

  // POST /api/notifications/clear-seen -> Clear History (seen items only)
  r.post("/clear-seen", (_req, res) => {
    res.json({ ok: true, cleared: repo(res).clearSeen() });
  });

  // POST /api/notifications/:id/seen
  r.post("/:id/seen", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!repo(res).markSeen(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  });

  // POST /api/notifications/:id/snooze { until: ISO instant } — hide from
  // Unseen until then; the item itself is untouched otherwise.
  r.post("/:id/snooze", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const until = (req.body as { until?: unknown } | undefined)?.until;
    if (typeof until !== "string" || Number.isNaN(Date.parse(until))) {
      res.status(400).json({ error: "Invalid 'until' — an ISO timestamp is required" });
      return;
    }
    if (!repo(res).snooze(id, new Date(until).toISOString())) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  });

  // DELETE /api/notifications/:id — per-item delete
  r.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!repo(res).remove(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  });

  return r;
}
