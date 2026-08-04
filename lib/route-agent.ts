import { AgentId } from "./data";

// Routeur d'entrée « décris ton besoin » : à partir de la description libre
// saisie par un porteur non-technique, on choisit l'expert qui prend la parole
// en premier. Volontairement LOCAL et déterministe (pas d'appel LLM) : le
// chemin d'ouverture de session ne doit pas bloquer sur un modèle, et un
// mauvais choix est sans coût — la section ORIENTER passe la main au bon
// confrère en cours de conversation.
//
// Clara (pm) est le défaut : une description de projet réelle appelle d'abord un
// cadrage. On ne bascule vers un spécialiste que sur un signal clair.

// Un signal est soit un fragment (comparé en `includes`), soit une expression
// régulière quand le fragment ne suffit pas (mots intercalés, variantes).
type Signal = string | RegExp;

// Signaux par expert, du plus spécifique au plus général. Les termes sont en
// minuscules sans accent (la description est normalisée avant comparaison) et
// pensés « langage porteur », pas jargon.
const SIGNALS: Record<Exclude<AgentId, "pm">, Signal[]> = {
  // Sam — question frontale de compréhension / apprentissage.
  teacher: [
    "c'est quoi",
    "c est quoi",
    "qu'est-ce que",
    "qu est ce que",
    "comment marche",
    "comment fonctionne",
    "comment ca marche",
    "expliqu",
    "je ne comprends pas",
    "je comprends pas",
    "difference entre",
    "ca veut dire",
    "definition",
    "vulgaris",
    "c'est quoi la difference",
  ],
  // Rui — quelque chose ne va pas / vérifier que ça marche.
  quality: [
    "bug",
    "plante",
    "ca marche pas",
    "marche pas",
    "ne marche pas",
    "ne fonctionne pas",
    "fonctionne pas",
    "erreur",
    "message d'erreur",
    "tester",
    "les tests",
    "recette",
    "corriger",
    "debug",
    "debugg",
    "ca bug",
  ],
  // Nadia — mise en ligne / exploitation. NB : pas de « en ligne » nu, trop
  // large (« vendre en ligne », « cours en ligne » ne relèvent pas du
  // déploiement). Le « en ligne » de déploiement est capté via un verbe de
  // publication, avec un nom éventuel intercalé (« mettre mon site en ligne »).
  devops: [
    /(mettre|mets|met|publier|publie|mise|heberger|avoir|lancer).{0,20}en ligne/,
    "mise en ligne",
    "deploy",
    "deploie",
    "heberg",
    "nom de domaine",
    "mise en prod",
    "en production",
    "monitoring",
    "sauvegarde",
    "serveur",
    "https",
  ],
  // Malik — choix de techno / structure technique.
  architect: [
    "quelle techno",
    "quelles techno",
    "quel langage",
    "quel framework",
    "quelle stack",
    "choisir la techno",
    "choisir une techno",
    "architecture",
    "base de donnees",
    "quelle base de donnees",
    "no-code",
    "no code",
    "quel outil pour",
  ],
  // Milo — envie de VOIR plutôt que de lire. Signaux volontairement étroits :
  // « maquette », « prototype » et les tournures « à quoi ça ressemble » ne
  // recouvrent aucun autre expert.
  prototyper: [
    "maquette",
    "prototype",
    "wireframe",
    "a quoi ca ressemble",
    "a quoi ressemble",
    "a quoi ca ressemblerait",
    "voir a quoi",
    "un apercu visuel",
    "un rendu visuel",
    "un exemple visuel",
    /(voir|montre|montrer|montrez|visualiser).{0,25}(ecran|interface|rendu|design|page d'accueil)/,
  ],
  // Jade — fonctionnalités / parcours / périmètre produit.
  product: [
    "fonctionnalites",
    "fonctionnalite",
    "parcours utilisateur",
    "parcours client",
    "mvp",
    "premiere version",
    "quelles fonctions",
    "prioriser les fonction",
    "experience utilisateur",
    "quelles pages",
  ],
};

// Ordre de priorité : on retient le PREMIER expert dont un signal apparaît
// (« l'intention la plus spécifique gagne »). La question de compréhension prime
// (elle bloque tout le reste tant qu'elle n'est pas levée), puis le concret
// (bug, mise en ligne), puis le cadrage technique, puis produit. Faute de
// signal, Clara (pm) prend le cadrage.
const PRIORITY: Exclude<AgentId, "pm">[] = [
  "teacher",
  "prototyper",
  "quality",
  "devops",
  "architect",
  "product",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // retire les accents (diacritiques combinants)
}

/**
 * Choisit l'expert qui ouvre la session à partir d'une description libre.
 * Retourne toujours un agent : `pm` (Clara) par défaut, faute de signal clair.
 */
export function pickEntryAgent(description: string): AgentId {
  const text = normalize(description);
  if (!text.trim()) return "pm";

  for (const agent of PRIORITY) {
    const matched = SIGNALS[agent].some((signal) =>
      typeof signal === "string" ? text.includes(signal) : signal.test(text),
    );
    if (matched) return agent;
  }

  return "pm";
}
