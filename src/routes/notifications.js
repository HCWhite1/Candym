import { Router } from "express";
import { db, patchRow } from "../db.js";

export const notificationsRouter = Router();

const SELECT = `SELECT n.id, n.entreprise_id AS entrepriseId, e.nom AS entreprise,
  n.classement, n.auto, n.from_email AS fromEmail, n.subject, n.snippet,
  n.mail_date AS mailDate, n.is_read AS isRead, n.created_at AS createdAt, n.motifs
  FROM notifications n LEFT JOIN entreprises e ON e.id = n.entreprise_id`;

// motifs : expressions qui ont décidé du classement automatique ({ strong, weak }), null avant leur enregistrement
const parseMotifs = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const shape = r => ({ ...r, auto: !!r.auto, isRead: !!r.isRead, motifs: parseMotifs(r.motifs) });

notificationsRouter.get("/", (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(db.prepare(SELECT + " ORDER BY n.created_at DESC LIMIT ?").all(limit).map(shape));
});

notificationsRouter.get("/unread-count", (req, res) => {
  res.json({ count: db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0").get().c });
});

const FIELDS = {
  isRead: { col: "is_read", map: v => (v ? 1 : 0) },
  classement: { col: "classement", map: v => v },
  auto: { col: "auto", map: v => v },
};

// Marquer lu / corriger le classement affiché (le statut de l'entreprise, lui,
// se change via l'API entreprises — le front fait les deux appels).
notificationsRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (b.classement !== undefined && b.classement !== null && !["piste", "acceptee", "refusee"].includes(b.classement)) {
    return res.status(400).json({ error: "Classement invalide" });
  }
  // Un classement corrigé à la main n'est plus « automatique »
  patchRow("notifications", FIELDS, { isRead: b.isRead, classement: b.classement, auto: b.classement !== undefined ? 0 : undefined }, id);
  const row = db.prepare(SELECT + " WHERE n.id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Notification introuvable" });
  res.json(shape(row));
});

notificationsRouter.post("/read-all", (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run();
  res.json({ ok: true });
});

notificationsRouter.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM notifications WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Notification introuvable" });
  res.status(204).end();
});
