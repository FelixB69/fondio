// Préparation du HTML d'une maquette avant son injection dans l'iframe.
//
// La frontière de sécurité, c'est le navigateur — pas nos regex. L'iframe est
// montée avec `sandbox="allow-scripts"` SANS `allow-same-origin` : elle reçoit
// une origine opaque et ne peut donc lire ni le DOM parent, ni les cookies, ni
// le localStorage où vit la session Supabase. Ajouter `allow-same-origin` à côté
// de `allow-scripts` annulerait entièrement le bac à sable — ne jamais le faire.
//
// Par-dessus, une CSP en <meta> restreint ce que la page peut charger et coupe
// TOUT appel réseau sortant (`connect-src 'none'`) : l'exfiltration devient
// impossible par construction, pas seulement improbable.
//
// Reste un effet de bord : dans une origine opaque, `localStorage`,
// `sessionStorage` et `document.cookie` lèvent une SecurityError. Les modèles
// en écrivent par réflexe dès qu'une maquette a une liste ou un formulaire, et
// l'exception laisserait une page BLANCHE, sans rien à dire à l'utilisateur.
// D'où le shim en mémoire injecté avant tout script de la page : la consigne du
// prompt reste la première ligne de défense, ceci en est le filet.

import type { ChatMessage } from "./data";

// Attribut `sandbox` de l'iframe. Volontairement minimal.
// - pas de `allow-same-origin` : c'est ce qui garantit l'origine opaque ;
// - pas de `allow-modals` : alert()/confirm() sont ignorés plutôt qu'affichés,
//   une maquette ne doit pas pouvoir ouvrir de boîte de dialogue crédible ;
// - pas de `allow-popups` ni `allow-top-navigation` : rien ne sort du cadre.
export const PROTOTYPE_SANDBOX = "allow-scripts";

// Allowlist stricte. `default-src 'none'` bloque tout ce qui n'est pas listé.
// `'unsafe-inline'` est nécessaire (le HTML généré porte ses styles et scripts
// en ligne) et `'unsafe-eval'` l'est pour le compilateur JIT de Tailwind CDN ;
// dans une origine opaque sans accès réseau, ni l'un ni l'autre n'ouvre de
// capacité nouvelle — le script inline peut déjà tout faire à l'intérieur.
export const PROTOTYPE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: https://placehold.co",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

// Remplace localStorage / sessionStorage / document.cookie par des équivalents
// en mémoire. Doit s'exécuter AVANT tout script de la maquette, d'où l'injection
// en tête de <head>.
const STORAGE_SHIM = `<script>(function(){
  function memoryStorage(){
    var store = Object.create(null);
    return {
      getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v){ store[String(k)] = String(v); },
      removeItem: function(k){ delete store[String(k)]; },
      clear: function(){ store = Object.create(null); },
      key: function(i){ var keys = Object.keys(store); return i < keys.length ? keys[i] : null; },
      get length(){ return Object.keys(store).length; }
    };
  }
  try { Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true }); } catch (e) {}
  try {
    var jar = '';
    Object.defineProperty(document, 'cookie', {
      get: function(){ return jar; },
      set: function(v){ jar = String(v); },
      configurable: true
    });
  } catch (e) {}
})();<\/script>`;

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PROTOTYPE_CSP}">`;

// En-tête à injecter : la CSP d'abord (elle ne s'applique qu'à ce qui la suit),
// le shim ensuite (il doit précéder les scripts de la maquette).
const INJECTED_HEAD = `${CSP_META}${STORAGE_SHIM}`;

// Insère l'en-tête au tout début de <head> — ou, à défaut, au bon endroit selon
// ce que le modèle a réellement produit (un fragment sans <html> arrive).
export function buildPrototypeSrcDoc(html: string): string {
  const source = html.trim();
  if (!source) return `<!DOCTYPE html><html><head>${INJECTED_HEAD}</head><body></body></html>`;

  const headOpen = source.match(/<head\b[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return source.slice(0, at) + INJECTED_HEAD + source.slice(at);
  }

  // Pas de <head> : on en crée un juste après <html>, sinon on préfixe le tout
  // (le navigateur reconstruira la structure autour).
  const htmlOpen = source.match(/<html\b[^>]*>/i);
  if (htmlOpen && htmlOpen.index !== undefined) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return source.slice(0, at) + `<head>${INJECTED_HEAD}</head>` + source.slice(at);
  }

  return INJECTED_HEAD + source;
}

// ---------------------------------------------------------------------------
// Contexte envoyé au modèle
// ---------------------------------------------------------------------------

const SUPERSEDED_MARKER = "[maquette de ce tour — remplacée depuis par une version plus récente]";

const CURRENT_PROTOTYPE_HEADER =
  "Maquette actuelle. Pour toute modification demandée, RENVOIE ce fichier entier, modifié :";

// Réinjecte la DERNIÈRE maquette dans le fil transmis au modèle.
//
// Le `content` d'un message ne porte que la prose : le HTML est rangé à part
// dans `artifacts`. Sans réinjection, le modèle ne reverrait jamais la page
// qu'il vient de produire et « mettez le bouton en bleu » repartirait de zéro.
//
// On ne réinjecte QUE la plus récente, les précédentes étant réduites à un
// marqueur : le coût de contexte reste constant quel que soit le nombre
// d'itérations, là où tout renvoyer saturerait la fenêtre en quelques tours
// (une maquette pèse 5 à 20 Ko).
export function withLatestPrototype(
  messages: ChatMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const hasPrototype = (m: ChatMessage) => m.artifacts?.some((a) => a.kind === "prototype") ?? false;
  let latest = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (hasPrototype(messages[i])) {
      latest = i;
      break;
    }
  }

  return messages.map((m, i) => {
    if (i !== latest) {
      const content = hasPrototype(m) ? `${m.content}\n\n${SUPERSEDED_MARKER}` : m.content;
      return { role: m.role, content };
    }
    const proto = m.artifacts?.find((a) => a.kind === "prototype");
    const html = proto && proto.kind === "prototype" ? proto.html : "";
    return {
      role: m.role,
      content: `${m.content}\n\n${CURRENT_PROTOTYPE_HEADER}\n\`\`\`html\n${html}\n\`\`\``,
    };
  });
}
