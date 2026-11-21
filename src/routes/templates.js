import { Router } from "express";
import { db } from "../db.js";

export const templatesRouter = Router();

const SELECT = "SELECT id, name, subject, body, kind FROM templates";
const KINDS = ["candidature", "relance", "autre"];

function readBody(req, res) {
  const { name, subject = "", body = "", kind = "autre" } = req.body ?? {};
  if (!String(name ?? "").trim()) {
    res.status(400).json({ error: "Le nom du modèle est obligatoire" });
    return null;
  }
  if (!KINDS.includes(kind)) {
    res.status(400).json({ error: "Type de modèle invalide" });
    return null;
  }
  return [String(name).trim(), String(subject), String(body), kind];
}

templatesRouter.get("/", (req, res) => {
  res.json(db.prepare(SELECT + " ORDER BY id").all());
});

templatesRouter.post("/", (req, res) => {
  const vals = readBody(req, res);
  if (!vals) return;
  const info = db.prepare("INSERT INTO templates (name, subject, body, kind) VALUES (?, ?, ?, ?)").run(...vals);
  res.status(201).json(db.prepare(SELECT + " WHERE id = ?").get(Number(info.lastInsertRowid)));
});

templatesRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const vals = readBody(req, res);
  if (!vals) return;
  const info = db.prepare("UPDATE templates SET name = ?, subject = ?, body = ?, kind = ? WHERE id = ?").run(...vals, id);
  if (!info.changes) return res.status(404).json({ error: "Modèle introuvable" });
  res.json(db.prepare(SELECT + " WHERE id = ?").get(id));
});

templatesRouter.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM templates WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Modèle introuvable" });
  res.status(204).end();
});
