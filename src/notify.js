// Notifications Windows natives (toasts) : nouvelles réponses, relances dues, entretiens proches.
// Aucune dépendance : on passe par l'API WinRT de Windows PowerShell 5.1.
// Le texte transite par variables d'environnement et est échappé côté PowerShell (pas d'injection).
import { spawn } from "node:child_process";
import { db, getSetting, setSetting } from "./db.js";

let appUrl = "http://localhost:3400";
export const setAppUrl = url => { appUrl = url; };

const TOAST_SCRIPT = `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$esc = { param($s) [Security.SecurityElement]::Escape($s) }
$xml = '<toast activationType="protocol" launch="' + (& $esc $env:TOAST_URL) + '"><visual><binding template="ToastGeneric"><text>' + (& $esc $env:TOAST_TITLE) + '</text><text>' + (& $esc $env:TOAST_BODY) + '</text></binding></visual></toast>'
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($doc))
`;
const ENCODED = Buffer.from(TOAST_SCRIPT, "utf16le").toString("base64");

export const toastsEnabled = () => process.platform === "win32" && getSetting("notif_windows", "1") === "1";

export function showToast(title, body, { force = false } = {}) {
  if (!force && !toastsEnabled()) return;
  if (process.platform !== "win32") return;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", ENCODED], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, TOAST_TITLE: String(title).slice(0, 120), TOAST_BODY: String(body).slice(0, 300), TOAST_URL: appUrl },
  });
  let err = "";
  child.stderr.on("data", d => { err += d; });
  child.on("close", code => { if (code) console.error("Notification Windows impossible :", err.trim().split("\n")[0]); });
  child.on("error", e => console.error("Notification Windows impossible :", e.message));
}

/* ---------- Rappel quotidien ---------- */

// Même règle que le front (state.js → needsRelance) : contactée ou relancée,
// sans réponse, dernier échange plus vieux que le délai de relance.
export function relancesDues(now = Date.now()) {
  const delai = Number(getSetting("delai_relance", 7));
  const limit = new Date(now - delai * 86400000).toISOString();
  return db.prepare(`
    SELECT e.id, e.nom FROM entreprises e
    WHERE e.statut IN ('contacte', 'relancee') AND e.reponse = 0
      AND (SELECT max(date) FROM historique h
           WHERE h.entreprise_id = e.id AND h.type IN ('contact', 'relance', 'reponse')) < ?
    ORDER BY e.nom`).all(limit);
}

// Entretiens entre maintenant et la fin de demain (date_entretien en heure locale « AAAA-MM-JJTHH:MM »).
export function entretiensProches(now = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  const local = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 0, 0);
  return db.prepare("SELECT id, nom, date_entretien FROM entreprises WHERE date_entretien >= ? AND date_entretien <= ? ORDER BY date_entretien")
    .all(local(now), local(end));
}

function dailyReminder() {
  const now = new Date();
  const today = now.toLocaleDateString("sv-SE"); // AAAA-MM-JJ local
  if (now.getHours() < 8 || getSetting("reminder_day") === today) return;
  setSetting("reminder_day", today);

  const dues = relancesDues();
  if (dues.length) {
    const names = dues.slice(0, 4).map(e => e.nom).join(", ") + (dues.length > 4 ? "…" : "");
    showToast(`${dues.length} relance${dues.length > 1 ? "s" : ""} à faire`, names);
  }
  for (const e of entretiensProches(now)) {
    const d = new Date(e.date_entretien);
    const quand = d.toDateString() === now.toDateString() ? "aujourd'hui" : "demain";
    showToast(`Entretien ${quand} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, e.nom);
  }
}

let reminderTimer = null;
export function scheduleReminders() {
  clearInterval(reminderTimer);
  setTimeout(dailyReminder, 15000);
  reminderTimer = setInterval(dailyReminder, 30 * 60000);
}
