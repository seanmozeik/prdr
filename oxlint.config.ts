import { composeDeClankConfig, coreBaseConfig, effectConfig } from '@seanmozeik/de-clank/config';
import { defineConfig } from 'oxlint';

const projectConfig = defineConfig({
  env: { es2024: true, node: true },
  globals: { Bun: 'readonly' },
  ignorePatterns: ['artifacts', 'coverage', 'dist', 'node_modules'],
  overrides: [
    { files: ['src/cli/**/*.ts', 'src/commands/**/*.ts'], rules: { 'no-console': 'off' } },
    {
      files: ['**/*.d.ts'],
      rules: { 'typescript/no-empty-interface': 'off', 'typescript/no-empty-object-type': 'off' },
    },
    {
      files: ['scripts/**/*.ts'],
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-statements': 'off',
        'no-console': 'off',
        'no-inline-comments': 'off',
        'no-magic-numbers': 'off',
        'typescript/explicit-function-return-type': 'off',
        'typescript/explicit-module-boundary-types': 'off',
        'typescript/no-unnecessary-condition': 'off',
        'typescript/prefer-nullish-coalescing': 'off',
      },
    },
    {
      files: ['**/*.test.ts'],
      globals: {
        afterEach: 'readonly',
        beforeEach: 'readonly',
        Bun: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
      },
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-statements': 'off',
        'no-inline-comments': 'off',
        'no-magic-numbers': 'off',
        'vitest/prefer-importing-vitest-globals': 'off',
      },
    },
    {
      files: ['src/lib/tty.ts'],
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'no-control-regex': 'off',
        'no-inline-comments': 'off',
        'no-magic-numbers': 'off',
        'sort-keys': 'off',
        'typescript/no-unnecessary-condition': 'off',
        'typescript/strict-boolean-expressions': 'off',
        'unicorn/escape-case': 'off',
        'unicorn/no-hex-escape': 'off',
        'unicorn/no-nested-ternary': 'off',
      },
    },
  ],
  rules: { 'de-clank/no-flat-prefix-clusters': ['error', { minimumClusterSize: 6 }] },
});

export default composeDeClankConfig(coreBaseConfig, effectConfig, projectConfig);
