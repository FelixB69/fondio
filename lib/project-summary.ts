// Construction du prompt de la synthèse « Où en est mon projet ? ».
//
// On n'emprunte RIEN au registre d'agents : `AGENTS.pm.systemPrompt` embarque
// déjà FORMAT_INSTRUCTIONS (LIVRABLES/CHALLENGES) et PEDAGOGY_INSTRUCTIONS (qui
// impose une section LEXIQUE), et `buildSystemPrompt("pm", …)` y ajoute
// TASKS_INSTRUCTIONS. Ce sont exactement les trois sections qu'on ne veut pas
// ici : la synthèse est un texte, pas un tour de chat. On réécrit donc une
// persona condensée et on ne réutilise que ce qui est réellement réutilisable —
// `buildProjectStateInstruction()` et le dashboard.
import { Task } from "./data";
import { knownTerms } from "./glossary";
import { LLMMessage } from "./llm";
import { buildDashboard } from "./project-dashboard";
import { buildProjectStateInstruction, Project, ProjectSessionRow } from "./projects";

// Une génération par minute et par projet. Déduit de summary.generated_at, déjà
// chargé pour construire le prompt : aucun store dédié.
export const SUMMARY_MIN_INTERVAL_MS = 60_000;

// Borne de stockage, dans le même esprit que la limite de taille des messages
// de chat : un modèle qui part en boucle ne doit pas gonfler le JSONB.
export const SUMMARY_MAX_LENGTH = 4_000;

const PERSONA = `
Tu es Clara, cheffe de projet. Tu accompagnes une personne qui pilote seule un projet informatique et qui ne sait pas coder.
Tu fais le point : où en est le projet, ce qui a bougé, ce qui coince, quoi faire ensuite.
Tu es structurée, réaliste sur le temps, et tu nommes ce qui traîne sans dramatiser.
VOUVOIE SYSTÉMATIQUEMENT la personne (vous, votre, vos — jamais tu, ton, tes).
`.trim();

const GROUNDING = `
RÈGLE ABSOLUE — Tu ne parles QUE de ce qui figure dans les données ci-dessous. Tu n'inventes aucune tâche, aucune date, aucune décision, aucun chiffre qui n'y soit pas. Si une information manque, tu ne la remplaces pas par une supposition : tu n'en parles pas.
`.trim();

const FORMAT = `
FORMAT DE TA RÉPONSE — 4 à 6 phrases, en prose continue, en français.
Couvre dans cet ordre : où en est le projet, ce qui a avancé récemment, ce qui bloque ou traîne, puis les deux ou trois prochaines actions concrètes que vous recommandez.
AUCUN titre, AUCUNE liste à puces, AUCUNE section en majuscules, AUCUN mot suivi de deux-points en début de ligne. Un simple paragraphe suivi.
Ne donne pas de pourcentage brut ni de compte de tâches : formule l'avancement en mots.
`.trim();

// Consigne de vocabulaire : l'inverse de buildKnownTermsInstruction, qui sert à
// ne PAS redéfinir les termes connus. Ici on veut restreindre le lexique aux
// termes déjà expliqués — une synthèse n'est pas le moment d'apprendre un mot.
function buildAllowedTermsInstruction(project: Pick<Project, "glossary">): string {
  const terms = knownTerms(project.glossary ?? []);
  if (terms.length === 0) {
    return "VOCABULAIRE — N'emploie aucun terme technique : cette personne n'en a encore vu aucun expliqué. Dis les choses avec des mots de tous les jours.";
  }
  return `VOCABULAIRE — Les seuls termes techniques autorisés sont ceux qui ont déjà été expliqués à cette personne : ${terms.join(", ")}. Emploie-les normalement, sans les redéfinir. Tout autre terme technique est INTERDIT — reformule avec des mots de tous les jours.`;
}

// Ce que l'utilisateur a sous les yeux : mêmes indicateurs, mêmes alertes, même
// flux d'activité que le cockpit. Clara commente donc l'écran affiché, et pas
// une lecture parallèle des données.
function buildDashboardBlock(input: {
  project: Project;
  tasks: Task[];
  sessions: ProjectSessionRow[];
}): string {
  const dash = buildDashboard(input);
  const lines: string[] = ["CE QUE LA PERSONNE VOIT SUR SON TABLEAU DE BORD :"];

  if (dash.kpis.overdue > 0) {
    lines.push(`- ${dash.kpis.overdue} tâche(s) en retard sur leur échéance.`);
  }
  if (dash.kpis.week > 0) {
    lines.push(`- ${dash.kpis.week} échéance(s) dans les 7 prochains jours.`);
  }
  if (dash.kpis.deliverables > 0) {
    lines.push(`- ${dash.kpis.deliverables} livrable(s) déjà produit(s) au fil des échanges.`);
  }

  if (dash.alerts.length > 0) {
    lines.push("- Points de vigilance détectés automatiquement :");
    for (const a of dash.alerts) lines.push(`  • ${a.message}`);
  }

  if (dash.upcoming.length > 0) {
    lines.push("- Prochaines échéances :");
    for (const t of dash.upcoming) lines.push(`  • ${t.content} (pour le ${t.due_date})`);
  }

  if (dash.activity.length > 0) {
    lines.push("- Activité récente, de la plus récente à la plus ancienne :");
    for (const a of dash.activity) lines.push(`  • ${a.label} — ${a.detail}`);
  }

  return lines.join("\n");
}

export function buildProjectSummaryPrompt(input: {
  project: Project;
  tasks: Task[];
  sessions: ProjectSessionRow[];
}): LLMMessage[] {
  const { project, tasks, sessions } = input;

  const system = [
    PERSONA,
    GROUNDING,
    buildProjectStateInstruction({
      name: project.name,
      stage: project.stage,
      tasks: tasks.map((t) => ({ content: t.content, status: t.status })),
    }),
    buildDashboardBlock({ project, tasks, sessions }),
    buildAllowedTermsInstruction(project),
    FORMAT,
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: "Faites le point sur mon projet." },
  ];
}
