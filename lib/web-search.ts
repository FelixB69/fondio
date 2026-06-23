// Recherche web — permet d'ancrer les réponses des agents dans des infos réelles
// et fraîches, au lieu de la mémoire figée du modèle.
//
// On utilise Tavily (https://tavily.com) : une API de recherche pensée pour les
// LLM. Sa particularité : elle renvoie directement le CONTENU texte des pages
// (déjà nettoyé), pas seulement des liens. Pas besoin d'aller scraper les pages
// nous-mêmes.

import {
  callChatModel,
  callModelWithTools,
  type ToolDef,
  type ToolLoopMessage,
} from "./llm";
import type { ChatMessage } from "./data";

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
      "TAVILY_API_KEY manquante. Créez un compte gratuit sur tavily.com et ajoutez la clé dans .env.",
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

// ─────────────────────────────────────────────────────────────────────────────
// Recherche web "intelligente", partagée par /api/chat ET /api/panel-chat.
//
// Avant, cette logique vivait en double dans les routes. On la centralise ici
// (même esprit que lib/artifacts.ts). Deux étapes :
//   1. TOOL-CALLING : on donne l'outil web_search au modèle, il décide quoi
//      chercher (et peut creuser). C'est la voie privilégiée.
//   2. FALLBACK : si l'étape 1 n'a ramené aucune source (modèle sans support
//      des outils, plantage…), on demande au modèle une requête et on cherche.
// Une recherche infructueuse ne casse jamais le chat : on renvoie un contexte
// vide, l'agent répond sans web.
// ─────────────────────────────────────────────────────────────────────────────

export interface WebContext {
  webContext: string; // bloc texte à coller dans le prompt (ou "")
  sources: { title: string; url: string }[]; // ordre = citations [1], [2]…
}

const EMPTY_WEB_CONTEXT: WebContext = { webContext: "", sources: [] };

// Définition de l'outil exposé au modèle pour le tool-calling.
const WEB_SEARCH_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Recherche des informations récentes et factuelles sur le web (chiffres, prix, concurrents, taille de marché, tendances, actualités). À utiliser dès qu'une donnée vérifiable et à jour manque pour répondre.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "La requête de recherche, formulée comme une recherche Google.",
        },
      },
      required: ["query"],
    },
  },
};

// Point d'entrée unique : tente le tool-calling, puis le fallback si rien.
export async function gatherWebContext(
  conversation: ChatMessage[],
  preferredProvider?: "local" | "cloud",
): Promise<WebContext> {
  // Étape 1 : tool-calling natif.
  try {
    const research = await runWebResearch(conversation, preferredProvider);
    if (research.sources.length > 0) return research;
  } catch (e) {
    console.error("Tool-calling indisponible :", e);
  }

  // Étape 2 : fallback (le modèle formule une requête, on cherche une fois).
  try {
    const query = await decideSearchQuery(conversation, preferredProvider);
    if (query) {
      const search = await searchWeb(query);
      return {
        webContext: formatWebResultsForPrompt(search),
        sources: search.results.map((r) => ({ title: r.title, url: r.url })),
      };
    }
  } catch (e) {
    console.error("Recherche web ignorée :", e);
  }

  return EMPTY_WEB_CONTEXT;
}

// Boucle d'agent en tool-calling : le modèle appelle lui-même web_search.
async function runWebResearch(
  conversation: ChatMessage[],
  preferredProvider?: "local" | "cloud",
): Promise<WebContext> {
  const recent = conversation.slice(-6);
  const messages: ToolLoopMessage[] = [
    {
      role: "system",
      content:
        'Tu es un assistant de recherche. À partir de la conversation, utilise l\'outil web_search autant de fois que nécessaire pour rassembler les infos factuelles utiles (tu peux chercher plusieurs fois pour creuser un sujet). Quand tu as assez d\'infos — ou si aucune recherche n\'est utile (remerciement, small talk, coaching, reformulation) — réponds juste "FINI" sans appeler d\'outil. IMPORTANT : Vouvoie SYSTÉMATIQUEMENT l\'utilisateur dans ta réponse (vous, votre, vos — jamais tu, ton, tes).',
    },
    ...recent.map((m): ToolLoopMessage => ({ role: m.role, content: m.content })),
  ];

  const collected: { title: string; url: string; content: string; score: number }[] = [];
  // 1 seul tour = rapide. Augmenter pour que l'agent enchaîne plusieurs recherches.
  const MAX_STEPS = 1;

  for (let step = 0; step < MAX_STEPS; step++) {
    const { data: turn, providerLabel } = await callModelWithTools(messages, [WEB_SEARCH_TOOL], {
      forceProvider: preferredProvider,
    });
    if (step === 0 && process.env.NODE_ENV !== "production")
      console.log(`[recherche] tool-calling via ${providerLabel}`);
    if (turn.toolCalls.length === 0) break;

    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });

    for (const call of turn.toolCalls) {
      let query = "";
      try {
        query = (JSON.parse(call.arguments) as { query?: string }).query ?? "";
      } catch {
        /* arguments mal formés : on ignore */
      }
      let toolOutput = "Aucun résultat.";
      if (query) {
        if (process.env.NODE_ENV !== "production")
          console.log(`[web_search] étape ${step + 1} → "${query}"`);
        const search = await searchWeb(query);
        for (const r of search.results) {
          collected.push({ title: r.title, url: r.url, content: r.content, score: r.score });
        }
        toolOutput =
          search.results.map((r) => `${r.title} — ${r.url}\n${r.content}`).join("\n\n") ||
          "Aucun résultat.";
      }
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: toolOutput });
    }
  }

  // Dédoublonne les pages par URL.
  const seen = new Set<string>();
  const unique = collected.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));

  const webContext = unique.length
    ? formatWebResultsForPrompt({ query: "", answer: null, results: unique })
    : "";
  return { webContext, sources: unique.map((u) => ({ title: u.title, url: u.url })) };
}

// Décide s'il faut chercher, et formule la requête idéale. null = inutile.
async function decideSearchQuery(
  conversation: ChatMessage[],
  forceProvider?: "local" | "cloud",
): Promise<string | null> {
  const recent = conversation.slice(-6);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content}`)
    .join("\n");

  const system = `Tu décides s'il faut faire une recherche web pour bien répondre au dernier message.
Une recherche est UTILE pour : chiffres, prix, concurrents, taille de marché, tendances, actualités, faits vérifiables et récents.
Une recherche est INUTILE pour : remerciements, "bonjour", small talk, questions d'opinion ou de coaching, reformulations, ou quand l'historique de la conversation suffit déjà.

Réponds UNIQUEMENT en JSON, sans aucun autre texte :
{ "needSearch": true ou false, "query": "la requête web idéale, courte, formulée comme une recherche Google" }
Si needSearch vaut false, mets "query": "".`;

  try {
    const { data: raw } = await callChatModel(
      [
        { role: "system", content: system },
        { role: "user", content: `Conversation :\n${transcript}\n\nDécide maintenant.` },
      ],
      { jsonMode: true, forceProvider },
    );
    const parsed = JSON.parse(raw) as { needSearch?: boolean; query?: string };
    if (parsed.needSearch && typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim();
    }
    return null;
  } catch {
    return null;
  }
}
