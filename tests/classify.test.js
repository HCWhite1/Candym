import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, stripQuoted, matchEntreprise, isOutOfOffice, isReplySubject } from "../src/mail/classify.js";

const classify = (subject, text) => analyze(subject, text).classement;

// Citation Gmail typique : ton propre message (qui parle d'entretien) sous la réponse
const QUOTE_GMAIL = `

Le mar. 15 sept. 2026 à 10:02, Hugo <hugo@example.com> a écrit :
> Bonjour,
> Je reste disponible pour un entretien à votre convenance.
> Cordialement`;

const QUOTE_OUTLOOK = `

________________________________
De : Hugo <hugo@example.com>
Envoyé : mardi 15 septembre 2026 10:02
À : rh@exemple.fr
Objet : Candidature alternance

Je reste disponible pour un entretien.`;

test("stripQuoted retire la citation Gmail (en-tête sur deux lignes compris)", () => {
  assert.equal(stripQuoted("Bien reçu, merci." + QUOTE_GMAIL), "Bien reçu, merci.");
  const twoLines = "Merci !\n\nLe mar. 15 sept. 2026 à 10:02, Hugo Canu <\nhugo@example.com> a écrit :\n> blabla entretien";
  assert.equal(stripQuoted(twoLines), "Merci !");
});

test("stripQuoted retire la citation Outlook, les lignes > et la signature", () => {
  assert.equal(stripQuoted("Bien reçu." + QUOTE_OUTLOOK), "Bien reçu.");
  assert.equal(stripQuoted("Ok\n> cité\nsuite"), "Ok\nsuite");
  assert.equal(stripQuoted("Réponse\n-- \nJean, RH — entretien annuel"), "Réponse");
});

test("un accusé de réception qui cite ton mail n'est pas une piste", () => {
  assert.equal(classify("RE: Candidature alternance", "Bonjour, nous avons bien reçu votre candidature." + QUOTE_GMAIL), null);
  assert.equal(classify("RE: Candidature alternance", "Bien reçu, merci." + QUOTE_OUTLOOK), null);
});

test("l'objet d'une réponse (RE:) est ignoré", () => {
  assert.ok(isReplySubject("RE: x"));
  assert.ok(isReplySubject("Réf : x"));
  assert.ok(isReplySubject("TR: x"));
  assert.ok(!isReplySubject("Refus de candidature"));
  // « entretien » dans ton objet d'origine ne compte pas
  assert.equal(classify("RE: Demande d'entretien pour alternance", "Merci pour votre message."), null);
});

test("refus clairs", () => {
  const cases = [
    "Nous ne pouvons pas donner suite à votre candidature.",
    "Après étude, votre candidature n'a pas été retenue.",
    "Nous n’accueillons pas d’alternants cette année.", // apostrophes typographiques
    "Nous ne recrutons pas d'alternant pour le moment.",
    "Le poste est déjà pourvu.",
    "Votre profil ne correspond pas à nos besoins actuels.",
    "Malheureusement, nous ne pourrons pas vous proposer de contrat.",
    "Notre équipe est complète pour la rentrée.",
  ];
  for (const text of cases) assert.equal(classify("Votre candidature", text), "refusee", text);
});

test("« malheureusement » seul ne suffit plus à conclure au refus", () => {
  const t = "Malheureusement je suis absent mardi. Êtes-vous disponible jeudi pour un entretien ? Quelles sont vos disponibilités ?";
  assert.equal(classify("RE: candidature", t), "piste");
  assert.equal(classify("RE: candidature", "Malheureusement le fichier ne s'ouvre pas, pouvez-vous le renvoyer ?"), null);
});

test("pistes", () => {
  const cases = [
    "Nous souhaiterions vous rencontrer la semaine prochaine.",
    "Pouvez-vous nous indiquer vos disponibilités pour un échange téléphonique ?",
    "Votre profil nous intéresse, pourriez-vous nous appeler ?",
    "Je vous propose un entretien le 24 septembre à 14h.",
    "Merci de nous transmettre votre portfolio.",
    "Nous vous rappellerons demain.",
  ];
  for (const text of cases) assert.equal(classify("RE: candidature", text), "piste", text);
});

test("acceptations, y compris sans confusion avec la négation", () => {
  assert.equal(classify("Bonne nouvelle", "Nous avons retenu votre candidature, bienvenue chez nous !"), "acceptee");
  assert.equal(classify("RE:", "Nous serions ravis de vous accueillir en septembre pour la signature du contrat."), "acceptee");
  assert.equal(classify("RE:", "Nous n'avons pas retenu votre candidature."), "refusee");
});

test("signaux contradictoires → à classer à la main", () => {
  const t = "Nous ne pouvons pas donner suite pour ce poste, mais nous souhaiterions vous rencontrer pour un autre projet.";
  assert.equal(classify("RE:", t), null);
  const a = analyze("RE:", t);
  assert.ok(a.strong.refus.length && a.strong.piste.length);
  // Motifs montrés sous la notification : les expressions du mail, pas les regex
  assert.deepEqual(a.strong.refus, ["pas donner suite"]);
  assert.deepEqual(a.strong.piste, ["souhaiterions vous rencontrer"]);
});

test("« entretien » seul (ex. société d'entretien) n'est pas une piste", () => {
  assert.equal(classify("Info", "Nous sommes une société de maintenance et d'entretien informatique."), null);
});

test("messages d'absence", () => {
  assert.ok(isOutOfOffice("Réponse automatique : absent du bureau"));
  assert.ok(isOutOfOffice("Automatic reply: Candidature"));
  assert.ok(isOutOfOffice("Absence du 10 au 20 août"));
  assert.ok(!isOutOfOffice("RE: Candidature alternance"));
});

test("matchEntreprise : adresse exacte, puis domaine pro, jamais un domaine grand public", () => {
  const list = [
    { id: 1, email: "jobs@digiworks.fr" },
    { id: 2, email: "patron@gmail.com" },
    { id: 3, email: "contact@exemple.fr" },
  ];
  assert.equal(matchEntreprise("RH@DigiWorks.fr", list)?.id, 1);
  assert.equal(matchEntreprise("patron@gmail.com", list)?.id, 2);
  assert.equal(matchEntreprise("autre@gmail.com", list), null);
  assert.equal(matchEntreprise("contact@exemple.fr", list)?.id, 3);
  assert.equal(matchEntreprise("pasdarobase", list), null);
});
