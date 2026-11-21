// Fonctions pures du front (public/js/utils.js) : échappement, URL, variables, CSV, ICS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, raw, esc, safeUrl, applyVars, missingIdentity, findPlaceholder, csvCell, icsEvent, rel } from "../public/js/utils.js";
import { normalizeUrl } from "../src/security.js";

test("html`` échappe les valeurs et garde les fragments sûrs", () => {
  const nom = `<img src=x onerror="alert(1)">`;
  const out = String(html`<b title="${nom}">${nom}</b>${raw("<i>ok</i>")}${html`<u>${"&"}</u>`}`);
  assert.equal(out, `<b title="${esc(nom)}">${esc(nom)}</b><i>ok</i><u>&amp;</u>`);
  assert.ok(!out.includes("<img"));
});

test("html`` : tableaux concaténés ; null, undefined et false ignorés ; 0 conservé", () => {
  assert.equal(String(html`${["<a>", html`<b></b>`]}`), "&lt;a&gt;<b></b>");
  assert.equal(String(html`${null}${undefined}${false}${0}`), "0");
});

test("safeUrl n'accepte que http(s)", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl(" JaVaScRiPt:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.equal(safeUrl("exemple.fr"), "https://exemple.fr/");
  assert.equal(safeUrl("http://exemple.fr/a?b=1"), "http://exemple.fr/a?b=1");
  assert.equal(safeUrl(""), "");
});

test("normalizeUrl (serveur) refuse les schémas dangereux", () => {
  assert.throws(() => normalizeUrl("javascript:alert(1)"), /http\(s\)/);
  assert.throws(() => normalizeUrl("file:///C:/x"), /http\(s\)/);
  assert.equal(normalizeUrl("exemple.fr"), "https://exemple.fr");
  assert.equal(normalizeUrl(""), "");
});

test("applyVars remplace les variables de l'entreprise et de l'expéditeur", () => {
  const e = { nom: "ACME", ville: "", activite: "Dev", contactNom: "" };
  const me = { nom: "Hugo Canu", tel: "06", email: "h@x.fr" };
  assert.equal(applyVars("{interlocuteur} {entreprise} {ville} {activite} {moi.nom} {moi.tel} {moi.email}", e, me),
    "Madame, Monsieur ACME votre région Dev Hugo Canu 06 h@x.fr");
  assert.equal(applyVars("Bonjour {interlocuteur}", { contactNom: "Mme Durand" }), "Bonjour Mme Durand");
});

test("missingIdentity et findPlaceholder", () => {
  assert.deepEqual(missingIdentity("{moi.nom} {moi.tel}", { nom: "", tel: "06" }), ["ton nom"]);
  assert.deepEqual(missingIdentity("rien", {}), []);
  assert.equal(findPlaceholder("Poste de [intitulé du poste] ici"), "[intitulé du poste]");
  assert.equal(findPlaceholder("Aucun trou"), null);
  assert.equal(findPlaceholder("tableau[0]"), null); // un seul caractère : pas un trou
});

test("csvCell neutralise les formules et double les guillemets", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("@SUM(1)"), `"'@SUM(1)"`);
  assert.equal(csvCell("Normal"), `"Normal"`);
  assert.equal(csvCell(null), `""`);
});

test("icsEvent produit un événement valide et échappé", () => {
  const ics = icsEvent({ uid: "u1", start: new Date("2026-09-24T12:00:00Z"), title: "Entretien — ACME, Rouen", description: "ligne1\nligne2" });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20260924T120000Z/);
  assert.match(ics, /DTEND:20260924T130000Z/);
  assert.match(ics, /SUMMARY:Entretien — ACME\\, Rouen/);
  assert.match(ics, /DESCRIPTION:ligne1\\nligne2/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("rel : ancienneté de moins en moins précise", () => {
  const now = new Date("2026-11-12T12:00:00Z").getTime();
  const ago = ms => rel(new Date(now - ms), now);
  const MIN = 60000, H = 60 * MIN, J = 24 * H;
  assert.equal(rel(null), null);
  assert.equal(ago(0), "à l'instant");
  assert.equal(ago(-5 * MIN), "à l'instant"); // date future : pas d'ancienneté négative
  assert.equal(ago(5 * MIN), "il y a 5 min");
  assert.equal(ago(3 * H + 12 * MIN), "il y a 3 h 12");
  assert.equal(ago(3 * H + 5 * MIN), "il y a 3 h 05");
  assert.equal(ago(2 * J + 7 * H), "il y a 2 j 7 h");
  assert.equal(ago(2 * J), "il y a 2 j");
  assert.equal(ago(12 * J + 5 * H), "il y a 12 j");
  assert.equal(ago(90 * J), "il y a 2 mois");
  assert.equal(ago(800 * J), "il y a 2 ans");
});
