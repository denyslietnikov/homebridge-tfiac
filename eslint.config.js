const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

// We pass "recommendedConfig" to let "eslint:recommended" be recognized.
const compat = new FlatCompat({
  baseDirectory: process.cwd(),
  resolvePluginsRelativeTo: process.cwd(),
  // Provide recommendedConfig so that "eslint:recommended" works
  recommendedConfig: js.configs.recommended,
});

module.exports = [
  // Ignore dist folder
  {
    ignores: ['dist'],
  },

  // Use compat.extends for old-style extends.
  // Remove "plugin:@typescript-eslint/eslint-recommended" 
  // because it's superseded by "plugin:@typescript-eslint/recommended".
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ),

  {
    // Apply these settings/rules only to TypeScript files
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
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];