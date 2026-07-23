// Parse la réponse texte d'un agent (Mistral local OU API) en :
//   { content, deliverables, challenges }
//
// Robuste aux décorations markdown que les modèles cloud (notamment
// mistral-small-latest) ajoutent autour des titres de section, malgré la
// consigne "pas de markdown lourd" :
//
//   LIVRABLES:        ← cas idéal
//   **LIVRABLES:**    ← Mistral cloud fréquent
//   ## LIVRABLES      ← idem
//   ### Livrables :   ← idem
//
// Si rien ne matche, le texte brut devient `content` (fallback gracieux).

export interface ParsedReply {
  content: string;
  deliverables: string[];
  challenges: string[];
  // Actions à faire, émises surtout par le Chef de projet via la section
  // `TÂCHES:`. Alimentent le board (statut todo) côté serveur.
  tasks: string[];
}

// Motifs de titres de section. `TÂCHES` peut arriver sans accent ("TACHES").
const LABEL_LIVRABLES = "LIVRABLES";
const LABEL_CHALLENGES = "CHALLENGES";
const LABEL_TACHES = "T[ÂA]CHES";

// Caractères de décoration markdown autorisés autour d'un titre de section.
// `-` en dernier pour rester littéral dans la classe.
const DECO = String.raw`[\s>#*_~\x60-]`;

function buildHeadingRegex(label: string): RegExp {
  return new RegExp(`^${DECO}*${label}${DECO}*:?${DECO}*$`, "im");
}

// S'arrête à la 1re ligne qui débute une AUTRE section (peu importe laquelle).
function buildStopRegex(otherLabels: string[]): RegExp {
  return new RegExp(`\\n${DECO}*(?:${otherLabels.join("|")})`, "i");
}

// Repère la 1re ligne qui EST un titre de section (LIVRABLES/CHALLENGES), seule
// sur sa ligne, modulo décorations markdown (`**`, `##`…) — exactement la même
// tolérance que le parseur final. Sert à couper la prose au bon endroit.
const SECTION_HEADING_LINE = new RegExp(
  `^${DECO}*(?:${LABEL_LIVRABLES}|${LABEL_CHALLENGES}|${LABEL_TACHES})${DECO}*:?${DECO}*$`,
  "im",
);

// Renvoie le texte AVANT la 1re section structurée (ou tout le texte si aucune).
// Utilisé pendant le streaming pour n'afficher que la prose : ainsi rien ne
// « disparaît » quand parseAgentReply retire ces sections au message final.
export function stripTrailingSections(text: string): string {
  const m = text.match(SECTION_HEADING_LINE);
  if (!m || m.index === undefined) return text;
  return text.slice(0, m.index).trimEnd();
}

function stripBulletPrefix(line: string): string {
  // Enlève marqueurs de liste : "- ", "* ", "• ", "1. ", "1) ", "> ", "# ", etc.
  return line
    .replace(/^[\s>*_#~\x60-]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

export function parseAgentReply(raw: string): ParsedReply {
  // Tentative JSON d'abord (rare, mais certains modèles le font spontanément).
  const jsonMatch = raw.match(/\{[\s\S]*"message"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.message === "string") {
        return {
          content: parsed.message.trim(),
          deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
          challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        };
      }
    } catch {
      // Tombe dans le parsing texte ci-dessous.
    }
  }

  const extractSection = (
    label: string,
    otherLabels: string[],
  ): { items: string[]; start: number } => {
    const m = raw.match(buildHeadingRegex(label));
    if (!m || m.index === undefined) return { items: [], start: -1 };
    const start = m.index;
    const after = raw.slice(start + m[0].length);
    const stopMatch = after.match(buildStopRegex(otherLabels));
    const stopIdx =
      stopMatch && stopMatch.index !== undefined ? stopMatch.index : after.length;
    const block = after.slice(0, stopIdx);
    // On ne garde que la LISTE de puces. Dès qu'une ligne de prose (sans puce)
    // suit les puces, on s'arrête : sinon le texte que le modèle écrit parfois
    // APRÈS la liste (violation du format) devenait de faux livrables.
    const items: string[] = [];
    let sawBullet = false;
    for (const line of block.split("\n")) {
      const isBullet = /^\s*(?:[-*•‣–]|\d+[.)])\s+/.test(line);
      const cleaned = stripBulletPrefix(line);
      // Ligne vide ou pure décoration markdown ("**", "---") : on ignore.
      if (!cleaned || !/[A-Za-zÀ-ÿ0-9]/.test(cleaned)) continue;
      // Prose après les puces → fin de la section structurée.
      if (sawBullet && !isBullet) break;
      if (isBullet) sawBullet = true;
      items.push(cleaned);
    }
    return { items, start };
  };

  const liv = extractSection(LABEL_LIVRABLES, [LABEL_CHALLENGES, LABEL_TACHES]);
  const cha = extractSection(LABEL_CHALLENGES, [LABEL_LIVRABLES, LABEL_TACHES]);
  const tac = extractSection(LABEL_TACHES, [LABEL_LIVRABLES, LABEL_CHALLENGES]);

  const cuts = [liv.start, cha.start, tac.start].filter((n) => n >= 0);
  const cutAt = cuts.length > 0 ? Math.min(...cuts) : raw.length;
  const content = raw.slice(0, cutAt).trim();

  return {
    content: content || raw.trim(),
    deliverables: liv.items,
    challenges: cha.items,
    tasks: tac.items,
  };
}
