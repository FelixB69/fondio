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
}

// Caractères de décoration markdown autorisés autour d'un titre de section.
// `-` en dernier pour rester littéral dans la classe.
const DECO = String.raw`[\s>#*_~\x60-]`;

function buildHeadingRegex(label: string): RegExp {
  return new RegExp(`^${DECO}*${label}${DECO}*:?${DECO}*$`, "im");
}

function buildStopRegex(otherLabel: string): RegExp {
  return new RegExp(`\\n${DECO}*${otherLabel}`, "i");
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
        };
      }
    } catch {
      // Tombe dans le parsing texte ci-dessous.
    }
  }

  const extractSection = (
    label: string,
    otherLabel: string,
  ): { items: string[]; start: number } => {
    const m = raw.match(buildHeadingRegex(label));
    if (!m || m.index === undefined) return { items: [], start: -1 };
    const start = m.index;
    const after = raw.slice(start + m[0].length);
    const stopMatch = after.match(buildStopRegex(otherLabel));
    const stopIdx =
      stopMatch && stopMatch.index !== undefined ? stopMatch.index : after.length;
    const block = after.slice(0, stopIdx);
    const items = block
      .split("\n")
      .map(stripBulletPrefix)
      // On filtre aussi les lignes qui sont juste des décorations markdown
      // résiduelles (ex. "**", "---").
      .filter((line) => line.length > 0 && /[A-Za-zÀ-ÿ0-9]/.test(line));
    return { items, start };
  };

  const liv = extractSection("LIVRABLES", "CHALLENGES");
  const cha = extractSection("CHALLENGES", "LIVRABLES");

  const cuts = [liv.start, cha.start].filter((n) => n >= 0);
  const cutAt = cuts.length > 0 ? Math.min(...cuts) : raw.length;
  const content = raw.slice(0, cutAt).trim();

  return {
    content: content || raw.trim(),
    deliverables: liv.items,
    challenges: cha.items,
  };
}
