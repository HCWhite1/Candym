-- ============================================================
-- Candym — contenus par défaut (modèles de message, réglages)
-- Exécuté une seule fois, à la création de la base.
-- ============================================================
BEGIN;

INSERT INTO templates (id, name, subject, body, kind) VALUES
  (1, 'Candidature spontanée', 'Candidature [stage / alternance / poste] — [intitulé du poste]', 'Bonjour {interlocuteur},

Actuellement en [votre formation], je recherche [un stage / une alternance / un poste] à partir de [date].

Votre entreprise {entreprise} a retenu mon attention et j''aimerais mettre mes compétences au service de vos projets : [vos compétences principales].

Vous trouverez mon CV en pièce jointe. Je reste disponible pour un entretien à votre convenance, en visio ou dans vos locaux à {ville}.

Cordialement,
{moi.nom}
{moi.tel} — {moi.email}', 'candidature'),
  (2, 'Réponse à une annonce', 'Candidature — [intitulé du poste]', 'Bonjour {interlocuteur},

Suite à votre annonce pour le poste de [intitulé du poste], je vous adresse ma candidature.

[Présentez en 2 lignes votre parcours et vos expériences pertinentes.]

Mon CV est en pièce jointe. Je me tiens à votre disposition pour échanger.

Cordialement,
{moi.nom}
{moi.tel}', 'candidature'),
  (3, 'Relance', 'Relance — candidature [intitulé du poste]', 'Bonjour {interlocuteur},

Je me permets de revenir vers vous concernant ma candidature envoyée il y a quelques jours à {entreprise}.

Toujours très motivé à l''idée de rejoindre vos équipes, je reste disponible pour tout échange ou entretien.

Dans l''attente de votre retour,

Cordialement,
{moi.nom}
{moi.tel}', 'relance'),
  (4, 'Demande d''information', 'Recrutez-vous en [stage / alternance] ?', 'Bonjour {interlocuteur},

Actuellement en [votre formation], je me renseigne sur les entreprises susceptibles d''accueillir un profil [votre domaine].

{entreprise} recrute-t-elle cette année ? Si oui, à qui puis-je adresser ma candidature ?

Merci d''avance pour votre retour.

Cordialement,
{moi.nom}
{moi.tel}', 'autre'),
  (5, 'Version courte', 'Candidature [stage / alternance] — [intitulé du poste]', 'Bonjour {interlocuteur},

Je recherche [un stage / une alternance] en [votre domaine] à partir de [date]. Compétences clés : [vos compétences].

Mon CV est en pièce jointe. Disponible pour un échange à votre convenance.

Cordialement,
{moi.nom} — {moi.tel}', 'candidature');

INSERT INTO settings (key, value) VALUES ('delai_relance', '7');

COMMIT;
