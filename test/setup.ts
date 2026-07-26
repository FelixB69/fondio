import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// L'environnement jsdom de ce projet n'expose qu'un localStorage partiel (pas de
// removeItem/clear). On installe une implémentation Storage complète et fiable
// (adossée à une Map) pour que les composants (onboarding…) et leurs tests s'y
// appuient sans surprise.
if (typeof window !== "undefined") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

// jsdom n'implémente pas matchMedia, utilisé par useIsMobile (donc par tout
// composant responsive). On fournit un défaut inerte (non-mobile) pour que les
// composants montent ; les tests qui veulent piloter la largeur le remplacent.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Setup global partagé par TOUS les tests (env node ET jsdom). On y branche les
// matchers @testing-library/jest-dom et le cleanup React. Le cleanup n'a de sens
// qu'en présence d'un DOM : le garde-fou `typeof document` évite de planter les
// tests en environnement `node` (routes API, logique pure) qui partagent ce
// même setup.
afterEach(async () => {
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
