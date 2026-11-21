// File d'envoi SMTP : programmer, suivre, annuler, relancer un envoi.
import { Router } from "express";
import { listOutbox, enqueue, cancelOutbox, retryOutbox, sendTestToSelf } from "../smtp.js";

export const outboxRouter = Router();

outboxRouter.get("/", (req, res) => {
  res.json(listOutbox({ limit: Math.min(500, Math.max(1, Number(req.query.limit) || 100)) }));
});

outboxRouter.post("/", (req, res) => {
  res.status(201).json(enqueue(req.body ?? {}));
});

outboxRouter.post("/test", async (req, res) => {
  try {
    res.json(await sendTestToSelf(req.body ?? {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: "Envoi du test impossible : " + err.message });
  }
});

outboxRouter.delete("/:id", (req, res) => {
  cancelOutbox(Number(req.params.id));
  res.status(204).end();
});

outboxRouter.post("/:id/retry", (req, res) => {
  retryOutbox(Number(req.params.id));
  res.json({ ok: true });
});
