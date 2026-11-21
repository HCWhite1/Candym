// Tableau de bord : taux et délai de réponse, entonnoir par statut,
// activité des 12 dernières semaines, efficacité par modèle de message.
import { api } from "../api.js";
import { STATUTS, STATUT_ORDER, TEMPLATE_KINDS } from "../constants.js";
import { $, html, toast } from "../utils.js";
import { showModal } from "./modals.js";

const pct = x => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);
const days = x => (x === null || x === undefined ? "—" : x < 1 ? "< 1 j" : `${x.toFixed(1).replace(".", ",")} j`);

function barList(rows, max) {
  return html`<div class="barlist">${rows.map(r => html`
    <div class="barrow">
      <span class="barlabel">${r.label}</span>
      <span class="bartrack"><span class="barfill" style="width:${max ? (r.value / max) * 100 : 0}%;${r.color ? `background:${r.color}` : ""}"></span></span>
      <span class="barval">${r.value}</span>
    </div>`)}</div>`;
}

function weeks(semaines) {
  const max = Math.max(1, ...semaines.map(s => Math.max(s.envois, s.reponses)));
  const label = iso => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return html`
    <div class="weekchart" role="img" aria-label="Envois et réponses par semaine sur 12 semaines">
      <div class="wc-grid"><span>${max}</span><span>${Math.round(max / 2)}</span><span>0</span></div>
      ${semaines.map(s => html`
        <div class="wc-col" title="Semaine du ${label(s.semaine)} : ${s.envois} envoi(s), ${s.reponses} réponse(s)">
          <div class="wc-bars">
            <span class="wc-bar sent" style="height:${(s.envois / max) * 100}%"></span>
            <span class="wc-bar rep" style="height:${(s.reponses / max) * 100}%"></span>
          </div>
          <span class="wc-label">${label(s.semaine)}</span>
        </div>`)}
    </div>
    <div class="legend"><span><i class="lg sent"></i>Envois et relances</span><span><i class="lg rep"></i>Réponses reçues</span></div>`;
}

function render(s) {
  const funnel = STATUT_ORDER.filter(k => s.parStatut[k]).map(k => ({ label: STATUTS[k].label, value: s.parStatut[k], color: STATUTS[k].color }));
  const canaux = Object.entries(s.canaux).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const positives = (s.parStatut.piste || 0) + (s.parStatut.acceptee || 0);
  $("#statsBody").innerHTML = html`
    <div class="kpis">
      <div class="kpi"><span class="klabel">Taux de réponse</span><b>${pct(s.tauxReponse)}</b><small>${s.repondues} sur ${s.contactees} entreprises contactées</small></div>
      <div class="kpi"><span class="klabel">Délai médian de réponse</span><b>${days(s.delaiMedianJours)}</b><small>moyenne ${days(s.delaiMoyenJours)}</small></div>
      <div class="kpi"><span class="klabel">Pistes et acceptations</span><b>${positives}</b><small>sur ${s.total} entreprises suivies</small></div>
    </div>
    <div class="dsection">
      <h3>Activité — 12 dernières semaines</h3>
      ${weeks(s.semaines)}
    </div>
    <div class="grid2 gap">
      <div class="dsection"><h3>Répartition par statut</h3>${barList(funnel, Math.max(...funnel.map(f => f.value), 1))}</div>
      <div class="dsection"><h3>Canal du premier contact</h3>${canaux.length ? barList(canaux, Math.max(...canaux.map(c => c.value))) : html`<p class="hint">Aucun contact enregistré.</p>`}</div>
    </div>
    <div class="dsection">
      <h3>Efficacité par modèle</h3>
      ${s.parModele.length ? html`
        <div class="tablewrap"><table class="mini">
          <thead><tr><th>Modèle</th><th>Type</th><th class="num">Envois</th><th class="num">Réponses</th><th class="num">Taux</th><th class="num">Positives</th></tr></thead>
          <tbody>${s.parModele.sort((a, b) => b.envois - a.envois).map(t => html`
            <tr><td>${t.name}</td><td>${TEMPLATE_KINDS[t.kind] || "Autre"}</td><td class="num">${t.envois}</td><td class="num">${t.reponses}</td><td class="num">${pct(t.reponses / t.envois)}</td><td class="num">${t.positives}</td></tr>`)}
          </tbody>
        </table></div>` : html`<p class="hint">Le modèle utilisé est enregistré à chaque envoi depuis cette version : les chiffres apparaîtront après tes prochains envois.</p>`}
    </div>`;
}

export async function openStats() {
  $("#statsBody").innerHTML = html`<p class="hint">Calcul…</p>`;
  showModal("#mStats");
  try {
    render(await api.stats());
  } catch (err) {
    toast(err.message, "err");
  }
}

export function initStats() {
  $("#btnStats").addEventListener("click", openStats);
}
