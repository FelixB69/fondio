// Reformulation des intitulés de tâches en ACTIONS.
//
// Une tâche du board doit se lire comme quelque chose à FAIRE : « Appeler
// l'hébergeur », « Rédiger le cahier des charges ». Or les sources qui
// alimentent le board produisent souvent des NOMS DE CHOSES : le LLM (malgré la
// consigne du prompt, cf. TASKS_INSTRUCTIONS), et surtout la conversion d'un
// LIVRABLE en tâche — un livrable EST par nature un nom d'objet
// (« Plan de prospection pour les 12 cafés du 11e »).
//
// La reformulation est déterministe et PRUDENTE : on ne réécrit que ce qu'on
// sait réécrire correctement (verbe connu en tête → on garde tel quel ; nom
// connu en tête → verbe adapté + article du bon genre). Dans le doute, on rend
// l'intitulé intact : mieux vaut un nom lisible qu'une phrase française fausse.

type Article = "le" | "la" | "les";

// Verbes d'action (infinitif) admis en tête d'une tâche. Liste FERMÉE : une
// heuristique par terminaison (-er / -ir / -re) prendrait « Atelier », « Devis »
// ou « Livre » pour des verbes.
const ACTION_VERBS = new Set([
  "acheter", "affiner", "ajouter", "ajuster", "analyser", "annuler", "appeler", "arbitrer",
  "auditer", "boucler", "brancher", "budgeter", "cadrer", "caler", "cartographier", "chiffrer",
  "choisir", "coder", "collecter", "commander", "comparer", "completer", "concevoir", "configurer",
  "confirmer", "connecter", "constituer", "contacter", "corriger", "creer", "decouper", "definir",
  "demander", "deployer", "developper", "documenter", "dresser", "ecrire", "envoyer", "estimer",
  "etablir", "etudier", "finaliser", "fixer", "former", "heberger", "identifier", "importer",
  "installer", "integrer", "interviewer", "lancer", "lister", "maquetter", "mesurer",
  "mettre", "migrer", "modifier", "negocier", "nettoyer", "noter", "obtenir", "optimiser",
  "organiser", "partager", "passer", "planifier", "poser", "prendre", "preparer", "presenter",
  "prioriser", "programmer", "prototyper", "publier", "questionner", "rassembler", "realiser",
  "recruter", "relancer", "relire", "remplir", "rencontrer", "repondre", "reserver", "revoir",
  "rediger", "sauvegarder", "securiser", "segmenter", "signer", "simplifier", "sonder",
  "structurer", "suivre", "supprimer", "tester", "trancher", "traduire", "trier", "valider",
  "verifier", "faire",
]);

// Nom connu en tête → verbe qui lui va + genre (pour « le / la / l' »).
// Les entrées les plus spécifiques (expressions en plusieurs mots, pluriels)
// passent AVANT les plus générales : la première qui matche gagne.
const NOUN_RULES: { head: RegExp; verb: string; article: Article }[] = [
  { head: /^cahier des charges/, verb: "Rédiger", article: "le" },
  { head: /^compte[- ]rendu/, verb: "Rédiger", article: "le" },
  { head: /^appel d'offres?/, verb: "Lancer", article: "le" },
  { head: /^nom de domaine/, verb: "Réserver", article: "le" },
  { head: /^mise en (?:ligne|production)/, verb: "Réaliser", article: "la" },
  { head: /^feuille de route/, verb: "Établir", article: "la" },
  { head: /^charte graphique/, verb: "Créer", article: "la" },
  { head: /^base de donnees/, verb: "Créer", article: "la" },
  { head: /^parcours (?:utilisateur|client)/, verb: "Décrire", article: "le" },
  { head: /^landing page/, verb: "Créer", article: "la" },
  { head: /^user stor(?:ies|y)/, verb: "Rédiger", article: "les" },
  { head: /^retro[- ]?planning/, verb: "Établir", article: "le" },
  { head: /^plan(?:ning|ification)?\b/, verb: "Établir", article: "le" },
  { head: /^roadmap/, verb: "Établir", article: "la" },
  { head: /^calendrier/, verb: "Établir", article: "le" },
  { head: /^budget/, verb: "Établir", article: "le" },
  { head: /^chiffrage/, verb: "Établir", article: "le" },
  { head: /^estimation/, verb: "Établir", article: "la" },
  { head: /^devis/, verb: "Demander", article: "le" },
  { head: /^facture/, verb: "Envoyer", article: "la" },
  { head: /^contrat/, verb: "Préparer", article: "le" },
  { head: /^maquettes\b/, verb: "Créer", article: "les" },
  { head: /^maquette/, verb: "Créer", article: "la" },
  { head: /^wireframe/, verb: "Créer", article: "le" },
  { head: /^prototype/, verb: "Créer", article: "le" },
  { head: /^documentation/, verb: "Rédiger", article: "la" },
  { head: /^documents\b/, verb: "Rédiger", article: "les" },
  { head: /^document\b/, verb: "Rédiger", article: "le" },
  { head: /^specifications\b/, verb: "Rédiger", article: "les" },
  { head: /^specification\b/, verb: "Rédiger", article: "la" },
  { head: /^rapport/, verb: "Rédiger", article: "le" },
  { head: /^synthese/, verb: "Rédiger", article: "la" },
  { head: /^note\b/, verb: "Rédiger", article: "la" },
  { head: /^article/, verb: "Rédiger", article: "le" },
  { head: /^newsletter/, verb: "Rédiger", article: "la" },
  { head: /^(?:e[- ]?mail|mail|message)/, verb: "Rédiger", article: "le" },
  { head: /^texte/, verb: "Rédiger", article: "le" },
  { head: /^contenus\b/, verb: "Rédiger", article: "les" },
  { head: /^contenu\b/, verb: "Rédiger", article: "le" },
  { head: /^listes\b/, verb: "Dresser", article: "les" },
  { head: /^liste\b/, verb: "Dresser", article: "la" },
  { head: /^inventaire/, verb: "Dresser", article: "le" },
  { head: /^checklist/, verb: "Établir", article: "la" },
  { head: /^backlog/, verb: "Constituer", article: "le" },
  { head: /^reunion/, verb: "Organiser", article: "la" },
  { head: /^rendez[- ]vous/, verb: "Planifier", article: "le" },
  { head: /^entretien/, verb: "Planifier", article: "le" },
  { head: /^atelier/, verb: "Organiser", article: "le" },
  { head: /^formation/, verb: "Organiser", article: "la" },
  { head: /^demo\b/, verb: "Préparer", article: "la" },
  { head: /^appel\b/, verb: "Passer", article: "le" },
  { head: /^point\b/, verb: "Organiser", article: "le" },
  { head: /^choix\b/, verb: "Trancher", article: "le" },
  { head: /^selection/, verb: "Faire", article: "la" },
  { head: /^onboarding/, verb: "Préparer", article: "le" },
  { head: /^serveur/, verb: "Configurer", article: "le" },
  { head: /^charte/, verb: "Créer", article: "la" },
  { head: /^comparatif/, verb: "Réaliser", article: "le" },
  { head: /^benchmark/, verb: "Réaliser", article: "le" },
  { head: /^etude/, verb: "Réaliser", article: "la" },
  { head: /^analyse/, verb: "Réaliser", article: "la" },
  { head: /^audit/, verb: "Réaliser", article: "le" },
  { head: /^tests\b/, verb: "Réaliser", article: "les" },
  { head: /^test\b/, verb: "Réaliser", article: "le" },
  { head: /^recette/, verb: "Réaliser", article: "la" },
  { head: /^campagne/, verb: "Préparer", article: "la" },
  { head: /^sauvegarde/, verb: "Mettre en place", article: "la" },
  { head: /^hebergement/, verb: "Choisir", article: "le" },
  { head: /^prestataire/, verb: "Contacter", article: "le" },
  { head: /^agence/, verb: "Contacter", article: "la" },
  { head: /^(?:freelance|developpeur|dev\b)/, verb: "Contacter", article: "le" },
  { head: /^persona/, verb: "Définir", article: "le" },
  { head: /^objectifs\b/, verb: "Définir", article: "les" },
  { head: /^objectif\b/, verb: "Définir", article: "le" },
  { head: /^perimetre/, verb: "Définir", article: "le" },
  { head: /^besoins\b/, verb: "Définir", article: "les" },
  { head: /^besoin\b/, verb: "Définir", article: "le" },
  { head: /^criteres\b/, verb: "Définir", article: "les" },
  { head: /^critere\b/, verb: "Définir", article: "le" },
  { head: /^strategie/, verb: "Définir", article: "la" },
  { head: /^process(?:us)?\b/, verb: "Définir", article: "le" },
  { head: /^arborescence/, verb: "Définir", article: "la" },
  { head: /^offre/, verb: "Définir", article: "la" },
  { head: /^tarifs\b/, verb: "Définir", article: "les" },
  { head: /^(?:tarif|prix)\b/, verb: "Définir", article: "le" },
  { head: /^sites\b/, verb: "Créer", article: "les" },
  { head: /^site\b/, verb: "Créer", article: "le" },
  { head: /^pages\b/, verb: "Créer", article: "les" },
  { head: /^page\b/, verb: "Créer", article: "la" },
  { head: /^ecrans\b/, verb: "Créer", article: "les" },
  { head: /^ecran\b/, verb: "Créer", article: "le" },
  { head: /^formulaire/, verb: "Créer", article: "le" },
  { head: /^logo/, verb: "Créer", article: "le" },
  { head: /^api\b/, verb: "Créer", article: "la" },
  { head: /^script/, verb: "Écrire", article: "le" },
  { head: /^fonctionnalites\b/, verb: "Développer", article: "les" },
  { head: /^fonctionnalite\b/, verb: "Développer", article: "la" },
  { head: /^module/, verb: "Développer", article: "le" },
  { head: /^tunnel/, verb: "Concevoir", article: "le" },
  { head: /^interface/, verb: "Concevoir", article: "la" },
  { head: /^design/, verb: "Concevoir", article: "le" },
];

// Verbe passe-partout, utilisé UNIQUEMENT quand l'intitulé porte déjà son
// déterminant (« Le tunnel de réservation ») : on peut alors préfixer sans
// risque de faute de genre.
const GENERIC_VERB = "Préparer";

// Tournures qui noient l'action (« Il faut appeler… ») : on les retire pour
// laisser le verbe en tête.
const FILLERS = [
  /^il faut(?:rait)?\s+/i,
  /^(?:vous|tu) (?:devez|devriez|dois)\s+/i,
  /^je (?:dois|devrais)\s+/i,
  /^pense[rz]?\s+[àa]\s+/i,
  /^n['’]oubli(?:ez|er) pas de\s+/i,
  /^(?:[àa] faire|t[âa]che|todo|action)\s*:\s*/i,
];

// Minuscules sans accents ni apostrophes typographiques — sert UNIQUEMENT à
// reconnaître (verbe, nom, déterminant) ; l'affichage repart du texte d'origine.
function fold(s: string): string {
  return s
    .normalize("NFD") // accents détachés de leur lettre, puis supprimés (̀-ͯ)
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase();
}

// Déterminant en tête : l'intitulé porte déjà son article, on n'en ajoute pas.
const LEADING_DETERMINER =
  /^(?:l'|d'|les?|la|un|une|des|du|de|ce|cet|cette|ces|mon|ma|mes|notre|nos|votre|vos|leurs?)\b/;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Passe l'intitulé en minuscule initiale pour le coller derrière un verbe —
// sauf acronyme (API, SEO, RGPD) ou nom propre en capitales.
function lowerFirst(s: string): string {
  const first = s.split(/\s+/)[0] ?? "";
  if (first.length >= 2 && first === first.toUpperCase() && /[A-ZÀ-Þ]/.test(first)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// « le » + « appel d'offres » → « l'appel d'offres » (élision devant voyelle et h).
function withArticle(article: Article, phrase: string): string {
  const folded = fold(phrase);
  if (LEADING_DETERMINER.test(folded)) return lowerFirst(phrase);
  if (article !== "les" && /^[aeiouyh]/.test(folded)) return `l'${lowerFirst(phrase)}`;
  return `${article} ${lowerFirst(phrase)}`;
}

// Nettoyage de surface : puce, gras markdown, espaces multiples, point final.
function tidy(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*•‣–]|\d+[.)])\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\.$/, "");
}

function stripFiller(s: string): string {
  let out = s;
  for (const filler of FILLERS) {
    const next = out.replace(filler, "");
    if (next !== out) out = next.trim();
  }
  return out;
}

/**
 * Reformule un intitulé de tâche en action commençant par un verbe.
 *
 * « Plan de prospection pour les 12 cafés » → « Établir le plan de prospection… »
 * « Il faut appeler l'hébergeur »           → « Appeler l'hébergeur »
 * « Appeler l'hébergeur »                   → inchangé (déjà une action)
 * « Tunnel de réservation en 3 étapes »     → inchangé (nom inconnu : on ne devine pas)
 */
export function toActionTitle(raw: string): string {
  const clean = stripFiller(tidy(raw));
  if (!clean) return "";

  const key = fold(clean);
  const firstWord = key.split(/[^a-z0-9]+/).filter(Boolean)[0] ?? "";
  if (ACTION_VERBS.has(firstWord)) return capitalize(clean);

  // Le nom de tête peut être précédé de son déterminant (« La maquette du… ») :
  // on le met de côté pour la reconnaissance seulement.
  const headKey = key.replace(LEADING_DETERMINER, "").trim();
  const rule = NOUN_RULES.find((r) => r.head.test(headKey));
  if (rule) return `${rule.verb} ${withArticle(rule.article, clean)}`;

  // Déterminant déjà présent → un verbe passe-partout ne peut pas se tromper de genre.
  if (LEADING_DETERMINER.test(key)) return `${GENERIC_VERB} ${lowerFirst(clean)}`;

  return capitalize(clean);
}
