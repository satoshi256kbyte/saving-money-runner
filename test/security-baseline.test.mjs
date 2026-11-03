import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findForbiddenPublicPattern,
  validateSecurityBaseline,
} from '../scripts/quality/security-baseline-policy.mjs';
import {
  collectPublicTextPaths,
  readPublicText,
} from '../scripts/quality/security-baseline-files.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseline = JSON.parse(readFileSync(join(root, 'config/security-baseline.json'), 'utf8'));
const document = readFileSync(join(root, 'docs/04-脅威モデルとセキュリティ基準.md'), 'utf8');

test('必須セキュリティ基準が全てリリース阻止条件になっている', () => {
  assert.equal(baseline.controls.length, 12);
  for (const control of baseline.controls) {
    assert.match(control.id, /^SEC-\d{3}$/);
    assert.equal(control.release_blocker, true);
  }
});

test('セキュリティ基準の文書とJSONのIDが一致している', () => {
  for (const control of baseline.controls) {
    assert.equal(document.includes(control.id), true);
  }
});

test('検査契約がリリース阻止条件と必須文字列を要求する', () => {
  const invalidBaseline = JSON.parse(JSON.stringify(baseline));
  invalidBaseline.controls[0].release_blocker = false;
  assert.throws(() => validateSecurityBaseline(invalidBaseline, document));

  const invalidFieldBaseline = JSON.parse(JSON.stringify(baseline));
  invalidFieldBaseline.controls[0].verification = 1;
  assert.throws(() => validateSecurityBaseline(invalidFieldBaseline, document));

  const invalidCategoryBaseline = JSON.parse(JSON.stringify(baseline));
  invalidCategoryBaseline.controls = invalidCategoryBaseline.controls.filter(
    (control) => control.category !== 'boundary',
  );
  assert.throws(() => validateSecurityBaseline(invalidCategoryBaseline, document));
});

test('公開情報検査がAWSパーティションとトークン形式を拒否する', () => {
  const account = ['123456', '789012'].join('');
  const awsArn = `${['arn', 'aws'].join(':')}:iam::${account}:role/example`;
  const govArn = `${['arn', 'aws-us-gov'].join(':')}:iam::${account}:role/example`;
  const chinaArn = `${['arn', 'aws-cn'].join(':')}:iam::${account}:role/example`;
  const githubToken = ['ghp', 'A'.repeat(32)].join('_');
  const githubFineGrainedToken = ['github', 'pat', 'A'.repeat(32)].join('_');
  const privateKeyHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const webhookSecretValue = ['webhook_secret', 'A'.repeat(32)].join(': ');
  const jsonSecret = ['"', 'password', '": "', 'A'.repeat(32), '"'].join('');
  const yamlSecret = ["'", 'token', "': '", 'A'.repeat(32), "'"].join('');
  const javascriptSecret = ['secret', ' = `', 'A'.repeat(32), '`'].join('');
  const apiKeyValue = ['api', '_key = "', 'https://example.com/path.with.symbols', '"'].join('');
  const authorizationValue = ['"', 'authorization', '": "', 'Bearer abc.def:ghi/jkl', '"'].join('');
  const unquotedAuthorization = ['authorization', ': ', 'Bearer abc.def:ghi/jkl'].join('');
  const unquotedApiKey = ['api', '_key', '=', 'https://example.com/path.with.symbols'].join('');
  const shortApiKey = ['api', '_key', '=', 'abc123'].join('');
  const awsSecretAccessKeyValue = ['AWS', '_SECRET_ACCESS_KEY=', 'A'.repeat(40)].join('');
  const shortToken = ['token', '=', 'abcde'].join('');

  for (const value of [
    awsArn,
    govArn,
    chinaArn,
    ['AKIA', '1234567890', 'ABCDEF'].join(''),
    ['ASIA', '1234567890', 'ABCDEF'].join(''),
    githubToken,
    githubFineGrainedToken,
    privateKeyHeader,
    webhookSecretValue,
    jsonSecret,
    yamlSecret,
    javascriptSecret,
    apiKeyValue,
    authorizationValue,
    unquotedAuthorization,
    unquotedApiKey,
    shortApiKey,
    awsSecretAccessKeyValue,
    shortToken,
  ]) {
    assert.notEqual(findForbiddenPublicPattern(value), undefined);
  }
  assert.equal(
    findForbiddenPublicPattern('arn:<PARTITION>:iam::<ACCOUNT_ID>:role/example'),
    undefined,
  );
});

test('公開検査の対象ファイルを固定する', () => {
  const paths = collectPublicTextPaths(root);
  for (const path of [
    'AGENTS.md',
    'README.md',
    'config/security-baseline.json',
    'package.json',
    'scripts/quality/check-structure.mjs',
    'scripts/quality/security-baseline-files.mjs',
    'scripts/quality/security-baseline-policy.mjs',
    'test/security-baseline.test.mjs',
    'src/index.ts',
    'cdk/lib/foundation-stack.ts',
    '.github/workflows/quality.yml',
  ]) {
    assert.equal(paths.includes(path), true);
  }
  assert.equal(
    paths.some((path) => path.startsWith('docs/')),
    true,
  );
  assert.equal(
    paths.some((path) => path.startsWith('specs/')),
    true,
  );
  assert.equal(
    paths.some((path) => path.startsWith('.github/')),
    true,
  );
});

test('Git情報がない場合もリポジトリ配下のテキストを走査する', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'security-baseline-'));
  const futureDirectory = join(temporaryRoot, 'future');
  const coverageDirectory = join(temporaryRoot, 'coverage');
  const stagingDirectory = join(temporaryRoot, '.cdk.staging');
  const dependencyDirectory = join(temporaryRoot, 'node_modules');
  mkdirSync(futureDirectory);
  mkdirSync(coverageDirectory);
  mkdirSync(stagingDirectory);
  mkdirSync(dependencyDirectory);
  writeFileSync(
    join(temporaryRoot, '.gitignore'),
    'ignored-secret.txt\n/root-only.txt\n**/secret.txt\n.env*\n!.env.example\ncoverage/\n.cdk.staging/\nnode_modules/\n',
  );
  writeFileSync(join(temporaryRoot, 'root-public.txt'), 'public');
  writeFileSync(join(temporaryRoot, 'secret.txt'), ['token', '=', 'ignored'].join(''));
  writeFileSync(join(temporaryRoot, 'root-only.txt'), ['token', '=', 'ignored'].join(''));
  writeFileSync(join(futureDirectory, 'secret.txt'), ['token', '=', 'ignored'].join(''));
  writeFileSync(join(futureDirectory, 'root-only.txt'), 'public');
  writeFileSync(join(temporaryRoot, 'ignored-secret.txt'), ['token', '=', 'ignored'].join(''));
  writeFileSync(join(temporaryRoot, '.env'), ['token', '=', 'hidden'].join(''));
  writeFileSync(join(temporaryRoot, '.env.example'), 'placeholder=true');
  writeFileSync(join(futureDirectory, 'future-public.txt'), 'public');
  writeFileSync(join(coverageDirectory, 'coverage.txt'), ['token', '=', 'ignored'].join(''));
  writeFileSync(join(stagingDirectory, 'staging.txt'), ['token', '=', 'ignored'].join(''));
  writeFileSync(join(dependencyDirectory, 'dependency.txt'), ['token', '=', 'ignored'].join(''));

  try {
    const paths = collectPublicTextPaths(temporaryRoot);
    assert.equal(paths.includes('root-public.txt'), true);
    assert.equal(paths.includes('future/future-public.txt'), true);
    assert.equal(paths.includes('ignored-secret.txt'), false);
    assert.equal(paths.includes('secret.txt'), false);
    assert.equal(paths.includes('future/secret.txt'), false);
    assert.equal(paths.includes('root-only.txt'), false);
    assert.equal(paths.includes('future/root-only.txt'), true);
    assert.equal(paths.includes('.env'), false);
    assert.equal(paths.includes('.env.example'), true);
    assert.equal(paths.includes('coverage/coverage.txt'), false);
    assert.equal(paths.includes('.cdk.staging/staging.txt'), false);
    assert.equal(paths.includes('node_modules/dependency.txt'), false);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('セキュリティ基準に公開用のAWS識別情報がない', () => {
  const content = readPublicText(root);
  assert.equal(findForbiddenPublicPattern(content), undefined);
});
