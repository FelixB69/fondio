// Rendu markdown → HTML *assaini*. Les réponses des agents (et surtout le
// contenu de recherche web injecté dans leurs prompts) peuvent contenir du HTML
// arbitraire ; `marked` ne nettoie RIEN par défaut. On fait donc passer sa
// sortie par DOMPurify avant tout `dangerouslySetInnerHTML` : sinon un
// `<img onerror>`, un `<script>` ou un href `javascript:` s'exécuterait dans la
// session de l'utilisateur (XSS). `isomorphic-dompurify` fonctionne aussi bien
// au rendu client (navigateur) qu'au SSR (jsdom) — les composants concernés
// sont des client components mais Next les pré-rend côté serveur.
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// `target="_blank"` est légitime pour nos liens (citations, liens markdown) ;
// DOMPurify le retire par défaut, on le ré-autorise explicitement. Les href en
// protocole dangereux (javascript:, data:) restent bloqués par DOMPurify.
const PURIFY_CONFIG = { ADD_ATTR: ["target"] };

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

export function markdownToSafeHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(raw);
}

// Échappe une valeur destinée à un ATTRIBUT HTML (href, title…) construit à la
// main. Empêche de « casser » l'attribut avec un guillemet pour injecter, p.ex.,
// un gestionnaire d'événement. DOMPurify assainit ensuite le tout, mais on
// produit d'abord du HTML bien formé (défense en profondeur).
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
