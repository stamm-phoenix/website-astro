import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginAstro from 'eslint-plugin-astro';
import * as parserAstro from 'astro-eslint-parser';
import pluginSvelte from 'eslint-plugin-svelte';
import configPrettier from 'eslint-config-prettier';
import pluginPrettier from 'eslint-plugin-prettier';
import pluginPlaywright from 'eslint-plugin-playwright';

/**
 * Modules of `api/lib` that the browser may import as values. They import no zod (checked by
 * `test/browser-code-without-zod.test.ts`), unlike most validators, schemas and data access.
 * Types come from any module: `import type` is erased. Check a new module before listing it.
 */
const BROWSER_SAFE_API_MODULES = [
  'abrechnung-session',
  'abstimmung-model',
  'aktion-stufen',
  'anwesenheit-model',
  'aufgaben-zuordnung',
  'calendar-day',
  'campflow-groups',
  'changelog-id',
  'download-file-name',
  'etag-version',
  'essen-einheiten-model',
  'essen-einkaeufe-model',
  'essen-einkauf-model',
  'essen-gerichte-model',
  'essen-packliste-model',
  'essen-planung-model',
  'essen-teilnehmende-model',
  'foto-pfade',
  'help-contacts',
  'inventur-model',
  'kjr-zuschuss',
  'kontakt-validation',
  'nikolaus-config',
  'nikolaus-dispo',
  'nikolaus-einteilung',
  'nikolaus-validation',
  'personen-model',
  'postfach-liste',
  'postfach-model',
  'problemmeldung-model',
  'protokoll-editor-model',
  'protokoll-korrektur-model',
  'protokoll-markdown',
  'protokoll-zeitraum',
  'sammelbestellung-export',
  'sammelbestellung-model',
  'sammelbestellung-shops',
  'sammelbestellung-stamm',
  'schnupper-model',
  'staff-settings-model',
];

export default tseslint.config(
  {
    // Global ignores
    ignores: [
      'dist/',
      '.astro/',
      'node_modules/',
      'test-results/',
      'playwright-report/',
      '.svelte-kit',
      '.env',
      '.env.*',
      'pnpm-lock.yaml',
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
    files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.json'],
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // Astro specific configuration
  {
    files: ['**/*.astro'],
    languageOptions: {
      parser: parserAstro,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.astro'],
      },
      globals: {
        Astro: true,
      },
    },
    plugins: {
      prettier: pluginPrettier,
    },
    rules: {
      'prettier/prettier': 'error',
    },
  },

  // Svelte specific configuration
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: pluginSvelte.parser, // pluginSvelte provides its own parser for .svelte files
      parserOptions: {
        parser: tseslint.parser, // For the script tags
        extraFileExtensions: ['.svelte'],
      },
      globals: globals.browser,
    },
    plugins: {
      prettier: pluginPrettier,
    },
    rules: {
      'prettier/prettier': 'error',
    },
  },

  // zod must not reach the browser bundle: from `api/lib` only the modules above are imported as values
  {
    files: ['src/**/*.{ts,svelte}'],
    ignores: ['src/lib/content/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message: 'zod must not reach the browser bundle.',
              allowTypeImports: true,
            },
          ],
          patterns: [
            {
              group: [
                'zod/*',
                '**/api/lib/**',
                ...BROWSER_SAFE_API_MODULES.map((module) => `!**/api/lib/${module}`),
              ],
              allowTypeImports: true,
              message:
                'Import values only from api modules without zod (BROWSER_SAFE_API_MODULES in eslint.config.mjs); use import type for types.',
            },
          ],
        },
      ],
    },
  },

  // Browser tests wait for a condition, never for a fixed time (use `tests/settle.ts`)
  {
    files: ['tests/**/*.ts'],
    plugins: { playwright: pluginPlaywright },
    rules: { 'playwright/no-wait-for-timeout': 'error' },
  },

  // Prettier config (disables conflicting rules) - must be last
  configPrettier
);
