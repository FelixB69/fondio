import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

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
