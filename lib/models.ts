// Registre central des modèles IA de Fondio.
//
// SOURCE DE VÉRITÉ UNIQUE pour transformer un id de modèle brut
// (ex. "qwen2.5-coder:7b", "mistral-small-latest") en un nom lisible par un
// humain (ex. "Qwen 2.5 Coder", "Mistral Small").
//
// Ce fichier est PUR : il ne lit aucun process.env et ne fait aucun appel réseau.
// Donc il est importable AUSSI BIEN côté serveur (lib/llm.ts) que côté client
// (composants React) — ce qui évite que chaque endroit réinvente ses propres
// libellés (le bug du pied de page « Llama3 + Qwen2.5-Coder » codé en dur).
//
// Les vraies valeurs d'id viennent toujours de lib/llm.ts (qui lit l'env) ; ici
// on ne fait que les EMBELLIR.

export type ModelProvider = "local" | "cloud" | "byok";

// Chaque modèle a un rôle distinct dans le produit (on n'a pas un seul cerveau) :
//  - "chat"     : la conversation principale avec l'agent.
//  - "artifact" : 2e passe qui transforme les livrables en tableaux/documents.
//  - "tool"     : tool-calling (recherche web) — demande un modèle compatible.
export type ModelRole = "chat" | "artifact" | "tool";

export interface ModelInfo {
  id: string; // id brut envoyé à Ollama / Mistral
  name: string; // nom lisible ("Llama 3", "Mistral Small")
  family: string; // famille ("Llama", "Mistral", "Qwen", "Codestral")
  provider: ModelProvider;
}

export const ROLE_LABELS: Record<ModelRole, string> = {
  chat: "Conversation",
  artifact: "Mise en forme des livrables",
  tool: "Recherche web",
};

// Embellissement par préfixe : on matche le DÉBUT de l'id pour couvrir toutes les
// variantes d'un même modèle (llama3, llama3:8b, llama3.1, llama3.1:70b…) avec une
// seule règle. Le premier préfixe qui matche gagne, donc on range du plus
// spécifique au plus générique.
const PRETTY_RULES: Array<{ prefix: string; name: string; family: string }> = [
  { prefix: "claude-sonnet", name: "Claude Sonnet", family: "Claude" },
  { prefix: "claude-opus", name: "Claude Opus", family: "Claude" },
  { prefix: "claude-haiku", name: "Claude Haiku", family: "Claude" },
  { prefix: "claude", name: "Claude", family: "Claude" },
  { prefix: "gpt-4o-mini", name: "GPT-4o mini", family: "GPT" },
  { prefix: "gpt-4o", name: "GPT-4o", family: "GPT" },
  { prefix: "gpt", name: "GPT", family: "GPT" },
  { prefix: "gemini-2.0-flash", name: "Gemini Flash", family: "Gemini" },
  { prefix: "gemini", name: "Gemini", family: "Gemini" },
  { prefix: "qwen2.5-coder", name: "Qwen 2.5 Coder", family: "Qwen" },
  { prefix: "qwen3", name: "Qwen 3", family: "Qwen" },
  { prefix: "qwen2.5", name: "Qwen 2.5", family: "Qwen" },
  { prefix: "qwen", name: "Qwen", family: "Qwen" },
  { prefix: "llama3.1", name: "Llama 3.1", family: "Llama" },
  { prefix: "llama3.2", name: "Llama 3.2", family: "Llama" },
  { prefix: "llama3.3", name: "Llama 3.3", family: "Llama" },
  { prefix: "llama3", name: "Llama 3", family: "Llama" },
  { prefix: "llama", name: "Llama", family: "Llama" },
  { prefix: "codestral", name: "Codestral", family: "Codestral" },
  { prefix: "mistral-small", name: "Mistral Small", family: "Mistral" },
  { prefix: "mistral-large", name: "Mistral Large", family: "Mistral" },
  { prefix: "mistral-medium", name: "Mistral Medium", family: "Mistral" },
  { prefix: "mistral", name: "Mistral", family: "Mistral" },
  { prefix: "mixtral", name: "Mixtral", family: "Mistral" },
  { prefix: "gemma", name: "Gemma", family: "Gemma" },
  { prefix: "phi", name: "Phi", family: "Phi" },
];

// "llama3.1:70b" -> "Llama 3.1". Si aucun préfixe connu, on renvoie l'id capitalisé
// tel quel (mieux qu'un id brut, et on ne plante jamais sur un modèle inconnu).
export function prettyModelName(id: string): string {
  const lower = id.toLowerCase().trim();
  const rule = PRETTY_RULES.find((r) => lower.startsWith(r.prefix));
  if (rule) return rule.name;
  // Fallback : capitalise le 1er mot avant ":" ou "-".
  const base = lower.split(/[:@]/)[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function modelFamily(id: string): string {
  const lower = id.toLowerCase().trim();
  return PRETTY_RULES.find((r) => lower.startsWith(r.prefix))?.family ?? "Modèle";
}

export function describeModel(id: string, provider: ModelProvider): ModelInfo {
  return { id, name: prettyModelName(id), family: modelFamily(id), provider };
}

// Libellé compact prêt à afficher : "Llama 3 · local" / "Mistral Small · cloud".
export function modelLabel(id: string, provider: ModelProvider): string {
  return `${prettyModelName(id)} · ${provider === "local" ? "local" : "cloud"}`;
}

// Note de confidentialité associée au provider — c'est l'argument clé de Fondio.
export function providerPrivacyNote(provider: ModelProvider): string {
  if (provider === "byok") {
    return "Appel direct à l'API du fournisseur avec votre clé personnelle — facturé par lui, pas par Fondio.";
  }
  return provider === "local"
    ? "Tourne sur votre machine via Ollama. Vos données ne quittent pas votre ordinateur."
    : "Appel à l'API Mistral (serveurs en Europe). Utilisé en secours quand le modèle local est indisponible.";
}

// Forme renvoyée par /api/ollama-status : la config réelle des modèles, pour que
// l'UI affiche EXACTEMENT ce qui tourne (y compris si l'env a été personnalisé),
// au lieu de deviner.
export interface ModelStatus {
  available: boolean; // Ollama local joignable ?
  local: { chat: string; artifact: string; tool: string };
  cloud: { chat: string; artifact: string; configured: boolean };
  // Optionnel : Task 10 remplit ce champ quand /api/ollama-status expose la
  // config BYOK. Optionnel (et pas requis) pour ne pas casser le typecheck
  // des appelants existants qui construisent un ModelStatus sans BYOK.
  byok?: {
    configured: boolean;
    provider: "anthropic" | "openai" | "google" | "mistral_byok" | null;
    label: string | null;
    chatModel: string | null;
  } | null;
}
