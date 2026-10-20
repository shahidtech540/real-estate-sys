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
    // `.tsx` is for the render tests (React Testing Library / server render);
    // they still run in Node because `renderToStaticMarkup` needs no DOM.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    env: { TZ: "UTC", NODE_ENV: "test" },
    restoreMocks: true,
    /**
     * Integration files share **one** PostgreSQL database (`TEST_DATABASE_URL`)
     * and each needs the `company` singleton to itself: `company.test.ts` and
     * `projects.test.ts` both clear `project`/`company` to test the first-run
     * state (`DATABASE.md` §10.6, `AGENTS.md` §7.4). Vitest runs files in
     * parallel workers by default, which lets one suite delete the row the
     * other is asserting on. Serialise files so those fixtures cannot
     * interleave; the unit files lose a couple of seconds and gain determinism.
     */
    fileParallelism: false,
  },
});
