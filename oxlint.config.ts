import {
  composeDeClankConfig,
  coreBaseConfig,
  effectConfig,
  loadPersonalData,
} from '@seanmozeik/de-clank/config';
import { defineConfig } from 'oxlint';

const projectConfig = defineConfig({
  env: { es2024: true, node: true },
  globals: { Bun: 'readonly' },
  ignorePatterns: ['artifacts', 'coverage', 'dist', 'node_modules'],
  overrides: [
    { files: ['src/cli/**/*.ts', 'src/commands/**/*.ts'], rules: { 'no-console': 'off' } },
    { files: ['**/*.test.ts'], rules: { 'vitest/prefer-importing-vitest-globals': 'off' } },
  ],
  rules: { 'de-clank/no-personal-test-data': ['error', loadPersonalData()] },
});

export default composeDeClankConfig(coreBaseConfig, effectConfig, projectConfig);
