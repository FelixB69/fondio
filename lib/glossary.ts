import { LexiconEntry } from "./parse-agent-reply";

// Glossaire persistant d'un projet : les termes techniques déjà expliqués à
// l'utilisateur. Stocké en JSONB sur `projects.glossary`. Une fois un terme
// présent, on demande aux agents de ne PAS le redéfinir (moteur anti-cours).
export interface GlossaryEntry {
  term: string;
  definition: string;
  // Session où le terme a été expliqué la première fois (null si inconnu).
  session_id: string | null;
  ts: string;
}

// Clé de déduplication : insensible à la casse et aux espaces.
function normalize(term: string): string {
  return term.trim().toLowerCase();
}

// Fusionne de nouvelles entrées de lexique dans un glossaire existant. On ne
// duplique jamais (dédup par terme normalisé) et on n'écrase JAMAIS une
// définition déjà connue — le premier qui explique gagne.
export function mergeGlossary(
  existing: GlossaryEntry[],
  additions: LexiconEntry[],
  meta: { session_id: string | null; ts: string },
): GlossaryEntry[] {
  const seen = new Set(existing.map((e) => normalize(e.term)));
  const merged = [...existing];
  for (const add of additions) {
    const key = normalize(add.term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      term: add.term.trim(),
      definition: add.definition.trim(),
      session_id: meta.session_id,
      ts: meta.ts,
    });
  }
  return merged;
}

export function knownTerms(glossary: GlossaryEntry[]): string[] {
  return glossary.map((e) => e.term);
}

// Bloc de prompt listant les termes déjà expliqués, pour que l'agent les
// emploie sans les redéfinir. Chaîne vide si le glossaire est vide (rien à dire).
export function buildKnownTermsInstruction(glossary: GlossaryEntry[]): string {
  const terms = knownTerms(glossary);
  if (terms.length === 0) return "";
  return `TERMES DÉJÀ EXPLIQUÉS à cet utilisateur — emploie-les normalement mais NE LES REDÉFINIS PAS, et ne les remets pas dans la section LEXIQUE : ${terms.join(", ")}.`;
}
