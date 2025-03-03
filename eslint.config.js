/* eslint-env node */

import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

// Pass "recommendedConfig" so that "eslint:recommended" is recognized.
const compat = new FlatCompat({
  baseDirectory: process.cwd(),
  resolvePluginsRelativeTo: process.cwd(),
  recommendedConfig: js.configs.recommended,
});

export default [
  // Ignore the dist folder
  {
    ignores: ['dist'],
  },

  // Extend old-style configurations. Note: we pass them as separate arguments.
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ),

  {
    // Apply these settings only to TypeScript files.
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2018,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'quotes': ['warn', 'single'],
      'indent': ['warn', 2, { 'SwitchCase': 1 }],
      'semi': ['warn', 'always'],
      'comma-dangle': ['warn', 'always-multiline'],
      'dot-notation': 'off',
      'eqeqeq': 'warn',
      'curly': ['warn', 'all'],
      'brace-style': ['warn'],
      'prefer-arrow-callback': ['warn'],
      'max-len': ['warn', 140],
      'no-console': ['warn'], // prefer the built-in Homebridge log methods
      'no-non-null-assertion': ['off'],
      'comma-spacing': ['error'],
      'no-multi-spaces': ['warn', { 'ignoreEOLComments': true }],
      'lines-between-class-members': ['warn', 'always', { 'exceptAfterSingleLine': true }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off'
    }
  }
];