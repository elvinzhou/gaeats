/**
 * Vitest Configuration for GA Eats
 *
 * Configures the testing environment for unit and integration tests
 */

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: [
      "**/__tests__/**/*.test.ts",
      "**/__tests__/**/*.test.tsx",
      "scripts/**/*.test.js",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "app/generated/",
        "scripts/generated/",
        "**/*.config.ts",
        "**/*.d.ts",
      ],
    },
  },
});
