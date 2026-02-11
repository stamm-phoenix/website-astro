import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginAstro from "eslint-plugin-astro";
import parserAstro from "astro-eslint-parser";
import pluginSvelte from "eslint-plugin-svelte";
import configPrettier from "eslint-config-prettier";
import pluginPrettier from "eslint-plugin-prettier";

export default tseslint.config(
  {
    // Global ignores
    ignores: [
      "dist/",
      ".astro/",
      "node_modules/",
      ".svelte-kit",
      ".env",
      ".env.*",
      "pnpm-lock.yaml",
      "api/dist",
    ],
  },
  // Base JS recommended
  pluginJs.configs.recommended,
  // Base TS recommended (spread the array)
  ...tseslint.configs.recommended,
  // Svelte recommended (spread if it's an array)
  ...pluginSvelte.configs['flat/recommended'],
  // Astro recommended (spread if it's an array)
  ...pluginAstro.configs.recommended,
  
  // Base config for all JS/TS files
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: ["./tsconfig.json"],
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },

  // Astro specific configuration
  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: parserAstro,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".astro"],
      },
      globals: {
        Astro: true,
      },
    },
    plugins: {
      prettier: pluginPrettier,
    },
    rules: {
      "prettier/prettier": "error",
    },
  },

  // Svelte specific configuration
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: pluginSvelte.parser, // pluginSvelte provides its own parser for .svelte files
      parserOptions: {
        parser: tseslint.parser, // For the script tags
        extraFileExtensions: [".svelte"],
      },
      globals: globals.browser,
    },
    plugins: {
      prettier: pluginPrettier,
    },
    rules: {
      "prettier/prettier": "error",
    },
  },

  // Specific override for `api` directory TypeScript files
  {
    files: ["api/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./api/tsconfig.json"],
      },
    },
  },
  
  // Prettier config (disables conflicting rules) - must be last
  configPrettier,
);
