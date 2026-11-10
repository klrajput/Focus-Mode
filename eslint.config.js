// Root ESLint flat config (ESLint 10, typescript-eslint 8.72).
// Type-aware linting is intentionally off for the scaffold: the `recommended`
// ruleset needs no tsconfig project, so `npm run lint` works from a clean clone.
import tseslint from 'typescript-eslint';

const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '.npmcache/**',
  '.spikes/**',
  '.worktrees/**',
  'agent/release/**',
  'client/dist/**',
  'project-blueprint/**',
  'docs/**',
  '.tmp/**',
  '.ghcache/**',
];

export default [
  { ignores },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },
];
