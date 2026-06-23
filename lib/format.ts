// Helpers d'affichage de dates, partagés par la sidebar et la librairie.

// Temps relatif court en français ("Il y a 3 min", "Il y a 2h", "Il y a 4j").
// Au-delà d'une semaine, deux comportements selon l'appelant :
//   - défaut : "Il y a N sem." (sidebar — garde un format relatif compact)
//   - absoluteAfterWeek : date locale "JJ/MM/AAAA" (librairie — repère précis)
export function formatRelative(iso: string, opts?: { absoluteAfterWeek?: boolean }): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "À l'instant";
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `Il y a ${d}j`;
  if (opts?.absoluteAfterWeek) return new Date(iso).toLocaleDateString("fr-FR");
  const w = Math.round(d / 7);
  return `Il y a ${w} sem.`;
}
