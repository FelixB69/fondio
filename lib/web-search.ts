// Recherche web — permet d'ancrer les réponses des agents dans des infos réelles
// et fraîches, au lieu de la mémoire figée du modèle.
//
// On utilise Tavily (https://tavily.com) : une API de recherche pensée pour les
// LLM. Sa particularité : elle renvoie directement le CONTENU texte des pages
// (déjà nettoyé), pas seulement des liens. Pas besoin d'aller scraper les pages
// nous-mêmes.

// La clé secrète qui nous identifie auprès de Tavily. Elle vit dans .env, jamais
// dans le code (sinon elle finirait sur GitHub). `process.env` lit ce fichier.
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_URL = "https://api.tavily.com/search";

// Un résultat web = une page trouvée.
export interface WebResult {
  title: string;
  url: string;
  // Extrait pertinent de la page, déjà nettoyé par Tavily (c'est ça qu'on
  // donnera à lire au modèle).
  content: string;
  // Score de pertinence estimé par Tavily, entre 0 et 1.
  score: number;
}

// Ce que notre fonction renvoie : la question posée + un résumé optionnel + la
// liste des pages.
export interface WebSearchResult {
  query: string;
  // Tavily peut générer un mini-résumé de la réponse. Pratique, mais on
  // s'appuiera surtout sur `results`.
  answer: string | null;
  results: WebResult[];
}

// La fonction principale : on lui donne une question (texte), elle va chercher
// sur le web et renvoie les résultats. C'est une fonction `async` car parler à
// un service distant prend du temps : `await` veut dire "attends la réponse
// avant de continuer".
export async function searchWeb(
  query: string,
  opts?: { maxResults?: number; depth?: "basic" | "advanced" },
): Promise<WebSearchResult> {
  // Si la clé n'est pas configurée, on s'arrête avec un message clair plutôt que
  // de partir dans une erreur réseau incompréhensible.
  if (!TAVILY_API_KEY) {
    throw new Error(
      "TAVILY_API_KEY manquante. Crée un compte gratuit sur tavily.com et ajoute la clé dans .env.",
    );
  }

  // `fetch` = la commande qui envoie une requête HTTP (= parler à une API par
  // internet). On envoie une requête POST (= "voici des données, traite-les")
  // avec notre question dans le corps (`body`), au format JSON.
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // On prouve notre identité avec la clé, dans l'en-tête Authorization.
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      // Combien de pages on veut ramener (3 par défaut : moins de texte à lire
      // pour le modèle = réponse plus rapide).
      max_results: opts?.maxResults ?? 3,
      // "basic" = rapide et suffisant ; "advanced" = plus fouillé mais plus lent.
      search_depth: opts?.depth ?? "basic",
      // On demande à Tavily de générer un petit résumé en plus.
      include_answer: true,
    }),
  });

  // Si Tavily renvoie une erreur (mauvaise clé, quota dépassé...), on la remonte.
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily ${res.status}: ${text.slice(0, 200)}`);
  }

  // La réponse arrive en JSON (du texte structuré). On la transforme en objet
  // JavaScript utilisable.
  const json = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };

  // On range proprement les résultats dans notre format `WebSearchResult`.
  // Les `?? ""` / `?? 0` sont des filets de sécurité : si un champ manque, on
  // met une valeur par défaut au lieu de planter.
  return {
    query,
    answer: json.answer ?? null,
    results: (json.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
      score: r.score ?? 0,
    })),
  };
}

// Met en forme les résultats web en un bloc de texte qu'on "colle" dans le
// prompt du modèle. On numérote les sources [1], [2]... pour que l'agent puisse
// y faire référence, et on rappelle la date du jour (le modèle, lui, a une
// connaissance figée dans le passé — il faut lui dire qu'on est aujourd'hui).
export function formatWebResultsForPrompt(search: WebSearchResult): string {
  if (search.results.length === 0) return "";

  const today = new Date().toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const blocks = search.results
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.content}`)
    .join("\n\n");

  return `\n\nInformations trouvées sur le web (recherche effectuée le ${today}). Appuie-toi dessus quand c'est pertinent. Quand tu utilises une de ces sources, cite-la avec son numéro entre crochets, par exemple [1] ou [2]. Si ces résultats ne concernent pas la question posée, ignore-les complètement.\n\n${blocks}`;
}
