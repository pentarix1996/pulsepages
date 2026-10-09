import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Unused arguments in signatures document the contract (route handlers, callbacks).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  {
    // Test doubles and fixtures cast freely.
    files: ['__tests__/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    // Deno (Edge Functions) and standalone packages have their own tooling.
    'supabase/functions/**',
    'integrations/**',
    'packages/**',
    'scripts/**',
  ]),
])
