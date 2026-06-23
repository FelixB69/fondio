import { defineConfig } from "vitest/config";

// Tests unitaires de la logique pure (lib/*). Environnement `node` : aucune
// dépendance au DOM ni au réseau. L'alias `@/` est résolu nativement depuis
// tsconfig.json via resolve.tsconfigPaths.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "test/**/*.test.ts"],
  },
});
