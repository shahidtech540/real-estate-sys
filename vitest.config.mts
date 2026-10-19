import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest — ARCHITECTURE.md §14.3. Unit tests are pure (no database, no network);
 * integration tests opt in through `TEST_DATABASE_URL`. `TZ=UTC` matches the
 * rule in AGENTS.md §5.8: tests assert PKT behaviour from a UTC process.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { TZ: "UTC", NODE_ENV: "test" },
    restoreMocks: true,
  },
});
