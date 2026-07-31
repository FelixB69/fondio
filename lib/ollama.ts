// Connexion au serveur Ollama — URL + authentification.
//
// Ollama peut tourner à deux endroits :
//   1. En local sur votre machine (http://localhost:11434), sans mot de passe :
//      personne d'autre n'y accède, donc rien à protéger.
//   2. Sur un serveur distant exposé en HTTPS (ex. https://ai.exemple.fr), pour
//      que Fondio déployé sur Vercel puisse l'appeler. Là, l'URL est publique :
//      elle DOIT être protégée, sinon n'importe qui consomme votre GPU.
//
// La protection retenue est le **Basic Auth** : le navigateur (ici, notre code)
// envoie `Authorization: Basic <base64(identifiant:motdepasse)>`. Attention,
// base64 n'est PAS du chiffrement — c'est juste un encodage réversible. Ce qui
// protège réellement le mot de passe, c'est le HTTPS qui chiffre tout l'échange.
// D'où l'avertissement plus bas si on envoie des identifiants en HTTP simple.
//
// Ce module est le SEUL endroit qui sait où joindre Ollama : lib/llm.ts et
// /api/ollama-status passent par lui. Les variables d'environnement sont lues à
// chaque appel (fonctions, pas constantes de module) pour qu'un changement d'env
// soit pris en compte sans redémarrer le process — même choix que
// getMistralApiKey() dans lib/llm.ts.

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

// `OLLAMA_BASE_URL` est le nom historique du projet ; `OLLAMA_URL` est accepté
// en alias (c'est le nom couramment utilisé côté hébergeurs). Le premier gagne.
export function ollamaBaseUrl(): string {
  const raw = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;
  // On retire le slash final : on concatène ensuite "/api/chat", et
  // "https://x.fr//api/chat" fait échouer certains reverse proxies.
  return raw.trim().replace(/\/+$/, "");
}

// Serveur sur la machine de l'utilisateur ? Sert à adapter les messages d'erreur
// ("lancez `ollama serve`" n'a aucun sens pour un serveur distant) et à tolérer
// des identifiants en HTTP sur localhost.
export function isLocalOllama(url: string = ollamaBaseUrl()): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(url);
}

function basicAuthHeader(): string | null {
  const user = process.env.OLLAMA_USER;
  const password = process.env.OLLAMA_PASSWORD;
  // Les deux sont requis : un seul des deux = configuration incomplète, on
  // n'envoie rien plutôt que d'envoyer des identifiants tronqués.
  if (!user || !password) return null;
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

// Averti UNE fois par process : un warn par requête noierait les logs.
let insecureWarned = false;

function warnIfInsecure(url: string): void {
  if (insecureWarned || isLocalOllama(url) || url.startsWith("https://")) return;
  insecureWarned = true;
  console.warn(
    `[ollama] OLLAMA_USER / OLLAMA_PASSWORD sont envoyés en clair vers ${url} ` +
      `(HTTP non chiffré). Passez le serveur en HTTPS.`,
  );
}

// En-têtes à joindre à toute requête Ollama. L'authentification est ajoutée en
// dernier pour qu'un appelant ne puisse pas l'écraser par mégarde.
export function ollamaHeaders(extra?: Record<string, string>): Record<string, string> {
  const auth = basicAuthHeader();
  if (auth) warnIfInsecure(ollamaBaseUrl());
  return { ...extra, ...(auth ? { Authorization: auth } : {}) };
}

// Préfixe des erreurs d'authentification. Distinct de "Ollama injoignable" :
// un 401 n'est pas une panne, c'est une configuration à corriger — on ne veut
// donc pas qu'il soit avalé par un repli silencieux vers le cloud.
export const OLLAMA_AUTH_ERROR = "OLLAMA_AUTH";

// Conseil de dépannage adapté à l'emplacement du serveur.
export function ollamaHint(): string {
  const url = ollamaBaseUrl();
  return isLocalOllama(url)
    ? "Lancez `ollama serve` ou basculez sur Cloud."
    : `Vérifiez que ${url} est joignable (serveur allumé, reverse proxy actif) ou basculez sur Cloud.`;
}

// `fetch` vers Ollama : URL préfixée, en-têtes JSON + authentification, et 401/403
// transformés en erreur explicite. Renvoie la réponse brute pour le reste (le
// streaming a besoin de `res.body`, les appelants gèrent leurs propres statuts).
export async function ollamaFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = ollamaBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: ollamaHeaders({
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `${OLLAMA_AUTH_ERROR}: ${res.status} sur ${base} — identifiants refusés. ` +
        `Vérifiez OLLAMA_USER / OLLAMA_PASSWORD.`,
    );
  }
  return res;
}
