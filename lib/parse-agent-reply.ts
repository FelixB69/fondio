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

import { AGENTS, type AgentId } from "@/lib/data";

// Une entrée de lexique : un terme technique et sa définition simple.
export interface LexiconEntry {
  term: string;
  definition: string;
}

export interface ParsedReply {
  content: string;
  deliverables: string[];
  challenges: string[];
  // Actions à faire, émises surtout par le Chef de projet via la section
  // `TÂCHES:`. Alimentent le board (statut todo) côté serveur.
  tasks: string[];
  // Termes techniques expliqués via la section `LEXIQUE:`. Alimentent le
  // glossaire persistant du projet.
  lexicon: LexiconEntry[];
  // Mode Accompagné : relais suggéré vers un confrère via la section `ORIENTER:`.
  // null si aucune suggestion (ou prénom non reconnu).
  orient: { agentId: AgentId; reason: string } | null;
}

// Résout le jeton écrit après ORIENTER: (prénom, rôle, ou slug) en AgentId.
// Tolérant : les modèles écrivent « Malik », « Malik, » ou « Architecte ».
function resolveAgentToken(token: string): AgentId | null {
  const t = token.toLowerCase().replace(/[.,;:!?]+$/, "").trim();
  if (!t) return null;
  const ids = Object.keys(AGENTS) as AgentId[];
  for (const id of ids) {
    const a = AGENTS[id];
    if (id.toLowerCase() === t || a.firstName.toLowerCase() === t || a.name.toLowerCase() === t) {
      return id;
    }
  }
  // Repli : le jeton COMMENCE par un prénom connu (« Malik pour l'archi »).
  for (const id of ids) {
    if (t.startsWith(AGENTS[id].firstName.toLowerCase())) return id;
  }
  return null;
}

// Motifs de titres de section. `TÂCHES` peut arriver sans accent ("TACHES").
const LABEL_LIVRABLES = "LIVRABLES";
const LABEL_CHALLENGES = "CHALLENGES";
const LABEL_TACHES = "T[ÂA]CHES";
const LABEL_LEXIQUE = "LEXIQUE";
const LABEL_ORIENTER = "ORIENTER";

// Sépare "terme — définition" (ou "terme : définition", "terme - définition").
// On coupe au PREMIER séparateur suivi d'un espace, pour ne pas casser un terme
// contenant "/" ou "-" (ex. CI/CD). Sans définition, l'entrée est ignorée.
export function parseLexiconItems(items: string[]): LexiconEntry[] {
  const out: LexiconEntry[] = [];
  for (const item of items) {
    const m = item.match(/^(.+?)\s*[—–:-]\s+(.+)$/);
    if (!m) continue;
    // Nettoie les décorations markdown résiduelles (*, **, `) que les modèles
    // cloud ajoutent malgré la consigne.
    const clean = (s: string) => s.replace(/[*`]/g, "").trim();
    const term = clean(m[1]);
    const definition = clean(m[2]);
    if (term && definition) out.push({ term, definition });
  }
  return out;
}

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
  `^${DECO}*(?:(?:${LABEL_LIVRABLES}|${LABEL_CHALLENGES}|${LABEL_TACHES}|${LABEL_LEXIQUE})${DECO}*:?${DECO}*$|${LABEL_ORIENTER}${DECO}*:)`,
  "im",
);

// ORIENTER: <agent> — raison. Contrairement aux autres sections, c'est UNE ligne
// (pas une liste de puces), donc on l'extrait à part. Renvoie aussi le span à
// retirer de la prose affichée.
function extractOrient(
  raw: string,
): { agentId: AgentId; reason: string; start: number; end: number } | null {
  const headingRe = new RegExp(`^${DECO}*${LABEL_ORIENTER}${DECO}*:?[^\\S\\n]*`, "im");
  const m = raw.match(headingRe);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  const afterHeading = start + m[0].length;
  // Charge utile = reste de la ligne du titre.
  const restOfLine = raw.slice(afterHeading);
  const nl = restOfLine.indexOf("\n");
  let payload = (nl === -1 ? restOfLine : restOfLine.slice(0, nl)).trim();
  let end = nl === -1 ? raw.length : afterHeading + nl;
  // Titre seul sur sa ligne → la charge utile est sur la ligne suivante.
  if (!payload) {
    const rest2 = raw.slice(end).replace(/^\n+/, "");
    const consumed = raw.length - rest2.length; // début de rest2 dans raw
    const nl2 = rest2.indexOf("\n");
    payload = stripBulletPrefix(nl2 === -1 ? rest2 : rest2.slice(0, nl2)).trim();
    end = nl2 === -1 ? raw.length : consumed + nl2;
  }
  if (!payload) return null;
  // "<agent> — raison" : on coupe au 1er séparateur suivi d'un espace.
  const sep = payload.match(/^(.+?)\s*[—–:-]\s+(.+)$/);
  const token = (sep ? sep[1] : payload).replace(/[*`]/g, "").trim();
  const reason = (sep ? sep[2] : "").replace(/[*`]/g, "").trim();
  const agentId = resolveAgentToken(token);
  if (!agentId) return null;
  return { agentId, reason, start, end };
}

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
          lexicon: [],
          orient: null,
        };
      }
    } catch {
      // Tombe dans le parsing texte ci-dessous.
    }
  }

  const extractSection = (
    label: string,
    otherLabels: string[],
  ): { items: string[]; start: number; end: number } => {
    const m = raw.match(buildHeadingRegex(label));
    if (!m || m.index === undefined) return { items: [], start: -1, end: -1 };
    const start = m.index;
    const headingEnd = start + m[0].length;
    const after = raw.slice(headingEnd);
    const stopMatch = after.match(buildStopRegex(otherLabels));
    const stopIdx =
      stopMatch && stopMatch.index !== undefined ? stopMatch.index : after.length;
    const block = after.slice(0, stopIdx);
    // On ne garde que la LISTE de puces. Dès qu'une ligne de prose (sans puce)
    // suit les puces, on s'arrête : sinon le texte que le modèle écrit parfois
    // APRÈS la liste (violation du format) devenait de faux livrables — et
    // devait rester dans la prose, pas dans la section.
    const items: string[] = [];
    let sawBullet = false;
    let offset = 0; // position courante dans `block`
    let listEndOffset = 0; // fin (dans `block`) de la dernière puce retenue
    for (const line of block.split("\n")) {
      const nextOffset = offset + line.length + 1; // +1 pour le \n retiré par split
      const isBullet = /^\s*(?:[-*•‣–]|\d+[.)])\s+/.test(line);
      const cleaned = stripBulletPrefix(line);
      offset = nextOffset;
      // Ligne vide ou pure décoration markdown ("**", "---") : on ignore.
      if (!cleaned || !/[A-Za-zÀ-ÿ0-9]/.test(cleaned)) continue;
      // Prose après les puces → fin de la section structurée.
      if (sawBullet && !isBullet) break;
      if (isBullet) sawBullet = true;
      items.push(cleaned);
      listEndOffset = nextOffset;
    }
    // Fin du bloc à retirer du texte affiché = titre + liste de puces seulement
    // (la prose éventuelle avant/après reste du contenu, où qu'elle soit placée).
    const end = headingEnd + Math.min(listEndOffset, stopIdx);
    return { items, start, end };
  };

  const liv = extractSection(LABEL_LIVRABLES, [LABEL_CHALLENGES, LABEL_TACHES, LABEL_LEXIQUE, LABEL_ORIENTER]);
  const cha = extractSection(LABEL_CHALLENGES, [LABEL_LIVRABLES, LABEL_TACHES, LABEL_LEXIQUE, LABEL_ORIENTER]);
  const tac = extractSection(LABEL_TACHES, [LABEL_LIVRABLES, LABEL_CHALLENGES, LABEL_LEXIQUE, LABEL_ORIENTER]);
  const lex = extractSection(LABEL_LEXIQUE, [LABEL_LIVRABLES, LABEL_CHALLENGES, LABEL_TACHES, LABEL_ORIENTER]);
  const orient = extractOrient(raw);

  // On retire chaque bloc de section du texte affiché, où qu'il soit placé
  // (certains modèles mettent LEXIQUE en TÊTE). Le contenu = la prose restante.
  const spans = [liv, cha, tac, lex, orient ? { start: orient.start, end: orient.end } : null]
    .filter((s): s is { start: number; end: number } => !!s && s.start >= 0)
    .sort((a, b) => a.start - b.start);
  let content = "";
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) content += raw.slice(cursor, s.start);
    cursor = Math.max(cursor, s.end);
  }
  content += raw.slice(cursor);
  content = content.replace(/\n{3,}/g, "\n\n").trim();

  return {
    // Fallback vers le brut UNIQUEMENT si aucune section n'a été détectée.
    content: content || (spans.length ? content : raw.trim()),
    deliverables: liv.items,
    challenges: cha.items,
    tasks: tac.items,
    lexicon: parseLexiconItems(lex.items),
    orient: orient ? { agentId: orient.agentId, reason: orient.reason } : null,
  };
}
