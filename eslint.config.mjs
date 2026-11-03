export default [
  {
    ignores: ['.git/**', '.kiro/**', 'node_modules/**', 'coverage/**', 'cdk.out/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-constant-condition': 'error',
      'no-duplicate-imports': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // テストだけが Buffer を使う。src の .ts は ESLint の対象外のまま（パーサーを追加しない）。
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
      },
    },
  },
];
