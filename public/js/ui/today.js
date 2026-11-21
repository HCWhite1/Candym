// Vue « Aujourd'hui » : la réponse directe à « qu'est-ce que je fais maintenant ? » —
// entretiens d'aujourd'hui et de demain, réponses non lues, relances dues.
// Recalculée à chaque rendu, repliable (choix mémorisé dans le navigateur).
import { state, lastContact, needsRelance } from "../state.js";
import { $, html, rel } from "../utils.js";
import { icon } from "../icons.js";

const MAX = 5; // lignes par colonne, le reste est accessible par le lien « … autres »

const PHRASES = { acceptee: "accepte ta candidature", refusee: "refuse", piste: "propose une piste" };

let handlers = null;

const collapsed = {
  get() { try { return localStorage.getItem("radar.today") === "replie"; } catch { return false; } },
  set(v) { try { localStorage.setItem("radar.today", v ? "replie" : "ouvert"); } catch { /* stockage indisponible */ } },
};

// Même fenêtre que le rappel Windows (src/notify.js → entretiensProches), en gardant ceux déjà passés aujourd'hui.
function entretiens(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  return state.entreprises
    .filter(e => e.dateEntretien)
    .map(e => ({ e, d: new Date(e.dateEntretien) }))
    .filter(({ d }) => d >= start && d < end)
    .sort((a, b) => a.d - b.d);
}

const relances = () => state.entreprises.filter(needsRelance).sort((a, b) => lastContact(a) - lastContact(b));

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function column(title, iconName, rows, total, more) {
  return html`<div class="today-col">
    <h3>${icon(iconName, 13)} ${title} <span class="count-mono">${total}</span></h3>
    ${rows}
    ${total > MAX && html`<button class="linkbtn today-more" data-more="${more}">… et ${total - MAX} autre${total - MAX > 1 ? "s" : ""}</button>`}
  </div>`;
}

export function renderToday() {
  const box = $("#today");
  if (!box || !handlers || !state.loaded) return;
  const now = new Date();
  const rdv = entretiens(now);
  const dues = relances();
  const unread = state.unread;
  const total = rdv.length + dues.length + unread.length;

  const summary = total
    ? [rdv.length && plural(rdv.length, "entretien", "entretiens"),
      unread.length && plural(unread.length, "réponse non lue", "réponses non lues"),
      dues.length && plural(dues.length, "relance due", "relances dues")].filter(Boolean).join(" · ")
    : "rien d'urgent : aucune relance due, aucun entretien proche, aucune réponse non lue";
  const folded = collapsed.get();

  const day = d => (d.toDateString() === now.toDateString() ? "aujourd'hui" : "demain");
  const hour = d => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  box.innerHTML = html`
    <div class="today-head">
      <h2>Aujourd'hui</h2>
      <span class="today-sum">${summary}</span>
      ${total > 0 && html`<button class="btn small ghost" id="todayToggle" aria-expanded="${String(!folded)}">${folded ? "Afficher" : "Masquer"}</button>`}
    </div>
    ${total > 0 && !folded && html`<div class="today-cols">
      ${rdv.length > 0 && column("Entretiens", "calendar", rdv.slice(0, MAX).map(({ e, d }) => html`
        <div class="today-item">
          <button class="today-name" data-open="${e.id}">${e.nom}</button>
          <span class="today-when">${day(d)} ${hour(d)}</span>
        </div>`), rdv.length, "")}
      ${unread.length > 0 && column("Réponses non lues", "bell", unread.slice(0, MAX).map(n => html`
        <div class="today-item">
          <button class="today-name" data-notif="${n.id}">${n.entreprise || n.fromEmail}</button>
          <span class="today-when">${PHRASES[n.classement] || "à classer"}</span>
        </div>`), unread.length, "notifs")}
      ${dues.length > 0 && column("Relances dues", "clock", dues.slice(0, MAX).map(e => html`
        <div class="today-item">
          <button class="today-name" data-open="${e.id}">${e.nom}</button>
          <span class="today-when">${rel(lastContact(e))}</span>
          ${e.email && html`<button class="btn small" data-relance="${e.id}" title="Relancer ${e.nom} par mail">${icon("refresh", 12)} Relancer</button>`}
        </div>`), dues.length, "relances")}
    </div>`}`;
}

// handlers : { onOpen(id), onRelance(id), onOpenNotif(id), onShowNotifs(), onShowRelances() }
export function initToday(h) {
  handlers = h;
  $("#today").addEventListener("click", ev => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.id === "todayToggle") { collapsed.set(!collapsed.get()); renderToday(); return; }
    if (t.dataset.open) handlers.onOpen(Number(t.dataset.open));
    else if (t.dataset.relance) handlers.onRelance(Number(t.dataset.relance));
    else if (t.dataset.notif) handlers.onOpenNotif(Number(t.dataset.notif));
    else if (t.dataset.more === "notifs") {
      ev.stopPropagation(); // sinon le clic, arrivé au document, refermerait aussitôt le panneau
      handlers.onShowNotifs();
    }
    else if (t.dataset.more === "relances") handlers.onShowRelances();
  });
  renderToday();
}
