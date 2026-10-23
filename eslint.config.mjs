// Root ESLint flat config. Packages inherit it automatically (ESLint resolves the
// nearest config upward), so a package only needs `"lint": "eslint ."`.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.turbo/**',
    '**/.venv/**',
    'edge/ros2_ws/**',
    'docs/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Code-quality limits from the project coding-style rules (plan §9.2).
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-depth': ['error', 4],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // describe() blocks legitimately span many lines.
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
  prettier,
);
