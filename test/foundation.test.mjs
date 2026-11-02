import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('品質ゲートの入口が定義されている', () => {
  for (const script of [
    'format:check',
    'lint',
    'typecheck',
    'test',
    'cdk:check',
    'ministack:check',
    'docs:check',
    'foundation:check',
    'quality',
  ]) {
    assert.equal(typeof packageJson.scripts[script], 'string');
  }
});

test('CDKとMinistackの基盤ファイルが存在する', () => {
  assert.equal(existsSync(join(root, 'cdk.json')), true);
  assert.equal(existsSync(join(root, 'cdk/bin/app.ts')), true);
  assert.equal(existsSync(join(root, 'cdk/lib/foundation-stack.ts')), true);
  assert.equal(existsSync(join(root, 'compose.yaml')), true);
});

test('レビューとコードオーナーのガバナンスファイルが存在する', () => {
  assert.equal(existsSync(join(root, 'AGENTS.md')), true);
  const codeowners = readFileSync(join(root, '.github/CODEOWNERS'), 'utf8');
  assert.match(
    codeowners,
    /^\*\s+@[A-Za-z0-9][A-Za-z0-9-]*(?:\s+@[A-Za-z0-9][A-Za-z0-9-]*)*\s*$/mu,
  );
});

test('公開用の基盤ファイルへ認証情報を固定記載していない', () => {
  const compose = readFileSync(join(root, 'compose.yaml'), 'utf8');
  assert.equal(compose.includes('AWS_ACCESS_KEY_ID='), false);
  assert.equal(compose.includes('AWS_SECRET_ACCESS_KEY='), false);
});
