// Configuration de la boîte mail (IMAP + SMTP), tests de connexion et relève manuelle.
import { Router } from "express";
import { publicMailConfig, saveMailConfig, clearMailConfig, testConnection, checkMail } from "../mail.js";
import { testSmtp } from "../smtp.js";

export const mailRouter = Router();

mailRouter.get("/config", (req, res) => res.json(publicMailConfig()));

mailRouter.put("/config", (req, res) => res.json(saveMailConfig(req.body ?? {})));

mailRouter.delete("/config", (req, res) => {
  clearMailConfig();
  res.status(204).end();
});

// Les erreurs de connexion sont des erreurs « attendues » (mot de passe, réseau) : 400 + message clair.
const attempt = (fn, prefix = "") => async (req, res) => {
  try {
    res.json(await fn(req.body ?? {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: prefix + err.message });
  }
};

mailRouter.post("/test", attempt(testConnection, "Connexion IMAP impossible : "));
mailRouter.post("/test-smtp", attempt(testSmtp, "Connexion SMTP impossible : "));
mailRouter.post("/check", attempt(checkMail));
