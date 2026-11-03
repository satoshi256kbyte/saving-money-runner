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
  'config/security-baseline.json',
  'docs/04-脅威モデルとセキュリティ基準.md',
  'scripts/quality/check-security-baseline.mjs',
  'scripts/quality/security-baseline-files.mjs',
  'scripts/quality/security-baseline-policy.mjs',
  'README.md',
  'AGENTS.md',
  '.github/CODEOWNERS',
];

const missingFiles = requiredFiles.filter((file) => !existsSync(join(root, file)));
if (missingFiles.length > 0) {
  console.error(`必須ファイルがありません: ${missingFiles.join(', ')}`);
  process.exit(1);
}

const codeowners = readFileSync(join(root, '.github/CODEOWNERS'), 'utf8');
const codeownerRules = codeowners
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));
const catchAllRule = codeownerRules.find((line) => /^\*\s+/u.test(line));
const owners = catchAllRule?.split(/\s+/u).slice(1) ?? [];
if (owners.length === 0 || owners.some((owner) => !/^@[A-Za-z0-9][A-Za-z0-9-]*$/u.test(owner))) {
  console.error('CODEOWNERSに有効な全体所有者を1つ以上指定してください');
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
  'security:check',
  'docs:check',
  'foundation:check',
  'quality',
];
const missingScripts = requiredScripts.filter((script) => !packageJson.scripts?.[script]);
if (missingScripts.length > 0) {
  console.error(`必須スクリプトがありません: ${missingScripts.join(', ')}`);
  process.exit(1);
}
