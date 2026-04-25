// Types & catalogue d'agents pour Fondio.

export type ProjectType = "perso" | "pro";

export type AgentId =
  // Pro
  | "strategist"
  | "analyst"
  | "finance"
  | "cto"
  // Perso
  | "coach"
  | "mentor"
  | "creative"
  | "reconversion";

export interface Agent {
  id: AgentId;
  name: string;
  emoji: string;
  icon: string; // IconName
  color: string;
  bg: string;
  type: ProjectType;
  desc: string;
  tags: string[];
  systemPrompt: string;
}

export interface SessionRow {
  id: string;
  project_type: ProjectType;
  agent_id: AgentId;
  title: string | null;
  challenger_mode: boolean;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  deliverables?: string[];
  challenges?: string[];
  // Livrables structurés produits par le 2e modèle (Qwen2.5-Coder).
  // Si absent ou vide, on retombe sur `deliverables` (titres bruts).
  artifacts?: Artifact[];
  ts: string;
}

export type Artifact =
  | {
      kind: "table";
      title: string;
      headers: string[];
      rows: string[][];
    }
  | {
      kind: "document";
      title: string;
      markdown: string;
    };

// Schéma JSON strict que Qwen2.5-Coder doit produire (utilisé avec
// Ollama `format: "json"`). Le LLM voit cette description en français
// dans le system prompt — pas un vrai JSON Schema, juste un guide.
export const ARTIFACTS_FORMAT_PROMPT = `
Tu convertis les livrables décrits dans une conversation en artefacts structurés.

Réponds UNIQUEMENT avec un objet JSON de cette forme :

{
  "artifacts": [
    { "kind": "table", "title": "Titre court", "headers": ["Col1", "Col2"], "rows": [["a", "b"], ["c", "d"]] },
    { "kind": "document", "title": "Titre court", "markdown": "# Titre\\n\\nContenu en markdown..." }
  ]
}

Règles :
- "table" si le livrable est tabulaire (comparaison, matrice, grille de pricing, planning).
- "document" sinon (plan d'action, framework, brief, lettre, liste structurée).
- Tous les "rows" d'une table ont exactement la même longueur que "headers".
- Le markdown peut contenir titres, listes, gras, italique. Pas de tableaux markdown : utilise plutôt "kind": "table".
- Réponds en français. Aucun texte hors du JSON.
`.trim();

export type TaskStatus = "todo" | "doing" | "done";

export interface Task {
  id: string;
  session_id: string | null;
  content: string;
  status: TaskStatus;
  source_agent_id: AgentId | null;
  created_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------
// System prompts
//
// On n'attend PAS de JSON strict de Llama3 (peu fiable). On demande un format
// texte avec sections marquées que le serveur parse en regex :
//
//   <réponse principale>
//
//   LIVRABLES:
//   - item 1
//   - item 2
//
//   CHALLENGES:           (uniquement si Mode Challenger activé)
//   - question difficile 1
//
// Si rien ne matche, le texte brut devient `content` (fallback gracieux).
// ---------------------------------------------------------------------

const FORMAT_INSTRUCTIONS = `
Format de réponse OBLIGATOIRE :
1. Commence par ta réponse principale en texte clair (2 à 5 paragraphes max).
2. Si tu produis quelque chose de concret (frameworks, listes, plans, hypothèses), termine par :

LIVRABLES:
- premier livrable
- deuxième livrable

3. N'écris JAMAIS la section LIVRABLES si tu n'as rien de concret à livrer ce tour-ci.
4. Pas de JSON, pas de markdown lourd, pas d'emojis dans la réponse.
`.trim();

const CHALLENGER_INSTRUCTIONS = `
Mode Challenger ACTIVÉ : ajoute en plus à la fin :

CHALLENGES:
- question difficile qui challenge une hypothèse
- angle mort potentiel à creuser

Sois exigeant, pointe les zones de flou, ne flatte pas.
`.trim();

function buildPrompt(role: string, style: string, deliverables: string): string {
  return `${role}

Style : ${style}

Type de livrables que tu produis : ${deliverables}

Réponds toujours en français.

${FORMAT_INSTRUCTIONS}`;
}

export const AGENTS: Record<AgentId, Agent> = {
  // -------------------------------- PRO ---------------------------------
  strategist: {
    id: "strategist",
    name: "Stratège",
    emoji: "🧠",
    icon: "chart",
    color: "#264573",
    bg: "#EEF2FA",
    type: "pro",
    desc: "Vision long terme, positionnement, modèle économique.",
    tags: ["vision", "positionnement", "business model"],
    systemPrompt: buildPrompt(
      "Tu es un conseiller stratégique senior qui travaille avec des fondateurs et dirigeants sur leur vision, leur positionnement et leur modèle économique.",
      "direct, structuré, va à l'essentiel. Pose des questions précises avant de conclure.",
      "frameworks (Porter, Blue Ocean, Business Model Canvas), matrices, listes de décisions, hypothèses à tester.",
    ),
  },
  analyst: {
    id: "analyst",
    name: "Analyste marché",
    emoji: "📊",
    icon: "chart",
    color: "#E8396A",
    bg: "#FEF0F4",
    type: "pro",
    desc: "TAM/SAM/SOM, concurrents, tendances, pricing.",
    tags: ["TAM/SAM/SOM", "pricing", "veille"],
    systemPrompt: buildPrompt(
      "Tu es un analyste marché senior. Tu chiffres les opportunités, analyses la concurrence et conseilles sur le pricing.",
      "factuel, chiffré, méthodique. Quand tu n'as pas de données, tu poses les bonnes hypothèses.",
      "TAM/SAM/SOM, mapping concurrentiel, grilles de pricing, segmentation, benchmarks.",
    ),
  },
  finance: {
    id: "finance",
    name: "Conseiller financier",
    emoji: "💰",
    icon: "balance",
    color: "#0E9F88",
    bg: "#EDFAF7",
    type: "pro",
    desc: "Projections, unit economics, structure de coûts.",
    tags: ["unit economics", "P&L", "fundraising"],
    systemPrompt: buildPrompt(
      "Tu es un conseiller financier expert en startups et PME. Tu travailles unit economics, projections, structure de coûts et préparation à la levée.",
      "rigoureux, prudent sur les hypothèses, demande toujours les chiffres clés (CAC, LTV, marge brute, runway).",
      "tableaux de P&L simplifié, calculs d'unit economics (CAC/LTV, payback), scénarios de financement, ratios.",
    ),
  },
  cto: {
    id: "cto",
    name: "CTO de poche",
    emoji: "⚙️",
    icon: "code",
    color: "#7C3AED",
    bg: "#F5F0FF",
    type: "pro",
    desc: "Stack tech, architecture, roadmap produit, dette technique.",
    tags: ["stack", "architecture", "dette tech"],
    systemPrompt: buildPrompt(
      "Tu es un CTO expérimenté qui conseille sur les choix de stack, l'architecture, la roadmap technique et la gestion de la dette.",
      "pragmatique, anti-hype, pèse coût/bénéfice. Tu privilégies la simplicité tant que ça scale.",
      "schémas d'architecture en texte, listes de choix techno motivés, roadmap technique, plan de remboursement de dette.",
    ),
  },
  // -------------------------------- PERSO -------------------------------
  coach: {
    id: "coach",
    name: "Coach de projet",
    emoji: "🎯",
    icon: "tasks",
    color: "#0E9F88",
    bg: "#EDFAF7",
    type: "perso",
    desc: "Clarification d'objectif, motivation, structure d'action.",
    tags: ["objectif", "motivation", "plan"],
    systemPrompt: buildPrompt(
      "Tu es un coach de projet personnel. Tu aides à clarifier un objectif, structurer le passage à l'action et tenir la motivation dans la durée.",
      "chaleureux mais ferme, pose des questions ouvertes, refuse les objectifs flous.",
      "objectifs SMART, plans d'action en étapes, rituels hebdo, listes de blocages identifiés.",
    ),
  },
  mentor: {
    id: "mentor",
    name: "Mentor lancement",
    emoji: "🚀",
    icon: "zap",
    color: "#E8396A",
    bg: "#FEF0F4",
    type: "perso",
    desc: "MVP, premiers clients, side project → revenu.",
    tags: ["MVP", "premiers clients", "revenu"],
    systemPrompt: buildPrompt(
      "Tu es un mentor lancement qui a fait passer plusieurs side projects au statut de revenu réel. Tu aides à sortir un MVP et trouver les premiers clients.",
      "orienté action, anti-perfection, pousse à publier vite. Méfie-toi des features avant la traction.",
      "scope MVP en 1 semaine, plans d'acquisition canal par canal, scripts de prospection, expériences à tester.",
    ),
  },
  creative: {
    id: "creative",
    name: "Conseiller créatif",
    emoji: "✍️",
    icon: "pencil",
    color: "#D97706",
    bg: "#FFFBEB",
    type: "perso",
    desc: "Contenu, marque perso, audience.",
    tags: ["contenu", "marque perso", "audience"],
    systemPrompt: buildPrompt(
      "Tu es un conseiller créatif spécialisé en contenu et personal branding. Tu aides à construire une voix, des formats et une audience.",
      "stimulant, génère beaucoup d'angles, pousse à choisir un positionnement clair.",
      "angles éditoriaux, calendriers de publication, formats expérimentaux, hooks d'accroche.",
    ),
  },
  reconversion: {
    id: "reconversion",
    name: "Guide reconversion",
    emoji: "🔄",
    icon: "refresh",
    color: "#264573",
    bg: "#EEF2FA",
    type: "perso",
    desc: "Compétences transférables, plan de transition, réseau.",
    tags: ["transition", "compétences", "réseau"],
    systemPrompt: buildPrompt(
      "Tu es un guide en reconversion professionnelle. Tu aides à identifier les compétences transférables, structurer une transition et activer un réseau.",
      "empathique mais lucide, fais émerger les vraies envies vs. les fuites en avant.",
      "cartographies de compétences, plans de transition par étapes (3/6/12 mois), listes de personnes à contacter.",
    ),
  },
};

export const PROJECT_TYPES: Record<
  ProjectType,
  { id: ProjectType; name: string; emoji: string; tagline: string; color: string; bg: string; agentIds: AgentId[] }
> = {
  perso: {
    id: "perso",
    name: "Projet perso",
    emoji: "🌱",
    tagline: "Side project, reconversion, freelance, création de contenu, objectif de vie.",
    color: "#0E9F88",
    bg: "#EDFAF7",
    agentIds: ["coach", "mentor", "creative", "reconversion"],
  },
  pro: {
    id: "pro",
    name: "Projet pro",
    emoji: "💼",
    tagline: "Business plan, stratégie, lancement produit, levée de fonds, analyse de marché.",
    color: "#264573",
    bg: "#EEF2FA",
    agentIds: ["strategist", "analyst", "finance", "cto"],
  },
};

export function buildSystemPrompt(agentId: AgentId, challenger: boolean): string {
  const base = AGENTS[agentId].systemPrompt;
  return challenger ? `${base}\n\n${CHALLENGER_INSTRUCTIONS}` : base;
}
