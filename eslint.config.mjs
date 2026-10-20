import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config — AGENTS.md AG-Q1.
 *
 * `next/core-web-vitals` + `typescript-eslint` recommended-type-checked, with
 * `react/jsx-no-literals` scoped to the UI surfaces (AGENTS.md §5.11). Prettier
 * owns formatting; `eslint-config-prettier` disables the stylistic rules.
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "prisma/migrations/**",
    ],
  },
  js.configs.recommended,
  ...nextVitals,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // AGENTS.md §5.11 — no user-visible literals in components; keys only.
    files: [
      "src/app/**/*.tsx",
      "src/components/**/*.tsx",
      "src/modules/*/ui/**/*.tsx",
    ],
    plugins: { react },
    rules: {
      "react/jsx-no-literals": "error",
    },
  },
  {
    // Tests touch the generated Prisma client, which is an untyped stub in
    // sandboxes that cannot download an engine. Runtime behaviour is what these
    // files assert; the application code keeps the strict rules.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
