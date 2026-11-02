import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const requiredFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'cdk.json',
  'cdk/bin/app.ts',
  'cdk/lib/foundation-stack.ts',
  'README.md',
];

const missingFiles = requiredFiles.filter((file) => !existsSync(join(root, file)));
if (missingFiles.length > 0) {
  console.error(`必須ファイルがありません: ${missingFiles.join(', ')}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const requiredScripts = [
  'format:check',
  'lint',
  'typecheck',
  'test',
  'cdk:check',
  'ministack:check',
  'docs:check',
  'quality',
];
const missingScripts = requiredScripts.filter((script) => !packageJson.scripts?.[script]);
if (missingScripts.length > 0) {
  console.error(`必須スクリプトがありません: ${missingScripts.join(', ')}`);
  process.exit(1);
}
