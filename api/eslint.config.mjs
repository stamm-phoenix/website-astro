import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import configPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Global ignores
    ignores: ['dist/', 'node_modules/', '*.mjs'],
  },
  // Base JS recommended
  pluginJs.configs.recommended,
  // Base TS recommended (spread the array)
  ...tseslint.configs.recommended,

  // Base config for all TS files
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
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

  // Prettier config (disables conflicting rules) - must be last
  configPrettier
);
