// Fonctions pures : rapprochement expéditeur ↔ entreprise et classement
// heuristique d'une réponse (refus / acceptation / piste). Testable sans IMAP
// (voir tests/classify.test.js).

// Domaines grand public : une correspondance de domaine seul n'y prouve rien
// (deux entreprises différentes peuvent écrire depuis @gmail.com).
export const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr",
  "live.com", "live.fr", "msn.com", "yahoo.com", "yahoo.fr", "orange.fr", "wanadoo.fr",
  "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "icloud.com", "me.com",
  "protonmail.com", "proton.me", "gmx.com", "gmx.fr", "aol.com",
]);

export const domainOf = addr => {
  const a = String(addr || "").toLowerCase().trim();
  const at = a.lastIndexOf("@");
  return at < 1 ? "" : a.slice(at + 1);
};

// Retrouve l'entreprise correspondant à un expéditeur : adresse exacte d'abord,
// sinon même domaine (hors domaines grand public — rh@digiworks.fr répond
// souvent à la place de jobs@digiworks.fr).
export function matchEntreprise(fromAddr, entreprises) {
  const addr = String(fromAddr || "").toLowerCase().trim();
  const domain = domainOf(addr);
  if (!domain) return null;
  let byDomain = null;
  for (const e of entreprises) {
    const em = String(e.email || "").toLowerCase().trim();
    if (!domainOf(em)) continue;
    if (em === addr) return e;
    if (!byDomain && !FREEMAIL.has(domain) && domainOf(em) === domain) byDomain = e;
  }
  return byDomain;
}

/* ---------- Nettoyage du texte ---------- */

// Minuscules, apostrophes typographiques (’) ramenées à ', espaces normalisés.
export const normalize = s => String(s || "")
  .normalize("NFC")
  .toLowerCase()
  .replace(/[‘’ʼ´`]/g, "'")
  .replace(/[  ]/g, " ")
  .replace(/[ \t]+/g, " ");

// Début de la partie citée d'une réponse : en-têtes Gmail/Outlook/Apple (FR et EN).
const QUOTE_MARKERS = [
  /\n[ \t]*le [^\n]{0,200}(?:\n[^\n]{0,120})?a (?:[ée]|\S{1,3})crit ?:/i, // tolère un « é » mal décodé
  /\n[ \t]*on [^\n]{0,200}(?:\n[^\n]{0,120})?wrote ?:/i,
  /\n[ \t]*-{2,} ?(?:message d'origine|original message|message transf[ée]r[ée]|forwarded message)/i,
  /\n[ \t]*_{8,}[ \t]*\n/,
  /\n[ \t]*\*?(?:de|from) ?:\*? [^\n]+\n[ \t]*\*?(?:envoy[ée]|sent|date) ?:/i,
  /\n-- ?\n/, // séparateur de signature
];

// Ne garde que ce que l'expéditeur a écrit : coupe à la première citation,
// retire les lignes « > … ». Sans cela, les mots de ton propre message
// (« disponible pour un entretien ») faussent le classement.
export function stripQuoted(text) {
  let t = "\n" + String(text || "").replace(/\r\n?/g, "\n");
  let cut = t.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  t = t.slice(0, cut);
  return t.split("\n").filter(l => !/^\s*>/.test(l)).join("\n").trim();
}

// Objet d'une réponse (« RE: … ») : c'est ton propre objet, il ne dit rien de la réponse.
export const isReplySubject = subject => /^\s*(?:re|r[ée]f|tr|fwd?|aw|sv)\s*:/i.test(subject || "");

// Messages d'absence : ce n'est pas une réponse de l'entreprise, ils ne doivent pas
// remettre à zéro le délai de relance. (Un accusé de réception automatique, lui,
// reste une réponse neutre.)
export const isOutOfOffice = subject =>
  /(?:r[ée]ponse automatique|automatic reply|auto[- ]?reply|out of office|absent(?:e)? du bureau|message d'absence|^\s*absence\b)/i
    .test(subject || "");

/* ---------- Classement ---------- */

// Signaux forts : une seule occurrence suffit. Signaux faibles : jamais décisifs seuls.
const SIGNALS = {
  refus: [
    /(?:pas|plus) (?:pu |pouvoir |en mesure de )?donner (?:une )?suite/,
    /ne (?:donnerons|donnera|pourrons donner|pouvons donner) pas suite/,
    /\bpas (?:été )?retenue?s?\b/,
    /(?:ne |n')(?:recrutons|recherchons|prenons|accueillons|proposons|avons|embauchons) (?:pas|plus) (?:de |d')?(?:besoin|alternant|apprenti|stagiaire|contrat|poste|place|profil)/,
    /ne (?:pouvons|pourrons|pourrions) (?:malheureusement )?pas (?:vous )?(?:proposer|accueillir|prendre|retenir|recruter|répondre favorablement)/,
    /(?:aucun|pas de) (?:poste|place|besoin|offre) (?:disponible|ouvert|vacant|en alternance|d'alternance|d'alternant|pour le moment|actuellement|à pourvoir)/,
    /ne (?:correspond|correspondent) pas (?:à|a) (?:nos|notre) (?:besoins?|attentes|recherches?)/,
    /(?:d[ée]cision|r[ée]ponse|avis) (?:est )?(?:d[ée]favorable|n[ée]gative)/,
    /poste (?:est |a (?:déjà )?été )?(?:déjà )?pourvu/,
    /(?:nous sommes|sommes|équipe est|effectifs? (?:sont|est)) (?:déjà )?compl[eè]te?s?\b/,
  ],
  acceptee: [
    /(?<!pas )(?<!pas été )retenu votre candidature/,
    /votre candidature (?:a été |est )?(?:retenue|acceptée)/,
    /(?:heureux|heureuse|ravie?s?|plaisir) de vous (?:accueillir|compter parmi)/,
    /bienvenue (?:chez|dans|parmi)/,
    /promesse d'embauche/,
    /(?:signature|signer) (?:du |le |de votre |votre )?contrat/,
    /(?:proposition|offre) de contrat/,
  ],
  piste: [
    /(?:proposer|organiser|fixer|planifier|convenir d'|caler) ?(?:un |d'un |le )?(?:entretien|rendez-vous|rdv|échange|appel|visio)/,
    /(?:vos|quelles sont vos|indiquer vos|communiquer vos|vos prochaines) disponibilit/,
    /(?:souhaiterions|aimerions|voudrions|souhaitons|aimerais|souhaiterais|serions ravis de) (?:bien )?(?:vous )?(?:rencontrer|échanger|appeler|contacter|en savoir plus)/,
    /(?:votre )?profil (?:nous )?(?:intéresse|a retenu (?:notre|toute notre) attention|correspond à)/,
    /int[ée]ress[ée]e?s? par votre (?:profil|candidature)/,
    /(?:pouvez|pourriez)[- ]vous (?:nous )?(?:rappeler|appeler|joindre|passer|venir)/,
    /(?:venez|venir|passer) (?:avec votre cv|nous voir|nous rencontrer|à l'agence|dans nos locaux)/,
    /(?:transmettre|envoyer|faire parvenir) (?:votre |un |ton )?(?:cv|portfolio)/,
    /test technique|entretien (?:technique|téléphonique|en visio|le \d|(?:ce |le )?(?:lundi|mardi|mercredi|jeudi|vendredi))/,
    /(?:je vous|nous vous) (?:appellerai|appellerons|rappellerai|rappellerons|recontacterai|recontacterons)/,
  ],
};

const WEAK = {
  refus: [/malheureusement/, /regrett(?:ons|e)/, /d[ée]sol[ée]/, /à notre grand regret/],
  piste: [/entretien/, /rendez-vous/, /disponible/, /rencontrer/],
};

// Expressions trouvées dans le texte (et non les motifs regex) : elles sont montrées sous la notification.
const hits = (res, s) => res.map(r => s.match(r)?.[0].trim()).filter(Boolean);

// Analyse une réponse : renvoie le classement et les expressions qui l'expliquent.
// Règles :
//  - acceptation forte sans refus fort → acceptee ;
//  - refus fort sans signal positif fort → refusee ;
//  - piste forte sans refus fort → piste ;
//  - signaux contradictoires ou seulement faibles → null (à classer depuis la notification).
export function analyze(subject, text) {
  const body = stripQuoted(text);
  const s = normalize((isReplySubject(subject) ? "" : subject + "\n") + body);
  const strong = {
    refus: hits(SIGNALS.refus, s),
    acceptee: hits(SIGNALS.acceptee, s),
    piste: hits(SIGNALS.piste, s),
  };
  const weak = { refus: hits(WEAK.refus, s), piste: hits(WEAK.piste, s) };
  const r = strong.refus.length, a = strong.acceptee.length, p = strong.piste.length;

  let classement = null;
  if (a && !r) classement = "acceptee";
  else if (r && !a && !p) classement = "refusee";
  else if (p && !r) classement = "piste";

  return { classement, strong, weak, text: body };
}
