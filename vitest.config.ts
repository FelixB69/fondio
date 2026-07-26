import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Environnement `node` par DÉFAUT (logique pure lib/*, routes API app/api/*).
// Les tests qui touchent au DOM (hooks React, composants) déclarent en tête de
// fichier `// @vitest-environment jsdom`. L'alias `@/` est résolu nativement
// depuis tsconfig.json via resolve.tsconfigPaths. `setup.ts` branche les
// matchers @testing-library/jest-dom et le cleanup React après chaque test.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // Le tsconfig Next impose `jsx: preserve` (Next transpile lui-même). Le plugin
  // React fournit à Vitest la transform JSX (runtime automatique) nécessaire pour
  // les tests de composants/hooks (*.test.tsx). Sans lui, esbuild suit le
  // tsconfig et le JSX des tests n'est pas compilé.
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: [
      "lib/**/*.test.{ts,tsx}",
      "test/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
  },
});
