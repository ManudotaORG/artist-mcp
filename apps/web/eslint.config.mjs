import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintPluginPrettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // ── Arrow functions ────────────────────────────────────────────────
      // All function declarations must be expressions (arrow or function
      // expression). Default exports are moved to the bottom of files as
      // `const` + `export default`.
      'func-style': ['error', 'expression'],

      // ── Direct React imports ──────────────────────────────────────────
      // Ban `import * as React from "react"`. Use named imports like
      // `import { useState } from "react"` instead.
      // ── No interfaces ─────────────────────────────────────────────────
      // Always use `type` instead of `interface`.
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value='react'] ImportNamespaceSpecifier",
          message:
            "Use named imports (e.g., import { useState } from 'react') instead of import * as React from 'react'.",
        },
        {
          selector: 'TSInterfaceDeclaration',
          message: 'Use `type` instead of `interface`.',
        },
      ],

      // ── Case-sensitive import paths ────────────────────────────────────
      // Flag imports whose casing differs from the file on disk. macOS and
      // Windows resolve case-insensitively, but Turbopack and Linux CI do
      // not, so a wrong-case import compiles locally and breaks the build in
      // CI. The TypeScript resolver from eslint-config-next resolves the
      // `@/*` tsconfig alias used across the codebase.
      'import/no-unresolved': ['error', { caseSensitive: true }],
    },
  },
  // ── Prettier integration ──────────────────────────────────────────────
  // Enforce formatting via ESLint and disable any stylistic rules that
  // conflict with Prettier.
  {
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      'prettier/prettier': 'error',
      ...eslintConfigPrettier.rules,
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Generated artifact dir (Vitest coverage).
    'coverage/**',
  ]),
]);

export default eslintConfig;
