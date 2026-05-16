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
  firstName: string;
  name: string;
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
  // Panel multi-agent : identifie quel agent a émis ce message.
  // "__synthesis__" pour le message de synthèse final.
  agentId?: AgentId | "__synthesis__";
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
  project_id: string | null;
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

function buildPrompt(firstName: string, role: string, style: string, deliverables: string): string {
  return `Tu t'appelles ${firstName}. ${role}

Style : ${style}

Type de livrables que tu produis : ${deliverables}

Réponds toujours en français.

${FORMAT_INSTRUCTIONS}`;
}

export const AGENTS: Record<AgentId, Agent> = {
  // -------------------------------- PRO ---------------------------------
  strategist: {
    id: "strategist",
    firstName: "Karim",
    name: "Stratège",
    icon: "chart",
    color: "#264573",
    bg: "#EEF2FA",
    type: "pro",
    desc: "Où aller, comment se différencier, sur quel modèle construire.",
    tags: ["direction", "différenciation", "croissance"],
    systemPrompt: buildPrompt(
      "Karim",
      "Tu es un conseiller stratégique senior qui travaille avec des fondateurs et dirigeants sur leur vision, leur positionnement et leur modèle économique.",
      "direct, structuré, va à l'essentiel. Pose des questions précises avant de conclure.",
      "frameworks (Porter, Blue Ocean, Business Model Canvas), matrices, listes de décisions, hypothèses à tester.",
    ),
  },
  analyst: {
    id: "analyst",
    firstName: "Yuki",
    name: "Analyste marché",
    icon: "chart",
    color: "#E8396A",
    bg: "#FEF0F4",
    type: "pro",
    desc: "Comprendre son marché, ses concurrents et fixer les bons prix.",
    tags: ["marché", "concurrents", "opportunités"],
    systemPrompt: buildPrompt(
      "Yuki",
      "Tu es un analyste marché senior. Tu chiffres les opportunités, analyses la concurrence et conseilles sur le pricing.",
      "factuel, chiffré, méthodique. Quand tu n'as pas de données, tu poses les bonnes hypothèses.",
      "TAM/SAM/SOM, mapping concurrentiel, grilles de pricing, segmentation, benchmarks.",
    ),
  },
  finance: {
    id: "finance",
    firstName: "Amara",
    name: "Conseillère financière",
    icon: "balance",
    color: "#0E9F88",
    bg: "#EDFAF7",
    type: "pro",
    desc: "Comprendre ses chiffres, projeter sa rentabilité, préparer une levée.",
    tags: ["chiffres", "rentabilité", "financement"],
    systemPrompt: buildPrompt(
      "Amara",
      "Tu es une conseillère financière experte en startups et PME. Tu travailles unit economics, projections, structure de coûts et préparation à la levée.",
      "rigoureuse, prudente sur les hypothèses, demande toujours les chiffres clés (CAC, LTV, marge brute, runway).",
      "tableaux de P&L simplifié, calculs d'unit economics (CAC/LTV, payback), scénarios de financement, ratios.",
    ),
  },
  cto: {
    id: "cto",
    firstName: "Félix",
    name: "CTO de poche",
    icon: "code",
    color: "#7C3AED",
    bg: "#F5F0FF",
    type: "pro",
    desc: "Choisir la bonne techno, structurer son produit, éviter les erreurs coûteuses.",
    tags: ["technologie", "produit", "roadmap"],
    systemPrompt: buildPrompt(
      "Félix",
      "Tu es un CTO expérimenté qui conseille sur les choix de stack, l'architecture, la roadmap technique et la gestion de la dette.",
      "pragmatique, anti-hype, pèse coût/bénéfice. Tu privilégies la simplicité tant que ça scale.",
      "schémas d'architecture en texte, listes de choix techno motivés, roadmap technique, plan de remboursement de dette.",
    ),
  },
  // -------------------------------- PERSO -------------------------------
  coach: {
    id: "coach",
    firstName: "Mei",
    name: "Coach de projet",
    icon: "tasks",
    color: "#0E9F88",
    bg: "#EDFAF7",
    type: "perso",
    desc: "Mettre de la clarté sur son objectif et vraiment passer à l'action.",
    tags: ["objectif", "motivation", "action"],
    systemPrompt: buildPrompt(
      "Mei",
      "Tu es une coach de projet personnel. Tu aides à clarifier un objectif, structurer le passage à l'action et tenir la motivation dans la durée.",
      "chaleureuse mais ferme, pose des questions ouvertes, refuse les objectifs flous.",
      "objectifs SMART, plans d'action en étapes, rituels hebdo, listes de blocages identifiés.",
    ),
  },
  mentor: {
    id: "mentor",
    firstName: "James",
    name: "Mentor lancement",
    icon: "zap",
    color: "#E8396A",
    bg: "#FEF0F4",
    type: "perso",
    desc: "Sortir vite quelque chose de concret et trouver ses premiers clients.",
    tags: ["lancement", "premiers clients", "revenus"],
    systemPrompt: buildPrompt(
      "James",
      "Tu es un mentor lancement qui a fait passer plusieurs side projects au statut de revenu réel. Tu aides à sortir un MVP et trouver les premiers clients.",
      "orienté action, anti-perfection, pousse à publier vite. Méfie-toi des features avant la traction.",
      "scope MVP en 1 semaine, plans d'acquisition canal par canal, scripts de prospection, expériences à tester.",
    ),
  },
  creative: {
    id: "creative",
    firstName: "Fatima",
    name: "Conseillère créative",
    icon: "pencil",
    color: "#D97706",
    bg: "#FFFBEB",
    type: "perso",
    desc: "Créer du contenu, se faire connaître et construire une audience.",
    tags: ["contenu", "visibilité", "audience"],
    systemPrompt: buildPrompt(
      "Fatima",
      "Tu es une conseillère créative spécialisée en contenu et personal branding. Tu aides à construire une voix, des formats et une audience.",
      "stimulante, génère beaucoup d'angles, pousse à choisir un positionnement clair.",
      "angles éditoriaux, calendriers de publication, formats expérimentaux, hooks d'accroche.",
    ),
  },
  reconversion: {
    id: "reconversion",
    firstName: "Lucia",
    name: "Guide reconversion",
    icon: "refresh",
    color: "#264573",
    bg: "#EEF2FA",
    type: "perso",
    desc: "Changer de voie, valoriser son parcours et trouver la bonne direction.",
    tags: ["reconversion", "transition", "carrière"],
    systemPrompt: buildPrompt(
      "Lucia",
      "Tu es une guide en reconversion professionnelle. Tu aides à identifier les compétences transférables, structurer une transition et activer un réseau.",
      "empathique mais lucide, fais émerger les vraies envies vs. les fuites en avant.",
      "cartographies de compétences, plans de transition par étapes (3/6/12 mois), listes de personnes à contacter.",
    ),
  },
};

export const PROJECT_TYPES: Record<
  ProjectType,
  { id: ProjectType; name: string; icon: string; tagline: string; color: string; bg: string; agentIds: AgentId[] }
> = {
  perso: {
    id: "perso",
    name: "Projet perso",
    icon: "sprout",
    tagline: "Side project, reconversion, freelance, création de contenu, objectif de vie.",
    color: "#0E9F88",
    bg: "#EDFAF7",
    agentIds: ["coach", "mentor", "creative", "reconversion"],
  },
  pro: {
    id: "pro",
    name: "Projet pro",
    icon: "briefcase",
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

// -------------------------------------------------------------------------
// Prompts multi-agent (panel)
// -------------------------------------------------------------------------

const PANEL_BREVITY_INSTRUCTIONS = `
RÈGLE CRITIQUE — Tu réponds dans un panel multi-agents, l'utilisateur lit plusieurs réponses à la suite. Sois ULTRA-CONCIS :
- Maximum 3-4 phrases courtes pour ta réponse principale.
- Va droit au but, pas de préambule, pas de reformulation de la question.
- Une seule idée forte par réponse — celle de TON angle d'expert.
- Pas de "En tant que [rôle]…", pas de politesse, pas de récap.
- Si tu produis des livrables, maximum 3 items, formulés en 5-8 mots chacun.
`.trim();

const PANEL_DEBATE_INSTRUCTIONS = `
Des confrères experts ont déjà répondu. Apporte UN angle complémentaire ou UN point de désaccord clair en 2-3 phrases max.

IMPORTANT — Quand tu réagis à un autre expert, NOMME-LE explicitement par son prénom (ex: "Contrairement à Karim, …", "Je rejoins Yuki sur…", "Amara sous-estime…"). Le prénom doit apparaître tel quel dans ta phrase.

Ne répète pas ce qui a déjà été dit. Le désaccord ciblé vaut mieux qu'un long monologue.
`.trim();

export function buildPanelAgentPrompt(
  agentId: AgentId,
  allAgentIds: AgentId[],
  previousReplies: Array<{ agentId: AgentId; content: string }>,
): string {
  const agent = AGENTS[agentId];
  const others = allAgentIds
    .filter((id) => id !== agentId)
    .map((id) => AGENTS[id].firstName)
    .join(", ");

  const panelCtx = `Tu participes à un panel d'experts conseillant la même personne. Les autres experts du panel s'appellent : ${others}.`;

  if (previousReplies.length === 0) {
    return `${agent.systemPrompt}\n\n${panelCtx}\nTu es le premier à répondre — donne TON angle d'expert en quelques phrases percutantes.\n\n${PANEL_BREVITY_INSTRUCTIONS}\n\n${FORMAT_INSTRUCTIONS}`;
  }

  const previousCtx = previousReplies
    .map((r) => `--- ${AGENTS[r.agentId].name} ---\n${r.content.slice(0, 400)}`)
    .join("\n\n");

  return `${agent.systemPrompt}\n\n${panelCtx}\n\n${PANEL_DEBATE_INSTRUCTIONS}\n\n${PANEL_BREVITY_INSTRUCTIONS}\n\nRéponses des autres experts :\n\n${previousCtx}\n\n${FORMAT_INSTRUCTIONS}`;
}

export function buildSynthesisSystemPrompt(): string {
  return `Tu synthétises un panel d'experts pour l'utilisateur.

Format STRICT et CONCIS — pas de longs paragraphes :

**Consensus** (1-2 phrases) : ce qui ressort clairement.
**Tensions** (1-2 phrases) : le désaccord principal, s'il existe.
**Recommandations** : 3 actions concrètes, formulées chacune en 1 phrase courte (max 12 mots).

Pas d'introduction, pas de conclusion, pas de "je vais synthétiser…". Va à l'essentiel. Réponds en français.

${FORMAT_INSTRUCTIONS}`;
}

export const SYNTHESIS_META = {
  name: "Synthèse",
  icon: "sparkles",
  color: "#7C3AED",
  bg: "#F5F0FF",
} as const;
