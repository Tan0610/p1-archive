import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'web/dist/**', '.staging/**', 'recovered/**', 'node_modules/**', 'reader/recover.html'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Feed rules that matter for correctness (see src/core/feed.ts).
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='index'] > Literal[raw!='null']",
          message: 'Feed indexes must come from the network (resolveNextIndex), never a literal.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          property: 'uploadPayload',
          message: 'Archive contents are uploaded as a collection; the feed only gets the reference (uploadReference).',
        },
      ],
    },
  },
  {
    // Recovery must work with nothing but the published identifiers.
    files: ['src/recover/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../core/*', '!../core/catalogue-schema.js'],
              message: 'Recovery may not depend on publisher code, config, archive.json or keys.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['reader/**/*.js', 'templates/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
)
